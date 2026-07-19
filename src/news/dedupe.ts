/**
 * Title normalization + Jaccard dedup (ROADMAP B3). The same story is syndicated
 * across ET / LiveMint / Google News with near-identical headlines; counting
 * it once keeps the sentiment signal from double-weighting a single event.
 *
 * All pure functions — the ingestion job supplies the recent-title corpus from
 * the DB and this decides duplicate/not, so the policy is unit-testable and
 * deterministic.
 */

/** Threshold at/above which two normalized titles are treated as the same story. */
export const DEFAULT_JACCARD_THRESHOLD = 0.7;

/** Very common words that carry no disambiguating signal in a headline. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by',
  'from', 'as', 'is', 'are', 'be', 'this', 'that', 'it', 'its', 'after', 'over',
  'amid', 'up', 'down', 'vs', 'via',
]);

/**
 * Normalizes a headline for comparison + storage: lowercase, strip punctuation
 * to spaces, collapse whitespace. Kept deliberately simple and reversible-free
 * (no stemming) so it is stable and language-agnostic enough for Indian headlines.
 */
export const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Content token set for similarity: normalized tokens minus stopwords. */
export const titleTokens = (title: string): Set<string> => {
  const tokens = normalizeTitle(title)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
};

/** Jaccard similarity of two token sets: |A∩B| / |A∪B| (0..1; 0 when both empty). */
export const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
};

/**
 * True when `candidate` is a near-duplicate of any title in `existing`.
 * `existing` is the recent-window corpus (across all sources) supplied by the
 * caller. An exact normalized match short-circuits to duplicate.
 */
export const isDuplicateTitle = (
  candidate: string,
  existing: Iterable<string>,
  threshold: number = DEFAULT_JACCARD_THRESHOLD,
): boolean => {
  const candNorm = normalizeTitle(candidate);
  const candSet = titleTokens(candidate);
  for (const other of existing) {
    if (normalizeTitle(other) === candNorm) return true;
    if (jaccard(candSet, titleTokens(other)) >= threshold) return true;
  }
  return false;
};

/** A normalized title with its article-time, for time-windowed dedup. */
export type DatedTitle = { titleNormalized: string; publishedAtMs: number };

const DAY_MS = 86_400_000;

/**
 * Day-bucketed index of dated titles for time-windowed dedup (B3.5/B3.6). A
 * candidate is a duplicate only of titles published within ±`windowMs` of it
 * — the live pipeline's recency rule transposed to article time. Without the
 * window, a multi-year backfill corpus collapses every recurrence of a
 * periodic templated title (quarterly "Board Meeting Intimation"…) into its
 * first occurrence — measured live: 64%+ of a 2.5-year BSE run wrongly dropped.
 *
 * The bucketing keeps this near-linear: a flat scan is O(corpus) PER candidate
 * → O(n²) over a run, which CPU-starved the import box at 171k records. Keying
 * by UTC day and probing only the ±ceil(windowDays) neighbouring buckets makes
 * each check O(titles in-window), independent of total corpus size.
 */
export class DatedTitleIndex {
  private readonly buckets = new Map<number, DatedTitle[]>();
  private readonly windowMs: number;
  private readonly windowDays: number;
  private readonly threshold: number;

  constructor(windowMs: number, threshold: number = DEFAULT_JACCARD_THRESHOLD) {
    this.windowMs = windowMs;
    this.windowDays = Math.ceil(windowMs / DAY_MS);
    this.threshold = threshold;
  }

  add(titleNormalized: string, publishedAtMs: number): void {
    const day = Math.floor(publishedAtMs / DAY_MS);
    const bucket = this.buckets.get(day);
    if (bucket) bucket.push({ titleNormalized, publishedAtMs });
    else this.buckets.set(day, [{ titleNormalized, publishedAtMs }]);
  }

  hasDuplicate(candidateNormalized: string, candidatePublishedAtMs: number): boolean {
    const day = Math.floor(candidatePublishedAtMs / DAY_MS);
    let candSet: Set<string> | null = null;
    for (let d = day - this.windowDays; d <= day + this.windowDays; d++) {
      const bucket = this.buckets.get(d);
      if (!bucket) continue;
      for (const other of bucket) {
        if (Math.abs(other.publishedAtMs - candidatePublishedAtMs) > this.windowMs) continue;
        if (other.titleNormalized === candidateNormalized) return true;
        candSet ??= titleTokens(candidateNormalized);
        if (jaccard(candSet, titleTokens(other.titleNormalized)) >= this.threshold) return true;
      }
    }
    return false;
  }
}
