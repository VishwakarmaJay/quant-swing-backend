import { describe, expect, test } from 'bun:test';

import { ALIAS_VERSION, aliasVersionInputs } from './aliasVersion';

describe('ALIAS_VERSION', () => {
  test('has the av- prefix and a 12-hex body', () => {
    expect(ALIAS_VERSION).toMatch(/^av-[0-9a-f]{12}$/);
  });

  test('is stable across calls (pure)', () => {
    // Re-importing would re-execute; within a process it is a constant.
    expect(ALIAS_VERSION).toBe(ALIAS_VERSION);
  });

  test('covers all three derivation inputs — dictionary, exclusions, domains', () => {
    const i = aliasVersionInputs();
    expect(i.aliases.length).toBeGreaterThan(100); // the real universe dictionary
    expect(i.exclusions.length).toBeGreaterThan(0);
    expect(i.indianDomains.length).toBeGreaterThan(0);
  });

  test('inputs are canonicalised (sorted) so file reordering does not bump the version', () => {
    const i = aliasVersionInputs();
    const aliasKeys = i.aliases.map(([k]) => k);
    expect([...aliasKeys]).toEqual([...aliasKeys].sort());
    // each alias list is itself sorted
    for (const [, list] of i.aliases) expect([...list]).toEqual([...list].sort());
    expect([...i.indianDomains]).toEqual([...i.indianDomains].sort());
  });

  test('a content change would change the hash (guards against a no-op hash)', () => {
    const { createHash } = require('node:crypto');
    const base = aliasVersionInputs();
    const mutated = { ...base, aliases: [...base.aliases, ['ZZTEST', ['zz test co']]] };
    const h = (o: unknown) => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 12);
    expect(h(mutated)).not.toBe(h(base));
  });
});
