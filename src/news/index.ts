export { ingestNews, type IngestSummary, type SourceResult } from './ingest';
export { NEWS_SOURCES, resolveSourceUrls } from './sources';
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
export {
  scoreSentiment,
  sentimentHealth,
  type SentimentBatch,
  type SentimentResult,
} from './sentimentClient';
export { scoreUnscoredArticles, type ScoreRunSummary, type ScoredArticle } from './scoreArticles';
export { COMPANY_ALIASES } from './companyAliases';
export { originForSource } from './types';
export type { NewsSource, NewsSourceId, RawFeedItem, ProcessedArticle, FeedDialect } from './types';
export { runGdeltBackfill, GDELT_SOURCE, type BackfillSummary, type BackfillStats } from './gdelt';
