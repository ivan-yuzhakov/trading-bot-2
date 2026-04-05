import { Decimal } from 'decimal.js';
import { Analyzer } from './Analyzer.js';
import { RsiIndicator } from '../indicators/RsiIndicator.js';
import type { App } from '../app/App.js';
import type { Candle } from '../candles/types.js';
import type { Signal, AnalyzerConfig, ActiveTrade } from './types.js';

export class RsiAnalyzer extends Analyzer {
  #indicator: RsiIndicator;
  #oversold: number;
  #overbought: number;

  constructor(app: App, config: AnalyzerConfig) {
    super(app, 'rsi', config);
    this.#indicator = new RsiIndicator({ period: (config.period as number) || 14 });
    this.#oversold = (config.oversold as number) || 30;
    this.#overbought = (config.overbought as number) || 70;
  }

  analyze(candles: Candle[], _currentPrice: string, _trade?: ActiveTrade): Signal {
    const result = this.#indicator.calculate(candles);
    const rsi = new Decimal(result.values.rsi);

    if (rsi.lessThan(this.#oversold)) {
      const distance = new Decimal(this.#oversold).minus(rsi).dividedBy(this.#oversold);
      return { action: 'buy', weight: distance.toDecimalPlaces(4).toString(), reason: `RSI ${result.values.rsi} < ${this.#oversold}` };
    }

    if (rsi.greaterThan(this.#overbought)) {
      const distance = rsi.minus(this.#overbought).dividedBy(new Decimal(100).minus(this.#overbought));
      return { action: 'sell', weight: distance.toDecimalPlaces(4).toString(), reason: `RSI ${result.values.rsi} > ${this.#overbought}` };
    }

    return { action: 'hold', weight: '0', reason: `RSI ${result.values.rsi} neutral` };
  }
}
