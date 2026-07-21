import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

import logger from '@services/logger';
import { prisma } from '@services/prisma';

/**
 * Raw-payload capture (B16) — the architecture review's "Bronze layer".
 *
 * The RSS/BSE parser is regex-based and can silently drop malformed items, so a
 * parser bug found next month cannot be replayed against last month's feeds
 * unless the raw payload was kept. This module keeps it.
 *
 * Storage split (deliberate): the payload BYTES are gzipped to a local spool
 * dir; the existing daily backup ships the spool to S3 (`raw/<sha>.gz`) and
 * prunes it, so the box holds < 1 day of raw and the Postgres dump stays tiny.
 * A lightweight `raw_capture` INDEX row (sha, source, url, status, bytes,
 * s3Key) lives in the DB forever — queryable provenance that travels in the
 * backup even if S3 is lost.
 *
 * Dedup by content SHA: CDN-cached feeds return byte-identical payloads across
 * 15-min polls, so a re-fetch just bumps `seenCount`/`lastSeen` and re-spools
 * nothing. One row and one S3 object per distinct payload.
 *
 * NON-FATAL: every failure here is caught and logged. Raw capture must never
 * fail news ingestion — the parsed articles are the asset; the raw payload is
 * insurance.
 */

/** Where the backend container writes gzipped payloads for the backup to ship. */
export const rawSpoolDir = (): string => process.env.RAW_SPOOL_DIR ?? '.cache/raw-spool';

/** The S3 object key a given payload will occupy once the backup ships it. */
export const s3KeyForSha = (sha: string): string => `raw/${sha}.gz`;

export const sha256 = (payload: string): string =>
  createHash('sha256').update(payload).digest('hex');

/**
 * Captures one fetched payload. Idempotent on content:
 *  - unseen sha  → insert index row + spool `<sha>.gz`
 *  - seen sha    → bump seenCount / lastSeen, spool nothing
 *
 * Returns the sha (or null if capture was skipped/failed). Never throws.
 */
export const captureRawPayload = async (
  source: string,
  url: string,
  httpStatus: number,
  payload: string,
): Promise<string | null> => {
  try {
    if (!payload) return null;
    const sha = sha256(payload);

    const existing = await prisma.rawCapture.findUnique({ where: { sha }, select: { id: true } });
    if (existing) {
      await prisma.rawCapture.update({
        where: { sha },
        data: { lastSeen: new Date(), seenCount: { increment: 1 } },
      });
      return sha; // same content — already spooled/shipped
    }

    // New content: spool the gzipped bytes, then record the index row.
    const dir = rawSpoolDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const gz = gzipSync(Buffer.from(payload, 'utf8'));
    writeFileSync(join(dir, `${sha}.gz`), gz);

    await prisma.rawCapture.create({
      data: {
        sha,
        source,
        url,
        httpStatus,
        bytes: Buffer.byteLength(payload, 'utf8'),
        s3Key: s3KeyForSha(sha), // where the backup will ship it (~within 24h)
      },
    });
    return sha;
  } catch (err) {
    // A unique-key race (two URLs, same content, same run) lands here — benign.
    logger.warn(`[RawCapture]: skipped ${source} (${err instanceof Error ? err.message : err})`);
    return null;
  }
};
