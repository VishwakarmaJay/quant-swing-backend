import type { Instrument } from '@generated/prisma/client';
import { getUniverse } from '@services/instrumentMaster';
import logger from '@services/logger';
import { prisma } from '@services/prisma';
import type { LtpUpdate } from './ltpUpdate';

/** The 3 underlying index rows (AMXIDX) for the configured universe. */
export const getIndexInstruments = async (): Promise<Instrument[]> => {
  const universe = await getUniverse();
  return prisma.instrument.findMany({
    where: { instrumentType: 'AMXIDX', name: { in: universe.names } },
  });
};

/** Strike step for an underlying = smallest gap between consecutive strikes. */
const strikeStep = (strikes: number[]): number => {
  let step = Infinity;
  for (let i = 1; i < strikes.length; i++) {
    const gap = strikes[i]! - strikes[i - 1]!;
    if (gap > 0 && gap < step) step = gap;
  }
  return Number.isFinite(step) ? step : 0;
};

/** Last computed strike step per underlying, so hot paths avoid DB work. */
const strikeStepCache = new Map<string, number>();

export const getCachedStrikeStep = (name: string): number | undefined =>
  strikeStepCache.get(name);

/**
 * Computes the ATM option band for one underlying from its live index price:
 * nearest expiry >= today, strikes within +/- `atmBand` steps of the ATM
 * strike, both calls and puts. BRL-005/006 (US #29-30).
 */
export const getAtmBandInstruments = async (
  name: string,
  indexLtp: number,
): Promise<Instrument[]> => {
  const universe = await getUniverse();

  const nearest = await prisma.instrument.findFirst({
    where: { name, instrumentType: 'OPTIDX', expiry: { gte: new Date() } },
    orderBy: { expiry: 'asc' },
    select: { expiry: true },
  });
  if (!nearest?.expiry) return [];

  const contracts = await prisma.instrument.findMany({
    where: { name, instrumentType: 'OPTIDX', expiry: nearest.expiry },
    orderBy: { strike: 'asc' },
  });
  if (!contracts.length) return [];

  const strikes = [...new Set(contracts.map((c) => c.strike))];
  const step = strikeStep(strikes);
  if (!step) return [];
  strikeStepCache.set(name, step);

  const atm = Math.round(indexLtp / step) * step;
  const halfBand = universe.atmBand * step;

  const band = contracts.filter((c) => Math.abs(c.strike - atm) <= halfBand);
  logger.debug(`[ActiveInstruments]: ${name} ATM ${atm} -> ${band.length} contracts in band`);
  return band;
};

/** Extracts `name -> LTP` for index (AMXIDX) instruments present in a tick. */
export const indexLtpsFromUpdate = (
  update: LtpUpdate,
  indexInstruments: Instrument[],
): Map<string, number> => {
  const ltps = new Map<string, number>();
  for (const index of indexInstruments) {
    const tick = update[index.id];
    if (tick?.l) ltps.set(index.name, tick.l);
  }
  return ltps;
};
