import { EventEmitter } from 'events';
import type { App } from '../app/App.js';
import type { ExchangeAdapter } from '../exchange/ExchangeAdapter.js';
import type { ExchangeTrade } from '../exchange/types.js';
import { CandleStore } from './CandleStore.js';
import { CandleAggregator } from './CandleAggregator.js';
import type { Candle, Timeframe, RawTrade } from './types.js';
import { BASE_TF_MS } from './types.js';
import { CandleSyncState } from '../entity/CandleSyncState.js';

/**
 * Manages candle history and realtime updates for all active pairs.
 *
 * Sync algorithm:
 * 1. Connect to trade stream first (buffer incoming trades)
 * 2. Load/update history (fill gaps, not full reload)
 * 3. Process buffered trades, transition to live mode
 *
 * All timestamps come from the exchange, NOT local clock.
 */
export class CandleManager extends EventEmitter {
  #app: App;
  store: CandleStore;
  #aggregator: CandleAggregator;

  /** Current in-progress candle per pair (not yet closed) */
  #currentCandles: Map<string, Candle> = new Map();

  /** Trade buffer during history sync */
  #tradeBuffers: Map<string, RawTrade[]> = new Map();

  /** Whether history sync is complete per pair */
  #syncComplete: Map<string, boolean> = new Map();

  constructor(app: App) {
    super();
    this.#app = app;
    this.store = new CandleStore(app);
    this.#aggregator = new CandleAggregator();
  }

  /** Initialize candle system for a pair. Blocks until history is synced. */
  async initPair(exchange: ExchangeAdapter, pair: string): Promise<void> {
    const key = `${exchange.name}:${pair}`;
    this.#tradeBuffers.set(key, []);
    this.#syncComplete.set(key, false);

    // Step 1: Connect to trade stream first (buffer trades)
    await exchange.connectTradeStream(pair, (trade: ExchangeTrade) => {
      const rawTrade: RawTrade = {
        price: trade.price,
        quantity: trade.quantity,
        time: trade.time,
        isBuyerMaker: trade.isBuyerMaker,
      };

      if (!this.#syncComplete.get(key)) {
        // Buffer while syncing history
        this.#tradeBuffers.get(key)!.push(rawTrade);
      } else {
        // Live mode — process immediately
        this.#processTrade(exchange.name, pair, rawTrade);
      }
    });

    this.#app.logger.log(`[CandleManager] Trade stream connected for ${pair}, syncing history...`);

    // Step 2: Sync history
    await this.#syncHistory(exchange, pair);

    // Step 3: Process buffered trades
    const buffer = this.#tradeBuffers.get(key)!;
    const lastCandle = await this.store.getLast(exchange.name, pair);
    const lastCandleCloseTime = lastCandle ? lastCandle.t + BASE_TF_MS : 0;

    for (const trade of buffer) {
      // Skip trades that belong to already-synced candles
      if (trade.time <= lastCandleCloseTime) continue;
      this.#processTrade(exchange.name, pair, trade);
    }

    this.#tradeBuffers.delete(key);
    this.#syncComplete.set(key, true);

    const count = await this.store.count(exchange.name, pair);
    this.#app.logger.log(`[CandleManager] ${pair} synced: ${count} candles. Live mode active.`);
  }

  /** Stop tracking a pair. */
  async stopPair(exchange: ExchangeAdapter, pair: string): Promise<void> {
    const key = `${exchange.name}:${pair}`;
    await exchange.disconnectTradeStream(pair);
    this.#currentCandles.delete(key);
    this.#syncComplete.delete(key);
  }

  /** Get candles for a pair in a specific timeframe. */
  async getCandles(exchange: string, pair: string, tf: Timeframe, count: number): Promise<Candle[]> {
    if (tf === '5m') {
      return this.store.getLatest(exchange, pair, count);
    }

    // For higher TFs: get enough 5m candles and aggregate
    const tfMultiplier = Math.ceil(this.#tfToMs(tf) / BASE_TF_MS);
    const needed = count * tfMultiplier + tfMultiplier; // extra for partial candle
    const baseCandles = await this.store.getLatest(exchange, pair, needed);
    const aggregated = this.#aggregator.aggregate(baseCandles, tf);

    return aggregated.slice(-count);
  }

  /** Get candles in a time range for a specific timeframe. */
  async getCandlesRange(exchange: string, pair: string, tf: Timeframe, from: number, to: number): Promise<Candle[]> {
    const baseCandles = await this.store.get(exchange, pair, from, to);
    if (tf === '5m') return baseCandles;
    return this.#aggregator.aggregate(baseCandles, tf);
  }

  // ==================== Private ====================

  async #syncHistory(exchange: ExchangeAdapter, pair: string): Promise<void> {
    const repo = this.#app.db.getRepository(CandleSyncState);
    let syncState = await repo.findOne({ where: { pair, exchange: exchange.name } });

    const existingCount = await this.store.count(exchange.name, pair);

    if (existingCount === 0) {
      // First run — load all available history
      this.#app.logger.log(`[CandleManager] First sync for ${pair}, loading full history...`);
      await this.#loadFullHistory(exchange, pair);
    } else {
      // Existing history — fill gaps and update recent
      this.#app.logger.log(`[CandleManager] Updating history for ${pair} (${existingCount} candles exist)...`);
      await this.#fillGaps(exchange, pair);
      await this.#updateRecent(exchange, pair);
    }

    // Update sync state
    const lastCandle = await this.store.getLast(exchange.name, pair);
    if (lastCandle) {
      if (!syncState) {
        syncState = repo.create({ pair, exchange: exchange.name });
      }
      syncState.last_synced_ts = String(lastCandle.t);
      await repo.save(syncState);
    }
  }

