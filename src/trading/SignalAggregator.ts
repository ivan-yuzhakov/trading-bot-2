import { Decimal } from 'decimal.js';
import type { Candle } from '../candles/types.js';
import type { Analyzer } from '../analyzers/Analyzer.js';
import type { ActiveTrade, AggregatedSignal } from '../analyzers/types.js';

export interface WeightedAnalyzer {
  analyzer: Analyzer;
  weight: string;
  candles?: Candle[];
}

export class SignalAggregator {

  /**
   * @param analyzers - each analyzer may have its own candles (different TF).
   *   If analyzer.candles is set, uses those. Otherwise falls back to defaultCandles.
   */
  aggregate(analyzers: WeightedAnalyzer[], defaultCandles: Candle[], currentPrice: string, trade?: ActiveTrade): AggregatedSignal {
    let totalBuyWeight = new Decimal(0);
    let totalSellWeight = new Decimal(0);
    const signals: AggregatedSignal['signals'] = [];

    for (const { analyzer, weight, candles: analyzerCandles } of analyzers) {
      const signal = analyzer.analyze(analyzerCandles || defaultCandles, currentPrice, trade);
      const configWeight = new Decimal(weight);
      const signalWeight = new Decimal(signal.weight);
      const effectiveWeight = configWeight.times(signalWeight);

      if (signal.action === 'buy') {
        totalBuyWeight = totalBuyWeight.plus(effectiveWeight);
      } else if (signal.action === 'sell') {
        totalSellWeight = totalSellWeight.plus(effectiveWeight);
      }

      signals.push({ analyzerName: analyzer.name, signal });
    }

    return {
      totalBuyWeight: totalBuyWeight.toDecimalPlaces(4).toString(),
      totalSellWeight: totalSellWeight.toDecimalPlaces(4).toString(),
      signals,
    };
  }
}
