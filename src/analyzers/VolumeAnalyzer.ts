import { Decimal } from 'decimal.js';
import { Analyzer } from './Analyzer.js';
import { ObvIndicator } from '../indicators/ObvIndicator.js';
import type { App } from '../app/App.js';
import type { Candle } from '../candles/types.js';
import type { Signal, AnalyzerConfig, ActiveTrade } from './types.js';

/** Confirms trends with volume analysis using OBV and volume spikes. */
export class VolumeAnalyzer extends Analyzer {
  #obvIndicator: ObvIndicator;

  constructor(app: App, config: AnalyzerConfig) {
    super(app, 'volume', config);
    this.#obvIndicator = new ObvIndicator({});
  }

  analyze(candles: Candle[], _currentPrice: string, _trade?: ActiveTrade): Signal {
    const period = (this.config.period as number) || 20;

    if (candles.length < period + 1) {
      return { action: 'hold', weight: '0', reason: 'Not enough data for volume analysis' };
    }

    // Average volume over period
    const recentCandles = candles.slice(-period);
    let avgVol = new Decimal(0);
    for (const c of recentCandles) avgVol = avgVol.plus(c.v);
    avgVol = avgVol.dividedBy(period);

    const lastVol = new Decimal(candles[candles.length - 1].v);
    const volRatio = avgVol.isZero() ? new Decimal(1) : lastVol.dividedBy(avgVol);

    // OBV change over recent period — calculate only the delta, not full OBV twice
    let obvChange = new Decimal(0);
    const start = candles.length - period;
    for (let i = start; i < candles.length; i++) {
      const curClose = new Decimal(candles[i].c);
      const prevClose = new Decimal(candles[i - 1].c);
      const vol = new Decimal(candles[i].v);
      if (curClose.greaterThan(prevClose)) obvChange = obvChange.plus(vol);
      else if (curClose.lessThan(prevClose)) obvChange = obvChange.minus(vol);
    }

    // Volume spike + price going up = buy confirmation
    const priceUp = new Decimal(candles[candles.length - 1].c).greaterThan(candles[candles.length - 2].c);
    const priceDown = new Decimal(candles[candles.length - 1].c).lessThan(candles[candles.length - 2].c);

    if (volRatio.greaterThan(1.5) && priceUp && obvChange.greaterThan(0)) {
      const weight = Decimal.min(volRatio.minus(1).dividedBy(2), 1);
      return { action: 'buy', weight: weight.toDecimalPlaces(4).toString(), reason: `Volume spike (${volRatio.toDecimalPlaces(2)}x) with bullish OBV` };
    }

    if (volRatio.greaterThan(1.5) && priceDown && obvChange.lessThan(0)) {
      const weight = Decimal.min(volRatio.minus(1).dividedBy(2), 1);
      return { action: 'sell', weight: weight.toDecimalPlaces(4).toString(), reason: `Volume spike (${volRatio.toDecimalPlaces(2)}x) with bearish OBV` };
    }

    return { action: 'hold', weight: '0', reason: `Volume ratio: ${volRatio.toDecimalPlaces(2)}x` };
  }
}
