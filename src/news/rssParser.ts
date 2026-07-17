import type { FeedDialect, RawFeedItem } from './types';

/**
 * In-house RSS 2.0 / Atom / BSE-XML parser (ROADMAP B3). Kept in-house rather
 * than adding an RSS dependency, matching the project's "own the parsing so it
 * can be unit-tested and golden-stable" ethos. Deliberately tolerant: real feeds
 * are messy, so a malformed item is skipped, never thrown — ingestion must
 * degrade, not crash.
 *
 * Covers standard RSS `<item>` and Atom `<entry>` (ET Markets, Moneycontrol,
 * Google News). BSE corporate announcements use a bespoke XML shape handled by
 * `parseBse`; its exact live schema must be confirmed on infra (see sources.ts).
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

/**
 * Parses BSE corporate-announcement XML. BSE's announcement API returns rows
 * (commonly `<Table>…</Table>`) with fields like HEADLINE/NEWSSUB, SCRIP_CD,
 * NEWS_DT, and an attachment name. This reader is tolerant of field-name
 * variants; the exact live schema must be confirmed against the real endpoint
 * (see sources.ts). Falls back to the RSS reader if no rows are found.
 */
export const parseBse = (xml: string): RawFeedItem[] => {
  const rows = blocks(xml, 'Table');
  if (!rows.length) return parseRss(xml);

  return rows
    .map((row): RawFeedItem | null => {
      const title = cleanText(firstNonEmpty(tagText(row, 'HEADLINE'), tagText(row, 'NEWSSUB'), tagText(row, 'NEWS_SUB')));
      if (!title) return null;
      const attach = cleanText(tagText(row, 'ATTACHMENTNAME'));
      const url = attach ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${attach}` : '';
      const publishedAt = toIso(firstNonEmpty(tagText(row, 'NEWS_DT'), tagText(row, 'DissemDT'), tagText(row, 'News_submission_dt')));
      const body = cleanText(firstNonEmpty(tagText(row, 'MORE'), tagText(row, 'NEWSSUB'))) || null;
      return { title, url, publishedAt, body };
    })
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
