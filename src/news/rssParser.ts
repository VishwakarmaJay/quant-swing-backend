import type { FeedDialect, RawFeedItem } from './types';

/**
 * In-house RSS 2.0 / Atom / BSE-XML parser (ROADMAP B3). Kept in-house rather
 * than adding an RSS dependency, matching the project's "own the parsing so it
 * can be unit-tested and golden-stable" ethos. Deliberately tolerant: real feeds
 * are messy, so a malformed item is skipped, never thrown — ingestion must
 * degrade, not crash.
 *
 * Covers standard RSS `<item>` and Atom `<entry>` (ET Markets, LiveMint,
 * Google News). BSE corporate announcements use a bespoke JSON/XML shape handled
 * by `parseBse`; its exact live schema must be confirmed on infra (see sources.ts).
 */

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#34': '"',
  nbsp: ' ',
};

/** Decodes the handful of HTML entities that appear in feed titles/bodies. */
export const decodeEntities = (s: string): string =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (code[0] === '#') {
      const cp = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
    }
    return HTML_ENTITIES[code] ?? whole;
  });

/** Strips CDATA wrappers, HTML tags, and decodes entities to plain text. */
export const cleanText = (raw: string | null | undefined): string => {
  if (!raw) return '';
  const noCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const noTags = noCdata.replace(/<[^>]+>/g, ' ');
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
};

/** Returns the inner text of the first `<tag>…</tag>` within `xml`, or null. */
const tagText = (xml: string, tag: string): string | null => {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1]! : null;
};

/** Extracts every `<tag>…</tag>` block (non-greedy) from `xml`. */
const blocks = (xml: string, tag: string): string[] => {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'gi');
  return xml.match(re) ?? [];
};

/** Parses a date string to an ISO string, or null if it is missing/invalid. */
const toIso = (raw: string | null): string | null => {
  if (!raw) return null;
  const t = Date.parse(cleanText(raw));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

const firstNonEmpty = (...vals: (string | null)[]): string | null => {
  for (const v of vals) if (v && v.trim()) return v;
  return null;
};

/** Parses one RSS `<item>` or Atom `<entry>` block into a RawFeedItem. */
const parseRssItem = (block: string): RawFeedItem | null => {
  const title = cleanText(tagText(block, 'title'));
  if (!title) return null;

  // RSS <link>text</link>; Atom <link href="…"/> (prefer rel="alternate").
  let url = cleanText(tagText(block, 'link'));
  if (!url) {
    const alt = block.match(/<link[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i);
    const any = block.match(/<link[^>]*\bhref=["']([^"']+)["']/i);
    url = cleanText(alt?.[1] ?? any?.[1] ?? null);
  }
  // Google News wraps the real link in <guid> sometimes; fall back to it.
  if (!url) url = cleanText(tagText(block, 'guid'));

  const publishedAt = toIso(
    firstNonEmpty(tagText(block, 'pubDate'), tagText(block, 'dc:date'), tagText(block, 'published'), tagText(block, 'updated')),
  );

  const body = cleanText(
    firstNonEmpty(tagText(block, 'content:encoded'), tagText(block, 'description'), tagText(block, 'summary'), tagText(block, 'content')),
  ) || null;

  return { title, url, publishedAt, body };
};

/** Parses standard RSS/Atom XML into raw items. */
export const parseRss = (xml: string): RawFeedItem[] => {
  const items = blocks(xml, 'item');
  const entries = items.length ? items : blocks(xml, 'entry');
  return entries.map(parseRssItem).filter((i): i is RawFeedItem => i !== null);
};

/** One row of BSE's announcement payload (JSON or XML), field names as published. */
type BseRow = Record<string, unknown>;

const bseField = (row: BseRow, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
};

/** Maps one BSE announcement row (shared by the JSON and XML paths). */
const bseRowToItem = (get: (...keys: string[]) => string | null): RawFeedItem | null => {
  const title = cleanText(get('HEADLINE', 'NEWSSUB', 'NEWS_SUB'));
  if (!title) return null;
  const attach = cleanText(get('ATTACHMENTNAME'));
  const url = attach ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${attach}` : '';
  const publishedAt = toIso(get('NEWS_DT', 'DissemDT', 'News_submission_dt', 'DT_TM'));
  const body = cleanText(get('MORE', 'NEWSSUB')) || null;
  return { title, url, publishedAt, body };
};

/**
 * Parses BSE corporate announcements. The live AnnGetData API returns JSON —
 * `{ Table: [ { NEWSSUB, HEADLINE, NEWS_DT, ATTACHMENTNAME, … } ] }`, or the
 * literal string "No Record Found!" for an empty window — while older feeds
 * used the same field names as XML `<Table>` rows. Both shapes are handled,
 * tolerant of field-name variants; anything else falls back to the RSS reader.
 */
export const parseBse = (payload: string): RawFeedItem[] => {
  const trimmed = payload.trim();

  // JSON path (the current AnnGetData API).
  if (trimmed.startsWith('{') || trimmed.startsWith('"') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'string') return []; // "No Record Found!"
      const table = Array.isArray(parsed)
        ? parsed
        : ((parsed as { Table?: unknown }).Table ?? []);
      if (!Array.isArray(table)) return [];
      return table
        .filter((r): r is BseRow => typeof r === 'object' && r !== null)
        .map((row) => bseRowToItem((...keys) => bseField(row, ...keys)))
        .filter((i): i is RawFeedItem => i !== null);
    } catch {
      return [];
    }
  }

  // XML path (legacy <Table> rows), else fall back to plain RSS.
  const rows = blocks(payload, 'Table');
  if (!rows.length) return parseRss(payload);
  return rows
    .map((row) => bseRowToItem((...keys) => firstNonEmpty(...keys.map((k) => tagText(row, k)))))
    .filter((i): i is RawFeedItem => i !== null);
};

/** Dispatches to the right reader for a feed dialect. Never throws. */
export const parseFeed = (xml: string, dialect: FeedDialect): RawFeedItem[] => {
  try {
    return dialect === 'bse' ? parseBse(xml) : parseRss(xml);
  } catch {
    return [];
  }
};
