import { Decimal } from 'decimal.js';
import type { App } from '../app/App.js';
import type { Candle, Timeframe } from '../candles/types.js';
import { TF_MS, BASE_TF_MS } from '../candles/types.js';
import { CandleAggregator } from '../candles/CandleAggregator.js';
import { Analyzer } from '../analyzers/Analyzer.js';
import { RsiAnalyzer } from '../analyzers/RsiAnalyzer.js';
import { BollingerAnalyzer } from '../analyzers/BollingerAnalyzer.js';
import { MaCrossAnalyzer } from '../analyzers/MaCrossAnalyzer.js';
import { MacdAnalyzer } from '../analyzers/MacdAnalyzer.js';
import { VolumeAnalyzer } from '../analyzers/VolumeAnalyzer.js';
import { ProfitTargetAnalyzer } from '../analyzers/ProfitTargetAnalyzer.js';
import { StopLossAnalyzer } from '../analyzers/StopLossAnalyzer.js';
import { NewsAnalyzer } from '../analyzers/NewsAnalyzer.js';
import { TrendFilterAnalyzer } from '../analyzers/TrendFilterAnalyzer.js';
import { SignalAggregator, type WeightedAnalyzer } from './SignalAggregator.js';
import type { ActiveTrade, AggregatedSignal } from '../analyzers/types.js';
import type { Strategy, AnalyzerConfig, MoneyManagementConfig } from '../entity/Strategy.js';

export const COMMISSION_RATE = new Decimal('0.001');
const BASE_LOOKBACK = 200;

export interface TradeDecision {
  action: 'buy' | 'sell' | 'hold';
  signal: AggregatedSignal;
}

export interface PositionSize {
  quantity: string;
  amount: string;
}

/**
 * Core trading logic shared between live trading (PairRunner) and backtesting (BacktestEngine).
 * This is the SINGLE source of truth for:
 * - Analyzer creation
 * - Signal evaluation (buy/sell/hold decision)
 * - Position sizing
 * - Profit calculation
 */
export class TradingCore {
  #signalAggregator = new SignalAggregator();
  #aggregator = new CandleAggregator();

  /** Create analyzer instance from config. */
  createAnalyzer(app: App, config: AnalyzerConfig): Analyzer | null {
    const c = config.config;
    switch (config.name) {
      case 'rsi': return new RsiAnalyzer(app, c);
      case 'bollinger': return new BollingerAnalyzer(app, c);
      case 'ma_cross': return new MaCrossAnalyzer(app, c);
      case 'macd': return new MacdAnalyzer(app, c);
      case 'volume': return new VolumeAnalyzer(app, c);
      case 'profit_target': return new ProfitTargetAnalyzer(app, c);
      case 'stop_loss': return new StopLossAnalyzer(app, c);
      case 'news': return new NewsAnalyzer(app, c);
      case 'trend_filter': return new TrendFilterAnalyzer(app, c);
      default: return null;
    }
  }

  /** Create all analyzers for a strategy, optionally skipping backtest-incompatible ones. */
  createAnalyzers(app: App, strategy: Strategy, backtestMode: boolean = false): (WeightedAnalyzer & { timeframe: Timeframe })[] {
    const result: (WeightedAnalyzer & { timeframe: Timeframe })[] = [];
    for (const ac of strategy.analyzers) {
      const analyzer = this.createAnalyzer(app, ac);
      if (!analyzer) continue;
      if (backtestMode && !analyzer.supportsBacktest) continue;
      result.push({ analyzer, weight: ac.weight, timeframe: (ac.timeframe || '5m') as Timeframe });
    }
    return result;
  }

