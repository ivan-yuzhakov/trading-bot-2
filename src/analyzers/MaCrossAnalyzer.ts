import { Decimal } from 'decimal.js';
import { Analyzer } from './Analyzer.js';
import { EmaIndicator } from '../indicators/EmaIndicator.js';
import type { App } from '../app/App.js';
import type { Candle } from '../candles/types.js';
import type { Signal, AnalyzerConfig, ActiveTrade } from './types.js';

/** Golden cross / death cross analyzer using two EMAs. */
export class MaCrossAnalyzer extends Analyzer {
  #fastEma: EmaIndicator;
  #slowEma: EmaIndicator;

  constructor(app: App, config: AnalyzerConfig) {
    super(app, 'ma_cross', config);
    this.#fastEma = new EmaIndicator({ period: (config.fastPeriod as number) || 9 });
    this.#slowEma = new EmaIndicator({ period: (config.slowPeriod as number) || 21 });
  }

  analyze(candles: Candle[], _currentPrice: string, _trade?: ActiveTrade): Signal {
    if (candles.length < 2) return { action: 'hold', weight: '0', reason: 'Not enough data' };

    const fast = new Decimal(this.#fastEma.calculate(candles).values.ema);
    const slow = new Decimal(this.#slowEma.calculate(candles).values.ema);

    // Also check previous candles for cross detection
    const prevCandles = candles.slice(0, -1);
    const prevFast = new Decimal(this.#fastEma.calculate(prevCandles).values.ema);
    const prevSlow = new Decimal(this.#slowEma.calculate(prevCandles).values.ema);

    const wasBelowOrEqual = prevFast.lessThanOrEqualTo(prevSlow);
    const isAbove = fast.greaterThan(slow);
    const wasAboveOrEqual = prevFast.greaterThanOrEqualTo(prevSlow);
    const isBelow = fast.lessThan(slow);

    if (wasBelowOrEqual && isAbove) {
      const spread = fast.minus(slow).dividedBy(slow).abs();
      return { action: 'buy', weight: Decimal.min(spread.times(100), 1).toDecimalPlaces(4).toString(), reason: 'Golden cross (fast EMA crossed above slow)' };
    }

    if (wasAboveOrEqual && isBelow) {
      const spread = slow.minus(fast).dividedBy(slow).abs();
      return { action: 'sell', weight: Decimal.min(spread.times(100), 1).toDecimalPlaces(4).toString(), reason: 'Death cross (fast EMA crossed below slow)' };
    }

    return { action: 'hold', weight: '0', reason: 'No cross detected' };
  }
}
