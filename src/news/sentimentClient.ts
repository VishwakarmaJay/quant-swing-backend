import { env } from '@config/env';
import logger from '@services/logger';

/**
 * SentimentProvider client for the FinBERT sidecar (ADR-0006 / ROADMAP B6).
 *
 * Contract: 5s timeout, 2 retries, DEGRADED-NEUTRAL fallback — a down sidecar
 * yields `null` (callers leave articles unscored and move on), it never throws
 * and never fails a pipeline. Same posture as Telegram delivery.
 */

export type SentimentResult = {
  positive: number;
  negative: number;
  neutral: number;
  label: string;
  /** positive − negative ∈ [−1, 1]. */
  score: number;
};

export type SentimentBatch = {
  /** "<model>@<revision>" — stamped per scored article. */
  modelVersion: string;
  results: SentimentResult[];
};

const RETRIES = 2; // additional attempts after the first (ADR-0006)

const attempt = async (texts: string[]): Promise<SentimentBatch | null> => {
  const res = await fetch(`${env.SENTIMENT_SIDECAR_URL}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
    signal: AbortSignal.timeout(env.SENTIMENT_TIMEOUT_MS),
  });
  if (!res.ok) {
    logger.warn(`[Sentiment]: sidecar HTTP ${res.status}`);
    return null;
  }
  const payload = (await res.json()) as {
    model?: string;
    revision?: string;
    results?: SentimentResult[];
  };
  if (!payload.model || !payload.revision || !Array.isArray(payload.results)) return null;
  if (payload.results.length !== texts.length) {
    logger.warn(`[Sentiment]: sidecar returned ${payload.results.length} results for ${texts.length} texts`);
    return null;
  }
  return { modelVersion: `${payload.model}@${payload.revision.slice(0, 12)}`, results: payload.results };
};

/**
 * Scores a batch of texts. Null = degraded (sidecar down/misbehaving) — the
 * caller skips scoring; nothing throws.
 */
export const scoreSentiment = async (texts: string[]): Promise<SentimentBatch | null> => {
  if (texts.length === 0) return null;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      const batch = await attempt(texts);
      if (batch) return batch;
    } catch (err) {
      logger.warn(
        `[Sentiment]: sidecar attempt ${i + 1}/${RETRIES + 1} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  logger.warn('[Sentiment]: sidecar unavailable — degraded-neutral (articles stay unscored)');
  return null;
};

/** Sidecar liveness + pinned-revision info (used by the scoring script preamble). */
export const sentimentHealth = async (): Promise<{ model: string; revision: string } | null> => {
  try {
    const res = await fetch(`${env.SENTIMENT_SIDECAR_URL}/health`, {
      signal: AbortSignal.timeout(env.SENTIMENT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const h = (await res.json()) as { model?: string; revision?: string };
    return h.model && h.revision ? { model: h.model, revision: h.revision } : null;
  } catch {
    return null;
  }
};
