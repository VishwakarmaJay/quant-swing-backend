/**
 * The canonical-symbol convention — the single home for a join rule that is
 * load-bearing across the whole platform.
 *
 * Two symbol spaces exist and they are NOT interchangeable:
 *
 *   - **Instrument space** — what the broker's scrip master returns and what
 *     `instrument.symbol` stores: `ABB-EQ`, `RELIANCE-EQ` (NSE equity series
 *     suffix). Index rows carry no suffix (`NIFTY`, `India VIX`).
 *   - **Canonical space** — what every derived dataset keys on: `ABB`,
 *     `RELIANCE`. News `symbols[]`, `quarterly_fundamental.symbol`, the alias
 *     dictionary, and sector-peer maps all live here.
 *
 * Joining the two requires stripping the series suffix. That rule was previously
 * copy-pasted as an inline regex at nine call sites; the B12 event study then
 * omitted it and silently measured **zero** observations — empty result tables
 * that were indistinguishable from "no events qualified". A research harness
 * producing a confident-looking false negative is the worst possible failure
 * mode, so the rule now lives here, once, with tests.
 *
 * Pure: no I/O, no clock. Idempotent — safe to apply to an already-canonical
 * symbol, which is what makes it usable at every boundary without checking.
 */

/** NSE series suffixes seen in the scrip master for our universe. */
const SERIES_SUFFIX = /-(EQ|BE|BZ|SM|ST)$/;

/**
 * Instrument symbol → canonical symbol (`ABB-EQ` → `ABB`).
 * Idempotent, and a no-op for index rows which carry no suffix.
 */
export const canonicalSymbol = (instrumentSymbol: string): string =>
  instrumentSymbol.replace(SERIES_SUFFIX, '');

/**
 * Builds a canonical-keyed lookup from instrument-keyed rows — the shape almost
 * every cross-dataset join actually needs.
 *
 * On duplicate canonical keys the FIRST wins and the collision is returned, so a
 * caller can surface it rather than silently lose rows (e.g. a universe holding
 * both `X-EQ` and `X-BE`).
 */
export const byCanonicalSymbol = <T>(
  items: readonly T[],
  symbolOf: (item: T) => string,
): { map: Map<string, T>; collisions: string[] } => {
  const map = new Map<string, T>();
  const collisions: string[] = [];
  for (const item of items) {
    const key = canonicalSymbol(symbolOf(item));
    if (map.has(key)) collisions.push(key);
    else map.set(key, item);
  }
  return { map, collisions };
};
