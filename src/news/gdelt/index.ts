/** GDELT historical news backfill (ROADMAP B3.5) — see docs/GDELT_BACKFILL.md. */

export {
  buildDocApiUrl,
  fetchGdeltPayload,
  isThrottleResponse,
  GDELT_DOC_API,
  GDELT_MAX_RECORDS,
  GDELT_COVERAGE_START,
} from './gdeltClient';
export {
  parseGdeltPayload,
  parseSeendate,
  reconstructAvailableAt,
  cleanGdeltTitle,
  toGdeltRecords,
  type GdeltArticle,
  type GdeltRecord,
} from './parser';
export {
  sliceDateRange,
  windowDays,
  buildSymbolQuery,
  downloadWindow,
  downloadWindowBatch,
  type DateWindow,
  type WindowDownload,
  type WindowBatch,
} from './download';
export {
  runGdeltBackfill,
  processGdeltRecords,
  GDELT_SOURCE,
  type BackfillOptions,
  type BackfillStats,
  type BackfillSummary,
  type GdeltRow,
  type ProcessResult,
} from './backfill';
