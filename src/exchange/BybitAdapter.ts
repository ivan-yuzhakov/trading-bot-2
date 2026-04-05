import type { App } from '../app/App.js';
import { ExchangeAdapter } from './ExchangeAdapter.js';
import type {
  ExchangeBalance,
  ExchangeCandle,
  ExchangeOrder,
  ExchangePairInfo,
  TradeStreamCallback,
  OrderUpdateCallback,
} from './types.js';

/**
 * Bybit adapter — заглушка для будущей реализации.
 * Структура готова, методы выбрасывают ошибку "Not implemented".
 */
export class BybitAdapter extends ExchangeAdapter {
  constructor(app: App) {
    super(app, 'bybit');
  }

  async init(): Promise<void> {
    this.app.logger.log('[BybitAdapter] initialized (stub)');
  }

  async getBalance(): Promise<ExchangeBalance[]> {
    throw new Error('BybitAdapter.getBalance not implemented');
  }

  async placeOrder(_pair: string, _side: 'BUY' | 'SELL', _price: string, _quantity: string): Promise<ExchangeOrder | undefined> {
    throw new Error('BybitAdapter.placeOrder not implemented');
  }

  async cancelOrder(_pair: string, _orderId: string): Promise<ExchangeOrder | undefined> {
    throw new Error('BybitAdapter.cancelOrder not implemented');
  }

  async getOrder(_pair: string, _orderId: string): Promise<ExchangeOrder> {
    throw new Error('BybitAdapter.getOrder not implemented');
  }

  async getOpenOrders(_pair: string): Promise<ExchangeOrder[]> {
    throw new Error('BybitAdapter.getOpenOrders not implemented');
  }

  async fetchCandles(_pair: string, _interval: string, _startTime?: number, _endTime?: number, _limit?: number): Promise<ExchangeCandle[]> {
    throw new Error('BybitAdapter.fetchCandles not implemented');
  }

  async connectTradeStream(_pair: string, _callback: TradeStreamCallback): Promise<void> {
    throw new Error('BybitAdapter.connectTradeStream not implemented');
  }

  async disconnectTradeStream(_pair: string): Promise<void> {
    throw new Error('BybitAdapter.disconnectTradeStream not implemented');
  }

  async connectUserStream(_callback: OrderUpdateCallback): Promise<void> {
    throw new Error('BybitAdapter.connectUserStream not implemented');
  }

  async checkConnectivity(): Promise<boolean> {
    return false;
  }

  async getPairInfo(_pair: string): Promise<ExchangePairInfo | undefined> {
    throw new Error('BybitAdapter.getPairInfo not implemented');
  }

  async getAvailablePairs(): Promise<ExchangePairInfo[]> {
    throw new Error('BybitAdapter.getAvailablePairs not implemented');
  }
}
