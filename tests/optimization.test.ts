import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { isRange, expandRange, extractRanges, cartesianProduct, applyVariant } from '../src/optimization/GridSearchEngine.js';
import type { ParamRange, RangeInfo } from '../src/optimization/types.js';
import type { OptimizationConfig } from '../src/optimization/types.js';

describe('isRange', () => {
  it('detects valid range objects', () => {
    expect(isRange({ from: 5, to: 20, step: 1 })).toBe(true);
    expect(isRange({ from: 0.1, to: 0.5, step: 0.1 })).toBe(true);
    expect(isRange({ from: 0, to: 0, step: 1 })).toBe(true);
  });

  it('rejects non-range objects', () => {
    expect(isRange({ from: 5, to: 20 })).toBe(false); // missing step
    expect(isRange({ from: 5, to: 20, step: 1, extra: true })).toBe(false); // extra key
    expect(isRange({ period: 14 })).toBe(false);
    expect(isRange({ from: '5', to: '20', step: '1' })).toBe(false); // strings
    expect(isRange(null)).toBe(false);
    expect(isRange(undefined)).toBe(false);
    expect(isRange(42)).toBe(false);
    expect(isRange('string')).toBe(false);
    expect(isRange([1, 2, 3])).toBe(false);
    expect(isRange({})).toBe(false);
  });

  it('rejects objects where keys match but types are wrong', () => {
    expect(isRange({ from: null, to: 20, step: 1 })).toBe(false);
    expect(isRange({ from: 5, to: undefined, step: 1 })).toBe(false);
    expect(isRange({ from: 5, to: 20, step: true })).toBe(false);
  });
});

describe('expandRange', () => {
  it('expands integer range', () => {
    expect(expandRange({ from: 5, to: 20, step: 5 })).toEqual([5, 10, 15, 20]);
  });

  it('expands single-value range (from === to)', () => {
    expect(expandRange({ from: 7, to: 7, step: 1 })).toEqual([7]);
  });

  it('expands range with step=1', () => {
    expect(expandRange({ from: 1, to: 5, step: 1 })).toEqual([1, 2, 3, 4, 5]);
  });

  it('expands decimal range without floating point drift', () => {
    const result = expandRange({ from: 0.1, to: 0.3, step: 0.1 });
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it('handles range where last step would overshoot', () => {
    // from=1, to=10, step=3 → [1, 4, 7, 10]
    const result = expandRange({ from: 1, to: 10, step: 3 });
    expect(result).toEqual([1, 4, 7, 10]);
  });

  it('handles range where to is not exactly reachable', () => {
    // from=0, to=1, step=0.3 → [0, 0.3, 0.6, 0.9]
    const result = expandRange({ from: 0, to: 1, step: 0.3 });
    expect(result).toEqual([0, 0.3, 0.6, 0.9]);
  });

  it('large integer range', () => {
    const result = expandRange({ from: 5, to: 20, step: 1 });
    expect(result.length).toBe(16);
    expect(result[0]).toBe(5);
    expect(result[15]).toBe(20);
  });
});

describe('extractRanges', () => {
  it('extracts from flat object', () => {
    const obj = { buy_threshold: { from: 0.2, to: 0.5, step: 0.1 }, sell_threshold: '0.3' };
    const ranges = extractRanges(obj);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].path).toBe('buy_threshold');
    expect(ranges[0].values).toEqual([0.2, 0.3, 0.4, 0.5]);
  });

  it('extracts from nested object', () => {
    const obj = {
      analyzers: [{
        name: 'rsi',
        config: {
          period: { from: 5, to: 7, step: 1 },
          oversold: 30,
        },
      }],
    };
    const ranges = extractRanges(obj);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].path).toBe('analyzers[0].config.period');
    expect(ranges[0].values).toEqual([5, 6, 7]);
  });

  it('extracts multiple ranges at different depths', () => {
    const obj = {
      buy_threshold: { from: 0.3, to: 0.5, step: 0.1 },
      analyzers: [
        { name: 'rsi', config: { period: { from: 9, to: 11, step: 1 } } },
        { name: 'stop_loss', config: { lossPct: { from: 3, to: 5, step: 1 } } },
      ],
    };
    const ranges = extractRanges(obj);
    expect(ranges).toHaveLength(3);

    const paths = ranges.map(r => r.path);
    expect(paths).toContain('buy_threshold');
    expect(paths).toContain('analyzers[0].config.period');
    expect(paths).toContain('analyzers[1].config.lossPct');
  });

  it('returns empty for no ranges', () => {
    const obj = { pair: 'BTCUSDT', exchange: 'binance', analyzers: [{ name: 'rsi', config: { period: 14 } }] };
    expect(extractRanges(obj)).toHaveLength(0);
  });

  it('handles null and primitive values', () => {
    expect(extractRanges(null)).toEqual([]);
    expect(extractRanges(42)).toEqual([]);
    expect(extractRanges('string')).toEqual([]);
  });
});

