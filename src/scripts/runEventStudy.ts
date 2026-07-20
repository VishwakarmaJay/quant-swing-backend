import { loadCandleStore, type CandleStore } from '@/backtest';
import { classifyEvent, EXTRACTOR_VERSION, type EventType } from '@/events/classify';
import { cellStats, HORIZONS, measureEvent, type Horizon } from '@/events/eventStudy';
import { prisma } from '@services/prisma';

/**
 * B12 — Event study. Read-only.
 *
 *   bun run events:study
 *
 * WHY: every lever the program has found (both factor floors, all eight B11 rank
 * keys) trims the LEFT tail or does nothing. Nothing yet identifies large
 * winners. Events are the standing hypothesis for where the right tail lives —
 * and BSE labels its own announcements, so typing them is a lookup, not NLP.
 *
 * This measures, per event type: forward EXCESS return vs Nifty at 1/3/5/10
 * trading days, with a 95% CI (does the cell say anything at all?), the hit rate,
 * and — the statistic that matters here — **p90, the upside tail**. A type with a
 * flat mean but a fat p90 is exactly what a 2R/3R target strategy needs; a type
 * with a good mean and a thin p90 is not.
 *
 * POINT-IN-TIME: outcomes anchor at the first close STRICTLY AFTER `availableAt`
 * (never publishedAt), the same next-bar discipline the trade simulator uses.
 * Exchange-filing rows carry the most trustworthy availability evidence, so the
 * study runs on BSE origins by default.
 */

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const padE = (s: string | number, w: number) => String(s).padEnd(w);
const pad = (s: string | number, w: number) => String(s).padStart(w);

