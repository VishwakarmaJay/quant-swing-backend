/** BSE announcements historical backfill (ROADMAP B3.6) — see docs/BSE_BACKFILL.md. */

export { buildScripAnnouncementsUrl, parseRowcnt, downloadScripWindow, BSE_ANN_HEADERS, type ScripWindowDownload } from './download';
export {
  processBseItems,
  backfillBseSymbol,
  loadScripCodes,
  loadBseBackfillContext,
  bseRowKey,
  BSE_SOURCE,
  BSE_WINDOW_DAYS,
  type BseRow,
  type BseSymbolStats,
  type BseSymbolBackfillOptions,
  type ProcessBseResult,
} from './backfill';
