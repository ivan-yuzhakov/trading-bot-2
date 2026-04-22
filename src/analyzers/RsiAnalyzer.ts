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
    const rsi = parseFloat(result.values.rsi);

    if (rsi < this.#oversold) {
      const distance = (this.#oversold - rsi) / this.#oversold;
      return { action: 'buy', weight: distance.toFixed(4), reason: `RSI ${result.values.rsi} < ${this.#oversold}` };
    }

    if (rsi > this.#overbought) {
      const distance = (rsi - this.#overbought) / (100 - this.#overbought);
      return { action: 'sell', weight: distance.toFixed(4), reason: `RSI ${result.values.rsi} > ${this.#overbought}` };
    }

    return { action: 'hold', weight: '0', reason: `RSI ${result.values.rsi} neutral` };
  }
}
