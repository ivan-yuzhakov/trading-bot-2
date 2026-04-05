import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

/** Simple Moving Average */
export class MaIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const period = (this.config.period as number) || 20;
    const slice = candles.slice(-period);

    if (slice.length < period) {
      return { name: 'ma', values: { ma: candles[candles.length - 1]?.c || '0' }, timestamp: candles[candles.length - 1]?.t || 0 };
    }

    let sum = new Decimal(0);
    for (const c of slice) {
      sum = sum.plus(c.c);
    }

    const ma = sum.dividedBy(period).toDecimalPlaces(8).toString();
    return { name: 'ma', values: { ma }, timestamp: candles[candles.length - 1].t };
  }
}
