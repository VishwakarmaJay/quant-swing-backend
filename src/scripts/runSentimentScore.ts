import { scoreUnscoredArticles, sentimentHealth } from '@/news';
import { prisma } from '@services/prisma';

/**
 * Retro-scores the news archive through the FinBERT sidecar (ROADMAP B6).
 * Idempotent + resumable: scores whatever is unscored (or scored by a
 * different model@revision); `--rescore` wipes existing scores first and
 * re-scores the whole archive under the current pinned model.
 *
 *   bun run sentiment:score            # score the unscored backlog
 *   bun run sentiment:score --rescore  # wipe + re-score everything
 *
 * Scores the HEADLINE (title) — deterministic across sources; bodies vary
 * from absent to boilerplate (documented v1 limitation). The sidecar applies
 * the India-term normalizer before tokenization.
 */

const run = async () => {
  const health = await sentimentHealth();
  if (!health) {
    console.error(
      'Sidecar not reachable. Start it first:\n' +
        '  cd sidecar && .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8001',
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Sidecar up: ${health.model}@${health.revision.slice(0, 12)}\n`);

  if (process.argv.includes('--rescore')) {
    const wiped = await prisma.newsArticle.updateMany({
      data: { sentimentScoredAt: null, sentimentModel: null },
    });
    console.log(`--rescore: cleared scores on ${wiped.count} article(s).`);
  }

  const total = await prisma.newsArticle.count();
  const s = await scoreUnscoredArticles();
  console.log(`Archive ${total} articles — ${s.toScore} to score, ${s.scored.length} scored.`);

  if (s.scored.length > 0) {
    const labelCounts: Record<string, number> = {};
    let scoreSum = 0;
    for (const a of s.scored) {
      labelCounts[a.label] = (labelCounts[a.label] ?? 0) + 1;
      scoreSum += a.score;
    }
    const dist = Object.entries(labelCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([l, n]) => `${l} ${n} (${((n / s.scored.length) * 100).toFixed(1)}%)`)
      .join(' · ');
    console.log(`\n  Labels: ${dist}`);
    console.log(`  Mean score (pos−neg): ${(scoreSum / s.scored.length).toFixed(4)}`);

    const sorted = [...s.scored].sort((a, b) => b.score - a.score);
    console.log(`\n  Most POSITIVE (spot-check):`);
    for (const e of sorted.slice(0, 5)) console.log(`    ${e.score.toFixed(3)}  ${e.title.slice(0, 90)}`);
    console.log(`  Most NEGATIVE (spot-check):`);
    for (const e of sorted.slice(-5).reverse()) console.log(`    ${e.score.toFixed(3)}  ${e.title.slice(0, 90)}`);
  }

  if (s.degraded) {
    console.log(`\n⚠️ Sidecar degraded mid-run — ${s.scored.length} scored, rest left unscored. Re-run to resume.`);
    process.exitCode = 1;
  } else {
    console.log(`\n✅ Archive fully scored under ${s.modelVersion}.`);
  }
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
