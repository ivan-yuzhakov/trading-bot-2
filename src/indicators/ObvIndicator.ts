import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

/** On-Balance Volume */
export class ObvIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const last = candles[candles.length - 1];
    if (candles.length < 2) {
      return { name: 'obv', values: { obv: '0' }, timestamp: last?.t || 0 };
    }

    let obv = new Decimal(0);
    for (let i = 1; i < candles.length; i++) {
      const curClose = new Decimal(candles[i].c);
      const prevClose = new Decimal(candles[i - 1].c);
      const vol = new Decimal(candles[i].v);

      if (curClose.greaterThan(prevClose)) {
        obv = obv.plus(vol);
      } else if (curClose.lessThan(prevClose)) {
        obv = obv.minus(vol);
      }
    }

    return { name: 'obv', values: { obv: obv.toDecimalPlaces(8).toString() }, timestamp: last.t };
  }
}
