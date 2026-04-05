import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

/** Exponential Moving Average */
export class EmaIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const period = (this.config.period as number) || 20;

    if (candles.length < period) {
      return { name: 'ema', values: { ema: candles[candles.length - 1]?.c || '0' }, timestamp: candles[candles.length - 1]?.t || 0 };
    }

    const multiplier = new Decimal(2).dividedBy(period + 1);

    // Start EMA with SMA of first `period` candles
    let ema = new Decimal(0);
    for (let i = 0; i < period; i++) {
      ema = ema.plus(candles[i].c);
    }
    ema = ema.dividedBy(period);

    // Apply EMA formula for remaining candles
    for (let i = period; i < candles.length; i++) {
      const close = new Decimal(candles[i].c);
      ema = close.minus(ema).times(multiplier).plus(ema);
    }

    return { name: 'ema', values: { ema: ema.toDecimalPlaces(8).toString() }, timestamp: candles[candles.length - 1].t };
  }
}
