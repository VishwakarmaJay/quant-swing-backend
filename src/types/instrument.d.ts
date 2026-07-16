export type AngelOneScrip = {
  token: string;
  symbol: string;
  name: string;
  expiry: string;
  strike: string;
  lotsize: string;
  instrumenttype: string;
  exch_seg: string;
  tick_size: string;
  freeze_qty: string;
};

export type InstrumentUniverse = {
  names: string[];
  optionSegments: string[];
  /** Strikes to watch on each side of the ATM strike. BRL-005. */
  atmBand: number;
};
