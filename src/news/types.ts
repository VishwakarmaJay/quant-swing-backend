/** News ingestion domain types (ROADMAP B3). */

import { NewsOrigin } from '@generated/prisma/enums';

/**
 * The four feeds the archive collects from. Stored verbatim in `NewsArticle.source`.
 * (LIVEMINT replaced MONEYCONTROL 2026-07: Moneycontrol's RSS feeds are frozen at
 * 23 Apr 2024 — live-verified — so they contribute nothing to the archive.)
 */
export type NewsSourceId = 'ET_MARKETS' | 'LIVEMINT' | 'BSE_ANNOUNCEMENTS' | 'GOOGLE_NEWS';

/** Parser dialect for a feed. Most are standard RSS/Atom; BSE is bespoke XML/JSON. */
export type FeedDialect = 'rss' | 'bse';

/** A configured feed to poll. */
export type NewsSource = {
  id: NewsSourceId;
  url: string;
  dialect: FeedDialect;
  /** Extra request headers some feeds require (e.g. BSE's Referer). */
  headers?: Record<string, string>;
};

/** A raw item extracted from a feed, before normalization/symbol-mapping. */
export type RawFeedItem = {
  title: string;
  /** Canonical article URL (may be empty if the feed omits it). */
  url: string;
  /** Feed-declared publish time as an ISO string, or null when unparseable. */
  publishedAt: string | null;
  /** Plain-text body/summary when present (HTML stripped). */
  body: string | null;
};

/** A fully-processed article ready to persist. */
export type ProcessedArticle = {
  source: NewsSourceId;
  url: string;
  title: string;
  titleNormalized: string;
  body: string | null;
  symbols: string[];
  publishedAt: Date;
  fetchedAt: Date;
  /** The as-of moment (B3.5): when the platform could have known the article. */
  availableAt: Date;
  /** Provenance (B3.5): which collection path produced the row. */
  origin: NewsOrigin;
};

/**
 * Provenance for a LIVE-captured article (B3.5). BSE announcements arrive via
 * the exchange API; every other live feed is an RSS/Atom poll. GDELT rows are
 * minted only by the historical backfill (`src/news/gdelt/`), never here.
 */
export const originForSource = (source: NewsSourceId): NewsOrigin =>
  source === 'BSE_ANNOUNCEMENTS' ? NewsOrigin.LIVE_BSE : NewsOrigin.LIVE_RSS;
