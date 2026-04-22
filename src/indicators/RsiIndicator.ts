import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

export class RsiIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const period = (this.config.period as number) || 14;

    if (candles.length < period + 1) {
      return { name: 'rsi', values: { rsi: '50' }, timestamp: candles[candles.length - 1]?.t || 0 };
    }

    // Native floats — RSI is statistical, precision well above trading thresholds.
    let avgGain = 0;
    let avgLoss = 0;
    let prevClose = parseFloat(candles[0].c);

    // Initial average gain/loss over first `period` changes (candles[1..period])
    for (let i = 1; i <= period; i++) {
      const close = parseFloat(candles[i].c);
      const change = close - prevClose;
      if (change > 0) avgGain += change;
      else avgLoss += -change;
      prevClose = close;
    }
    avgGain /= period;
    avgLoss /= period;

    // Wilder's smoothing for remaining changes
    const periodMinus1 = period - 1;
    for (let i = period + 1; i < candles.length; i++) {
      const close = parseFloat(candles[i].c);
      const change = close - prevClose;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;
      avgGain = (avgGain * periodMinus1 + gain) / period;
      avgLoss = (avgLoss * periodMinus1 + loss) / period;
      prevClose = close;
    }

    let rsi: string;
    if (avgLoss === 0) {
      rsi = '100';
    } else {
      const rs = avgGain / avgLoss;
      rsi = (100 - 100 / (rs + 1)).toFixed(4);
    }

    return { name: 'rsi', values: { rsi }, timestamp: candles[candles.length - 1].t };
  }
}
