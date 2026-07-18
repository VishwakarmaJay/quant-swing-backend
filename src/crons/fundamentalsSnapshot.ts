import { env } from '@config/env';

import { snapshotFundamentals } from '@/fundamentals';

import { CRONJOBS, createIntervalCron } from './cron';

/**
 * Weekly fundamentals snapshot (ROADMAP B4, clock #2): capture every universe
 * symbol's current headline ratios with `fetchedAt`, building a native
 * point-in-time archive going forward (current values are lookahead for the
 * past — only snapshots taken as time passes are honest history). Fires once
 * on boot, then every FUNDAMENTALS_SNAPSHOT_INTERVAL_MS (default 7 days).
 */
export const registerFundamentalsSnapshotCron = () =>
  createIntervalCron(CRONJOBS.FUNDAMENTALS_SNAPSHOT, env.FUNDAMENTALS_SNAPSHOT_INTERVAL_MS, async () => {
    await snapshotFundamentals();
  });
