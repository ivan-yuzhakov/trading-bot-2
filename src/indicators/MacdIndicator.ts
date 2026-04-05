import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

export class MacdIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const fastPeriod = (this.config.fastPeriod as number) || 12;
    const slowPeriod = (this.config.slowPeriod as number) || 26;
    const signalPeriod = (this.config.signalPeriod as number) || 9;
    const last = candles[candles.length - 1];

    if (candles.length < slowPeriod + signalPeriod) {
      return { name: 'macd', values: { macd: '0', signal: '0', histogram: '0' }, timestamp: last?.t || 0 };
    }

    const closes = candles.map((c) => new Decimal(c.c));
    const fastEma = this.#ema(closes, fastPeriod);
    const slowEma = this.#ema(closes, slowPeriod);

    // MACD line = fast EMA - slow EMA (compute for each point where both exist)
    const startIdx = slowPeriod - 1;
    const macdLine: Decimal[] = [];
    for (let i = startIdx; i < closes.length; i++) {
      macdLine.push(fastEma[i].minus(slowEma[i]));
    }

    // Signal line = EMA of MACD line
    const signalLine = this.#ema(macdLine, signalPeriod);

    const macdVal = macdLine[macdLine.length - 1];
    const signalVal = signalLine[signalLine.length - 1];
    const histogram = macdVal.minus(signalVal);

    return {
      name: 'macd',
      values: {
        macd: macdVal.toDecimalPlaces(8).toString(),
        signal: signalVal.toDecimalPlaces(8).toString(),
        histogram: histogram.toDecimalPlaces(8).toString(),
      },
      timestamp: last.t,
    };
  }

  #ema(data: Decimal[], period: number): Decimal[] {
    const result: Decimal[] = new Array(data.length);
    const multiplier = new Decimal(2).dividedBy(period + 1);

    // SMA for first period
    let sum = new Decimal(0);
    for (let i = 0; i < period && i < data.length; i++) {
      sum = sum.plus(data[i]);
      result[i] = sum.dividedBy(i + 1);
    }

    // EMA for rest
    let ema = sum.dividedBy(period);
    result[period - 1] = ema;

    for (let i = period; i < data.length; i++) {
      ema = data[i].minus(ema).times(multiplier).plus(ema);
      result[i] = ema;
    }

    return result;
  }
}
