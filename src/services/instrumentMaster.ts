import type { Prisma } from '@generated/prisma/client';
import logger from '@services/logger';
import { prisma } from '@services/prisma';
import { ServiceUnavailableError } from '@utils/errors';
import { EQUITY_UNIVERSE } from '@/universe/equityUniverse';
import type { AngelOneScrip, InstrumentUniverse } from '../types/instrument';

const SCRIP_MASTER_URL =
  'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

const UNIVERSE_CONFIG_KEY = 'instrument.universe';
const UPSERT_SLICE_SIZE = 500;

const DEFAULT_UNIVERSE: InstrumentUniverse = {
  names: ['NIFTY', 'BANKNIFTY', 'SENSEX'],
  optionSegments: ['NFO', 'BFO'],
  atmBand: 3,
};

const MONTHS: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

/** Parses the dump expiry format `DDMMMYYYY` (e.g. 29JAN2026). */
const parseExpiry = (expiry: string): Date | null => {
  const match = /^(\d{2})([A-Z]{3})(\d{4})$/.exec(expiry);
  if (!match) return null;

  const month = MONTHS[match[2]!];
  if (month === undefined) return null;

  return new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
};

/** Loads the universe filter from AppConfig, seeding the default on first use. */
export const getUniverse = async (): Promise<InstrumentUniverse> => {
  const config = await prisma.appConfig.findUnique({ where: { key: UNIVERSE_CONFIG_KEY } });
  // Merge over defaults so configs stored before a field existed stay valid.
  if (config) return { ...DEFAULT_UNIVERSE, ...(config.value as Partial<InstrumentUniverse>) };

  await prisma.appConfig.create({
    data: { key: UNIVERSE_CONFIG_KEY, value: DEFAULT_UNIVERSE },
  });
  return DEFAULT_UNIVERSE;
};

const toInstrument = (scrip: AngelOneScrip): Prisma.InstrumentCreateManyInput => ({
  id: `${scrip.exch_seg}:${scrip.symbol}`,
  token: scrip.token,
  symbol: scrip.symbol,
  name: scrip.name,
  expiry: parseExpiry(scrip.expiry),
  // Angel One publishes strikes in paise (actual strike x 100)
  strike: Number(scrip.strike) / 100,
  lotSize: Number(scrip.lotsize),
  tickSize: Number(scrip.tick_size),
  instrumentType: scrip.instrumenttype,
  exchSeg: scrip.exch_seg,
  freezeQty: Number(scrip.freeze_qty),
});

/** NSE cash equity (Angel instrumenttype ""), stamped with our EQ type + sector. */
const toEquityInstrument = (
  scrip: AngelOneScrip,
  sector: string,
): Prisma.InstrumentCreateManyInput => ({
  id: `${scrip.exch_seg}:${scrip.symbol}`,
  token: scrip.token,
  symbol: scrip.symbol,
  name: scrip.name,
  expiry: null,
  strike: 0,
  lotSize: Number(scrip.lotsize) || 1,
  // Equity tick_size is published in paise (e.g. 5 → ₹0.05), unlike derivatives.
  tickSize: Number(scrip.tick_size) / 100,
  instrumentType: 'EQ',
  exchSeg: scrip.exch_seg,
  sector,
  freezeQty: Number(scrip.freeze_qty) || 0,
});

/**
 * Fetches the Angel One scrip master, filters it to the platform universe —
 * index options + their underlying index rows, plus the NSE equity universe —
 * and merges it into the instrument table: existing rows update in place
 * (primary key unchanged), new rows insert, nothing is ever deleted. Equity
 * symbols that don't resolve (renames/delistings) are reported, never dropped
 * silently.
 */
export const syncInstrumentMaster = async (by: string) => {
  const universe = await getUniverse();

  logger.info('[InstrumentMaster]: fetching Angel One scrip master');
  const response = await fetch(SCRIP_MASTER_URL);
  if (!response.ok) {
    throw new ServiceUnavailableError(`Scrip master fetch failed with status ${response.status}`);
  }
  const scrips = (await response.json()) as AngelOneScrip[];

  const isUnderlying = (scrip: AngelOneScrip) =>
    scrip.instrumenttype === 'AMXIDX' && universe.names.includes(scrip.name);

  const isIndexOption = (scrip: AngelOneScrip) =>
    scrip.instrumenttype === 'OPTIDX' &&
    universe.optionSegments.includes(scrip.exch_seg) &&
    universe.names.includes(scrip.name);

  // Equity universe, keyed by the Angel scrip-master `name` (alias-aware).
  const equityByAngelName = new Map(EQUITY_UNIVERSE.map((e) => [e.angelName, e]));
  const isEquity = (scrip: AngelOneScrip) =>
    scrip.exch_seg === 'NSE' &&
    scrip.instrumenttype === '' &&
    scrip.symbol.endsWith('-EQ') &&
    equityByAngelName.has(scrip.name);

  const derivativeInstruments = scrips
    .filter((s) => isUnderlying(s) || isIndexOption(s))
    .map(toInstrument);

  const equityScrips = scrips.filter(isEquity);
  const equityInstruments = equityScrips.map((s) =>
    toEquityInstrument(s, equityByAngelName.get(s.name)!.sector),
  );

  const resolvedNames = new Set(equityScrips.map((s) => s.name));
  const unresolvedEquities = EQUITY_UNIVERSE.filter((e) => !resolvedNames.has(e.angelName)).map(
    (e) => e.symbol,
  );

  const instruments = [...derivativeInstruments, ...equityInstruments];

  // Upsert in slices: update existing rows by primary key, insert new ones.
  for (let i = 0; i < instruments.length; i += UPSERT_SLICE_SIZE) {
    await prisma.$transaction(
      instruments.slice(i, i + UPSERT_SLICE_SIZE).map(({ id, ...data }) =>
        prisma.instrument.upsert({
          where: { id },
          update: data,
          create: { id, ...data },
        }),
      ),
    );
  }

  logger.info(
    `[InstrumentMaster]: merged ${instruments.length} scrips ` +
      `(${derivativeInstruments.length} derivative, ${equityInstruments.length} equity) by ${by}`,
  );
  if (unresolvedEquities.length) {
    logger.warn(
      `[InstrumentMaster]: ${unresolvedEquities.length} equity symbol(s) did not resolve — ` +
        `add an alias in equityUniverse.ts: ${unresolvedEquities.join(', ')}`,
    );
  }

  return {
    fetched: scrips.length,
    stored: instruments.length,
    equities: equityInstruments.length,
    unresolvedEquities,
  };
};
