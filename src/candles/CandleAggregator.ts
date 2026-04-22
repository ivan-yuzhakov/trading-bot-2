import { Decimal } from 'decimal.js';
import type { Candle, Timeframe, RawTrade } from './types.js';
import { TF_MS, BASE_TF_MS } from './types.js';

/**
 * Aggregates 5-minute base candles into higher timeframes.
 * Also builds 5-minute candles from raw trades in realtime.
 */
export class CandleAggregator {

  /** Aggregate base (5m) candles into a higher timeframe. Drops incomplete last group. */
  aggregate(candles: Candle[], targetTf: Timeframe): Candle[] {
    if (targetTf === '5m') return candles;

    const tfMs = TF_MS[targetTf];
    const expectedPerGroup = tfMs / BASE_TF_MS;
    const groups = new Map<number, Candle[]>();

    for (const candle of candles) {
      const groupKey = Math.floor(candle.t / tfMs) * tfMs;
      let group = groups.get(groupKey);
      if (!group) {
        group = [];
        groups.set(groupKey, group);
      }
      group.push(candle);
    }

    const result: Candle[] = [];
    const sortedKeys = [...groups.keys()].sort((a, b) => a - b);

    for (let i = 0; i < sortedKeys.length; i++) {
      const group = groups.get(sortedKeys[i])!;
      // Drop incomplete groups at boundaries (not enough base candles to form a full period)
      if (group.length < expectedPerGroup) continue;
      result.push(this.#mergeCandles(sortedKeys[i], group));
    }

    return result;
  }

  /** Create or update a 5-minute candle from a single raw trade. */
  aggregateTrade(currentCandle: Candle | null, trade: RawTrade): { candle: Candle; closed: Candle | null } {
    const candleOpenTime = Math.floor(trade.time / BASE_TF_MS) * BASE_TF_MS;

    // If the trade belongs to the current candle, update it
    if (currentCandle && currentCandle.t === candleOpenTime) {
      const high = Decimal.max(currentCandle.h, trade.price).toString();
      const low = Decimal.min(currentCandle.l, trade.price).toString();
      const volume = new Decimal(currentCandle.v).plus(trade.quantity).toString();

      return {
        candle: {
          t: candleOpenTime,
          o: currentCandle.o,
          h: high,
          l: low,
          c: trade.price,
          v: volume,
        },
        closed: null,
      };
    }

    // New candle period — the current one is closed
    const newCandle: Candle = {
      t: candleOpenTime,
      o: trade.price,
      h: trade.price,
      l: trade.price,
      c: trade.price,
      v: trade.quantity,
    };

    return {
      candle: newCandle,
      closed: currentCandle,
    };
  }

  #mergeCandles(openTime: number, candles: Candle[]): Candle {
    const sorted = candles.sort((a, b) => a.t - b.t);
    let high = new Decimal(sorted[0].h);
    let low = new Decimal(sorted[0].l);
    let volume = new Decimal(0);

    for (const c of sorted) {
      high = Decimal.max(high, c.h);
      low = Decimal.min(low, c.l);
      volume = volume.plus(c.v);
    }

    return {
      t: openTime,
      o: sorted[0].o,
      h: high.toString(),
      l: low.toString(),
      c: sorted[sorted.length - 1].c,
      v: volume.toString(),
    };
  }
}
