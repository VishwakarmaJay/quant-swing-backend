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
 * backtested results.
 *
 * [REPAIRED 2026-07-21 — see docs/SURVIVORSHIP.md] The "JS/WAF data block" was
 * false: historical Nifty-200 constituents are obtainable (Wayback CSV snapshots +
 * reconstitution PDFs) and delisted-name OHLCV is in the B13 bhavcopy archive. The
 * 10 delisted victims below were ingested (`survivorship:ingest`) with the
 * index-exit `to` windows in UNIVERSE_MEMBERSHIP, and the SRS pre-pass now honours
 * `isMemberOn`. Measured impact: bias inflated the FULL deep window ~4.4pp but the
 * validated COVERAGE gate is unchanged and the verdict holds. Residual: exact
 * reconstitution dates would sharpen the ±1-reconstitution window precision.
 */

export type MembershipWindow = { from?: string; to?: string };

/** Canonical symbol → membership exception window. `to` is exclusive. */
export const UNIVERSE_MEMBERSHIP: Readonly<Record<string, MembershipWindow>> = {
  // Survivorship victims ingested from the bhavcopy archive (docs/SURVIVORSHIP.md).
  // `to` = when the name left the Nifty-200 LARGE-CAP UNIVERSE (index-exit), NOT its
  // delisting date — using delist-date would let the backtest trade a name during a
  // period it had already dropped to small-cap (e.g. RELINFRA's 2024 13× rally after
  // it left the index in ~2022), which is a look-ahead-style bias, not a correction.
  // Exit dates are bracketed by the Nifty-200 constituent snapshots (2021-03 / 2022-03
  // / 2023-08 / current): the 8 below were confirmed members in 2021-03 and absent by
  // 2022-03, so `to` ≈ the 2022-Q1 reconstitution; PEL survived to 2023-08; DHFL
  // delisted mid-membership (2021-06). ⚠️ The snapshots are annual, so exit is precise
  // only to ±1 reconstitution — a rigorous version needs the exact reconstitution
  // dates from the press-release PDFs (docs/SURVIVORSHIP.md §4).
  DHFL: { to: '2021-06-14' }, // delisted while a member (insolvency)
  RELCAPITAL: { to: '2022-04-01' },
  FRETAIL: { to: '2022-04-01' },
  FCONSUMER: { to: '2022-04-01' },
  GSPL: { to: '2022-04-01' },
  RELINFRA: { to: '2022-04-01' },
  DISHTV: { to: '2022-04-01' },
  TV18BRDCST: { to: '2022-04-01' },
  RAJESHEXPO: { to: '2022-04-01' },
  PEL: { to: '2024-04-01' }, // present through the 2023-08 snapshot
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
