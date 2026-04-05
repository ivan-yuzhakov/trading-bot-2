import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

export class StochasticIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const kPeriod = (this.config.kPeriod as number) || 14;
    const dPeriod = (this.config.dPeriod as number) || 3;
    const smooth = (this.config.smooth as number) || 3;
    const last = candles[candles.length - 1];

    if (candles.length < kPeriod + dPeriod + smooth) {
      return { name: 'stochastic', values: { k: '50', d: '50' }, timestamp: last?.t || 0 };
    }

    // Raw %K values
    const rawK: Decimal[] = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
      const slice = candles.slice(i - kPeriod + 1, i + 1);
      let highest = new Decimal(slice[0].h);
      let lowest = new Decimal(slice[0].l);
      for (const c of slice) {
        highest = Decimal.max(highest, c.h);
        lowest = Decimal.min(lowest, c.l);
      }
      const range = highest.minus(lowest);
      const k = range.isZero() ? new Decimal(50) : new Decimal(candles[i].c).minus(lowest).dividedBy(range).times(100);
      rawK.push(k);
    }

    // Smooth %K
    const smoothedK = this.#sma(rawK, smooth);

    // %D = SMA of smoothed %K
    const dValues = this.#sma(smoothedK, dPeriod);

    return {
      name: 'stochastic',
      values: {
        k: smoothedK[smoothedK.length - 1].toDecimalPlaces(4).toString(),
        d: dValues[dValues.length - 1].toDecimalPlaces(4).toString(),
      },
      timestamp: last.t,
    };
  }

  #sma(data: Decimal[], period: number): Decimal[] {
    const result: Decimal[] = [];
    for (let i = period - 1; i < data.length; i++) {
      let sum = new Decimal(0);
      for (let j = i - period + 1; j <= i; j++) sum = sum.plus(data[j]);
      result.push(sum.dividedBy(period));
    }
    return result;
  }
}
