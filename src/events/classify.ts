/**
 * Deterministic event typing (B12). PURE — no clock, no I/O, no model.
 *
 * The architecture review's key observation: **BSE already labels its own
 * announcements**, so v1 event typing is a lookup, not NLP. Two layers, in
 * priority order:
 *
 *   1. EXACT — the exchange's own subcategory, which survives in the stored body
 *      as `Announcement under Regulation 30 (LODR)-<SubCategory>`. Measured on
 *      the live archive: 39.4% of 57,474 BSE rows carry it verbatim.
 *   2. KEYWORD — a small, ordered rule pack for the high-value types that are
 *      filed under other formats (results above all). ~14% more.
 *
 * Everything else is `OTHER` — deliberately, and reported as such. A wrong type
 * is worse than an untyped row: the same precision-over-recall trade the symbol
 * mapper makes.
 *
 * `EXTRACTOR_VERSION` stamps every classification. Changing the rules changes
 * the version, so a study can always name the rule pack that produced it (the
 * `weightsVersion` pattern applied to derivation).
 */

export const EXTRACTOR_VERSION = 'ev-1.0.0';

export type EventType =
  | 'EARNINGS_RESULT'
  | 'EARNINGS_CALL'        // transcripts / investor presentations / analyst meets
  | 'ORDER_WIN'
  | 'RATING_ACTION'
  | 'M_AND_A'              // acquisitions, schemes of arrangement, divestments
  | 'DIVIDEND'
  | 'BOARD_MEETING'
  | 'MGMT_CHANGE'
  | 'CAPITAL_ISSUE'        // allotments, ESOP, fund raises
  | 'INSIDER_PLEDGE'       // SAST/PIT, pledge, trading window
  | 'MEDIA_ROUTINE'        // press release / newspaper publication — low signal, typed to keep it OUT of OTHER
  | 'OTHER';

export type Classification = {
  type: EventType;
  /** How the type was derived — exact exchange label vs our keyword pack. */
  method: 'exchange-label' | 'keyword' | 'none';
  /** The raw exchange subcategory when method = 'exchange-label'. */
  rawLabel: string | null;
  extractorVersion: string;
};

/** Exchange subcategory (lowercased, trimmed) → our type. Longest-match wins. */
const LABEL_MAP: [RegExp, EventType][] = [
  [/earnings call transcript|investor presentation|analyst ?\/ ?investor meet/i, 'EARNINGS_CALL'],
  [/award_of_order|receipt_of_order|award of order|receipt of order/i, 'ORDER_WIN'],
  [/credit rating/i, 'RATING_ACTION'],
  [/acquisition|scheme of arrangement|amalgamation|merger|divestment|slump sale/i, 'M_AND_A'],
  [/dividend/i, 'DIVIDEND'],
  [/financial result|quarterly result/i, 'EARNINGS_RESULT'],
  [/board meeting/i, 'BOARD_MEETING'],
  [/change in management|change in directorate|cessation|appointment|resignation|key managerial/i, 'MGMT_CHANGE'],
  [/allotment|issue of securities|fund ?rais|preferential issue|rights issue|buyback/i, 'CAPITAL_ISSUE'],
  [/pledge|encumbrance|insider|trading window|sast/i, 'INSIDER_PLEDGE'],
  [/press release|media release|newspaper publication/i, 'MEDIA_ROUTINE'],
];

/**
 * Ordered keyword rules over the TITLE for rows without an exchange label.
 * Order matters — the first match wins, so the most specific/highest-value
 * patterns come first. Kept deliberately tight: a miss costs recall, a false
 * positive corrupts an event study.
 */
const KEYWORD_RULES: [RegExp, EventType][] = [
  // Results: the canonical swing catalyst. "Integrated Financials for the
  // quarter" and "audited/unaudited results" are the common non-LODR formats.
  [/\b(financial|integrated financial)s? (results?|for the (quarter|half|year))|\b(un)?audited (financial )?results?|quarterly results?/i, 'EARNINGS_RESULT'],
  [/earnings call|con(ference)? ?call|investor (meet|presentation|conference)|analyst meet/i, 'EARNINGS_CALL'],
  [/\b(letter of award|letter of intent|\bLOA\b|work order|receipt of order|bags? (an? )?order|wins? (an? )?(order|contract)|order (win|worth|received))/i, 'ORDER_WIN'],
  [/credit rating|rating (action|upgrade|downgrade|revision)|\b(ICRA|CRISIL|CARE Ratings|India Ratings)\b/i, 'RATING_ACTION'],
  // Divestments are filed in many shapes. "sale/transfer OF <an entity>" is
  // tight enough to catch them without swallowing routine share transfers.
  [/acquisition|acquire[sd]?\b|scheme of arrangement|amalgamation|\bmerger\b|divestment|stake (sale|purchase)|(sale|transfer|disposal)[^.]{0,40}\b(subsidiary|SPV|undertaking|business|division|joint venture)\b/i, 'M_AND_A'],
  [/\bdividend\b/i, 'DIVIDEND'],
  [/board meeting|meeting of the board/i, 'BOARD_MEETING'],
  [/pledge|encumbrance|\bSAST\b|substantial acquisition of shares|trading window|insider trading/i, 'INSIDER_PLEDGE'],
  [/change in (key managerial|management|directorate)|appointment of|resignation of|cessation of/i, 'MGMT_CHANGE'],
  [/allotment|issue of securities|fund ?rais|preferential (issue|allotment)|rights issue|buyback|\bESOP\b/i, 'CAPITAL_ISSUE'],
  [/press release|media release|newspaper publication/i, 'MEDIA_ROUTINE'],
];

/** Pulls the exchange's own subcategory out of the stored body, if present. */
export const exchangeLabelOf = (body: string | null | undefined): string | null => {
  if (!body) return null;
  const m = /\(LODR\)\s*-\s*([^\n|]{2,80})/i.exec(body);
  return m?.[1]?.trim() || null;
};

/**
 * Classifies one announcement. Exchange label first (authoritative), then the
 * keyword pack over the title, else OTHER.
 */
export const classifyEvent = (title: string, body?: string | null): Classification => {
  const rawLabel = exchangeLabelOf(body);
  if (rawLabel) {
    for (const [re, type] of LABEL_MAP) {
      if (re.test(rawLabel)) {
        return { type, method: 'exchange-label', rawLabel, extractorVersion: EXTRACTOR_VERSION };
      }
    }
    // Labelled by the exchange but outside our map — still not a guess.
    return { type: 'OTHER', method: 'exchange-label', rawLabel, extractorVersion: EXTRACTOR_VERSION };
  }
  for (const [re, type] of KEYWORD_RULES) {
    if (re.test(title)) {
      return { type, method: 'keyword', rawLabel: null, extractorVersion: EXTRACTOR_VERSION };
    }
  }
  return { type: 'OTHER', method: 'none', rawLabel: null, extractorVersion: EXTRACTOR_VERSION };
};