  async #loadFullHistory(exchange: ExchangeAdapter, pair: string): Promise<void> {
    // Start from the earliest available candle on the exchange
    // Binance klines go back years, we fetch in batches of 1000
    let startTime = 0; // will use no startTime on first request to get earliest
    let totalLoaded = 0;
    let hasMore = true;

    // First, get the earliest available candle
    const firstBatch = await exchange.fetchCandles(pair, '5m', undefined, undefined, 1);
    if (firstBatch.length === 0) {
      this.#app.logger.log(`[CandleManager] No candles available for ${pair}`);
      return;
    }

    // Now fetch forward from the beginning
    // Start from a very early time to get all history
    startTime = firstBatch[0].openTime;

    // Actually, fetch from oldest by going backwards? No — Binance returns oldest first with startTime.
    // Let's just start from a very old date and page forward.
    let currentStart = startTime;

    while (hasMore) {
      const batch = await exchange.fetchCandles(pair, '5m', currentStart, undefined, 1000);

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      const candles: Candle[] = batch.map((c) => ({
        t: c.openTime,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
        v: c.volume,
      }));

      await this.store.store(exchange.name, pair, candles);
      totalLoaded += candles.length;

      if (batch.length < 1000) {
        hasMore = false;
      } else {
        // Next batch starts after the last candle
        currentStart = batch[batch.length - 1].openTime + BASE_TF_MS;
      }

      if (totalLoaded % 10000 === 0) {
        this.#app.logger.log(`[CandleManager] ${pair}: loaded ${totalLoaded} candles...`);
      }

      // Small delay to respect rate limits
      await new Promise((r) => setTimeout(r, 100));
    }

    this.#app.logger.log(`[CandleManager] ${pair}: full history loaded — ${totalLoaded} candles`);
  }

  async #fillGaps(exchange: ExchangeAdapter, pair: string): Promise<void> {
    const first = await this.store.getFirst(exchange.name, pair);
    const last = await this.store.getLast(exchange.name, pair);
    if (!first || !last) return;

    const totalExpected = Math.floor((last.t - first.t) / BASE_TF_MS) + 1;
    const totalActual = await this.store.count(exchange.name, pair);

    if (totalActual >= totalExpected) {
      this.#app.logger.log(`[CandleManager] ${pair}: no gaps detected`);
      return;
    }

    const gapCount = totalExpected - totalActual;
    this.#app.logger.log(`[CandleManager] ${pair}: ${gapCount} candles missing, filling gaps...`);

    // Scan in chunks to find gaps
    const chunkSize = 1000 * BASE_TF_MS; // 1000 candle periods
    let scanStart = first.t;

    while (scanStart < last.t) {
      const scanEnd = Math.min(scanStart + chunkSize, last.t);
      const expectedInChunk = Math.floor((scanEnd - scanStart) / BASE_TF_MS) + 1;
      const actualInChunk = await this.store.countRange(exchange.name, pair, scanStart, scanEnd);

      if (actualInChunk < expectedInChunk) {
        // Gap found in this chunk — fetch from exchange
        const batch = await exchange.fetchCandles(pair, '5m', scanStart, scanEnd, 1000);
        if (batch.length > 0) {
          const candles: Candle[] = batch.map((c) => ({
            t: c.openTime, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume,
          }));
          await this.store.store(exchange.name, pair, candles);
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      scanStart = scanEnd + BASE_TF_MS;
    }
  }

  async #updateRecent(exchange: ExchangeAdapter, pair: string): Promise<void> {
    // In dev: re-fetch last week. In prod: re-fetch last day.
    const recentMs = this.#app.config.mode === 'dev'
      ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;

    const now = Date.now();
    const from = now - recentMs;
    let currentStart = from;
    let updated = 0;

    while (currentStart < now) {
      const batch = await exchange.fetchCandles(pair, '5m', currentStart, undefined, 1000);
      if (batch.length === 0) break;

      const candles: Candle[] = batch.map((c) => ({
        t: c.openTime, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume,
      }));
      await this.store.store(exchange.name, pair, candles);
      updated += candles.length;

      if (batch.length < 1000) break;
      currentStart = batch[batch.length - 1].openTime + BASE_TF_MS;
      await new Promise((r) => setTimeout(r, 100));
    }

    this.#app.logger.log(`[CandleManager] ${pair}: updated ${updated} recent candles`);
  }

  #processTrade(exchange: string, pair: string, trade: RawTrade): void {
    const key = `${exchange}:${pair}`;
    const current = this.#currentCandles.get(key) || null;

    const { candle, closed } = this.#aggregator.aggregateTrade(current, trade);
    this.#currentCandles.set(key, candle);

    if (closed) {
      // Store the closed candle, then emit event only after confirmed write
      this.store.store(exchange, pair, [closed]).then(() => {
        this.emit('candle:closed', { exchange, pair, candle: closed, tf: '5m' as Timeframe });
      }).catch((e) => {
        this.#app.logger.error(`[CandleManager] Failed to store candle: ${e}`);
      });
    }
  }

  #tfToMs(tf: Timeframe): number {
    const map: Record<Timeframe, number> = {
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '2h': 2 * 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    return map[tf];
  }
}
