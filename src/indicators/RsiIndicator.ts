import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

export class RsiIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const period = (this.config.period as number) || 14;

    if (candles.length < period + 1) {
      return { name: 'rsi', values: { rsi: '50' }, timestamp: candles[candles.length - 1]?.t || 0 };
    }

    // Calculate price changes
    const changes: Decimal[] = [];
    for (let i = 1; i < candles.length; i++) {
      changes.push(new Decimal(candles[i].c).minus(candles[i - 1].c));
    }

    // Initial average gain/loss
    let avgGain = new Decimal(0);
    let avgLoss = new Decimal(0);

    for (let i = 0; i < period; i++) {
      if (changes[i].greaterThan(0)) {
        avgGain = avgGain.plus(changes[i]);
      } else {
        avgLoss = avgLoss.plus(changes[i].abs());
      }
    }

    avgGain = avgGain.dividedBy(period);
    avgLoss = avgLoss.dividedBy(period);

    // Smoothed RSI (Wilder's method)
    for (let i = period; i < changes.length; i++) {
      const change = changes[i];
      const gain = change.greaterThan(0) ? change : new Decimal(0);
      const loss = change.lessThan(0) ? change.abs() : new Decimal(0);

      avgGain = avgGain.times(period - 1).plus(gain).dividedBy(period);
      avgLoss = avgLoss.times(period - 1).plus(loss).dividedBy(period);
    }

    let rsi: string;
    if (avgLoss.isZero()) {
      rsi = '100';
    } else {
      const rs = avgGain.dividedBy(avgLoss);
      rsi = new Decimal(100).minus(new Decimal(100).dividedBy(rs.plus(1))).toDecimalPlaces(4).toString();
    }

    return { name: 'rsi', values: { rsi }, timestamp: candles[candles.length - 1].t };
  }
}
