/**
 * As-of universe membership (ROADMAP B8.2) — the survivorship-bias stopper.
 *
 * The equity universe is committed reference data that only ever grew; the
 * backtest replays it as of TODAY's list, so any stock that is later removed
 * (delisting, merger, curation) would silently vanish from history and the
 * backtest would compound survivorship bias going forward.
 *
 * THE RULE: never delete a symbol from `equityUniverse.ts`. When one leaves
 * the tradeable universe, add a membership window here instead — the backtest
 * keeps its history and stops signalling it from `to` onward, exactly like a
 * live operator would have experienced.
 *
 * Entries are SPARSE — only exceptions. A symbol with no entry is a member for
 * its whole candle history (listings are naturally bounded by their first
 * candle + the engine's warmup). `from`/`to` are ISO dates; `to` is exclusive.
 *
 * ⚠️ Residual, honestly stated: this mechanism cannot repair the PAST — the
 * universe was curated in 2025, so stocks that would have been picked in
 * 2021–2024 but collapsed before curation are absent, which flatters
 * backtested results. Repairing that needs historical NSE index change
 * records (niftyindices.com serves them only via a JS/WAF-guarded page —
 * attempted 2026-07-18, left as an open data task).
 */

export type MembershipWindow = { from?: string; to?: string };

/** Canonical symbol → membership exception window. Empty = no exceptions yet. */
export const UNIVERSE_MEMBERSHIP: Readonly<Record<string, MembershipWindow>> = {
  // (none yet — TMCV/TMPV post-demerger listings are naturally bounded by
  // their first candles; no symbol has left the universe since curation)
};

/** Is `symbol` a universe member on `dateIso`? (No entry → always a member.) */
export const isMemberOn = (
  symbol: string,
  dateIso: string,
  membership: Readonly<Record<string, MembershipWindow>> = UNIVERSE_MEMBERSHIP,
): boolean => {
  const w = membership[symbol];
  if (!w) return true;
  if (w.from && dateIso < w.from) return false;
  if (w.to && dateIso >= w.to) return false;
  return true;
};
