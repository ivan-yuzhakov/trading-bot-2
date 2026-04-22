import crypto from 'crypto';
import axios, { type AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { App } from '../app/App.js';
import { ExchangeAdapter } from './ExchangeAdapter.js';
import type {
  ExchangeBalance,
  ExchangeCandle,
  ExchangeOrder,
  ExchangePairInfo,
  ExchangeTrade,
  TradeStreamCallback,
  OrderUpdateCallback,
} from './types.js';

enum TaskStatus {
  Created = 0,
  Prepared = 1,
  Sent = 2,
  Received = 3,
}

interface WsTask {
  status: TaskStatus;
  ts: number;
  request: any;
  response: any;
}

export class BinanceAdapter extends ExchangeAdapter {
  #rest: AxiosInstance;
  #ws: WebSocket | null = null;
  #isAuthenticated = false;
  #isUserStream = false;
  #heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  #lastPong = 0;
  #reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  #reconnectDelay = 5000;
  #tasks: Record<string, WsTask> = {};
  #requestCounter = 0;
  #tradeStreams: Map<string, WebSocket> = new Map();
  #orderUpdateCallback: OrderUpdateCallback | null = null;
  events = new EventEmitter();

  #baseUrl: string;
  #wsApiUrl: string;
  #streamUrl: string;

  constructor(app: App) {
    super(app, 'binance');

    const demo = app.config.binance.demo;
    this.#baseUrl = demo ? 'https://demo-api.binance.com' : 'https://api.binance.com';
    this.#wsApiUrl = demo ? 'wss://demo-ws-api.binance.com/ws-api/v3' : 'wss://ws-api.binance.com:443/ws-api/v3';
    this.#streamUrl = demo ? 'wss://demo-stream.binance.com:9443/ws' : 'wss://stream.binance.com:9443/ws';

    this.#rest = axios.create({
      baseURL: this.#baseUrl,
      timeout: 12000,
      headers: {
        'X-MBX-APIKEY': app.config.binance.apiKey,
      },
    });
  }

  async init(): Promise<void> {
    if (!this.app.config.binance.apiKey) {
      this.app.logger.log('[BinanceAdapter] No API key configured, skipping init');
      return;
    }

    // Init WS
    this.#startSendingLoop();
    this.#connect();

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (this.#isAuthenticated && this.#isUserStream) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    this.app.logger.log('[BinanceAdapter] initialized');
  }

  // ==================== REST API ====================

  async getBalance(): Promise<ExchangeBalance[]> {
    const result = await this.#request('get', '/api/v3/account', true, { omitZeroBalances: true });
    return result.data.balances.map((b: any) => ({
      asset: b.asset,
      free: b.free,
      locked: b.locked,
    }));
  }

  async placeOrder(pair: string, side: 'BUY' | 'SELL', price: string, quantity: string): Promise<ExchangeOrder | undefined> {
    this.app.logger.log(`BinanceAdapter.placeOrder(): ${JSON.stringify({ pair, side, price, quantity })}`);

    if (this.app.config.mode !== 'prod') {
      this.app.logger.log('Order not sent — development mode');
      return {
        orderId: '-1',
        symbol: pair,
        status: 'NEW',
        side,
        price,
        quantity,
        executedQty: '0',
      };
    }

    try {
      const result = await this.#request('post', '/api/v3/order', true, {
        symbol: pair,
        side,
        type: 'LIMIT',
        price,
        quantity,
        timeInForce: 'GTC',
      });

      const d = result.data;
      return {
        orderId: String(d.orderId),
        symbol: d.symbol,
        status: d.status,
        side: d.side,
        price: d.price,
        quantity: d.origQty,
        executedQty: d.executedQty,
        raw: d,
      };
    } catch (e: any) {
      this.app.logger.error(`BinanceAdapter.placeOrder error:\n${e.stack}\nResponse: ${JSON.stringify(e.response?.data)}`);
      return undefined;
    }
  }

  async cancelOrder(pair: string, orderId: string): Promise<ExchangeOrder | undefined> {
    if (orderId === '-1') return undefined;

    this.app.logger.log(`BinanceAdapter.cancelOrder(): ${JSON.stringify({ pair, orderId })}`);

    if (this.app.config.mode !== 'prod') {
      this.app.logger.log('Order not cancelled — development mode');
      return { orderId, symbol: pair, status: 'CANCELED', side: 'BUY', price: '0', quantity: '0', executedQty: '0' };
    }

    try {
      const result = await this.#request('delete', '/api/v3/order', true, {
        symbol: pair,
        orderId: +orderId,
        cancelRestrictions: 'ONLY_NEW',
      });

      const d = result.data;
      return {
        orderId: String(d.orderId),
        symbol: d.symbol,
        status: d.status,
        side: d.side,
        price: d.price,
        quantity: d.origQty,
        executedQty: d.executedQty,
        raw: d,
      };
    } catch (e: any) {
      if (e.response?.data?.code === -2011) {
        this.app.logger.error(`BinanceAdapter.cancelOrder: Order ${orderId} not NEW. ${e.response.data.msg}`);
        throw new Error(`ORDER_NOT_NEW: ${e.response.data.msg}`);
      }
      this.app.logger.error(`BinanceAdapter.cancelOrder error:\n${e.stack}\nResponse: ${JSON.stringify(e.response?.data)}`);
      throw e;
    }
  }

  async getOrder(pair: string, orderId: string): Promise<ExchangeOrder> {
    if (orderId === '-1') {
      return { orderId: '-1', symbol: pair, status: 'NEW', side: 'BUY', price: '0', quantity: '0', executedQty: '0' };
    }

    const result = await this.#request('get', '/api/v3/order', true, { symbol: pair, orderId: +orderId });
    const d = result.data;
    return {
      orderId: String(d.orderId),
      symbol: d.symbol,
      status: d.status,
      side: d.side,
      price: d.price,
      quantity: d.origQty,
      executedQty: d.executedQty,
      raw: d,
    };
  }

  async getOpenOrders(pair: string): Promise<ExchangeOrder[]> {
    const result = await this.#request('get', '/api/v3/openOrders', true, { symbol: pair });
    return result.data.map((d: any) => ({
      orderId: String(d.orderId),
      symbol: d.symbol,
      status: d.status,
      side: d.side,
      price: d.price,
      quantity: d.origQty,
      executedQty: d.executedQty,
      raw: d,
    }));
  }

  async fetchCandles(pair: string, interval: string, startTime?: number, endTime?: number, limit: number = 1000): Promise<ExchangeCandle[]> {
    const params: Record<string, any> = { symbol: pair, interval, limit };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;

    const result = await this.#rest.get('/api/v3/klines', { params });
    return result.data.map((k: any[]) => ({
      openTime: k[0],
      open: k[1],
      high: k[2],
      low: k[3],
      close: k[4],
      volume: k[5],
      closeTime: k[6],
      trades: k[8],
    }));
  }

  async connectTradeStream(pair: string, callback: TradeStreamCallback): Promise<void> {
    const symbol = pair.toLowerCase();
    const url = `${this.#streamUrl}/${symbol}@trade`;

    const ws = new WebSocket(url);

    ws.on('open', () => {
      this.app.logger.log(`[BinanceAdapter] Trade stream connected: ${pair}`);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const trade: ExchangeTrade = {
          id: String(msg.t),
          price: msg.p,
          quantity: msg.q,
          time: msg.T,
          isBuyerMaker: msg.m,
        };
        callback(trade);
      } catch (e) {
        this.app.logger.error(`[BinanceAdapter] Trade stream parse error: ${e}`);
      }
    });

    ws.on('close', () => {
      this.app.logger.log(`[BinanceAdapter] Trade stream closed: ${pair}, reconnecting...`);
      this.#tradeStreams.delete(pair);
      setTimeout(() => this.connectTradeStream(pair, callback), this.#reconnectDelay);
    });

    ws.on('error', (err) => {
      this.app.logger.error(`[BinanceAdapter] Trade stream error: ${pair} ${err.message}`);
    });

    this.#tradeStreams.set(pair, ws);
  }

  async disconnectTradeStream(pair: string): Promise<void> {
    const ws = this.#tradeStreams.get(pair);
    if (ws) {
      ws.removeAllListeners('close');
      ws.close();
      this.#tradeStreams.delete(pair);
    }
  }

  async connectUserStream(callback: OrderUpdateCallback): Promise<void> {
    this.#orderUpdateCallback = callback;

    this.events.on('executionReport', (event: any) => {
      const order: ExchangeOrder = {
        orderId: String(event.i),
        symbol: event.s,
        status: event.X,
        side: event.S,
        price: event.p,
        quantity: event.q,
        executedQty: event.z,
        commission: event.n,
        commissionAsset: event.N,
        raw: event,
      };
      callback(order);
    });
  }

  async checkConnectivity(): Promise<boolean> {
    try {
      const result = await this.#rest.get('/api/v3/ping');
      return result.status === 200;
    } catch {
      return false;
    }
  }

  async getPairInfo(pair: string): Promise<ExchangePairInfo | undefined> {
    const pairs = await this.getAvailablePairs();
    return pairs.find((p) => p.symbol === pair);
  }

  async getAvailablePairs(): Promise<ExchangePairInfo[]> {
    const result = await this.#rest.get('/api/v3/exchangeInfo');
    return result.data.symbols
      .filter((s: any) => s.status === 'TRADING')
      .map((s: any) => {
        const lotSize = s.filters.find((f: any) => f.filterType === 'LOT_SIZE');
        const priceFilter = s.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
        const notional = s.filters.find((f: any) => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL');
        return {
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          status: s.status,
          pricePrecision: s.quotePrecision,
          quantityPrecision: s.baseAssetPrecision,
          minNotional: notional?.minNotional || '0',
          stepSize: lotSize?.stepSize || '0',
          tickSize: priceFilter?.tickSize || '0',
        };
      });
  }

  // ==================== RSA Signatures ====================

  #makeSignature(params: Record<string, any>): string {
    const query = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    const key = crypto.createPrivateKey(Buffer.from(this.app.config.binance.privateKey, 'base64'));
    return crypto.sign(null, Buffer.from(query), key).toString('base64');
  }

  #makeSignatureRest(params: Record<string, any>): { query: string; signature: string } {
    const timestamp = Date.now();
    const query = this.#buildQueryString({ ...params, timestamp });

    const key = crypto.createPrivateKey(Buffer.from(this.app.config.binance.privateKey, 'base64'));
    const signature = crypto.sign(null, Buffer.from(query), key).toString('base64');

    return { query, signature: encodeURIComponent(signature) };
  }

  #buildQueryString(params: Record<string, any>): string {
    if (!params) return '';
    return Object.entries(params)
      .filter(([_, v]) => v !== undefined)
      .map(([key, value]) => {
        const valueString = Array.isArray(value) ? `["${value.join('","')}"]` : String(value);
        return `${key}=${encodeURIComponent(valueString)}`;
      })
      .join('&');
  }

  async #request(method: string, url: string, secure: boolean = false, params: Record<string, any> = {}): Promise<any> {
    if (secure) {
      const { query, signature } = this.#makeSignatureRest(params);
      return this.#rest.request({
        method,
        url: `${url}?${query}&signature=${signature}`,
      });
    }
    throw new Error('Unsecured requests not implemented');
  }

  // ==================== WebSocket API ====================

  #connect(): void {
    this.#ws = new WebSocket(this.#wsApiUrl);

    this.#ws.on('open', () => {
      this.#isAuthenticated = false;
      this.#isUserStream = false;
      this.app.logger.log('[BinanceAdapter] WS connected');
      this.#heartbeat();
      this.#auth();
    });

    this.#ws.on('pong', () => {
      this.#lastPong = Date.now();
    });

    this.#ws.on('error', (err) => {
      this.#isAuthenticated = false;
      this.#isUserStream = false;
      this.app.logger.error(`[BinanceAdapter] WS error: ${err.message}`);
      this.#ws?.close();
    });

    this.#ws.on('close', (code, reason) => {
      this.#isAuthenticated = false;
      this.#isUserStream = false;
      this.app.logger.error(`[BinanceAdapter] WS closed: ${code} ${reason}`);
      if (this.#heartbeatInterval) clearInterval(this.#heartbeatInterval);
      this.#reconnect();
    });

    this.#ws.on('message', (data) => {
      this.#onMessage(data);
    });
  }

  #reconnect(): void {
    if (this.#reconnectTimeout) return;
    this.app.logger.log('[BinanceAdapter] WS reconnecting...');
    this.#reconnectTimeout = setTimeout(() => {
      this.#reconnectTimeout = null;
      this.#connect();
    }, this.#reconnectDelay);
  }

  #heartbeat(): void {
    this.#lastPong = Date.now();
    this.#heartbeatInterval = setInterval(() => {
      if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.#lastPong > 30000) {
        this.app.logger.error('[BinanceAdapter] No pong received, terminating...');
        this.#ws.terminate();
        return;
      }
      try {
        this.#ws.ping();
      } catch (e) {
        this.app.logger.error(`[BinanceAdapter] Ping error: ${e}`);
      }
    }, 10000);
  }

  #auth(): void {
    this.#wsSend('session.logon').then(() => {
      this.#isAuthenticated = true;
      this.app.logger.log('[BinanceAdapter] WS authenticated');
      return this.#wsSend('userDataStream.subscribe');
    }).then(() => {
      this.#isUserStream = true;
      this.app.logger.log('[BinanceAdapter] WS UserDataStream subscribed');
    });
  }

  async #wsSend(method: string, params: Record<string, any> = {}): Promise<any> {
    const taskId = this.#makeTask(method, params);
    const task = this.#tasks[taskId];

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (task.status === TaskStatus.Received) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    if (task.response.status !== 200) {
      throw new Error(`[BinanceAdapter] WS response failed\n${JSON.stringify(task.response)}`);
    }

    delete this.#tasks[taskId];
    return task.response;
  }

  #startSendingLoop(): void {
    const send = () => {
      if (this.#ws?.readyState !== WebSocket.OPEN) {
        setTimeout(send, 4000);
        return;
      }

      for (const id in this.#tasks) {
        const task = this.#tasks[id];
        if (!this.#isAuthenticated && task.request?.method !== 'session.logon') continue;
        if (task.status === TaskStatus.Prepared) {
          this.#ws!.send(JSON.stringify(task.request), (err) => {
            if (err) {
              this.app.logger.error(`[BinanceAdapter] WS send error: ${err}`);
              return;
            }
            task.status = TaskStatus.Sent;
            task.ts = Date.now();
          });
        }
      }

      setTimeout(send, 1000);
    };
    send();
  }

  #onMessage(data: WebSocket.RawData): void {
    let json: any;
    try {
      json = JSON.parse(data.toString());
    } catch {
      this.app.logger.error('[BinanceAdapter] JSON parse error');
      return;
    }

    const task = this.#tasks[json.id];
    if (task) {
      task.response = json;
      task.status = TaskStatus.Received;
      return;
    }

    if (json.event?.e === 'eventStreamTerminated') {
      this.app.logger.error('[BinanceAdapter] WS stream terminated');
      this.#ws?.terminate();
      return;
    }
    if (json.event?.e === 'balanceUpdate') return;
    if (json.event?.e === 'outboundAccountPosition') return;
    if (json.event?.e === 'executionReport') {
      this.events.emit('executionReport', json.event);
      return;
    }

    this.app.logger.error('[BinanceAdapter] Unknown WS message: ' + data.toString().substring(0, 200));
  }

  #makeTask(method: string, parameters: Record<string, any> = {}): string {
    const id = this.#makeId();
    const params: Record<string, any> = { timestamp: Date.now(), ...parameters };

    if (method === 'session.logon') {
      params.apiKey = this.app.config.binance.apiKey;
      params.signature = this.#makeSignature(params);
    }
    if (method === 'userDataStream.subscribe') {
      delete params.timestamp;
    }

    this.#tasks[id].status = TaskStatus.Prepared;
    this.#tasks[id].request = { id, method, params };
    return id;
  }

  #makeId(): string {
    this.#requestCounter++;
    while (true) {
      const random = crypto.randomBytes(8).toString('hex');
      const id = `${this.#requestCounter}-${random}`;
      if (!this.#tasks[id]) {
        this.#tasks[id] = { status: TaskStatus.Created, ts: 0, request: undefined, response: undefined };
        return id;
      }
    }
  }

  async shutdown(): Promise<void> {
    // Stop reconnect attempts
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }

    // Stop heartbeat
    if (this.#heartbeatInterval) {
      clearInterval(this.#heartbeatInterval);
      this.#heartbeatInterval = null;
    }

    // Close all trade streams
    for (const [, ws] of this.#tradeStreams) {
      ws.removeAllListeners();
      ws.terminate();
    }
    this.#tradeStreams.clear();

    // Close main WS — terminate() kills the socket immediately
    if (this.#ws) {
      this.#ws.removeAllListeners();
      this.#ws.terminate();
      this.#ws = null;
    }
  }
}
