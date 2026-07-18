import { env } from '@config/env';
import { fetchFeed } from '@/news';
import { EQUITY_UNIVERSE } from '@/universe/equityUniverse';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import { fallbackAvailableAt, matchAnnouncementToQuarter } from './asOf';
import { parseScreenerPage } from './screenerParser';
import type { ResultAnnouncement, ScreenerPage } from './types';

/**
 * Fundamentals ingestion (ROADMAP B4). Two jobs:
 *
 *  - backfillFundamentals: per universe symbol → Screener quarterly EPS table
 *    (consolidated, falling back to standalone) + BSE result-announcement dates
 *    (per-scrip AnnSubCategoryGetData accepts wide ranges) → upsert
 *    QuarterlyFundamental rows keyed (symbol, periodEnd) with the honest
 *    `announcedAt` as-of moment.
 *  - snapshotFundamentals: current headline ratios per symbol with `fetchedAt`
 *    (clock #2 — the native point-in-time archive going forward).
 *
 * Degrades per symbol (no-throw): one broken page never stops the run.
 * Fetch pacing: FUNDAMENTALS_FETCH_DELAY_MS between companies (rate courtesy).
 */

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * Circuit breaker: after this many CONSECUTIVE page-fetch failures, abort the
 * run. A failure streak this long means the host is rate-limiting/blocking us
 * (Screener 429s/connection-drops after sustained fetching — observed live
 * 2026-07-18); hammering the remaining list only extends the ban. The run is
 * idempotent, so the remainder is simply re-run later.
 */
const CONSECUTIVE_FAILURE_ABORT = 6;

const BSE_HEADERS = {
  Referer: 'https://www.bseindia.com/corporates/ann.html',
  Accept: 'application/json, text/plain, */*',
};

/**
 * Canonical symbol → the symbol Screener serves the page under, when a
 * corporate rename moved it. Rows are still stored under the canonical symbol
 * (factor lookups + sector peer groups key on it). Screener happens to track
 * the Angel rename here, but the namespaces aren't guaranteed to stay in
 * lockstep — hence a separate map from ANGEL_NAME_ALIASES.
 */
export const SCREENER_SYMBOL_ALIASES: Record<string, string> = {
  ZOMATO: 'ETERNAL', // renamed 2025; screener.in/company/ZOMATO/ now 404s
};

/**
 * Fetches + parses one company's Screener page. Standalone is tried only when
 * the consolidated page FETCHED but had no quarters (a genuinely
 * standalone-only company) — a failed fetch (429/block) must NOT trigger a
 * second request, or a rate-limit storm doubles its own request volume.
 */
export const fetchScreenerPage = async (symbol: string): Promise<ScreenerPage | null> => {
  const urlSymbol = SCREENER_SYMBOL_ALIASES[symbol] ?? symbol;
  const cons = await fetchFeed(`https://www.screener.in/company/${urlSymbol}/consolidated/`);
  if (cons === null) return null;
  const consolidated = parseScreenerPage(cons, 'consolidated');
  if (consolidated.quarters.length) return consolidated;

  const standalone = await fetchFeed(`https://www.screener.in/company/${urlSymbol}/`);
  if (standalone) {
    const page = parseScreenerPage(standalone, 'standalone');
    if (page.quarters.length || Object.keys(page.ratios).length) return page;
  }
  return null;
};

/** Result-announcement dates for a scrip over [fromIso, toIso] (wide ranges OK per-scrip). */
export const fetchResultAnnouncements = async (
  scripCode: string,
  fromIso: string,
  toIso: string,
): Promise<ResultAnnouncement[]> => {
  const fmt = (iso: string) => iso.replaceAll('-', '');
  const url =
    `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=Result` +
    `&strPrevDate=${fmt(fromIso)}&strScrip=${scripCode}&strSearch=P&strToDate=${fmt(toIso)}&strType=C&subcategory=-1`;
  const payload = await fetchFeed(url, BSE_HEADERS);
  if (!payload) return [];
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const table = (parsed as { Table?: unknown }).Table;
    if (!Array.isArray(table)) return [];
    return table
      .map((r: Record<string, unknown>): ResultAnnouncement | null => {
        const dt = r.DissemDT ?? r.NEWS_DT ?? r.DT_TM;
        if (typeof dt !== 'string' || !dt) return null;
        return { dissemAt: dt, headline: typeof r.HEADLINE === 'string' ? r.HEADLINE : String(r.NEWSSUB ?? '') };
      })
      .filter((a): a is ResultAnnouncement => a !== null);
  } catch {
    return [];
  }
};

export type BackfillSummary = {
  fetchedAt: Date;
  symbols: number;
  pagesOk: number;
  quartersUpserted: number;
  withAnnouncedAt: number;
  fallbackDated: number;
  failedSymbols: string[];
};

