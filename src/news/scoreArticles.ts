import { prisma } from '@services/prisma';

import { scoreSentiment, sentimentHealth } from './sentimentClient';

/**
 * Scores unscored archive articles through the FinBERT sidecar (ROADMAP B6).
 * No-throw and resumable: a down sidecar returns degraded=true with whatever
 * was scored so far; unscored rows are picked up on the next call. Articles
 * scored by a DIFFERENT model@revision count as unscored (a model bump
 * re-scores instead of silently mixing regimes).
 *
 * Scores the HEADLINE (title) — deterministic across sources; bodies range
 * from absent to boilerplate (v1 limitation, documented).
 */

const BATCH = 64;

export type ScoredArticle = { id: string; title: string; score: number; label: string };
export type ScoreRunSummary = {
  modelVersion: string | null;
  toScore: number;
  scored: ScoredArticle[];
  degraded: boolean;
};

export const scoreUnscoredArticles = async (limit = Infinity): Promise<ScoreRunSummary> => {
  const health = await sentimentHealth();
  if (!health) return { modelVersion: null, toScore: 0, scored: [], degraded: true };
  const modelVersion = `${health.model}@${health.revision.slice(0, 12)}`;

  const articles = await prisma.newsArticle.findMany({
    where: { OR: [{ sentimentScoredAt: null }, { sentimentModel: { not: modelVersion } }] },
    orderBy: { fetchedAt: 'asc' },
    take: Number.isFinite(limit) ? limit : undefined,
    select: { id: true, title: true },
  });

  const scored: ScoredArticle[] = [];
  for (let i = 0; i < articles.length; i += BATCH) {
    const chunk = articles.slice(i, i + BATCH);
    const batch = await scoreSentiment(chunk.map((a) => a.title));
    if (!batch) return { modelVersion, toScore: articles.length, scored, degraded: true };
    for (let j = 0; j < chunk.length; j++) {
      const a = chunk[j]!;
      const r = batch.results[j]!;
      await prisma.newsArticle.update({
        where: { id: a.id },
        data: {
          sentimentScore: r.score,
          sentimentLabel: r.label,
          sentimentPositive: r.positive,
          sentimentNegative: r.negative,
          sentimentNeutral: r.neutral,
          sentimentModel: batch.modelVersion,
          sentimentScoredAt: new Date(),
        },
      });
      scored.push({ id: a.id, title: a.title, score: r.score, label: r.label });
    }
  }
  return { modelVersion, toScore: articles.length, scored, degraded: false };
};