  /** Evaluate signals and decide buy/sell/hold.
   *  preAggregated: optional pre-computed candle arrays per timeframe (full history, sorted by t).
   *  When provided, slice is computed instead of re-aggregating — gives identical result much faster.
   *  Used by backtesting to avoid re-aggregating the same window thousands of times.
   */
  evaluate(
    analyzers: (WeightedAnalyzer & { timeframe: Timeframe })[],
    baseCandles: Candle[],
    currentPrice: string,
    activeTrade: ActiveTrade | undefined,
    buyThreshold: string,
    sellThreshold: string,
    preAggregated?: Map<Timeframe, Candle[]>,
  ): TradeDecision {
    const requiredLookback = this.calculateLookback(analyzers);
    if (baseCandles.length < requiredLookback / 4) {
      return { action: 'hold', signal: { totalBuyWeight: '0', totalSellWeight: '0', signals: [] } };
    }

    // Build candles per analyzer timeframe
    const windowStart = baseCandles[0].t;
    const windowEnd = baseCandles[baseCandles.length - 1].t;
    const analyzersWithCandles: WeightedAnalyzer[] = analyzers.map(a => {
      if (a.timeframe === '5m') return { ...a, candles: baseCandles };
      const pre = preAggregated?.get(a.timeframe);
      if (pre) {
        return { ...a, candles: this.#sliceForWindow(pre, a.timeframe, windowStart, windowEnd) };
      }
      return { ...a, candles: this.#aggregator.aggregate(baseCandles, a.timeframe) };
    });

    const signal = this.#signalAggregator.aggregate(analyzersWithCandles, baseCandles, currentPrice, activeTrade);
    const totalBuy = new Decimal(signal.totalBuyWeight);
    const totalSell = new Decimal(signal.totalSellWeight);

    if (!activeTrade && totalBuy.greaterThanOrEqualTo(buyThreshold)) {
      return { action: 'buy', signal };
    }
    if (activeTrade && totalSell.greaterThanOrEqualTo(sellThreshold)) {
      return { action: 'sell', signal };
    }
    return { action: 'hold', signal };
  }

  /** Calculate position size based on money management config. Commission is NOT deducted here — it's handled in calculateProfit(). */
  calculatePositionSize(balance: string, price: string, mm: MoneyManagementConfig): PositionSize {
    let amount: Decimal;
    if (mm.mode === 'percentage') {
      amount = new Decimal(balance).times(mm.amount).dividedBy(100);
    } else {
      amount = Decimal.min(new Decimal(mm.amount), new Decimal(balance));
    }

    const quantity = amount.dividedBy(price);

    return {
      quantity: quantity.toDecimalPlaces(8).toString(),
      amount: amount.toString(),
    };
  }

  /** Calculate profit for a closed trade (including commissions). */
  calculateProfit(entryPrice: string, exitPrice: string, quantity: string, commissions?: string[]): { profit: string; profitPct: string; totalCommission: string } {
    let totalCommission = new Decimal(0);
    if (commissions) {
      for (const c of commissions) {
        if (c) totalCommission = totalCommission.plus(c);
      }
    } else {
      // Estimate commission if not provided (backtest mode)
      const buyCommission = new Decimal(entryPrice).times(quantity).times(COMMISSION_RATE);
      const sellCommission = new Decimal(exitPrice).times(quantity).times(COMMISSION_RATE);
      totalCommission = buyCommission.plus(sellCommission);
    }

    const profit = new Decimal(exitPrice).minus(entryPrice).times(quantity).minus(totalCommission);
    const profitPct = new Decimal(exitPrice).minus(entryPrice).dividedBy(entryPrice).times(100);

    return {
      profit: profit.toDecimalPlaces(8).toString(),
      profitPct: profitPct.toDecimalPlaces(4).toString(),
      totalCommission: totalCommission.toDecimalPlaces(8).toString(),
    };
  }

  /** Calculate stop-loss price from entry price and percentage. */
  calculateStopLoss(entryPrice: string, stopLossPct: string): string {
    return new Decimal(entryPrice)
      .times(new Decimal(1).minus(new Decimal(stopLossPct).dividedBy(100)))
      .toDecimalPlaces(8).toString();
  }

  /** Slice pre-aggregated candles to match what would be produced by aggregating the window directly.
   *  A higher-TF candle is included only if all its base candles fit in [windowStart, windowEnd]
   *  (windowEnd is the openTime of the last 5m candle in the window — its 5m period extends to windowEnd + BASE_TF_MS).
   */
  #sliceForWindow(preAggregated: Candle[], tf: Timeframe, windowStart: number, windowEnd: number): Candle[] {
    if (preAggregated.length === 0) return [];
    const tfMs = TF_MS[tf];
    // Last valid openTime: candle at T has base candles up to openTime T + tfMs - BASE_TF_MS.
    // For all base candles to be in window, T + tfMs - BASE_TF_MS <= windowEnd → T <= windowEnd - tfMs + BASE_TF_MS.
    const lastValidOpenTime = windowEnd - tfMs + BASE_TF_MS;

    // Binary search for start (first openTime >= windowStart) and end (last openTime <= lastValidOpenTime).
    let lo = 0, hi = preAggregated.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (preAggregated[mid].t < windowStart) lo = mid + 1;
      else hi = mid;
    }
    const startIdx = lo;

    lo = startIdx; hi = preAggregated.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (preAggregated[mid].t <= lastValidOpenTime) lo = mid + 1;
      else hi = mid;
    }
    const endIdxExclusive = lo;

    return preAggregated.slice(startIdx, endIdxExclusive);
  }

  /** Pre-aggregate base candles to all unique non-5m timeframes used by analyzers. */
  preAggregateForAnalyzers(baseCandles: Candle[], analyzers: { timeframe: Timeframe }[]): Map<Timeframe, Candle[]> {
    const result = new Map<Timeframe, Candle[]>();
    const tfs = new Set<Timeframe>();
    for (const a of analyzers) {
      if (a.timeframe !== '5m') tfs.add(a.timeframe);
    }
    for (const tf of tfs) {
      result.set(tf, this.#aggregator.aggregate(baseCandles, tf));
    }
    return result;
  }

  /** Calculate required lookback in 5m candles for given analyzers. */
  calculateLookback(analyzers: { timeframe: Timeframe }[]): number {
    let maxMultiplier = 1;
    for (const a of analyzers) {
      const multiplier = TF_MS[a.timeframe] / BASE_TF_MS;
      if (multiplier > maxMultiplier) maxMultiplier = multiplier;
    }
    // Need BASE_LOOKBACK candles in the highest timeframe → multiply by ratio
    return BASE_LOOKBACK * maxMultiplier;
  }

  get lookback(): number { return BASE_LOOKBACK; }
}
