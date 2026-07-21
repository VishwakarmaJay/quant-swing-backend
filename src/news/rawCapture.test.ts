import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join } from 'node:path';

import { s3KeyForSha, sha256 } from './rawCapture';

/**
 * The DB orchestration in `captureRawPayload` is verified live (it needs
 * Postgres); these cover the pure + filesystem contract it relies on.
 */
describe('sha256', () => {
  test('is deterministic and content-addressed', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
    expect(sha256('hello')).not.toBe(sha256('hello ')); // any byte change → new sha
    expect(sha256('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  test('identical feed payloads collapse to one sha (the dedup guarantee)', () => {
    const feed = '<rss><item><title>X</title></item></rss>';
    expect(sha256(feed)).toBe(sha256(feed)); // a re-fetch of unchanged content
  });
});

describe('s3KeyForSha', () => {
  test('maps a sha to a raw/ object key', () => {
    expect(s3KeyForSha('abc123')).toBe('raw/abc123.gz');
  });
});

describe('gzip spool round-trip', () => {
  test('a spooled payload gunzips back to the exact bytes', () => {
    // Mirrors what captureRawPayload writes: gzipSync(payload) → <sha>.gz.
    const payload = '<rss>…arbitrary feed bytes… ₹ 1,200 crore</rss>';
    const dir = join(
      process.env.TMPDIR ?? '/tmp',
      `rawcap-test-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    try {
      const sha = sha256(payload);
      const { mkdirSync, writeFileSync } = require('node:fs');
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${sha}.gz`);
      writeFileSync(path, gzipSync(Buffer.from(payload, 'utf8')));

      expect(existsSync(path)).toBe(true);
      const restored = gunzipSync(readFileSync(path)).toString('utf8');
      expect(restored).toBe(payload); // byte-exact — replayable against a parser fix
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
