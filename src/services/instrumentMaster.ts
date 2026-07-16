import type { Prisma } from '@generated/prisma/client';
import logger from '@services/logger';
import { prisma } from '@services/prisma';
import { ServiceUnavailableError } from '@utils/errors';
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

/**
 * Fetches the Angel One scrip master, filters it to the platform universe
 * (index options + their underlying index rows), and merges it into the
 * instrument table: existing rows are updated in place (primary key unchanged),
 * new contracts are inserted, and nothing is ever deleted.
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

  const instruments = scrips.filter((s) => isUnderlying(s) || isIndexOption(s)).map(toInstrument);

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
    `[InstrumentMaster]: merged ${instruments.length} of ${scrips.length} scrips (by ${by})`,
  );
  return { fetched: scrips.length, stored: instruments.length };
};
