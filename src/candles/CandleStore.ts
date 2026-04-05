import type { App } from '../app/App.js';
import type { Candle } from './types.js';

/**
 * Redis storage for 5-minute candles.
 * Key pattern: candles:5min:{exchange}:{pair}
 * Sorted set with score = openTime (ms timestamp).
 */
export class CandleStore {
  #app: App;

  constructor(app: App) {
    this.#app = app;
  }

  #key(exchange: string, pair: string): string {
    return `candles:5min:${exchange}:${pair}`;
  }

  /** Store candles (ZADD with score = openTime). Deduplicates by overwriting same score. */
  async store(exchange: string, pair: string, candles: Candle[]): Promise<void> {
    if (candles.length === 0) return;

    const key = this.#key(exchange, pair);
    const pipeline = this.#app.redis.client.pipeline();

    // Batch in chunks of 500 to avoid huge commands
    for (let i = 0; i < candles.length; i += 500) {
      const chunk = candles.slice(i, i + 500);
      const args: (string | number)[] = [];
      for (const candle of chunk) {
        args.push(candle.t, JSON.stringify(candle));
      }
      pipeline.zadd(key, ...args as any);
    }

    await pipeline.exec();
  }

  /** Get candles in time range (inclusive). */
  async get(exchange: string, pair: string, from: number, to: number): Promise<Candle[]> {
    const key = this.#key(exchange, pair);
    const results = await this.#app.redis.client.zrangebyscore(key, from, to);
    return results.map((r) => JSON.parse(r) as Candle);
  }

  /** Get the latest N candles (ordered oldest first). */
  async getLatest(exchange: string, pair: string, count: number): Promise<Candle[]> {
    const key = this.#key(exchange, pair);
    const results = await this.#app.redis.client.zrange(key, -count, -1);
    return results.map((r) => JSON.parse(r) as Candle);
  }

  /** Get the very last candle stored. */
  async getLast(exchange: string, pair: string): Promise<Candle | undefined> {
    const candles = await this.getLatest(exchange, pair, 1);
    return candles[0];
  }

  /** Get the very first candle stored. */
  async getFirst(exchange: string, pair: string): Promise<Candle | undefined> {
    const key = this.#key(exchange, pair);
    const results = await this.#app.redis.client.zrange(key, 0, 0);
    return results.length > 0 ? JSON.parse(results[0]) as Candle : undefined;
  }

  /** Get total count of candles. */
  async count(exchange: string, pair: string): Promise<number> {
    const key = this.#key(exchange, pair);
    return this.#app.redis.client.zcard(key);
  }

  /** Count candles in a time range. */
  async countRange(exchange: string, pair: string, from: number, to: number): Promise<number> {
    const key = this.#key(exchange, pair);
    return this.#app.redis.client.zcount(key, from, to);
  }

  /** Remove candles older than maxAgeMs. */
  async trim(exchange: string, pair: string, maxAgeMs: number): Promise<number> {
    const key = this.#key(exchange, pair);
    const cutoff = Date.now() - maxAgeMs;
    return this.#app.redis.client.zremrangebyscore(key, '-inf', cutoff);
  }
}
