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
