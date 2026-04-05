/** Compact candle for Redis storage: {o,h,l,c,v,t} */
export interface Candle {
  /** open time (ms timestamp from exchange) */
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  /** volume */
  v: string;
}

export type Timeframe = '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d';

/** Base timeframe duration in ms — hardcoded 5 minutes */
export const BASE_TF_MS = 5 * 60 * 1000;

/** Timeframe durations in ms */
export const TF_MS: Record<Timeframe, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

export interface RawTrade {
  price: string;
  quantity: string;
  time: number;
  isBuyerMaker: boolean;
}
