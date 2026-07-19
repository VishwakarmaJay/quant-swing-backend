/**
 * Canonical universe symbol → company-name aliases used to match headlines
 * (ROADMAP B3 symbol mapper). This dictionary is the growable asset: the
 * ingestion job logs headlines that match nothing so aliases can be added here
 * over time.
 *
 * Design bias: PRECISION over recall. The done-criterion is "≥90% of matched
 * symbols correct", so aliases are deliberately multi-word, unambiguous company
 * names — never bare group words ("Tata", "Adani", "Bajaj", "Mahindra") that map
 * to several universe members. A company we can't disambiguate safely is left to
 * the unmatched log rather than guessed. Bare stock tickers are intentionally
 * NOT auto-matched (too many collide with English words: TITAN, TRENT, OIL,
 * SAIL, GAIL) — see symbolMapper.ts.
 *
 * Aliases are matched case-insensitively with word boundaries; internal spaces
 * match any whitespace run. Keep them lowercase here for readability (matching
 * is case-insensitive regardless).
 *
 * ALIAS_EXCLUSIONS (below) blocks an alias when it is immediately followed by a
 * listed word — for group prefixes whose subsidiaries share the name.
 */
export const COMPANY_ALIASES: Record<string, string[]> = {
  // ---- Banks ----
  HDFCBANK: ['hdfc bank'],
  ICICIBANK: ['icici bank'],
  SBIN: ['state bank of india', 'sbi'],
  KOTAKBANK: ['kotak mahindra bank', 'kotak bank'],
  AXISBANK: ['axis bank'],
  INDUSINDBK: ['indusind bank'],
  BANKBARODA: ['bank of baroda'],
  PNB: ['punjab national bank'],
  CANBK: ['canara bank'],
  UNIONBANK: ['union bank of india'],
  IDFCFIRSTB: ['idfc first bank'],
  FEDERALBNK: ['federal bank'],
  AUBANK: ['au small finance bank', 'au bank'],
  BANDHANBNK: ['bandhan bank'],

  // ---- NBFC / Financial Services ----
  BAJFINANCE: ['bajaj finance'],
  BAJAJFINSV: ['bajaj finserv'],
  JIOFIN: ['jio financial', 'jio finance'],
  CHOLAFIN: ['cholamandalam'],
  SHRIRAMFIN: ['shriram finance'],
  MUTHOOTFIN: ['muthoot finance'],
  LICHSGFIN: ['lic housing finance'],
  PFC: ['power finance corporation'],
  RECLTD: ['rec limited', 'rec ltd', 'rural electrification'],
  IRFC: ['indian railway finance', 'irfc'],
  SBICARD: ['sbi card', 'sbi cards'],
  HDFCAMC: ['hdfc amc', 'hdfc asset management'],

  // ---- Insurance ----
  SBILIFE: ['sbi life'],
  HDFCLIFE: ['hdfc life'],
  ICICIGI: ['icici lombard'],
  ICICIPRULI: ['icici prudential'],
  LICI: ['life insurance corporation', 'lic of india'],

  // ---- IT ----
  TCS: ['tata consultancy services', 'tata consultancy', 'tcs'],
  INFY: ['infosys'],
  HCLTECH: ['hcl technologies', 'hcltech'],
  WIPRO: ['wipro'],
  TECHM: ['tech mahindra'],
  LTM: ['ltimindtree', 'l&t infotech', 'lti mindtree', 'ltm ltd'],
  PERSISTENT: ['persistent systems'],
  COFORGE: ['coforge'],
  MPHASIS: ['mphasis'],
  KPITTECH: ['kpit technologies', 'kpit'],

  // ---- Auto ----
  MARUTI: ['maruti suzuki', 'maruti'],
  TMCV: ['tata motors commercial', 'tml commercial vehicles', 'tata motors'],
  TMPV: ['tata motors passenger', 'tml passenger vehicles', 'tata motors'],
  'M&M': ['mahindra & mahindra', 'm&m'],
  'BAJAJ-AUTO': ['bajaj auto'],
  EICHERMOT: ['eicher motors', 'royal enfield'],
  HEROMOTOCO: ['hero motocorp'],
  TVSMOTOR: ['tvs motor'],
  ASHOKLEY: ['ashok leyland'],
  BHARATFORG: ['bharat forge'],
  MOTHERSON: ['samvardhana motherson', 'motherson sumi'],

  // ---- Auto Ancillary ----
  MRF: ['mrf tyres', 'mrf ltd'],
  APOLLOTYRE: ['apollo tyres'],
  BOSCHLTD: ['bosch'],

  // ---- Pharma / Healthcare ----
  SUNPHARMA: ['sun pharma', 'sun pharmaceutical'],
  DRREDDY: ["dr reddy", "dr. reddy", "dr reddy's", "dr reddys"],
  CIPLA: ['cipla'],
  DIVISLAB: ["divi's laboratories", 'divis lab', 'divis laboratories'],
  APOLLOHOSP: ['apollo hospitals'],
  MAXHEALTH: ['max healthcare'],
  LUPIN: ['lupin'],
  AUROPHARMA: ['aurobindo pharma'],
  TORNTPHARM: ['torrent pharma', 'torrent pharmaceuticals'],
  ZYDUSLIFE: ['zydus lifesciences', 'zydus life'],
  BIOCON: ['biocon'],
  ALKEM: ['alkem laboratories', 'alkem lab'],

  // ---- FMCG / Consumer ----
  HINDUNILVR: ['hindustan unilever', 'hul'],
  ITC: ['itc limited', 'itc ltd'],
  NESTLEIND: ['nestle india'],
  BRITANNIA: ['britannia'],
  TATACONSUM: ['tata consumer'],
  DABUR: ['dabur'],
  GODREJCP: ['godrej consumer'],
  MARICO: ['marico'],
  COLPAL: ['colgate'],
  VBL: ['varun beverages'],
  UNITDSPR: ['united spirits'],

  // ---- Oil & Gas / Energy ----
  RELIANCE: ['reliance industries', 'ril'],
  ONGC: ['oil and natural gas', 'ongc'],
  OIL: ['oil india'],
  BPCL: ['bharat petroleum', 'bpcl'],
  IOC: ['indian oil', 'ioc'],
  HINDPETRO: ['hindustan petroleum', 'hpcl'],
  GAIL: ['gail india', 'gail (india)'],
  PETRONET: ['petronet lng'],
  ATGL: ['adani total gas'],

  // ---- Power / Utilities ----
  NTPC: ['ntpc'],
  POWERGRID: ['power grid corporation', 'powergrid'],
  TATAPOWER: ['tata power'],
  ADANIPOWER: ['adani power'],
  ADANIGREEN: ['adani green'],
  JSWENERGY: ['jsw energy'],
  NHPC: ['nhpc'],
  SJVN: ['sjvn'],

  // ---- Metals / Mining ----
  TATASTEEL: ['tata steel'],
  JSWSTEEL: ['jsw steel'],
  HINDALCO: ['hindalco'],
  VEDL: ['vedanta'],
  COALINDIA: ['coal india'],
  NMDC: ['nmdc'],
  SAIL: ['steel authority of india'],
  JINDALSTEL: ['jindal steel'],
  HINDZINC: ['hindustan zinc'],

  // ---- Cement ----
  ULTRACEMCO: ['ultratech cement', 'ultratech'],
  GRASIM: ['grasim'],
  SHREECEM: ['shree cement'],
  AMBUJACEM: ['ambuja cement', 'ambuja cements'],
  DALBHARAT: ['dalmia bharat'],

  // ---- Infra / Capital Goods ----
  LT: ['larsen & toubro', 'larsen and toubro', 'l&t'],
  SIEMENS: ['siemens india', 'siemens ltd'],
  ABB: ['abb india'],
  CUMMINSIND: ['cummins india'],
  THERMAX: ['thermax'],
  POLYCAB: ['polycab'],
  HAVELLS: ['havells'],
  CGPOWER: ['cg power'],
  BHEL: ['bharat heavy electricals', 'bhel'],
  KEI: ['kei industries'],

  // ---- Defence / Aerospace ----
  BEL: ['bharat electronics'],
  HAL: ['hindustan aeronautics'],
  BDL: ['bharat dynamics'],
  MAZDOCK: ['mazagon dock'],
  COCHINSHIP: ['cochin shipyard'],
  SOLARINDS: ['solar industries'],

  // ---- Railways / PSU Infra ----
  IRCTC: ['irctc', 'indian railway catering'],
  RVNL: ['rail vikas nigam', 'rvnl'],
  IRCON: ['ircon international', 'ircon'],
  CONCOR: ['container corporation'],

  // ---- Realty ----
  DLF: ['dlf limited', 'dlf ltd'],
  GODREJPROP: ['godrej properties'],
  OBEROIRLTY: ['oberoi realty'],
  PRESTIGE: ['prestige estates'],
  LODHA: ['lodha', 'macrotech developers'],

  // ---- Telecom ----
  BHARTIARTL: ['bharti airtel', 'airtel'],
  IDEA: ['vodafone idea'],
  INDUSTOWER: ['indus towers'],

  // ---- Chemicals / Fertilizers ----
  PIDILITIND: ['pidilite'],
  SRF: ['srf limited', 'srf ltd'],
  PIIND: ['pi industries'],
  DEEPAKNTR: ['deepak nitrite'],
  TATACHEM: ['tata chemicals'],
  CHAMBLFERT: ['chambal fertilisers', 'chambal fertilizers'],
  UPL: ['upl limited', 'upl ltd'],

  // ---- Paints ----
  ASIANPAINT: ['asian paints'],
  BERGEPAINT: ['berger paints'],
  KANSAINER: ['kansai nerolac', 'nerolac'],

  // ---- Consumer Durables / Retail ----
  TITAN: ['titan company'],
  DMART: ['avenue supermarts', 'dmart', 'd-mart'],
  TRENT: ['trent limited', 'trent ltd', 'westside'],
  VOLTAS: ['voltas'],
  BLUESTARCO: ['blue star'],
  CROMPTON: ['crompton greaves consumer', 'crompton'],
  BATAINDIA: ['bata india'],

  // ---- New-Age Platforms ----
  ZOMATO: ['eternal ltd', 'eternal limited', 'zomato'],
  PAYTM: ['paytm', 'one97 communications', 'one 97 communications'],
  NYKAA: ['nykaa', 'fsn e-commerce'],
  POLICYBZR: ['policybazaar', 'pb fintech'],
  DELHIVERY: ['delhivery'],
  SWIGGY: ['swiggy'],

  // ---- Aviation / Logistics ----
  INDIGO: ['interglobe aviation', 'indigo airlines'],
  ADANIPORTS: ['adani ports'],
  GESHIP: ['great eastern shipping'],

  // ---- Misc Large-Cap ----
  ADANIENT: ['adani enterprises'],
  JSWINFRA: ['jsw infrastructure'],
  TATACOMM: ['tata communications'],
  TATAELXSI: ['tata elxsi'],
};

