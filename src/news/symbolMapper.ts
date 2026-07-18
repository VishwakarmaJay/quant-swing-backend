import { EQUITY_UNIVERSE } from '@/universe/equityUniverse';

import { ALIAS_EXCLUSIONS, COMPANY_ALIASES } from './companyAliases';

/**
 * Symbol mapper (ROADMAP B3, "the hard part"): map a headline (+ optional body)
 * to the canonical universe symbols it mentions. Conservative by design — the
 * gate is ≥90% of matched symbols correct on a manual sample, so we accept
 * missing a mention (recall) far more readily than a wrong tag (precision).
 *
 * Matching rules:
 *  - Only curated multi-word company aliases from COMPANY_ALIASES are matched
 *    (no bare-ticker matching — TITAN/TRENT/OIL/SAIL collide with real words).
 *  - Case-insensitive, whitespace-flexible, with non-alphanumeric boundaries so
 *    "airtel" matches "Airtel's" but not "fairtelco".
 *  - A headline that matches nothing is surfaced by `mapArticleSymbols(...).symbols
 *    === []`, which the ingestion job logs to grow the dictionary.
 */

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Builds a boundary-anchored, whitespace-flexible matcher for one alias phrase. */
const aliasRegex = (alias: string): RegExp => {
  const key = alias.trim().toLowerCase();
  const body = escapeRegExp(key).replace(/\\?\s+/g, '\\s+');
  // ALIAS_EXCLUSIONS: block the match when the alias is immediately followed by
  // one of the listed words (e.g. "sbi life" must not match SBIN — SBI Life is a
  // different universe stock; "sbi funds/capital" are unlisted subsidiaries).
  const excluded = ALIAS_EXCLUSIONS[key];
  const lookahead = excluded?.length
    ? `(?!\\s+(?:${excluded.map(escapeRegExp).join('|')})([^a-z0-9]|$))`
    : '';
  // (^|non-alnum) phrase [not followed by an excluded word] (non-alnum|$).
  return new RegExp(`(^|[^a-z0-9])${body}${lookahead}([^a-z0-9]|$)`, 'i');
};

type CompiledAlias = { symbol: string; regex: RegExp };

/** Precompiled (symbol, regex) pairs — built once at module load. */
const COMPILED: CompiledAlias[] = Object.entries(COMPANY_ALIASES).flatMap(([symbol, aliases]) =>
  aliases.map((alias) => ({ symbol, regex: aliasRegex(alias) })),
);

/** Universe symbols, for coverage checks. */
const UNIVERSE_SYMBOLS = new Set(EQUITY_UNIVERSE.map((e) => e.symbol));

export type MappedSymbols = {
  /** Distinct canonical symbols matched, in universe declaration order. */
  symbols: string[];
};

/**
 * Returns the canonical symbols mentioned in `title` (and optional `body`).
 * Lowercases once and tests every compiled alias; de-dupes to a stable order.
 */
export const mapArticleSymbols = (title: string, body?: string | null): MappedSymbols => {
  const haystack = ` ${(body ? `${title} ${body}` : title).toLowerCase()} `;
  const hit = new Set<string>();
  for (const { symbol, regex } of COMPILED) {
    if (!hit.has(symbol) && regex.test(haystack)) hit.add(symbol);
  }
  // Emit in universe declaration order for determinism.
  const symbols = EQUITY_UNIVERSE.map((e) => e.symbol).filter((s) => hit.has(s));
  return { symbols };
};

/**
 * Universe symbols that currently have NO curated alias — a coverage report to
 * prioritise dictionary growth. Also flags alias keys that aren't in the
 * universe (typos) via `unknownAliasKeys`.
 */
export const aliasCoverage = (): { uncovered: string[]; unknownAliasKeys: string[] } => {
  const covered = new Set(Object.keys(COMPANY_ALIASES));
  const uncovered = [...UNIVERSE_SYMBOLS].filter((s) => !covered.has(s)).sort();
  const unknownAliasKeys = [...covered].filter((s) => !UNIVERSE_SYMBOLS.has(s)).sort();
  return { uncovered, unknownAliasKeys };
};
