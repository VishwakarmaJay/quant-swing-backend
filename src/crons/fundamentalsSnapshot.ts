import { env } from '@config/env';

import { snapshotFundamentals } from '@/fundamentals';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import { CRONJOBS, createIntervalCron } from './cron';

/**
 * Weekly fundamentals snapshot (ROADMAP B4, clock #2): capture every universe
 * symbol's current headline ratios with `fetchedAt`, building a native
 * point-in-time archive going forward (current values are lookahead for the
 * past — only snapshots taken as time passes are honest history).
 *
 * Boot-fire is guarded by the DATABASE, not the process: the run is skipped
 * unless the newest stored snapshot is older than ~90% of the interval. Without
 * this, every dev-watcher restart attempted a fresh 167-symbol crawl (observed
 * live 2026-07-18 — it kept Screener's IP block alive indefinitely).
 */
export const registerFundamentalsSnapshotCron = () =>
  createIntervalCron(CRONJOBS.FUNDAMENTALS_SNAPSHOT, env.FUNDAMENTALS_SNAPSHOT_INTERVAL_MS, async () => {
    const newest = await prisma.fundamentalSnapshot.findFirst({
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    });
    const dueAfterMs = env.FUNDAMENTALS_SNAPSHOT_INTERVAL_MS * 0.9;
    if (newest && Date.now() - newest.fetchedAt.getTime() < dueAfterMs) {
      const ageH = Math.round((Date.now() - newest.fetchedAt.getTime()) / 3_600_000);
      logger.info(`[Cron]: FUNDAMENTALS_SNAPSHOT not due (last snapshot ${ageH}h ago) — skipped`);
      return;
    }
    await snapshotFundamentals();
  });
