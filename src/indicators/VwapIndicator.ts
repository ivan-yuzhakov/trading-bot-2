import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

/** Volume Weighted Average Price */
export class VwapIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const last = candles[candles.length - 1];
    if (candles.length === 0) {
      return { name: 'vwap', values: { vwap: '0' }, timestamp: 0 };
    }

    let cumulativeTPV = new Decimal(0); // typical price * volume
    let cumulativeVol = new Decimal(0);

    for (const c of candles) {
      const tp = new Decimal(c.h).plus(c.l).plus(c.c).dividedBy(3);
      const vol = new Decimal(c.v);
      cumulativeTPV = cumulativeTPV.plus(tp.times(vol));
      cumulativeVol = cumulativeVol.plus(vol);
    }

    const vwap = cumulativeVol.isZero() ? new Decimal(last.c) : cumulativeTPV.dividedBy(cumulativeVol);

    return { name: 'vwap', values: { vwap: vwap.toDecimalPlaces(8).toString() }, timestamp: last.t };
  }
}
