export interface ExchangeBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface ExchangeOrder {
  orderId: string;
  symbol: string;
  status: string;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  executedQty: string;
  commission?: string;
  commissionAsset?: string;
  raw?: Record<string, unknown>;
}

export interface ExchangeCandle {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  trades: number;
}

export interface ExchangeTrade {
  id: string;
  price: string;
  quantity: string;
  time: number;
  isBuyerMaker: boolean;
}

export interface ExchangePairInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  pricePrecision: number;
  quantityPrecision: number;
  minNotional: string;
  stepSize: string;
  tickSize: string;
}

export type TradeStreamCallback = (trade: ExchangeTrade) => void;
export type OrderUpdateCallback = (order: ExchangeOrder) => void;
