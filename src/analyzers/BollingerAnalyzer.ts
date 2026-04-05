import { Decimal } from 'decimal.js';
import { Analyzer } from './Analyzer.js';
import { BollingerIndicator } from '../indicators/BollingerIndicator.js';
import type { App } from '../app/App.js';
import type { Candle } from '../candles/types.js';
import type { Signal, AnalyzerConfig, ActiveTrade } from './types.js';

export class BollingerAnalyzer extends Analyzer {
  #indicator: BollingerIndicator;

  constructor(app: App, config: AnalyzerConfig) {
    super(app, 'bollinger', config);
    this.#indicator = new BollingerIndicator({
      period: (config.period as number) || 20,
      stdDev: (config.stdDev as number) || 2,
    });
  }

  analyze(candles: Candle[], currentPrice: string, _trade?: ActiveTrade): Signal {
    const result = this.#indicator.calculate(candles);
    const price = new Decimal(currentPrice);
    const upper = new Decimal(result.values.upper);
    const lower = new Decimal(result.values.lower);
    const percentB = new Decimal(result.values.percentB);

    if (percentB.lessThan(0.1)) {
      const weight = new Decimal(0.1).minus(percentB).dividedBy(0.1);
      return { action: 'buy', weight: weight.toDecimalPlaces(4).toString(), reason: `Price near lower band (%B=${result.values.percentB})` };
    }

    if (percentB.greaterThan(0.9)) {
      const weight = percentB.minus(0.9).dividedBy(0.1);
      return { action: 'sell', weight: weight.toDecimalPlaces(4).toString(), reason: `Price near upper band (%B=${result.values.percentB})` };
    }

    return { action: 'hold', weight: '0', reason: `Price within bands (%B=${result.values.percentB})` };
  }
}
