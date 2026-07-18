export { ingestNews, type IngestSummary, type SourceResult } from './ingest';
export { NEWS_SOURCES, resolveSourceUrl } from './sources';
export { fetchFeed } from './fetch';
export { parseFeed, parseRss, parseBse, cleanText, decodeEntities } from './rssParser';
export {
  normalizeTitle,
  titleTokens,
  jaccard,
  isDuplicateTitle,
  DEFAULT_JACCARD_THRESHOLD,
} from './dedupe';
export { mapArticleSymbols, aliasCoverage, type MappedSymbols } from './symbolMapper';
export { COMPANY_ALIASES } from './companyAliases';
export type { NewsSource, NewsSourceId, RawFeedItem, ProcessedArticle, FeedDialect } from './types';
