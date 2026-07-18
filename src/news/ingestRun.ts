import { deliverAlert } from '@/delivery';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import type { IngestSummary, SourceResult } from './ingest';

/**
 * Ingest-run observability (architecture review "immediate win"): persist a
 * summary row per news-ingest pass and alert the operator on Telegram when
 * something needs a human. Designed for an unattended VM — the console report
 * nobody reads is no longer the only witness.
 *
 * Alert policy (deterministic, flap-resistant):
 *  - FROZEN feed (newest item > 3 days old): alert immediately — this is the
 *    Moneycontrol failure mode; item counts look healthy, only dates expose it.
 *  - Source failed / zero-parse / sidecar degraded: alert only on the SECOND
 *    consecutive run — one-off network flaps and sidecar restarts stay quiet;
 *    real outages page within ~30 minutes (2 × 15-min cadence).
 *  - Every alert line is also stored on the run row, so history is queryable.
 */

export const INGEST_MODULE_NEWS = 'NEWS';

/** How old a source's newest item may be before the feed counts as frozen. */
export const FROZEN_AFTER_DAYS = 3;

/** The slice of a previous run the alert rules need. */
export type PreviousRunView = {
  perSource: Pick<SourceResult, 'source' | 'parsed' | 'error'>[];
  sentimentDegraded: boolean;
};

export type DerivedAlerts = {
  /** ok | degraded | failed — failed means every source failed this run. */
  status: 'ok' | 'degraded' | 'failed';
  alerts: string[];
};

/**
 * Pure alert derivation from the current summary + the previous run's view.
 * `previous === null` (first run ever) suppresses the two-consecutive rules.
 */
export const deriveIngestAlerts = (
  summary: IngestSummary,
  previous: PreviousRunView | null,
  now: Date = summary.fetchedAt,
): DerivedAlerts => {
  const alerts: string[] = [];
  const prevBySource = new Map((previous?.perSource ?? []).map((s) => [s.source, s]));
  const frozenCutoff = now.getTime() - FROZEN_AFTER_DAYS * 86_400_000;

  let failedSources = 0;
  for (const s of summary.perSource) {
    const prev = prevBySource.get(s.source);

    if (s.error !== null) {
      failedSources++;
      if (prev && prev.error !== null) {
        alerts.push(`❌ ${s.source}: ${s.error} — second consecutive run`);
      }
      continue; // a failed source has no items to be frozen/zero-parse about
    }

    if (s.newestItem !== null && Date.parse(s.newestItem) < frozenCutoff) {
      alerts.push(`🧊 ${s.source}: FROZEN? newest item ${s.newestItem.slice(0, 10)} is >${FROZEN_AFTER_DAYS}d old`);
    }

    if (s.parsed === 0 && prev && prev.error === null && prev.parsed === 0) {
      alerts.push(`⚠️ ${s.source}: parsed 0 items — second consecutive run (endpoint/params drift?)`);
    }
  }

  const sentimentDegraded = summary.sentiment?.degraded === true;
  if (sentimentDegraded && previous?.sentimentDegraded) {
    alerts.push(`🤖 FinBERT sidecar down — second consecutive run; articles accumulating unscored`);
  }

  const status: DerivedAlerts['status'] =
    summary.perSource.length > 0 && failedSources === summary.perSource.length
      ? 'failed'
      : failedSources > 0 || alerts.length > 0 || sentimentDegraded
        ? 'degraded'
        : 'ok';

  return { status, alerts };
};

/** Formats the Telegram message for a run's alerts. */
export const formatIngestAlert = (derived: DerivedAlerts, summary: IngestSummary): string =>
  [
    `*News ingest ${derived.status.toUpperCase()}* (${summary.fetchedAt.toISOString().slice(0, 16)}Z)`,
    ...derived.alerts.map((a) => `• ${a}`),
    `totals: ${summary.totals.inserted} new / ${summary.totals.parsed} parsed`,
  ].join('\n');

/**
 * Persists the run row and delivers the alert (when any). Contractually
 * no-throw: observability must never take the ingest down.
 */
export const recordIngestRun = async (summary: IngestSummary, startedAt: Date): Promise<DerivedAlerts | null> => {
  try {
    const prevRow = await prisma.ingestRun.findFirst({
      where: { module: INGEST_MODULE_NEWS },
      orderBy: { startedAt: 'desc' },
      select: { perSource: true, totals: true },
    });
    const previous: PreviousRunView | null = prevRow
      ? {
          perSource: (prevRow.perSource as PreviousRunView['perSource']) ?? [],
          sentimentDegraded: (prevRow.totals as { sentimentDegraded?: boolean })?.sentimentDegraded === true,
        }
      : null;

    const derived = deriveIngestAlerts(summary, previous);

    await prisma.ingestRun.create({
      data: {
        module: INGEST_MODULE_NEWS,
        startedAt,
        finishedAt: new Date(),
        perSource: summary.perSource as object[],
        totals: { ...summary.totals, sentimentDegraded: summary.sentiment?.degraded === true },
        status: derived.status,
        alerts: derived.alerts,
      },
    });

    if (derived.alerts.length > 0) {
      await deliverAlert(formatIngestAlert(derived, summary));
    }
    return derived;
  } catch (err) {
    logger.error(`[News]: ingest-run persistence failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
};