describe('cartesianProduct', () => {
  it('returns single empty object for no ranges', () => {
    const result = cartesianProduct([]);
    expect(result).toEqual([{}]);
  });

  it('returns all values for single range', () => {
    const ranges: RangeInfo[] = [{ path: 'period', values: [5, 10, 15] }];
    const result = cartesianProduct(ranges);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ period: 5 });
    expect(result[1]).toEqual({ period: 10 });
    expect(result[2]).toEqual({ period: 15 });
  });

  it('produces correct count for two ranges', () => {
    const ranges: RangeInfo[] = [
      { path: 'a', values: [1, 2, 3] },
      { path: 'b', values: [10, 20] },
    ];
    const result = cartesianProduct(ranges);
    expect(result).toHaveLength(6);
  });

  it('produces correct combinations for two ranges', () => {
    const ranges: RangeInfo[] = [
      { path: 'x', values: [1, 2] },
      { path: 'y', values: [10, 20] },
    ];
    const result = cartesianProduct(ranges);
    expect(result).toEqual([
      { x: 1, y: 10 },
      { x: 1, y: 20 },
      { x: 2, y: 10 },
      { x: 2, y: 20 },
    ]);
  });

  it('handles large product correctly', () => {
    const ranges: RangeInfo[] = [
      { path: 'a', values: Array.from({ length: 16 }, (_, i) => i + 5) },   // 16
      { path: 'b', values: Array.from({ length: 17 }, (_, i) => i + 5) },   // 17
    ];
    const result = cartesianProduct(ranges);
    expect(result).toHaveLength(16 * 17);
    // Check first and last
    expect(result[0]).toEqual({ a: 5, b: 5 });
    expect(result[result.length - 1]).toEqual({ a: 20, b: 21 });
  });

  it('three ranges: correct count', () => {
    const ranges: RangeInfo[] = [
      { path: 'a', values: [1, 2] },
      { path: 'b', values: [10, 20, 30] },
      { path: 'c', values: [100, 200] },
    ];
    const result = cartesianProduct(ranges);
    expect(result).toHaveLength(2 * 3 * 2);
    expect(result[0]).toEqual({ a: 1, b: 10, c: 100 });
  });
});

describe('applyVariant', () => {
  it('applies flat params', () => {
    const template = { buy_threshold: '0.5', sell_threshold: '0.3' };
    const result = applyVariant(template, { buy_threshold: 0.4 });
    expect(result.buy_threshold).toBe(0.4);
    expect(result.sell_threshold).toBe('0.3'); // unchanged
  });

  it('applies nested array params', () => {
    const template = {
      analyzers: [
        { name: 'rsi', config: { period: 14, oversold: 30 } },
      ],
    };
    const result = applyVariant(template, { 'analyzers[0].config.period': 9 });
    expect((result.analyzers as any)[0].config.period).toBe(9);
    expect((result.analyzers as any)[0].config.oversold).toBe(30); // unchanged
  });

  it('applies multiple params simultaneously', () => {
    const template = {
      buy_threshold: '0.5',
      analyzers: [
        { name: 'rsi', config: { period: 14 } },
        { name: 'stop_loss', config: { lossPct: 5 } },
      ],
    };
    const result = applyVariant(template, {
      'buy_threshold': 0.3,
      'analyzers[0].config.period': 9,
      'analyzers[1].config.lossPct': 7,
    });
    expect(result.buy_threshold).toBe(0.3);
    expect((result.analyzers as any)[0].config.period).toBe(9);
    expect((result.analyzers as any)[1].config.lossPct).toBe(7);
  });

  it('does not mutate the template', () => {
    const template = { analyzers: [{ config: { period: 14 } }] };
    const templateCopy = JSON.parse(JSON.stringify(template));
    applyVariant(template, { 'analyzers[0].config.period': 9 });
    expect(template).toEqual(templateCopy);
  });

  it('handles deeply nested paths', () => {
    const template = { a: { b: { c: { d: 100 } } } };
    const result = applyVariant(template, { 'a.b.c.d': 999 });
    expect((result as any).a.b.c.d).toBe(999);
  });
});

