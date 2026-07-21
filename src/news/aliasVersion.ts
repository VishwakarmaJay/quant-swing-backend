import { createHash } from 'node:crypto';

import { INDIAN_NEWS_DOMAINS } from './indianDomains';
import { ALIAS_EXCLUSIONS, COMPANY_ALIASES } from './companyAliases';

/**
 * Alias-derivation version (B15). PURE.
 *
 * `news_article.symbols[]` is a DERIVED column: it is produced by the symbol
 * mapper from three inputs, all of which evolve over time —
 *   1. COMPANY_ALIASES        (the growable dictionary)
 *   2. ALIAS_EXCLUSIONS        (homonym / subsidiary guards)
 *   3. INDIAN_NEWS_DOMAINS      (the GDELT precision allowlist — changes which
 *                               GDELT rows keep their tags)
 * The GDELT precision fix already rewrote 24,671 tags once. So a sentiment
 * backtest run today and re-run in six months can differ **silently** if the
 * dictionary grows in between — which violates the platform's own reproducibility
 * creed (factor configs are hashed via `weightsVersion`/`factorConfigChecksum`;
 * the alias dictionary was not).
 *
 * `ALIAS_VERSION` closes that gap: it is a stable hash of all three inputs,
 * stamped onto every row when its `symbols[]` is written. Research can then split
 * or filter by the exact dictionary that produced a tag, and a stale re-run is
 * detectable instead of invisible. Same pattern as `weightsVersion`.
 *
 * Determinism: keys are sorted and alias/exclusion arrays sorted before hashing,
 * so a reordering of the source files (which changes nothing semantically) does
 * NOT change the version — only a genuine content change does.
 */

const sortedEntries = (dict: Record<string, string[]>): [string, string[]][] =>
  Object.keys(dict)
    .sort()
    .map((k) => [k, [...dict[k]!].sort()] as [string, string[]]);

/** The canonical, order-independent snapshot of the mapping inputs. */
export const aliasVersionInputs = () => ({
  aliases: sortedEntries(COMPANY_ALIASES),
  exclusions: sortedEntries(ALIAS_EXCLUSIONS),
  indianDomains: [...INDIAN_NEWS_DOMAINS].sort(),
});

/** `av-<12 hex>` — the stamp written to `news_article.aliasVersion`. */
export const ALIAS_VERSION = `av-${createHash('sha256')
  .update(JSON.stringify(aliasVersionInputs()))
  .digest('hex')
  .slice(0, 12)}`;
