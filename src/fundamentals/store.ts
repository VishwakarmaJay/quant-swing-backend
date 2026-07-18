import { prisma } from '@services/prisma';

import type { AvailableQuarter } from './asOf';

/**
 * Loads every stored quarter for every symbol into memory once, with each
 * quarter's `availableAt` resolved (announcedAt ?? SEBI-deadline fallback) —
 * the point-in-time discipline baked in at load time so every consumer
 * (backtest pre-pass, live pipeline) reconstructs identically.
 *
 * Keyed by canonical symbol (matches the universe / instrument symbol with the
 * `-EQ` suffix stripped). Quarters are sorted ascending by periodEnd, as
 * `fundamentalsAsOf` requires. An empty map (table not backfilled) simply
 * leaves every FundamentalFactor neutral — graceful degradation.
 */
export type FundamentalQuartersBySymbol = Map<string, AvailableQuarter[]>;

export const loadFundamentalQuarters = async (): Promise<FundamentalQuartersBySymbol> => {
  const rows = await prisma.quarterlyFundamental.findMany({
    orderBy: [{ symbol: 'asc' }, { periodEnd: 'asc' }],
    select: { symbol: true, periodEnd: true, epsBasic: true, announcedAt: true, fallbackAvailableAt: true },
  });

  const bySymbol: FundamentalQuartersBySymbol = new Map();
  for (const r of rows) {
    const availableAt = r.announcedAt
      ? r.announcedAt.toISOString()
      : r.fallbackAvailableAt.toISOString().slice(0, 10);
    const q: AvailableQuarter = {
      periodEnd: r.periodEnd.toISOString().slice(0, 10),
      epsBasic: r.epsBasic,
      availableAt,
    };
    (bySymbol.get(r.symbol) ?? bySymbol.set(r.symbol, []).get(r.symbol)!).push(q);
  }
  return bySymbol;
};
