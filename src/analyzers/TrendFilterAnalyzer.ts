import { Analyzer } from './Analyzer.js';
import type { App } from '../app/App.js';
import type { Candle } from '../candles/types.js';
import type { Signal, AnalyzerConfig, ActiveTrade } from './types.js';

/**
 * Trend filter via SMA comparison.
 * Returns continuous BUY weight when price > MA (bullish trend).
 * Returns hold (weight 0) when price < MA (bearish trend) — effectively blocks buys via threshold.
 * Never triggers sell — only filters entries.
 *
 * Use case: combine with mean-reversion analyzers (RSI/Bollinger) to avoid catching falling knives.
 * Set buy_threshold high enough that all required signals must fire (including this one).
 */
export class TrendFilterAnalyzer extends Analyzer {
  #period: number;
  /** Max price-MA gap (in %) at which weight saturates to 1.0. Default 5%. */
  #maxGapPct: number;

  constructor(app: App, config: AnalyzerConfig) {
    super(app, 'trend_filter', config);
    this.#period = (config.period as number) || 50;
    this.#maxGapPct = (config.maxGapPct as number) || 5;
  }

  analyze(candles: Candle[], currentPrice: string, _trade?: ActiveTrade): Signal {
    if (candles.length < this.#period) {
      return { action: 'hold', weight: '0', reason: `Not enough candles (${candles.length}/${this.#period})` };
    }

    // Simple moving average over last `period` closes
    let sum = 0;
    const start = candles.length - this.#period;
    for (let i = start; i < candles.length; i++) {
      sum += parseFloat(candles[i].c);
    }
    const ma = sum / this.#period;

    const price = parseFloat(currentPrice);
    const gapPct = (price - ma) / ma * 100;

    if (price <= ma) {
      return { action: 'hold', weight: '0', reason: `Bearish: price ${price.toFixed(2)} <= MA ${ma.toFixed(2)} (${gapPct.toFixed(2)}%)` };
    }

    // Bullish — weight scales with how far above MA, capped at 1.0
    const weight = Math.min(gapPct / this.#maxGapPct, 1);
    return {
      action: 'buy',
      weight: weight.toFixed(4),
      reason: `Bullish: price ${price.toFixed(2)} > MA ${ma.toFixed(2)} (gap ${gapPct.toFixed(2)}%)`,
    };
  }
}
