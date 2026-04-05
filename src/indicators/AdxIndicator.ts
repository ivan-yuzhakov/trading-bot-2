import { Decimal } from 'decimal.js';
import { Indicator } from './Indicator.js';
import type { Candle } from '../candles/types.js';
import type { IndicatorResult } from './types.js';

/** Average Directional Index */
export class AdxIndicator extends Indicator {
  calculate(candles: Candle[]): IndicatorResult {
    const period = (this.config.period as number) || 14;
    const last = candles[candles.length - 1];

    if (candles.length < period * 2 + 1) {
      return { name: 'adx', values: { adx: '0', pdi: '0', mdi: '0' }, timestamp: last?.t || 0 };
    }

    const trArr: Decimal[] = [];
    const plusDM: Decimal[] = [];
    const minusDM: Decimal[] = [];

    for (let i = 1; i < candles.length; i++) {
      const h = new Decimal(candles[i].h);
      const l = new Decimal(candles[i].l);
      const prevH = new Decimal(candles[i - 1].h);
      const prevL = new Decimal(candles[i - 1].l);
      const prevC = new Decimal(candles[i - 1].c);

      trArr.push(Decimal.max(h.minus(l), h.minus(prevC).abs(), l.minus(prevC).abs()));

      const upMove = h.minus(prevH);
      const downMove = prevL.minus(l);

      plusDM.push(upMove.greaterThan(downMove) && upMove.greaterThan(0) ? upMove : new Decimal(0));
      minusDM.push(downMove.greaterThan(upMove) && downMove.greaterThan(0) ? downMove : new Decimal(0));
    }

    // Smoothed values (Wilder's smoothing)
    let smoothTR = this.#sum(trArr, 0, period);
    let smoothPlusDM = this.#sum(plusDM, 0, period);
    let smoothMinusDM = this.#sum(minusDM, 0, period);

    const dxArr: Decimal[] = [];

    for (let i = period; i < trArr.length; i++) {
      if (i > period) {
        smoothTR = smoothTR.minus(smoothTR.dividedBy(period)).plus(trArr[i]);
        smoothPlusDM = smoothPlusDM.minus(smoothPlusDM.dividedBy(period)).plus(plusDM[i]);
        smoothMinusDM = smoothMinusDM.minus(smoothMinusDM.dividedBy(period)).plus(minusDM[i]);
      }

      const pdi = smoothTR.isZero() ? new Decimal(0) : smoothPlusDM.dividedBy(smoothTR).times(100);
      const mdi = smoothTR.isZero() ? new Decimal(0) : smoothMinusDM.dividedBy(smoothTR).times(100);
      const diSum = pdi.plus(mdi);
      const dx = diSum.isZero() ? new Decimal(0) : pdi.minus(mdi).abs().dividedBy(diSum).times(100);
      dxArr.push(dx);
    }

    // ADX = smoothed DX
    let adx = this.#sum(dxArr, 0, Math.min(period, dxArr.length)).dividedBy(Math.min(period, dxArr.length));
    for (let i = period; i < dxArr.length; i++) {
      adx = adx.times(period - 1).plus(dxArr[i]).dividedBy(period);
    }

    // Latest +DI and -DI
    const lastPdi = smoothTR.isZero() ? new Decimal(0) : smoothPlusDM.dividedBy(smoothTR).times(100);
    const lastMdi = smoothTR.isZero() ? new Decimal(0) : smoothMinusDM.dividedBy(smoothTR).times(100);

    return {
      name: 'adx',
      values: {
        adx: adx.toDecimalPlaces(4).toString(),
        pdi: lastPdi.toDecimalPlaces(4).toString(),
        mdi: lastMdi.toDecimalPlaces(4).toString(),
      },
      timestamp: last.t,
    };
  }

  #sum(arr: Decimal[], start: number, count: number): Decimal {
    let s = new Decimal(0);
    for (let i = start; i < start + count && i < arr.length; i++) s = s.plus(arr[i]);
    return s;
  }
}