/** Historical backfill: quarterly EPS + honest announcement dates, whole universe. */
export const backfillFundamentals = async (onlySymbols?: string[]): Promise<BackfillSummary> => {
  const fetchedAt = new Date();
  const symbols = onlySymbols ?? EQUITY_UNIVERSE.map((e) => e.symbol);
  const summary: BackfillSummary = {
    fetchedAt,
    symbols: symbols.length,
    pagesOk: 0,
    quartersUpserted: 0,
    withAnnouncedAt: 0,
    fallbackDated: 0,
    failedSymbols: [],
  };

  let consecutiveFailures = 0;
  let abortLogged = false;
  for (const symbol of symbols) {
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_ABORT) {
      if (!abortLogged) {
        abortLogged = true;
        logger.warn(
          `[Fundamentals]: backfill aborted after ${consecutiveFailures} consecutive fetch failures ` +
            `(rate-limited?) — remaining symbols recorded as failed; re-run later (idempotent).`,
        );
      }
      summary.failedSymbols.push(symbol);
      continue;
    }
    try {
      const page = await fetchScreenerPage(symbol);
      if (!page || !page.quarters.length) {
        consecutiveFailures++;
        summary.failedSymbols.push(symbol);
        await sleep(env.FUNDAMENTALS_FETCH_DELAY_MS);
        continue;
      }
      consecutiveFailures = 0;
      summary.pagesOk++;

      // Announcement dates spanning all parsed quarters (+75d for the last one).
      let announcements: ResultAnnouncement[] = [];
      if (page.bseScripCode) {
        const first = page.quarters[0]!.periodEnd;
        const last = page.quarters[page.quarters.length - 1]!.periodEnd;
        const to = new Date(new Date(last).getTime() + 75 * 86_400_000).toISOString().slice(0, 10);
        await sleep(env.FUNDAMENTALS_FETCH_DELAY_MS);
        announcements = await fetchResultAnnouncements(page.bseScripCode, first, to);
      }

      for (const q of page.quarters) {
        const ann = matchAnnouncementToQuarter(q.periodEnd, announcements);
        if (ann) summary.withAnnouncedAt++;
        else summary.fallbackDated++;
        await prisma.quarterlyFundamental.upsert({
          where: { symbol_periodEnd: { symbol, periodEnd: new Date(q.periodEnd) } },
          create: {
            symbol,
            periodEnd: new Date(q.periodEnd),
            epsBasic: q.epsBasic,
            netProfit: q.netProfit,
            sales: q.sales,
            announcedAt: ann ? new Date(ann.dissemAt) : null,
            fallbackAvailableAt: new Date(fallbackAvailableAt(q.periodEnd)),
            basis: page.basis,
            bseScripCode: page.bseScripCode,
            fetchedAt,
          },
          update: {
            epsBasic: q.epsBasic,
            netProfit: q.netProfit,
            sales: q.sales,
            ...(ann ? { announcedAt: new Date(ann.dissemAt) } : {}),
            basis: page.basis,
            bseScripCode: page.bseScripCode,
            fetchedAt,
          },
        });
        summary.quartersUpserted++;
      }
    } catch (err) {
      logger.warn(`[Fundamentals]: backfill ${symbol} failed: ${err instanceof Error ? err.message : err}`);
      summary.failedSymbols.push(symbol);
    }
    await sleep(env.FUNDAMENTALS_FETCH_DELAY_MS);
  }

  logger.info(
    `[Fundamentals]: backfill — ${summary.quartersUpserted} quarters across ${summary.pagesOk}/${summary.symbols} symbols ` +
      `(${summary.withAnnouncedAt} announcement-dated, ${summary.fallbackDated} fallback-dated, ${summary.failedSymbols.length} failed)`,
  );
  return summary;
};

export type SnapshotSummary = { fetchedAt: Date; symbols: number; snapshots: number; failedSymbols: string[] };

/** Weekly snapshot of current headline ratios (clock #2). */
export const snapshotFundamentals = async (onlySymbols?: string[]): Promise<SnapshotSummary> => {
  const fetchedAt = new Date();
  const symbols = onlySymbols ?? EQUITY_UNIVERSE.map((e) => e.symbol);
  const summary: SnapshotSummary = { fetchedAt, symbols: symbols.length, snapshots: 0, failedSymbols: [] };

  let consecutiveFailures = 0;
  let abortLogged = false;
  for (const symbol of symbols) {
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_ABORT) {
      if (!abortLogged) {
        abortLogged = true;
        logger.warn(
          `[Fundamentals]: snapshot aborted after ${consecutiveFailures} consecutive fetch failures ` +
            `(rate-limited?) — remaining symbols recorded as failed; the weekly cron retries anyway.`,
        );
      }
      summary.failedSymbols.push(symbol);
      continue;
    }
    try {
      const page = await fetchScreenerPage(symbol);
      if (!page || !Object.keys(page.ratios).length) {
        consecutiveFailures++;
        summary.failedSymbols.push(symbol);
        await sleep(env.FUNDAMENTALS_FETCH_DELAY_MS);
        continue;
      }
      consecutiveFailures = 0;
      const r = page.ratios;
      await prisma.fundamentalSnapshot.create({
        data: {
          symbol,
          fetchedAt,
          pe: r['Stock P/E'] ?? null,
          marketCap: r['Market Cap'] ?? null,
          bookValue: r['Book Value'] ?? null,
          roePct: r['ROE'] ?? null,
          raw: r,
        },
      });
      summary.snapshots++;
    } catch (err) {
      logger.warn(`[Fundamentals]: snapshot ${symbol} failed: ${err instanceof Error ? err.message : err}`);
      summary.failedSymbols.push(symbol);
    }
    await sleep(env.FUNDAMENTALS_FETCH_DELAY_MS);
  }

  logger.info(`[Fundamentals]: snapshot — ${summary.snapshots}/${summary.symbols} symbols @ ${fetchedAt.toISOString()}`);
  return summary;
};
