import { Decimal } from 'decimal.js';
import { Analyzer } from './Analyzer.js';
import { MacdIndicator } from '../indicators/MacdIndicator.js';
import type { App } from '../app/App.js';
import type { Candle } from '../candles/types.js';
import type { Signal, AnalyzerConfig, ActiveTrade } from './types.js';

export class MacdAnalyzer extends Analyzer {
  #indicator: MacdIndicator;

  constructor(app: App, config: AnalyzerConfig) {
    super(app, 'macd', config);
    this.#indicator = new MacdIndicator({
      fastPeriod: (config.fastPeriod as number) || 12,
      slowPeriod: (config.slowPeriod as number) || 26,
      signalPeriod: (config.signalPeriod as number) || 9,
    });
  }

  analyze(candles: Candle[], _currentPrice: string, _trade?: ActiveTrade): Signal {
    const result = this.#indicator.calculate(candles);
    const histogram = new Decimal(result.values.histogram);

    // Also check previous to detect crossover
    if (candles.length > 1) {
      const prevResult = this.#indicator.calculate(candles.slice(0, -1));
      const prevHistogram = new Decimal(prevResult.values.histogram);

      // Histogram crossed from negative to positive → buy
      if (prevHistogram.lessThanOrEqualTo(0) && histogram.greaterThan(0)) {
        return { action: 'buy', weight: Decimal.min(histogram.abs().times(10), 1).toDecimalPlaces(4).toString(), reason: 'MACD histogram crossed above zero' };
      }

      // Histogram crossed from positive to negative → sell
      if (prevHistogram.greaterThanOrEqualTo(0) && histogram.lessThan(0)) {
        return { action: 'sell', weight: Decimal.min(histogram.abs().times(10), 1).toDecimalPlaces(4).toString(), reason: 'MACD histogram crossed below zero' };
      }
    }

    return { action: 'hold', weight: '0', reason: `MACD histogram: ${result.values.histogram}` };
  }
}
