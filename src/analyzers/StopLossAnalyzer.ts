import { Decimal } from 'decimal.js';
import { Analyzer } from './Analyzer.js';
import type { App } from '../app/App.js';
import type { Candle } from '../candles/types.js';
import type { Signal, AnalyzerConfig, ActiveTrade } from './types.js';

/** Strong sell signal when loss exceeds threshold. */
export class StopLossAnalyzer extends Analyzer {
  #lossPct: Decimal;

  constructor(app: App, config: AnalyzerConfig) {
    super(app, 'stop_loss', config);
    this.#lossPct = new Decimal((config.lossPct as number) || 2);
  }

  analyze(_candles: Candle[], currentPrice: string, trade?: ActiveTrade): Signal {
    if (!trade) {
      return { action: 'hold', weight: '0', reason: 'No active trade' };
    }

    const entry = new Decimal(trade.entryPrice);
    const current = new Decimal(currentPrice);
    const lossPct = entry.minus(current).dividedBy(entry).times(100);

    if (lossPct.greaterThanOrEqualTo(this.#lossPct)) {
      return {
        action: 'sell',
        weight: '1',
        reason: `Stop loss triggered: -${lossPct.toDecimalPlaces(2)}% >= ${this.#lossPct}%`,
      };
    }

    return { action: 'hold', weight: '0', reason: `Loss: -${lossPct.toDecimalPlaces(2)}% (limit: ${this.#lossPct}%)` };
  }
}
