/** Fundamentals ingestion domain types (ROADMAP B4). */

/** One parsed quarter from the Screener quarterly-results table. */
export type ParsedQuarter = {
  /** Quarter end date, ISO (e.g. 2026-06-30 for a "Jun 2026" column). */
  periodEnd: string;
  /** EPS in ₹ ("EPS in Rs" row). */
  epsBasic: number;
  /** ₹ crore, when present. */
  netProfit: number | null;
  /** ₹ crore, when present. */
  sales: number | null;
};

/** Everything extracted from one Screener company page. */
export type ScreenerPage = {
  /** BSE scrip code from the page's bseindia.com link (null if absent). */
  bseScripCode: string | null;
  /** Which results table the page carries. */
  basis: 'consolidated' | 'standalone';
  quarters: ParsedQuarter[];
  /** Headline ratios (name → numeric value) from the top ratios list. */
  ratios: Record<string, number>;
};

/** A dated BSE result announcement for one scrip. */
export type ResultAnnouncement = {
  /** Dissemination time, ISO. */
  dissemAt: string;
  headline: string;
};