/**
 * Alias → following-words that BLOCK the match (negative lookahead). For group
 * prefixes whose subsidiaries carry the same name: the first live precision
 * sample (2026-07-18, 92%) showed every miss was bare "sbi" firing inside
 * "SBI Life" (a different universe stock!), "SBI Funds Management", and
 * "SBI Capital Markets". "SBI raises rates" / "SBI's Q1" still match SBIN.
 *
 * ── Homonym guards (GDELT_PRECISION_FIX S2, 2026-07-19) ──
 * The GDELT media backfill exposed common-English-word aliases colliding with
 * foreign homonyms. The Indian-domain allowlist (`indianDomains.ts`) is the
 * PRIMARY fix and already lifts these symbols to ~95-100% on Indian coverage;
 * these exclusions are a cheap, zero-recall-cost second line (a homonym slipping
 * through on an allowlisted domain, or any future domain-filter gap). Words are
 * the disambiguating token that FOLLOWS the alias in the false-positive — never
 * a token that follows the real company (verified against the live sample), so
 * "Britannia Q1", "Colgate India", "Federal Bank net profit", "Lupin shares"
 * all still map.
 */
export const ALIAS_EXCLUSIONS: Record<string, string[]> = {
  sbi: ['life', 'card', 'cards', 'funds', 'fund', 'capital', 'mutual', 'general', 'amc', 'caps'],
  // "A55 Britannia Bridge", "Britannia Beach", "Britannia Stand", cruise ship
  // "Britannia", gold "Britannia" coin, "Britannia Coconut Dancers".
  britannia: ['beach', 'bridge', 'stand', 'coconut', 'coin', 'cruise', 'naval', 'royal', 'yacht', 'row'],
  // "'Lupin' writer/series/season" (Netflix show), Arsène Lupin the gentleman thief.
  lupin: ['writer', 'series', 'season', 'netflix', 'part', 'thief', 'gentleman', 'star', 'cast'],
  // "Colgate Rochester Crozer Divinity School", Colgate University "Raiders".
  colgate: ['university', 'rochester', 'divinity', 'maroon', 'raiders', 'college'],
  // "federal bank fraud charges" (US crime), bank robberies/heists.
  'federal bank': ['fraud', 'charges', 'robbery', 'robberies', 'heist', 'indicted'],
};
