import { createHash } from 'node:crypto';

import { env } from '@config/env';
import {
  DEFAULT_MOMENTUM_CONFIG,
  DEFAULT_RS_CONFIG,
  DEFAULT_SECTOR_RS_CONFIG,
  DEFAULT_TREND_CONFIG,
  DEFAULT_VOLATILITY_CONFIG,
  DEFAULT_VOLUME_CONFIG,
} from '@/factors';
import { DEFAULT_STRATEGY_CONFIG } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * Version stamps that make every signal reproducible (docs ARCHITECTURE):
 * change any factor param or strategy weight and the checksum changes, so a
 * stored signal always names the exact config + engine that produced it.
 */
export const SNAPSHOT_SCHEMA_VERSION = '1.0.0';

export type RunVersions = {
  snapshotSchemaVersion: string;
  weightsVersion: string;
  engineVersion: string;
  instrumentMasterVersion: string;
  factorConfigChecksum: string;
};

const shortHash = (obj: unknown): string =>
  createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 12);

const gitSha = (): string | null => {
  try {
    const out = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD']).stdout.toString().trim();
    return out || null;
  } catch {
    return null;
  }
};

export const computeRunVersions = async (): Promise<RunVersions> => {
  const factorConfigChecksum = `f-${shortHash({
    trend: DEFAULT_TREND_CONFIG,
    momentum: DEFAULT_MOMENTUM_CONFIG,
    relativeStrength: DEFAULT_RS_CONFIG,
    sectorRelativeStrength: DEFAULT_SECTOR_RS_CONFIG,
    volume: DEFAULT_VOLUME_CONFIG,
    volatility: DEFAULT_VOLATILITY_CONFIG,
  })}`;

  const weightsVersion = `w-${shortHash({
    regimeWeights: DEFAULT_STRATEGY_CONFIG.regimeWeights,
    technicalFactorWeights: DEFAULT_STRATEGY_CONFIG.technicalFactorWeights,
    baseThreshold: DEFAULT_STRATEGY_CONFIG.baseThreshold,
    regimeThresholdAdj: DEFAULT_STRATEGY_CONFIG.regimeThresholdAdj,
  })}`;

  // Best-effort instrument-master version: universe size + latest sync date.
  const agg = await prisma.instrument.aggregate({ _count: true, _max: { updatedAt: true } });
  const masterDate = agg._max.updatedAt ? agg._max.updatedAt.toISOString().slice(0, 10) : 'unknown';

  return {
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    weightsVersion,
    engineVersion: env.ENGINE_VERSION ?? gitSha() ?? 'dev',
    instrumentMasterVersion: `im-${agg._count}@${masterDate}`,
    factorConfigChecksum,
  };
};
