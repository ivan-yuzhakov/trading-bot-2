import type { App } from '../app/App.js';
import type {
  ExchangeBalance,
  ExchangeCandle,
  ExchangeOrder,
  ExchangePairInfo,
  TradeStreamCallback,
  OrderUpdateCallback,
} from './types.js';

export abstract class ExchangeAdapter {
  protected app: App;
  readonly name: string;

  constructor(app: App, name: string) {
    this.app = app;
    this.name = name;
  }

  abstract init(): Promise<void>;

  abstract getBalance(): Promise<ExchangeBalance[]>;

  abstract placeOrder(
    pair: string,
    side: 'BUY' | 'SELL',
    price: string,
    quantity: string,
  ): Promise<ExchangeOrder | undefined>;

  abstract cancelOrder(pair: string, orderId: string): Promise<ExchangeOrder | undefined>;

  abstract getOrder(pair: string, orderId: string): Promise<ExchangeOrder>;

  abstract getOpenOrders(pair: string): Promise<ExchangeOrder[]>;

  abstract fetchCandles(
    pair: string,
    interval: string,
    startTime?: number,
    endTime?: number,
    limit?: number,
  ): Promise<ExchangeCandle[]>;

  abstract connectTradeStream(pair: string, callback: TradeStreamCallback): Promise<void>;

  abstract disconnectTradeStream(pair: string): Promise<void>;

  abstract connectUserStream(callback: OrderUpdateCallback): Promise<void>;

  abstract checkConnectivity(): Promise<boolean>;

  abstract getPairInfo(pair: string): Promise<ExchangePairInfo | undefined>;

  abstract getAvailablePairs(): Promise<ExchangePairInfo[]>;
}