const run = async () => {
  const horizonArg = Number(process.argv[2] ?? 5) as Horizon;
  const horizon: Horizon = (HORIZONS as readonly number[]).includes(horizonArg) ? horizonArg : 5;

  console.log(`Loading candles… (extractor ${EXTRACTOR_VERSION})`);
  const store: CandleStore = await loadCandleStore();
  const benchByDate = new Map((store.benchmark ?? []).map((c) => [c.tradeDate, c.close]));
  // News symbols are canonical (BAJAJ-AUTO); instrument symbols carry the
  // exchange suffix (ABB-EQ). Same normalization the live sentiment pre-pass
  // uses (`factors/context.ts`).
  const seriesBySymbol = new Map(
    store.instruments.map((i) => [i.symbol.replace(/-EQ$/, ''), store.seriesById.get(i.id) ?? []]),
  );
  console.log(`Universe ${store.instruments.length} stocks · benchmark ${benchByDate.size} days.`);

  // Exchange filings only: the most trustworthy availableAt, and the only rows
  // that carry the exchange's own category label.
  const rows = await prisma.newsArticle.findMany({
    where: { origin: { in: ['LIVE_BSE', 'BSE_BACKFILL'] }, symbols: { isEmpty: false } },
    select: { title: true, body: true, symbols: true, availableAt: true },
    orderBy: { availableAt: 'asc' },
  });
  console.log(`${rows.length} symbol-mapped exchange filings.\n`);

  // Classify → measure. One filing tagged to N symbols contributes N observations.
  const excesses = new Map<EventType, Map<Horizon, number[]>>();
  const counts = new Map<EventType, number>();
  const methodCounts = { 'exchange-label': 0, keyword: 0, none: 0 };
  let measured = 0;

  for (const r of rows) {
    const c = classifyEvent(r.title, r.body);
    methodCounts[c.method]++;
    counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
    for (const symbol of r.symbols) {
      const candles = seriesBySymbol.get(symbol);
      if (!candles?.length) continue;
      const out = measureEvent(candles, benchByDate, r.availableAt);
      if (!out) continue;
      measured++;
      let byH = excesses.get(c.type);
      if (!byH) excesses.set(c.type, (byH = new Map()));
      for (const h of HORIZONS) {
        const v = out.excessByHorizon[h];
        if (v == null) continue;
        (byH.get(h) ?? byH.set(h, []).get(h)!).push(v);
      }
    }
  }

  const typed = rows.length - (counts.get('OTHER') ?? 0);
  console.log(`=== TYPING COVERAGE (extractor ${EXTRACTOR_VERSION}) ===`);
  console.log(
    `  typed ${typed}/${rows.length} (${((100 * typed) / rows.length).toFixed(1)}%) · ` +
      `exchange-label ${methodCounts['exchange-label']} · keyword ${methodCounts.keyword} · untyped ${methodCounts.none}`,
  );
  console.log(`  ${measured} symbol-observations measured against price history.`);
  if (measured === 0) {
    // A broken join produces empty tables that look exactly like "no events
    // qualified" — i.e. a silent false negative. Fail loudly instead.
    console.error(
      `\n  ❌ ZERO observations measured despite ${rows.length} filings. This is a JOIN` +
        `\n     FAILURE, not a finding — check symbol normalization (news symbols are` +
        `\n     canonical, instrument symbols carry -EQ) and the candle date range.`,
    );
    process.exitCode = 1;
    return;
  }

  // ── Main table: one row per event type at the chosen horizon.
  console.log(`\n=== EXCESS RETURN vs NIFTY · ${horizon}-day horizon ===`);
  console.log(`  p90 is the RIGHT-TAIL statistic. A cell only claims something if its CI excludes 0.`);
  console.log(
    `  ${padE('event type', 17)} ${pad('n', 7)} ${pad('mean', 8)} ${pad('CI low', 8)} ${pad('CI high', 8)} ` +
      `${pad('hit%', 6)} ${pad('p90', 8)} ${pad('p10', 8)} ${pad('signif', 7)}`,
  );

  const rowsOut = [...excesses.entries()]
    .map(([type, byH]) => ({ type, stats: cellStats(byH.get(horizon) ?? []) }))
    .filter((r) => r.stats.n >= 30) // thin cells say nothing; drop rather than mislead
    .sort((a, b) => b.stats.p90 - a.stats.p90);

  for (const { type, stats: s } of rowsOut) {
    const signif = s.ci95[0] > 0 ? '  +ve' : s.ci95[1] < 0 ? '  -ve' : '    —';
    console.log(
      `  ${padE(type, 17)} ${pad(s.n, 7)} ${pad(pct(s.meanExcess), 8)} ${pad(pct(s.ci95[0]), 8)} ` +
        `${pad(pct(s.ci95[1]), 8)} ${pad(s.hitRatePct.toFixed(1), 6)} ${pad(pct(s.p90), 8)} ` +
        `${pad(pct(s.p10), 8)} ${pad(signif, 7)}`,
    );
  }

  // ── Horizon profile: does any effect build or decay? (drift vs pop)
  console.log(`\n=== MEAN EXCESS BY HORIZON (drift profile) ===`);
  console.log(`  ${padE('event type', 17)} ${HORIZONS.map((h) => pad(`${h}d`, 9)).join('')}`);
  for (const { type } of rowsOut) {
    const byH = excesses.get(type)!;
    const cells = HORIZONS.map((h) => {
      const s = cellStats(byH.get(h) ?? []);
      return pad(s.n >= 30 ? pct(s.meanExcess) : '—', 9);
    }).join('');
    console.log(`  ${padE(type, 17)}${cells}`);
  }

  console.log(
    `\n  ⚠️ Event STUDY, not a strategy: it measures what happened after an event, with no` +
      `\n     entry gate, sizing, or cost model. A promising cell is a hypothesis for the` +
      `\n     factor/backtest pipeline, NOT a tradeable result — and must clear the anchored` +
      `\n     walk-forward + portfolio gate like every other lever. Survivorship (today's` +
      `\n     universe) and the ~55% typing coverage both apply; untyped rows are excluded,` +
      `\n     not assumed neutral.`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
