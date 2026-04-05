import { Decimal } from 'decimal.js';
import { Analyzer } from './Analyzer.js';
import type { App } from '../app/App.js';
import type { Candle } from '../candles/types.js';
import type { Signal, AnalyzerConfig, ActiveTrade } from './types.js';

/** Sell when profit reaches target %. Only active when there's an open trade. */
export class ProfitTargetAnalyzer extends Analyzer {
  #targetPct: Decimal;

  constructor(app: App, config: AnalyzerConfig) {
    super(app, 'profit_target', config);
    this.#targetPct = new Decimal((config.targetPct as number) || 1);
  }

  analyze(_candles: Candle[], currentPrice: string, trade?: ActiveTrade): Signal {
    if (!trade) {
      return { action: 'hold', weight: '0', reason: 'No active trade' };
    }

    const entry = new Decimal(trade.entryPrice);
    const current = new Decimal(currentPrice);
    const profitPct = current.minus(entry).dividedBy(entry).times(100);

    if (profitPct.greaterThanOrEqualTo(this.#targetPct)) {
      return {
        action: 'sell',
        weight: '1',
        reason: `Profit target reached: ${profitPct.toDecimalPlaces(2)}% >= ${this.#targetPct}%`,
      };
    }

    return { action: 'hold', weight: '0', reason: `Profit: ${profitPct.toDecimalPlaces(2)}% (target: ${this.#targetPct}%)` };
  }
}
