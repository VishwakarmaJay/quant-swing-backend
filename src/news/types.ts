/** News ingestion domain types (ROADMAP B3). */

/** The four feeds the archive collects from. Stored verbatim in `NewsArticle.source`. */
export type NewsSourceId = 'ET_MARKETS' | 'MONEYCONTROL' | 'BSE_ANNOUNCEMENTS' | 'GOOGLE_NEWS';

/** Parser dialect for a feed. Most are standard RSS/Atom; BSE is bespoke XML. */
export type FeedDialect = 'rss' | 'bse';

/** A configured feed to poll. */
export type NewsSource = {
  id: NewsSourceId;
  url: string;
  dialect: FeedDialect;
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
};
