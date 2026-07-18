import type { ParsedQuarter, ScreenerPage } from './types';

/**
 * Pure HTML parser for a Screener.in company page (ROADMAP B4). Screener is
 * server-rendered, so the quarterly-results table (#quarters) and the headline
 * ratios list are plain HTML — no JS execution needed. Kept pure (string in,
 * data out) so it is unit-tested against a committed fixture; fetching lives in
 * the orchestrator.
 *
 * Extracted per page:
 *  - BSE scrip code (from the bseindia.com deep link) — feeds the announcement-
 *    date lookup, no separate symbol→scripcode API needed.
 *  - #quarters table: "EPS in Rs", "Net Profit", "Sales" rows × period columns
 *    ("Jun 2026" → 2026-06-30). Values are aligned from the RIGHT against the
 *    header count (Screener occasionally renders an extra leading cell).
 *  - Headline ratios (Market Cap, Stock P/E, Book Value, ROE …) name → number.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Jun 2026" → "2026-06-30" (last calendar day of the month). */
export const monthLabelToPeriodEnd = (label: string): string | null => {
  const m = label.trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (!month) return null;
  const year = Number(m[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
};

/** "1,23,456.78" / "-3.5" → number; null for empty/non-numeric cells. */
const toNumber = (raw: string): number | null => {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Extracts one labelled row's numeric cells from a table chunk. */
const rowValues = (tableHtml: string, label: string): (number | null)[] | null => {
  const re = new RegExp(`<tr[^>]*>\\s*<td class="text">((?:(?!</tr>).)*?)</tr>`, 'gs');
  for (const m of tableHtml.matchAll(re)) {
    const row = m[0];
    const cells = row.split('</td>');
    if (!stripTags(cells[0] ?? '').toLowerCase().startsWith(label.toLowerCase())) continue;
    return cells.slice(1).map((c) => toNumber(stripTags(c)));
  }
  return null;
};

export const parseScreenerPage = (html: string, basis: 'consolidated' | 'standalone'): ScreenerPage => {
  // BSE scrip code from the deep link: bseindia.com/stock-share-price/…/<code>/
  const bse = html.match(/bseindia\.com\/stock-share-price\/[^"']*?\/(\d{6})\//);
  const bseScripCode = bse ? bse[1]! : null;

  // ── Quarterly table.
  const qStart = html.indexOf('id="quarters"');
  const quarters: ParsedQuarter[] = [];
  if (qStart >= 0) {
    const section = html.slice(qStart, html.indexOf('</section>', qStart) + 10);
    const headers = [...section.matchAll(/<th[^>]*>\s*([A-Za-z]{3}\s+\d{4})\s*<\/th>/g)].map((m) => m[1]!);
    const periodEnds = headers.map(monthLabelToPeriodEnd);

    const eps = rowValues(section, 'EPS in Rs');
    const profit = rowValues(section, 'Net Profit');
    const sales = rowValues(section, 'Sales');

    if (eps && periodEnds.length) {
      // Align from the right: the last N numeric cells belong to the N headers.
      const n = periodEnds.length;
      const tail = <T>(a: T[] | null): T[] => (a ? a.slice(-n) : []);
      const epsT = tail(eps);
      const profitT = tail(profit);
      const salesT = tail(sales);
      for (let i = 0; i < n; i++) {
        const periodEnd = periodEnds[i];
        const e = epsT[i];
        if (!periodEnd || e == null) continue; // a quarter without EPS is unusable
        quarters.push({
          periodEnd,
          epsBasic: e,
          netProfit: profitT[i] ?? null,
          sales: salesT[i] ?? null,
        });
      }
    }
  }

  // ── Headline ratios: <li> blocks with a name span and a number span.
  const ratios: Record<string, number> = {};
  const ratioRe = /<li[^>]*>\s*<span class="name">\s*([^<]+?)\s*<\/span>[\s\S]*?<\/li>/g;
  for (const m of html.matchAll(ratioRe)) {
    const name = m[1]!.trim();
    const nums = [...m[0].matchAll(/<span class="number">\s*([\d.,\-]*)\s*<\/span>/g)]
      .map((x) => toNumber(x[1] ?? ''))
      .filter((v): v is number => v !== null);
    if (nums.length) ratios[name] = nums[0]!;
  }

  return { bseScripCode, basis, quarters, ratios };
};
