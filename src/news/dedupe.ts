/**
 * Title normalization + Jaccard dedup (ROADMAP B3). The same story is syndicated
 * across ET / Moneycontrol / Google News with near-identical headlines; counting
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
