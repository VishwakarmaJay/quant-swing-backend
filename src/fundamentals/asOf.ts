import dayjs from 'dayjs';

import type { ResultAnnouncement } from './types';

/**
 * Point-in-time fundamentals math (ROADMAP B4) — all pure.
 *
 * The one discipline that makes a Fundamental backtest honest: a quarter's
 * numbers become usable at their ANNOUNCEMENT date, never at period end. A June
 * quarter announced on 17 July did not exist publicly on 1 July.
 */

/** SEBI LODR result deadlines: 45 days after quarter end; 60 for the March (annual) quarter. */
export const fallbackAvailableAt = (periodEnd: string): string => {
  const end = dayjs(periodEnd);
  const days = end.month() === 2 ? 60 : 45; // month() is 0-based → 2 = March
  return end.add(days, 'day').format('YYYY-MM-DD');
};

/**
 * Matches a quarter to its result announcement: the EARLIEST announcement
 * strictly after periodEnd and within `windowDays`. Safe against neighbours:
 * the prior quarter's results are due ≤60d after the PRIOR period end, which is
 * on/before this periodEnd — so they cannot fall inside this window.
 */
export const matchAnnouncementToQuarter = (
  periodEnd: string,
  announcements: readonly ResultAnnouncement[],
  windowDays = 75,
): ResultAnnouncement | null => {
  const start = dayjs(periodEnd);
  const end = start.add(windowDays, 'day');
  let best: ResultAnnouncement | null = null;
  for (const a of announcements) {
    const d = dayjs(a.dissemAt);
    if (!d.isAfter(start) || d.isAfter(end)) continue;
    if (!best || d.isBefore(dayjs(best.dissemAt))) best = a;
  }
  return best;
};

/** A stored quarter with its availability moment resolved. */
export type AvailableQuarter = {
  periodEnd: string;
  epsBasic: number;
  /** announcedAt ?? fallbackAvailableAt — when the number became public. */
  availableAt: string;
};

/**
 * Trailing-twelve-month EPS as KNOWN on `date`: the 4 most recent quarters
 * whose availableAt ≤ date (by periodEnd). Null until 4 such quarters exist.
 */
export const ttmEpsKnownBy = (quarters: readonly AvailableQuarter[], date: string): number | null => {
  const known = quarters
    .filter((q) => !dayjs(q.availableAt).isAfter(dayjs(date)))
    .sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
  if (known.length < 4) return null;
  return known.slice(-4).reduce((s, q) => s + q.epsBasic, 0);
};

/** Price-to-earnings as of a date, from the as-of TTM EPS. Null when undefined (no/negative earnings). */
export const peAsOf = (price: number, ttmEps: number | null): number | null => {
  if (ttmEps === null || ttmEps <= 0 || !(price > 0)) return null;
  return price / ttmEps;
};

/**
 * Everything the FundamentalFactor needs about ONE stock as of a date, derived
 * from its stored quarters + price. Produced by the pre-pass (backtest loop /
 * live loader); the factor itself only scores these numbers.
 */
export type FundamentalSnapshotAsOf = {
  /** As-of P/E (null when earnings are negative/unknown). */
  pe: number | null;
  /** TTM EPS as known on the date (4 most recent known quarters). */
  ttmEps: number | null;
  /** TTM EPS one year earlier (known quarters 5–8) — the YoY growth base. */
  ttmEpsPrevYear: number | null;
  quartersKnown: number;
  /** Calendar days since the most recent result became known. */
  daysSinceLastResult: number | null;
  /** A calendar quarter has ended but its result is not yet known (risk window). */
  resultsPending: boolean;
};

const DAY_MS = 86_400_000;

/** Most recent calendar-quarter end (Mar/Jun/Sep/Dec) strictly before the date. */
const lastCalendarQuarterEnd = (dateIso: string): string => {
  const [y, m] = [Number(dateIso.slice(0, 4)), Number(dateIso.slice(5, 7))];
  // Quarter-end month/day pairs, most recent one strictly before (y, m, d).
  const ends: [number, string][] = [
    [y, `${y}-12-31`],
    [y, `${y}-09-30`],
    [y, `${y}-06-30`],
    [y, `${y}-03-31`],
    [y - 1, `${y - 1}-12-31`],
  ];
  for (const [, end] of ends) if (end < dateIso) return end;
  return `${y - 1}-09-30`; // dateIso ≤ Jan 1 edge — unreachable for real ISO dates
};

/**
 * The fast, allocation-light as-of reconstruction used by the per-day backtest
 * pre-pass (universe × trading-days calls). Comparisons are plain ISO string
 * compares (lexicographic = chronological), matching `ttmEpsKnownBy`'s
 * conservative semantics: a quarter announced with a time-of-day on day D
 * becomes usable AFTER D (`availableAt > date` string-compares true).
 *
 * `quarters` must be sorted ascending by periodEnd (the store guarantees it).
 */
export const fundamentalsAsOf = (
  quarters: readonly AvailableQuarter[],
  price: number | null,
  dateIso: string,
): FundamentalSnapshotAsOf => {
  const known = quarters.filter((q) => q.availableAt <= dateIso);
  const quartersKnown = known.length;

  const ttmEps = quartersKnown >= 4 ? known.slice(-4).reduce((s, q) => s + q.epsBasic, 0) : null;
  const ttmEpsPrevYear =
    quartersKnown >= 8 ? known.slice(-8, -4).reduce((s, q) => s + q.epsBasic, 0) : null;

  let lastAvailable: string | null = null;
  for (const q of known) {
    if (lastAvailable === null || q.availableAt > lastAvailable) lastAvailable = q.availableAt;
  }
  const daysSinceLastResult = lastAvailable
    ? Math.floor((Date.parse(dateIso) - Date.parse(lastAvailable.slice(0, 10))) / DAY_MS)
    : null;

  const pendingQuarterEnd = lastCalendarQuarterEnd(dateIso);
  const resultsPending =
    quartersKnown > 0 && !known.some((q) => q.periodEnd >= pendingQuarterEnd);

  return {
    pe: price !== null && ttmEps !== null ? peAsOf(price, ttmEps) : null,
    ttmEps,
    ttmEpsPrevYear,
    quartersKnown,
    daysSinceLastResult,
    resultsPending,
  };
};
