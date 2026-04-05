import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

export class IchimokuIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const tenkanPeriod = (this.config.tenkanPeriod as number) || 9;
    const kijunPeriod = (this.config.kijunPeriod as number) || 26;
    const senkouBPeriod = (this.config.senkouBPeriod as number) || 52;
    const last = candles[candles.length - 1];

    if (candles.length < senkouBPeriod) {
      return { name: 'ichimoku', values: { tenkan: '0', kijun: '0', senkouA: '0', senkouB: '0', chikou: '0' }, timestamp: last?.t || 0 };
    }

    const tenkan = this.#midpoint(candles, tenkanPeriod);
    const kijun = this.#midpoint(candles, kijunPeriod);
    const senkouA = tenkan.plus(kijun).dividedBy(2);
    const senkouB = this.#midpoint(candles, senkouBPeriod);
    const chikouIdx = candles.length - 1 - kijunPeriod;
    const chikou = chikouIdx >= 0 ? new Decimal(candles[chikouIdx].c) : new Decimal(last.c);

    return {
      name: 'ichimoku',
      values: {
        tenkan: tenkan.toDecimalPlaces(8).toString(),
        kijun: kijun.toDecimalPlaces(8).toString(),
        senkouA: senkouA.toDecimalPlaces(8).toString(),
        senkouB: senkouB.toDecimalPlaces(8).toString(),
        chikou: chikou.toDecimalPlaces(8).toString(),
      },
      timestamp: last.t,
    };
  }

  #midpoint(candles: Candle[], period: number): Decimal {
    const slice = candles.slice(-period);
    let highest = new Decimal(slice[0].h);
    let lowest = new Decimal(slice[0].l);
    for (const c of slice) {
      highest = Decimal.max(highest, c.h);
      lowest = Decimal.min(lowest, c.l);
    }
    return highest.plus(lowest).dividedBy(2);
  }
}
