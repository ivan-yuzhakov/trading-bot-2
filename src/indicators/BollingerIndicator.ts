import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

export class BollingerIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const period = (this.config.period as number) || 20;
    const stdDevMult = (this.config.stdDev as number) || 2;
    const slice = candles.slice(-period);
    const last = candles[candles.length - 1];

    if (slice.length < period) {
      return { name: 'bollinger', values: { upper: '0', middle: '0', lower: '0', bandwidth: '0', percentB: '0.5' }, timestamp: last?.t || 0 };
    }

    // SMA (middle band)
    let sum = new Decimal(0);
    for (const c of slice) sum = sum.plus(c.c);
    const middle = sum.dividedBy(period);

    // Standard deviation
    let sqSum = new Decimal(0);
    for (const c of slice) {
      sqSum = sqSum.plus(new Decimal(c.c).minus(middle).pow(2));
    }
    const stdDev = sqSum.dividedBy(period).sqrt();

    const upper = middle.plus(stdDev.times(stdDevMult));
    const lower = middle.minus(stdDev.times(stdDevMult));
    const bandwidth = upper.minus(lower).dividedBy(middle);
    const price = new Decimal(last.c);
    const percentB = upper.equals(lower) ? new Decimal(0.5) : price.minus(lower).dividedBy(upper.minus(lower));

    return {
      name: 'bollinger',
      values: {
        upper: upper.toDecimalPlaces(8).toString(),
        middle: middle.toDecimalPlaces(8).toString(),
        lower: lower.toDecimalPlaces(8).toString(),
        bandwidth: bandwidth.toDecimalPlaces(8).toString(),
        percentB: percentB.toDecimalPlaces(4).toString(),
      },
      timestamp: last.t,
    };
  }
}
