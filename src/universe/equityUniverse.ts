/**
 * The equity trading universe — the ~166 NSE stocks the platform scans, grouped
 * by sector. Committed reference data (not runtime config): version-controlled,
 * reviewable, and the single source of truth the instrument sync resolves
 * against the Angel One scrip master.
 *
 * `sector` feeds two things downstream: the RelativeStrengthFactor's peer group
 * and the PortfolioManager's 1-per-sector cap.
 *
 * ALIASES map our canonical symbol to the Angel scrip-master `name` when a
 * corporate action has renamed it (e.g. ZOMATO → ETERNAL). Symbols that no
 * longer resolve at all are left as-is and reported unresolved by the sync.
 */

/** Canonical symbol → Angel scrip-master `name`, for post-rename lookups. */
export const ANGEL_NAME_ALIASES: Record<string, string> = {
  ZOMATO: 'ETERNAL', // renamed 2025
};

/** Sector label → member symbols (mirrors the tracked universe grouping). */
const SECTORS: Record<string, string[]> = {
  Banks: [
    'HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK',
    'BANKBARODA', 'PNB', 'CANBK', 'UNIONBANK', 'IDFCFIRSTB', 'FEDERALBNK',
    'AUBANK', 'BANDHANBNK',
  ],
  'NBFC / Financial Services': [
    'BAJFINANCE', 'BAJAJFINSV', 'JIOFIN', 'CHOLAFIN', 'SHRIRAMFIN', 'MUTHOOTFIN',
    'LICHSGFIN', 'PFC', 'RECLTD', 'IRFC', 'SBICARD', 'HDFCAMC',
  ],
  Insurance: ['SBILIFE', 'HDFCLIFE', 'ICICIGI', 'ICICIPRULI', 'LICI'],
  IT: [
    // LTM = LTIMindtree (listed as LTM on NSE).
    'TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM', 'LTM', 'PERSISTENT', 'COFORGE',
    'MPHASIS', 'KPITTECH',
  ],
  Auto: [
    // TATAMOTORS demerged (2025): TMCV = commercial vehicles, TMPV = passenger.
    'MARUTI', 'TMCV', 'TMPV', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT', 'HEROMOTOCO',
    'TVSMOTOR', 'ASHOKLEY', 'BHARATFORG', 'MOTHERSON',
  ],
  'Auto Ancillary': ['MRF', 'APOLLOTYRE', 'BOSCHLTD'],
  'Pharma / Healthcare': [
    'SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'APOLLOHOSP', 'MAXHEALTH',
    'LUPIN', 'AUROPHARMA', 'TORNTPHARM', 'ZYDUSLIFE', 'BIOCON', 'ALKEM',
  ],
  'FMCG / Consumer': [
    'HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'TATACONSUM', 'DABUR',
    'GODREJCP', 'MARICO', 'COLPAL', 'VBL', 'UNITDSPR',
  ],
  'Oil & Gas / Energy': [
    'RELIANCE', 'ONGC', 'OIL', 'BPCL', 'IOC', 'HINDPETRO', 'GAIL', 'PETRONET', 'ATGL',
  ],
  'Power / Utilities': [
    'NTPC', 'POWERGRID', 'TATAPOWER', 'ADANIPOWER', 'ADANIGREEN', 'JSWENERGY',
    'NHPC', 'SJVN',
  ],
  'Metals / Mining': [
    'TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'COALINDIA', 'NMDC', 'SAIL',
    'JINDALSTEL', 'HINDZINC',
  ],
  Cement: ['ULTRACEMCO', 'GRASIM', 'SHREECEM', 'AMBUJACEM', 'DALBHARAT'],
  'Infra / Capital Goods': [
    'LT', 'SIEMENS', 'ABB', 'CUMMINSIND', 'THERMAX', 'POLYCAB', 'HAVELLS',
    'CGPOWER', 'BHEL', 'KEI',
  ],
  'Defence / Aerospace': ['BEL', 'HAL', 'BDL', 'MAZDOCK', 'COCHINSHIP', 'SOLARINDS'],
  'Railways / PSU Infra': ['IRCTC', 'RVNL', 'IRCON', 'CONCOR'],
  Realty: ['DLF', 'GODREJPROP', 'OBEROIRLTY', 'PRESTIGE', 'LODHA'],
  Telecom: ['BHARTIARTL', 'IDEA', 'INDUSTOWER'],
  'Chemicals / Fertilizers': [
    'PIDILITIND', 'SRF', 'PIIND', 'DEEPAKNTR', 'TATACHEM', 'CHAMBLFERT', 'UPL',
  ],
  Paints: ['ASIANPAINT', 'BERGEPAINT', 'KANSAINER'],
  'Consumer Durables / Retail': [
    'TITAN', 'DMART', 'TRENT', 'VOLTAS', 'BLUESTARCO', 'CROMPTON', 'BATAINDIA',
  ],
  'New-Age Platforms': ['ZOMATO', 'PAYTM', 'NYKAA', 'POLICYBZR', 'DELHIVERY', 'SWIGGY'],
  'Aviation / Logistics': ['INDIGO', 'ADANIPORTS', 'GESHIP'],
  'Misc Large-Cap': ['ADANIENT', 'JSWINFRA', 'TATACOMM', 'TATAELXSI'],
};

export type EquityUniverseEntry = {
  /** Canonical symbol as tracked internally. */
  symbol: string;
  sector: string;
  /** Angel scrip-master `name` to resolve against (defaults to `symbol`). */
  angelName: string;
};

/** Flattened universe: one entry per stock, with its sector and Angel name. */
export const EQUITY_UNIVERSE: readonly EquityUniverseEntry[] = Object.entries(SECTORS).flatMap(
  ([sector, symbols]) =>
    symbols.map((symbol) => ({
      symbol,
      sector,
      angelName: ANGEL_NAME_ALIASES[symbol] ?? symbol,
    })),
);

/** Distinct sector labels, in declaration order. */
export const EQUITY_SECTORS: readonly string[] = Object.keys(SECTORS);