describe('end-to-end: extractRanges → cartesianProduct → applyVariant', () => {
  it('full pipeline produces correct strategies', () => {
    const strategy = {
      pair: 'ETHUSDT',
      exchange: 'binance',
      analyzers: [
        { name: 'rsi', weight: '1.0', config: { period: { from: 9, to: 11, step: 1 } } },
      ],
      buy_threshold: { from: 0.3, to: 0.4, step: 0.1 },
      sell_threshold: '0.3',
      money_management: { mode: 'percentage', amount: '95' },
    };

    const ranges = extractRanges(strategy);
    expect(ranges).toHaveLength(2); // period + buy_threshold

    const variants = cartesianProduct(ranges);
    // period: 9,10,11 (3) × buy_threshold: 0.3,0.4 (2) = 6
    expect(variants).toHaveLength(6);

    // Apply first variant
    const first = applyVariant(strategy, variants[0]);
    expect((first.analyzers as any)[0].config.period).toBe(9);
    expect(first.buy_threshold).toBe(0.3);

    // Apply last variant
    const last = applyVariant(strategy, variants[5]);
    expect((last.analyzers as any)[0].config.period).toBe(11);
    expect(last.buy_threshold).toBe(0.4);

    // Original unchanged
    expect((strategy.analyzers[0].config.period as any).from).toBe(9);
  });

  it('weight and threshold ranges produce correct string values after conversion', () => {
    const strategy = {
      pair: 'ETHUSDT',
      exchange: 'binance',
      analyzers: [
        { name: 'rsi', weight: { from: 0.5, to: 1.5, step: 0.5 }, config: { period: 14 } },
        { name: 'stop_loss', weight: { from: 1.0, to: 2.0, step: 1.0 }, config: { lossPct: 5 } },
      ],
      buy_threshold: { from: 0.2, to: 0.4, step: 0.1 },
      sell_threshold: { from: 0.3, to: 0.4, step: 0.1 },
      stop_loss_pct: null,
      money_management: { mode: 'percentage', amount: '95', maxConcurrentTrades: 1, maxExposurePerPair: '10000', dailyLossLimit: '0' },
    };

    const ranges = extractRanges(strategy);
    // rsi weight (3) + sl weight (2) + buy_threshold (3) + sell_threshold (2) = 4 ranges
    expect(ranges).toHaveLength(4);

    const variants = cartesianProduct(ranges);
    expect(variants).toHaveLength(3 * 2 * 3 * 2); // 36

    // Apply a variant and check that numeric values are set correctly
    const applied = applyVariant(strategy, variants[0]);
    // After applyVariant, weight and thresholds are numbers (from range expansion)
    expect(typeof (applied.analyzers as any)[0].weight).toBe('number');
    expect(typeof applied.buy_threshold).toBe('number');
    expect(typeof applied.sell_threshold).toBe('number');

    // Verify values are correct for first variant
    expect((applied.analyzers as any)[0].weight).toBe(0.5);
    expect((applied.analyzers as any)[1].weight).toBe(1);
    expect(applied.buy_threshold).toBe(0.2);
    expect(applied.sell_threshold).toBe(0.3);

    // Verify String() conversion works (as toStrategyParams does)
    expect(String(applied.buy_threshold)).toBe('0.2');
    expect(String(applied.sell_threshold)).toBe('0.3');
    expect(String((applied.analyzers as any)[0].weight)).toBe('0.5');
  });

  it('run_id is deterministic for same config', () => {
    const config: OptimizationConfig = {
      name: 'Test',
      backtest: { startDate: '2025-01-01', endDate: '2025-03-31', initialBalance: '10000' },
      strategy: { pair: 'ETHUSDT', exchange: 'binance', analyzers: [{ name: 'rsi', config: { period: { from: 5, to: 10, step: 1 } } }], buy_threshold: '0.3', sell_threshold: '0.3' },
    };
    const makeId = (c: OptimizationConfig) => createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 32);

    const id1 = makeId(config);
    const id2 = makeId(config);
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(32);

    // Different config → different id
    const config2 = { ...config, name: 'Different' };
    const id3 = makeId(config2);
    expect(id3).not.toBe(id1);
  });

  it('no ranges → single variant with original values', () => {
    const strategy = {
      pair: 'BTCUSDT',
      analyzers: [{ name: 'rsi', config: { period: 14 } }],
      buy_threshold: '0.5',
    };

    const ranges = extractRanges(strategy);
    expect(ranges).toHaveLength(0);

    const variants = cartesianProduct(ranges);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toEqual({});

    const result = applyVariant(strategy, variants[0]);
    expect((result.analyzers as any)[0].config.period).toBe(14);
    expect(result.buy_threshold).toBe('0.5');
  });
});
