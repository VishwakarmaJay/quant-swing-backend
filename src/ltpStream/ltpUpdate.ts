/** Normalized tick map keyed by our Instrument PK (`exchSeg:symbol`). */
export type LtpUpdate = {
  [instrumentId: string]: {
    /** Last traded price */
    l: number;
    /** Best bid (falls back to LTP when the feed gives none) */
    b: number;
    /** Best ask (falls back to LTP when the feed gives none) */
    a: number;
    /** Cumulative day volume */
    v: number;
  };
};

/** Shape stored in Redis under `ltp:<instrumentId>`. */
export type CachedQuote = {
  l: number;
  b: number;
  a: number;
  v: number;
  /** Epoch millis at which the tick was cached */
  ts: number;
};
