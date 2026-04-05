import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

/** Williams %R */
export class WilliamsRIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const period = (this.config.period as number) || 14;
    const last = candles[candles.length - 1];
    const slice = candles.slice(-period);

    if (slice.length < period) {
      return { name: 'williamsr', values: { williamsr: '-50' }, timestamp: last?.t || 0 };
    }

    let highest = new Decimal(slice[0].h);
    let lowest = new Decimal(slice[0].l);
    for (const c of slice) {
      highest = Decimal.max(highest, c.h);
      lowest = Decimal.min(lowest, c.l);
    }

    const range = highest.minus(lowest);
    const wr = range.isZero()
      ? new Decimal(-50)
      : highest.minus(last.c).dividedBy(range).times(-100);

    return { name: 'williamsr', values: { williamsr: wr.toDecimalPlaces(4).toString() }, timestamp: last.t };
  }
}
