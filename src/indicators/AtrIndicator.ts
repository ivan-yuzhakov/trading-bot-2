import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

/** Average True Range */
export class AtrIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const period = (this.config.period as number) || 14;
    const last = candles[candles.length - 1];

    if (candles.length < period + 1) {
      return { name: 'atr', values: { atr: '0' }, timestamp: last?.t || 0 };
    }

    // True Range = max(H-L, |H-prevC|, |L-prevC|)
    const trValues: Decimal[] = [];
    for (let i = 1; i < candles.length; i++) {
      const h = new Decimal(candles[i].h);
      const l = new Decimal(candles[i].l);
      const prevC = new Decimal(candles[i - 1].c);
      const tr = Decimal.max(h.minus(l), h.minus(prevC).abs(), l.minus(prevC).abs());
      trValues.push(tr);
    }

    // First ATR = average of first `period` TRs
    let atr = new Decimal(0);
    for (let i = 0; i < period; i++) atr = atr.plus(trValues[i]);
    atr = atr.dividedBy(period);

    // Smoothed ATR (Wilder's)
    for (let i = period; i < trValues.length; i++) {
      atr = atr.times(period - 1).plus(trValues[i]).dividedBy(period);
    }

    return { name: 'atr', values: { atr: atr.toDecimalPlaces(8).toString() }, timestamp: last.t };
  }
}
