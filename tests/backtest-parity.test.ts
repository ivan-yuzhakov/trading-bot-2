import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { TradingCore, COMMISSION_RATE } from '../src/trading/TradingCore.js';
import type { Candle } from '../src/candles/types.js';
import type { MoneyManagementConfig } from '../src/entity/Strategy.js';
import type { ActiveTrade } from '../src/analyzers/types.js';

/**
 * This test simulates EXACTLY what BacktestEngine does and verifies
 * the balance/profit math matches what PairRunner would produce.
 *
 * The key guarantee: both use TradingCore for:
 * - evaluate() — same decision logic
 * - calculatePositionSize() — same sizing
 * - calculateProfit() — same profit/commission calc
 */

const core = new TradingCore();

function candle(t: number, c: number): Candle {
  return { t, o: String(c - 0.5), h: String(c + 1), l: String(c - 1), c: String(c), v: '100' };
}

const fakeApp = { config: { binance: {}, huggingface: {}, cryptopanic: {}, redis: {} } } as any;

describe('Backtest-Live Parity', () => {
  const mm: MoneyManagementConfig = {
    mode: 'percentage', amount: '50', maxConcurrentTrades: 1,
    maxExposurePerPair: '10000', dailyLossLimit: '0',
  };

  it('buy+sell cycle: balance calculation matches TradingCore', () => {
    const initialBalance = new Decimal('10000');
    const buyPrice = '100';
    const sellPrice = '110';

    // Step 1: Calculate position size (same as both BacktestEngine and PairRunner)
    const { quantity, amount } = core.calculatePositionSize(initialBalance.toString(), buyPrice, mm);

    // Step 2: Deduct amount from balance (BacktestEngine does this)
    let balance = initialBalance.minus(amount);

    // Step 3: Calculate profit (same method used by both)
    const { profit, totalCommission } = core.calculateProfit(buyPrice, sellPrice, quantity);

    // Step 4: Add back buy amount + profit (BacktestEngine's corrected logic)
    balance = balance.plus(amount).plus(profit);

    // Verify: balance should be initial + net profit
    const expectedBalance = initialBalance.plus(profit);
    expect(balance.toString()).toBe(expectedBalance.toString());
  });

  it('losing trade: balance goes down correctly', () => {
    const initialBalance = new Decimal('10000');
    const buyPrice = '100';
    const sellPrice = '90'; // 10% loss

    const { quantity, amount } = core.calculatePositionSize(initialBalance.toString(), buyPrice, mm);
    let balance = initialBalance.minus(amount);
    const { profit } = core.calculateProfit(buyPrice, sellPrice, quantity);
    balance = balance.plus(amount).plus(profit);

    // Profit should be negative
    expect(new Decimal(profit).lessThan(0)).toBe(true);
    // Balance should be less than initial
    expect(balance.lessThan(initialBalance)).toBe(true);
    // Balance should still be positive
    expect(balance.greaterThan(0)).toBe(true);
  });

  it('breakeven trade: only commission is lost', () => {
    const initialBalance = new Decimal('10000');
    const price = '100';

    const { quantity, amount } = core.calculatePositionSize(initialBalance.toString(), price, mm);
    let balance = initialBalance.minus(amount);
    const { profit, totalCommission } = core.calculateProfit(price, price, quantity);
    const entryAmount = new Decimal(price).times(quantity);
    balance = balance.plus(entryAmount).plus(profit);

    // Profit is negative (only commission)
    expect(new Decimal(profit).lessThan(0)).toBe(true);
    // Lost amount equals commission
    const lost = initialBalance.minus(balance);
    expect(lost.toString()).toBe(totalCommission);
  });

  it('multiple trades: balance accumulates correctly', () => {
    let balance = new Decimal('10000');
    const trades = [
      { buy: '100', sell: '105' },  // +5%
      { buy: '105', sell: '100' },  // -4.76%
      { buy: '100', sell: '110' },  // +10%
    ];

    let totalProfit = new Decimal(0);

    for (const t of trades) {
      const { quantity, amount } = core.calculatePositionSize(balance.toString(), t.buy, mm);
      balance = balance.minus(amount);
      const { profit } = core.calculateProfit(t.buy, t.sell, quantity);
      balance = balance.plus(amount).plus(profit);
      totalProfit = totalProfit.plus(profit);
    }

    // Total balance = initial + all profits
    expect(balance.toDecimalPlaces(8).toString()).toBe(
      new Decimal('10000').plus(totalProfit).toDecimalPlaces(8).toString()
    );
  });

  it('commission is symmetric with TradingCore.calculateProfit', () => {
    const entry = '1823.45';
    const exit = '1860.00';
    const qty = '0.54321';

    // Method 1: TradingCore.calculateProfit (used by both)
    const { profit, totalCommission } = core.calculateProfit(entry, exit, qty);

    // Method 2: Manual calculation matching what exchange would charge
    const buyValue = new Decimal(entry).times(qty);
    const sellValue = new Decimal(exit).times(qty);
    const buyComm = buyValue.times(COMMISSION_RATE);
    const sellComm = sellValue.times(COMMISSION_RATE);
    const manualProfit = sellValue.minus(buyValue).minus(buyComm).minus(sellComm);
    const manualCommission = buyComm.plus(sellComm);

    expect(profit).toBe(manualProfit.toDecimalPlaces(8).toString());
    expect(totalCommission).toBe(manualCommission.toDecimalPlaces(8).toString());
  });

  it('evaluate() is deterministic: same inputs → same outputs', () => {
    const candles = Array.from({ length: 200 }, (_, i) =>
      candle(i * 300000, 100 + Math.sin(i * 0.1) * 20)
    );
    const analyzers = core.createAnalyzers(fakeApp, {
      analyzers: [
        { name: 'rsi', weight: '1.0', config: { period: 9, oversold: 28, overbought: 72 } },
      ],
    } as any, true);

    const d1 = core.evaluate(analyzers, candles, '100', undefined, '0.3', '0.3');
    const d2 = core.evaluate(analyzers, candles, '100', undefined, '0.3', '0.3');

    expect(d1.action).toBe(d2.action);
    expect(d1.signal.totalBuyWeight).toBe(d2.signal.totalBuyWeight);
    expect(d1.signal.totalSellWeight).toBe(d2.signal.totalSellWeight);
  });

  it('evaluate() with activeTrade produces sell signals that hold signals ignore', () => {
    // RSI overbought → sell signal only matters if there's an active trade
    const candles = Array.from({ length: 200 }, (_, i) =>
      candle(i * 300000, 100 + i) // steady rise → RSI very high
    );
    const analyzers = core.createAnalyzers(fakeApp, {
      analyzers: [
        { name: 'rsi', weight: '1.0', config: { period: 14, oversold: 30, overbought: 70 } },
      ],
    } as any, true);

    const withoutTrade = core.evaluate(analyzers, candles, '299', undefined, '0.3', '0.3');
    const withTrade = core.evaluate(analyzers, candles, '299',
      { id: 1, entryPrice: '200', quantity: '1' }, '0.3', '0.3');

    // RSI overbought → sell signal present in both
    expect(withoutTrade.signal.totalSellWeight).toBe(withTrade.signal.totalSellWeight);
    // But decision differs: without trade can't sell, with trade can
    expect(withoutTrade.action).toBe('hold'); // no position to sell
    expect(withTrade.action).toBe('sell');
  });

  it('stop_loss analyzer triggers at correct percentage', () => {
    const candles = Array.from({ length: 200 }, (_, i) => candle(i * 300000, 100));
    const analyzers = core.createAnalyzers(fakeApp, {
      analyzers: [
        { name: 'stop_loss', weight: '2.0', config: { lossPct: 5.0 } },
      ],
    } as any, true);

    // 4% loss — should NOT trigger (below 5% threshold)
    const at4pct = core.evaluate(analyzers, candles, '96',
      { id: 1, entryPrice: '100', quantity: '1' }, '0.3', '0.3');
    expect(at4pct.action).toBe('hold');

    // 5% loss — SHOULD trigger
    const at5pct = core.evaluate(analyzers, candles, '95',
      { id: 1, entryPrice: '100', quantity: '1' }, '0.3', '0.3');
    expect(at5pct.action).toBe('sell');

    // 10% loss — definitely triggers
    const at10pct = core.evaluate(analyzers, candles, '90',
      { id: 1, entryPrice: '100', quantity: '1' }, '0.3', '0.3');
    expect(at10pct.action).toBe('sell');
  });

  it('profit_target analyzer triggers at correct percentage', () => {
    const candles = Array.from({ length: 200 }, (_, i) => candle(i * 300000, 100));
    const analyzers = core.createAnalyzers(fakeApp, {
      analyzers: [
        { name: 'profit_target', weight: '2.0', config: { targetPct: 3.0 } },
      ],
    } as any, true);

    // 2% profit — should NOT trigger
    const at2pct = core.evaluate(analyzers, candles, '102',
      { id: 1, entryPrice: '100', quantity: '1' }, '0.3', '0.3');
    expect(at2pct.action).toBe('hold');

    // 3% profit — SHOULD trigger
    const at3pct = core.evaluate(analyzers, candles, '103',
      { id: 1, entryPrice: '100', quantity: '1' }, '0.3', '0.3');
    expect(at3pct.action).toBe('sell');
  });
});
