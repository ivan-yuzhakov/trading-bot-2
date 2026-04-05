import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

/** Commodity Channel Index */
export class CciIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const period = (this.config.period as number) || 20;
    const last = candles[candles.length - 1];
    const slice = candles.slice(-period);

    if (slice.length < period) {
      return { name: 'cci', values: { cci: '0' }, timestamp: last?.t || 0 };
    }

    // Typical prices
    const tps = slice.map((c) => new Decimal(c.h).plus(c.l).plus(c.c).dividedBy(3));

    // SMA of typical prices
    let sum = new Decimal(0);
    for (const tp of tps) sum = sum.plus(tp);
    const sma = sum.dividedBy(period);

    // Mean deviation
    let mdSum = new Decimal(0);
    for (const tp of tps) mdSum = mdSum.plus(tp.minus(sma).abs());
    const md = mdSum.dividedBy(period);

    const tp = tps[tps.length - 1];
    const cci = md.isZero() ? new Decimal(0) : tp.minus(sma).dividedBy(md.times('0.015'));

    return { name: 'cci', values: { cci: cci.toDecimalPlaces(4).toString() }, timestamp: last.t };
  }
}
