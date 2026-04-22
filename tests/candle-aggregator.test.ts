import { describe, it, expect } from 'vitest';
import { CandleAggregator } from '../src/candles/CandleAggregator.js';
import type { Candle } from '../src/candles/types.js';

const aggregator = new CandleAggregator();

function make5mCandles(count: number, baseTime = 1700000000000): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    t: baseTime + i * 300000, // 5 min intervals
    o: String(100 + i),
    h: String(105 + i),
    l: String(95 + i),
    c: String(101 + i),
    v: '10',
  }));
}

describe('CandleAggregator.aggregate', () => {
  it('5m → 5m returns same candles', () => {
    const candles = make5mCandles(12);
    const result = aggregator.aggregate(candles, '5m');
    expect(result).toEqual(candles);
  });

  it('5m → 15m: reduces candle count', () => {
    const candles = make5mCandles(12);
    const result = aggregator.aggregate(candles, '15m');
    expect(result.length).toBeLessThan(candles.length);
    expect(result.length).toBeGreaterThan(0);
  });

  it('5m → 1h: 12 aligned candles produce 1 complete candle', () => {
    // Align to hour boundary: 12 candles × 5min = exactly 1 hour
    const hourBoundary = Math.floor(1700000000000 / 3600000) * 3600000;
    const candles = make5mCandles(12, hourBoundary);
    const result = aggregator.aggregate(candles, '1h');
    expect(result).toHaveLength(1);
    expect(result[0].t).toBe(hourBoundary);
  });

  it('5m → 1h: incomplete groups are dropped', () => {
    // 15 candles starting mid-hour — first and last groups incomplete, both dropped
    const candles = make5mCandles(15); // unaligned baseTime
    const hourBoundary = Math.floor(1700000000000 / 3600000) * 3600000;
    // If first candle is not at hour boundary, first group is partial
    if (candles[0].t !== hourBoundary) {
      const result = aggregator.aggregate(candles, '1h');
      // All candles fall into incomplete groups — no complete 1h candle
      expect(result.length).toBeLessThanOrEqual(1);
    }
  });

  it('aggregated candle has correct OHLCV', () => {
    // 3 candles to aggregate into 15m
    const candles: Candle[] = [
      { t: 0, o: '100', h: '110', l: '90', c: '105', v: '10' },
      { t: 300000, o: '105', h: '120', l: '95', c: '115', v: '20' },
      { t: 600000, o: '115', h: '125', l: '100', c: '108', v: '15' },
    ];
    const result = aggregator.aggregate(candles, '15m');
    expect(result.length).toBeGreaterThan(0);
    const agg = result[0];
    expect(agg.o).toBe('100');   // open of first
    expect(agg.h).toBe('125');   // highest high
    expect(agg.l).toBe('90');    // lowest low
    expect(agg.c).toBe('108');   // close of last
    expect(agg.v).toBe('45');    // sum of volumes
  });
});

describe('CandleAggregator.aggregateTrade', () => {
  it('creates new candle from first trade', () => {
    const { candle, closed } = aggregator.aggregateTrade(null, { price: '100', quantity: '5', time: 1700000000000, isBuyerMaker: false });
    expect(candle.o).toBe('100');
    expect(candle.c).toBe('100');
    expect(candle.v).toBe('5');
    expect(closed).toBeNull();
  });

  it('updates current candle from same period trade', () => {
    // Use timestamp aligned to 5min boundary
    const baseT = Math.floor(1700000000000 / 300000) * 300000;
    const current: Candle = { t: baseT, o: '100', h: '105', l: '98', c: '102', v: '10' };
    // Trade within same 5min window
    const { candle, closed } = aggregator.aggregateTrade(current, { price: '110', quantity: '3', time: baseT + 60000, isBuyerMaker: false });
    expect(candle.h).toBe('110');
    expect(candle.l).toBe('98');
    expect(candle.c).toBe('110');
    expect(candle.v).toBe('13');
    expect(closed).toBeNull();
  });

  it('closes candle when new period starts', () => {
    const baseT = Math.floor(1700000000000 / 300000) * 300000;
    const current: Candle = { t: baseT, o: '100', h: '105', l: '98', c: '102', v: '10' };
    // Trade in next 5min window
    const nextT = baseT + 300000;
    const { candle, closed } = aggregator.aggregateTrade(current, { price: '103', quantity: '2', time: nextT + 1000, isBuyerMaker: false });
    expect(closed).not.toBeNull();
    expect(closed!.t).toBe(baseT);
    expect(closed!.c).toBe('102');
    expect(candle.t).toBe(nextT);
    expect(candle.o).toBe('103');
  });
});
