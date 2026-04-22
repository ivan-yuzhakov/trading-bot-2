import { describe, it, expect } from 'vitest';
import { TradingCore, COMMISSION_RATE } from '../src/trading/TradingCore.js';
import type { Candle } from '../src/candles/types.js';
import type { MoneyManagementConfig } from '../src/entity/Strategy.js';

function makeCandles(closes: number[], baseTime = 1700000000000): Candle[] {
  return closes.map((c, i) => ({
    t: baseTime + i * 300000,
    o: String(c - 0.5), h: String(c + 1), l: String(c - 1), c: String(c), v: '100',
  }));
}

const core = new TradingCore();

describe('TradingCore.calculatePositionSize', () => {
  it('fixed mode: qty = amount / price (no commission deducted)', () => {
    const mm: MoneyManagementConfig = { mode: 'fixed', amount: '100', maxConcurrentTrades: 1, maxExposurePerPair: '500', dailyLossLimit: '0' };
    const result = core.calculatePositionSize('10000', '50', mm);
    // amount=100, qty=100/50=2
    expect(parseFloat(result.quantity)).toBe(2);
    expect(result.amount).toBe('100');
  });

  it('fixed mode: caps at balance', () => {
    const mm: MoneyManagementConfig = { mode: 'fixed', amount: '500', maxConcurrentTrades: 1, maxExposurePerPair: '500', dailyLossLimit: '0' };
    const result = core.calculatePositionSize('100', '50', mm);
    expect(result.amount).toBe('100');
  });

  it('percentage mode: uses % of balance', () => {
    const mm: MoneyManagementConfig = { mode: 'percentage', amount: '50', maxConcurrentTrades: 1, maxExposurePerPair: '500', dailyLossLimit: '0' };
    const result = core.calculatePositionSize('10000', '100', mm);
    // 50% of 10000 = 5000, qty=5000/100=50
    expect(parseFloat(result.quantity)).toBe(50);
    expect(result.amount).toBe('5000');
  });
});

describe('TradingCore.calculateProfit', () => {
  it('calculates profit with estimated commission', () => {
    const result = core.calculateProfit('100', '110', '10');
    // gross profit = (110-100)*10 = 100
    // buy commission = 100*10*0.001 = 1
    // sell commission = 110*10*0.001 = 1.1
    // net profit = 100 - 1 - 1.1 = 97.9
    expect(parseFloat(result.profit)).toBeCloseTo(97.9, 1);
    expect(parseFloat(result.profitPct)).toBeCloseTo(10, 0);
  });

  it('calculates profit with provided commissions', () => {
    const result = core.calculateProfit('100', '105', '10', ['2', '3']);
    // gross = (105-100)*10 = 50, commissions = 2+3 = 5, net = 45
    expect(parseFloat(result.profit)).toBeCloseTo(45, 1);
    expect(result.totalCommission).toBe('5');
  });

  it('calculates loss correctly', () => {
    const result = core.calculateProfit('100', '90', '10');
    expect(parseFloat(result.profit)).toBeLessThan(0);
    expect(parseFloat(result.profitPct)).toBeCloseTo(-10, 0);
  });
});

describe('TradingCore.calculateStopLoss', () => {
  it('calculates stop-loss price', () => {
    expect(core.calculateStopLoss('100', '5')).toBe('95');
    expect(core.calculateStopLoss('200', '2.5')).toBe('195');
  });
});

describe('TradingCore.evaluate', () => {
  it('returns hold with no analyzers', () => {
    const candles = makeCandles(Array.from({ length: 100 }, (_, i) => 100 + i));
    const decision = core.evaluate([], candles, '199', undefined, '0.5', '0.5');
    expect(decision.action).toBe('hold');
  });

  it('consistent between calls with same data', () => {
    // Same input → same output (deterministic)
    const candles = makeCandles(Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i) * 10));
    const analyzers = core.createAnalyzers(
      { config: { binance: {}, huggingface: {}, cryptopanic: {}, redis: {} } } as any,
      {
        analyzers: [{ name: 'rsi', weight: '1.0', config: { period: 14, oversold: 30, overbought: 70 } }],
      } as any,
      true,
    );
    const d1 = core.evaluate(analyzers, candles, '100', undefined, '0.3', '0.3');
    const d2 = core.evaluate(analyzers, candles, '100', undefined, '0.3', '0.3');
    expect(d1.action).toBe(d2.action);
    expect(d1.signal.totalBuyWeight).toBe(d2.signal.totalBuyWeight);
    expect(d1.signal.totalSellWeight).toBe(d2.signal.totalSellWeight);
  });
});

describe('TradingCore.createAnalyzers', () => {
  const fakeApp = { config: { binance: {}, huggingface: {}, cryptopanic: {}, redis: {} } } as any;

  it('creates known analyzers', () => {
    const strategy = {
      analyzers: [
        { name: 'rsi', weight: '1.0', config: { period: 14 } },
        { name: 'bollinger', weight: '0.8', config: { period: 20 } },
      ],
    } as any;
    const result = core.createAnalyzers(fakeApp, strategy);
    expect(result).toHaveLength(2);
    expect(result[0].analyzer.name).toBe('rsi');
    expect(result[1].analyzer.name).toBe('bollinger');
  });

  it('skips unknown analyzers', () => {
    const strategy = {
      analyzers: [
        { name: 'rsi', weight: '1.0', config: {} },
        { name: 'unknown_thing', weight: '1.0', config: {} },
      ],
    } as any;
    const result = core.createAnalyzers(fakeApp, strategy);
    expect(result).toHaveLength(1);
  });

  it('skips news in backtest mode', () => {
    const strategy = {
      analyzers: [
        { name: 'rsi', weight: '1.0', config: {} },
        { name: 'news', weight: '1.0', config: {} },
      ],
    } as any;
    const result = core.createAnalyzers(fakeApp, strategy, true);
    expect(result).toHaveLength(1);
    expect(result[0].analyzer.name).toBe('rsi');
  });

  it('includes news in live mode', () => {
    const strategy = {
      analyzers: [
        { name: 'rsi', weight: '1.0', config: {} },
        { name: 'news', weight: '1.0', config: {} },
      ],
    } as any;
    const result = core.createAnalyzers(fakeApp, strategy, false);
    expect(result).toHaveLength(2);
  });
});
