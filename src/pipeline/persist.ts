import type { Prisma } from '@generated/prisma/client';
import { prisma } from '@services/prisma';

import type { PipelineRun } from './runPipeline';

/**
 * Persists a pipeline run: the run summary, every approved signal (with its
 * full versioned snapshot), and every rejection. Append-only, one transaction —
 * a run that can't persist never happened (docs reproducibility rule).
 */
export const persistRun = async (run: PipelineRun): Promise<void> => {
  const asOf = new Date(`${run.asOf}T00:00:00.000Z`);
  const { versions } = run;

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.signalRun.create({
      data: {
        id: run.runId,
        asOf,
        marketRegime: run.regime,
        regimeDetail: run.regimeDetail,
        approvedCount: run.approved.length,
        rejectedCount: run.rejections.length,
        engineVersion: versions.engineVersion,
        weightsVersion: versions.weightsVersion,
        factorConfigChecksum: versions.factorConfigChecksum,
      },
    }),
  ];

  if (run.approved.length) {
    ops.push(
      prisma.signal.createMany({
        data: run.approved.map((s) => ({
          runId: run.runId,
          asOf,
          instrumentId: s.instrumentId,
          symbol: s.symbol,
          sector: s.sector,
          action: 'BUY',
          entry: s.entry,
          entryLow: s.entryLow,
          entryHigh: s.entryHigh,
          stopLoss: s.stopLoss,
          target1: s.target1,
          target2: s.target2,
          riskPerShare: s.riskPerShare,
          rrToResistance: s.rrToResistance,
          atrPct: s.atrPct,
          qty: s.qty,
          positionValue: s.positionValue,
          allocatedCapital: s.allocatedCapital,
          riskAmount: s.riskAmount,
          compositeScore: s.compositeScore,
          agreementScore: s.agreementScore,
          marketRegime: s.regime,
          snapshotJson: s as unknown as Prisma.InputJsonValue,
          snapshotSchemaVersion: versions.snapshotSchemaVersion,
          weightsVersion: versions.weightsVersion,
          engineVersion: versions.engineVersion,
          instrumentMasterVersion: versions.instrumentMasterVersion,
          constituentSnapshotDate: asOf,
          factorConfigChecksum: versions.factorConfigChecksum,
        })),
      }),
    );
  }

  if (run.rejections.length) {
    ops.push(
      prisma.signalRejection.createMany({
        data: run.rejections.map((r) => ({
          runId: run.runId,
          instrumentId: r.instrumentId,
          symbol: r.symbol,
          stage: r.stage,
          reason: r.reason,
          detail: r.detail,
        })),
      }),
    );
  }

  await prisma.$transaction(ops);
};
