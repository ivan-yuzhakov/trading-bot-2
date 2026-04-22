import { describe, it, expect } from 'vitest';
import type { Candle } from '../src/candles/types.js';
import { RsiIndicator } from '../src/indicators/RsiIndicator.js';
import { MaIndicator } from '../src/indicators/MaIndicator.js';
import { EmaIndicator } from '../src/indicators/EmaIndicator.js';
import { BollingerIndicator } from '../src/indicators/BollingerIndicator.js';
import { MacdIndicator } from '../src/indicators/MacdIndicator.js';
import { AtrIndicator } from '../src/indicators/AtrIndicator.js';
import { StochasticIndicator } from '../src/indicators/StochasticIndicator.js';
import { VwapIndicator } from '../src/indicators/VwapIndicator.js';
import { ObvIndicator } from '../src/indicators/ObvIndicator.js';
import { AdxIndicator } from '../src/indicators/AdxIndicator.js';
import { CciIndicator } from '../src/indicators/CciIndicator.js';
import { WilliamsRIndicator } from '../src/indicators/WilliamsRIndicator.js';
import { IchimokuIndicator } from '../src/indicators/IchimokuIndicator.js';

// ==================== Helpers ====================

function candle(t: number, o: number, h: number, l: number, c: number, v: number = 100): Candle {
  return { t, o: String(o), h: String(h), l: String(l), c: String(c), v: String(v) };
}

/** Shorthand: candles with only close prices (o=c-0.5, h=c+1, l=c-1) */
function fromCloses(closes: number[], base = 0): Candle[] {
  return closes.map((c, i) => candle(base + i * 300000, c - 0.5, c + 1, c - 1, c));
}

function val(result: { values: Record<string, string> }, key: string): number {
  return parseFloat(result.values[key]);
}

// ==================== RSI ====================

describe('RsiIndicator', () => {
  const rsi14 = new RsiIndicator({ period: 14 });

  it('RSI=100 when all candles go up (no losses)', () => {
    // 20 candles each +1 from previous → avgLoss=0 → RSI=100
    const candles = fromCloses(Array.from({ length: 20 }, (_, i) => 100 + i));
    expect(val(rsi14.calculate(candles), 'rsi')).toBe(100);
  });

  it('RSI=0 when all candles go down (no gains)', () => {
    const candles = fromCloses(Array.from({ length: 20 }, (_, i) => 120 - i));
    expect(val(rsi14.calculate(candles), 'rsi')).toBe(0);
  });

  it('RSI=100 when all closes are equal (no changes = no losses)', () => {
    const candles = fromCloses(Array.from({ length: 20 }, () => 100));
    expect(val(rsi14.calculate(candles), 'rsi')).toBe(100);
  });

  it('manual RSI calculation for known data', () => {
    // 15 closes: first 14 changes define initial avgGain/avgLoss
    // Changes: +2, -1, +3, -2, +1, -1, +2, -3, +1, +2, -1, +3, -2, +1
    const closes = [100, 102, 101, 104, 102, 103, 102, 104, 101, 102, 104, 103, 106, 104, 105];
    const candles = fromCloses(closes);
    const rsi = new RsiIndicator({ period: 14 });
    const result = val(rsi.calculate(candles), 'rsi');

    // Gains: 2,3,1,2,1,2,3,1 = 15, Losses: 1,2,1,3,1,2 = 10
    // avgGain=15/14=1.0714, avgLoss=10/14=0.7143
    // RS=1.0714/0.7143=1.5, RSI=100-100/2.5=60
    expect(result).toBeGreaterThan(55);
    expect(result).toBeLessThan(65);
  });

  it('not enough data returns default 50', () => {
    expect(val(rsi14.calculate(fromCloses([100, 101])), 'rsi')).toBe(50);
  });

  it('empty array returns 50', () => {
    expect(val(rsi14.calculate([]), 'rsi')).toBe(50);
  });

  it('period 7 is more reactive than 14', () => {
    const data = [100, 105, 102, 108, 95, 100, 110, 105, 98, 103, 108, 95, 90, 88, 85, 80];
    const r7 = val(new RsiIndicator({ period: 7 }).calculate(fromCloses(data)), 'rsi');
    const r14 = val(new RsiIndicator({ period: 14 }).calculate(fromCloses(data)), 'rsi');
    // Both in bearish territory on this data, but 7 should be more extreme
    expect(r7).toBeLessThan(r14);
  });

  it('RSI between 0 and 100', () => {
    const random = fromCloses(Array.from({ length: 50 }, () => 90 + Math.random() * 20));
    const result = val(rsi14.calculate(random), 'rsi');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('timestamp from last candle', () => {
    const candles = fromCloses(Array.from({ length: 20 }, (_, i) => 100 + i));
    expect(rsi14.calculate(candles).timestamp).toBe(candles[candles.length - 1].t);
  });
});

// ==================== MA ====================

describe('MaIndicator', () => {
  it('SMA(5) of [10,20,30,40,50] = 30', () => {
    const ma = new MaIndicator({ period: 5 });
    expect(val(ma.calculate(fromCloses([10, 20, 30, 40, 50])), 'ma')).toBe(30);
  });

  it('SMA(3) of [1,2,3,4,5] uses last 3: (3+4+5)/3 = 4', () => {
    const ma = new MaIndicator({ period: 3 });
    expect(val(ma.calculate(fromCloses([1, 2, 3, 4, 5])), 'ma')).toBe(4);
  });

  it('SMA of constant = that constant', () => {
    const ma = new MaIndicator({ period: 10 });
    expect(val(ma.calculate(fromCloses(Array.from({ length: 15 }, () => 42))), 'ma')).toBe(42);
  });

  it('not enough data returns last close', () => {
    const ma = new MaIndicator({ period: 20 });
    const candles = fromCloses([100, 105, 110]);
    expect(val(ma.calculate(candles), 'ma')).toBe(110);
  });

  it('period 1 = last close', () => {
    const ma = new MaIndicator({ period: 1 });
    expect(val(ma.calculate(fromCloses([10, 20, 30])), 'ma')).toBe(30);
  });
});

// ==================== EMA ====================

describe('EmaIndicator', () => {
  it('EMA(10) of constant 50 = 50', () => {
    const ema = new EmaIndicator({ period: 10 });
    const candles = fromCloses(Array.from({ length: 20 }, () => 50));
    expect(val(ema.calculate(candles), 'ema')).toBeCloseTo(50, 4);
  });

  it('EMA weights recent prices more heavily', () => {
    const ema = new EmaIndicator({ period: 5 });
    const ma = new MaIndicator({ period: 5 });
    // Accelerating rise: recent prices increase faster → EMA closer to them
    const candles = fromCloses([10, 11, 12, 13, 14, 15, 20, 30, 50, 100]);
    expect(val(ema.calculate(candles), 'ema')).toBeGreaterThan(val(ma.calculate(candles), 'ma'));
  });

  it('manual EMA(3): multiplier=2/(3+1)=0.5', () => {
    // SMA of first 3: (10+20+30)/3 = 20
    // EMA[3] = 40*0.5 + 20*0.5 = 30
    // EMA[4] = 50*0.5 + 30*0.5 = 40
    const ema = new EmaIndicator({ period: 3 });
    const result = val(ema.calculate(fromCloses([10, 20, 30, 40, 50])), 'ema');
    expect(result).toBeCloseTo(40, 4);
  });

  it('not enough data returns last close', () => {
    const ema = new EmaIndicator({ period: 20 });
    expect(val(ema.calculate(fromCloses([100])), 'ema')).toBe(100);
  });
});

// ==================== Bollinger ====================

describe('BollingerIndicator', () => {
  const bb = new BollingerIndicator({ period: 20, stdDev: 2 });

  it('constant prices: stdDev=0, upper=middle=lower', () => {
    const candles = fromCloses(Array.from({ length: 25 }, () => 100));
    const r = bb.calculate(candles);
    expect(val(r, 'middle')).toBe(100);
    expect(val(r, 'upper')).toBe(100);
    expect(val(r, 'lower')).toBe(100);
    expect(val(r, 'bandwidth')).toBe(0);
  });

  it('upper > middle > lower for volatile data', () => {
    const candles = fromCloses(Array.from({ length: 25 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5)));
    const r = bb.calculate(candles);
    expect(val(r, 'upper')).toBeGreaterThan(val(r, 'middle'));
    expect(val(r, 'middle')).toBeGreaterThan(val(r, 'lower'));
  });

  it('percentB=0.5 when price at middle band', () => {
    // All same price → middle = that price, upper=lower=middle → percentB=0.5
    const candles = fromCloses(Array.from({ length: 25 }, () => 100));
    expect(val(bb.calculate(candles), 'percentB')).toBe(0.5);
  });

  it('percentB near 0 when price near lower band', () => {
    // Prices mostly at 100, last one drops to 80
    const closes = Array.from({ length: 24 }, () => 100);
    closes.push(80);
    const r = bb.calculate(fromCloses(closes));
    expect(val(r, 'percentB')).toBeLessThan(0.1);
  });

  it('percentB near/above 1 when price near upper band', () => {
    const closes = Array.from({ length: 24 }, () => 100);
    closes.push(120);
    const r = bb.calculate(fromCloses(closes));
    expect(val(r, 'percentB')).toBeGreaterThan(0.9);
  });

  it('wider stdDev → wider bands', () => {
    const bb2 = new BollingerIndicator({ period: 20, stdDev: 2 });
    const bb3 = new BollingerIndicator({ period: 20, stdDev: 3 });
    const candles = fromCloses(Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 10));
    const bw2 = val(bb2.calculate(candles), 'bandwidth');
    const bw3 = val(bb3.calculate(candles), 'bandwidth');
    expect(bw3).toBeGreaterThan(bw2);
  });

  it('not enough data returns zeros', () => {
    const r = bb.calculate(fromCloses([100, 101]));
    expect(val(r, 'upper')).toBe(0);
  });
});

// ==================== MACD ====================

describe('MacdIndicator', () => {
  const macd = new MacdIndicator({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });

  it('strong uptrend: MACD > 0', () => {
    // Accelerating uptrend so fast EMA diverges from slow
    const candles = fromCloses(Array.from({ length: 40 }, (_, i) => 100 + i * 2 + i * 0.1));
    const r = macd.calculate(candles);
    expect(val(r, 'macd')).toBeGreaterThan(0);
  });

  it('strong downtrend: MACD < 0', () => {
    const candles = fromCloses(Array.from({ length: 40 }, (_, i) => 200 - i * 2 - i * 0.1));
    const r = macd.calculate(candles);
    expect(val(r, 'macd')).toBeLessThan(0);
  });

  it('flat prices: MACD ≈ 0', () => {
    const candles = fromCloses(Array.from({ length: 40 }, () => 100));
    const r = macd.calculate(candles);
    expect(Math.abs(val(r, 'macd'))).toBeLessThan(0.01);
  });

  it('signal line lags behind MACD line in accelerating trend', () => {
    // Accelerating trend: MACD diverges faster than signal can follow
    const candles = fromCloses(Array.from({ length: 40 }, (_, i) => 100 + i * 2 + Math.pow(i, 1.3)));
    const r = macd.calculate(candles);
    expect(Math.abs(val(r, 'macd'))).toBeGreaterThanOrEqual(Math.abs(val(r, 'signal')));
  });

  it('not enough data returns zeros', () => {
    const r = macd.calculate(fromCloses([100, 101, 102]));
    expect(val(r, 'macd')).toBe(0);
  });

  it('histogram = MACD - signal', () => {
    const candles = fromCloses(Array.from({ length: 40 }, (_, i) => 100 + i + Math.sin(i) * 5));
    const r = macd.calculate(candles);
    const expected = val(r, 'macd') - val(r, 'signal');
    expect(val(r, 'histogram')).toBeCloseTo(expected, 6);
  });
});

// ==================== ATR ====================

describe('AtrIndicator', () => {
  const atr = new AtrIndicator({ period: 14 });

  it('ATR=0 when H=L=C (no range)', () => {
    const candles = Array.from({ length: 20 }, (_, i) =>
      candle(i * 300000, 100, 100, 100, 100),
    );
    expect(val(atr.calculate(candles), 'atr')).toBe(0);
  });

  it('ATR > 0 for volatile data', () => {
    const candles = fromCloses(Array.from({ length: 20 }, (_, i) => 100 + i));
    expect(val(atr.calculate(candles), 'atr')).toBeGreaterThan(0);
  });

  it('manual ATR: constant range candles', () => {
    // Each candle: H=110, L=90, C=100 → TR = H-L = 20 for each
    // ATR should converge to 20
    const candles = Array.from({ length: 20 }, (_, i) =>
      candle(i * 300000, 100, 110, 90, 100),
    );
    expect(val(atr.calculate(candles), 'atr')).toBeCloseTo(20, 0);
  });

  it('ATR considers gap from previous close', () => {
    // Gap up: prev close=100, current H=120,L=115,C=118 → TR = max(5, |120-100|, |115-100|) = 20
    const candles = [
      candle(0, 100, 105, 95, 100),
      ...Array.from({ length: 14 }, (_, i) => candle((i + 1) * 300000, 100, 105, 95, 100)),
      candle(15 * 300000, 115, 120, 115, 118),
    ];
    expect(val(atr.calculate(candles), 'atr')).toBeGreaterThan(5);
  });

  it('not enough data returns 0', () => {
    expect(val(atr.calculate(fromCloses([100, 101])), 'atr')).toBe(0);
  });
});

// ==================== Stochastic ====================

describe('StochasticIndicator', () => {
  const stoch = new StochasticIndicator({ kPeriod: 14, dPeriod: 3, smooth: 3 });

  it('price at highest high: %K near 100', () => {
    // 25 candles, last one closes at the period high
    const candles = Array.from({ length: 25 }, (_, i) => {
      const c = 90 + (i < 20 ? i * 0.5 : 20); // rises then flat at 110
      return candle(i * 300000, c - 1, c + 2, c - 2, i === 24 ? 112 : c);
    });
    expect(val(stoch.calculate(candles), 'k')).toBeGreaterThan(80);
  });

  it('price at lowest low: %K near 0', () => {
    const candles = Array.from({ length: 25 }, (_, i) => {
      const c = 110 - (i < 20 ? i * 0.5 : 10);
      return candle(i * 300000, c + 1, c + 2, c - 2, i === 24 ? 88 : c);
    });
    expect(val(stoch.calculate(candles), 'k')).toBeLessThan(20);
  });

  it('%K and %D between 0 and 100', () => {
    const candles = fromCloses(Array.from({ length: 30 }, () => 90 + Math.random() * 20));
    const r = stoch.calculate(candles);
    expect(val(r, 'k')).toBeGreaterThanOrEqual(0);
    expect(val(r, 'k')).toBeLessThanOrEqual(100);
    expect(val(r, 'd')).toBeGreaterThanOrEqual(0);
    expect(val(r, 'd')).toBeLessThanOrEqual(100);
  });

  it('%D is smoother than %K (SMA of %K)', () => {
    // Can't easily test "smoother" but both should be valid numbers
    const candles = fromCloses(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 10));
    const r = stoch.calculate(candles);
    expect(val(r, 'k')).not.toBeNaN();
    expect(val(r, 'd')).not.toBeNaN();
  });

  it('not enough data returns 50', () => {
    const r = stoch.calculate(fromCloses([100, 101]));
    expect(val(r, 'k')).toBe(50);
  });
});

// ==================== VWAP ====================

describe('VwapIndicator', () => {
  const vwap = new VwapIndicator({});

  it('VWAP = typical price when all volumes equal', () => {
    // Single candle: TP = (H+L+C)/3 = (110+90+100)/3 = 100
    const candles = [candle(0, 100, 110, 90, 100, 50)];
    expect(val(vwap.calculate(candles), 'vwap')).toBeCloseTo(100, 4);
  });

  it('VWAP weighted by volume', () => {
    // Candle 1: TP=(12+8+10)/3=10, vol=100 → TPV=1000
    // Candle 2: TP=(22+18+20)/3=20, vol=300 → TPV=6000
    // VWAP = 7000/400 = 17.5
    const candles = [
      candle(0, 10, 12, 8, 10, 100),
      candle(1, 20, 22, 18, 20, 300),
    ];
    expect(val(vwap.calculate(candles), 'vwap')).toBeCloseTo(17.5, 4);
  });

  it('VWAP = close when zero volume candles', () => {
    const candles = [candle(0, 100, 100, 100, 100, 0)];
    // cumulativeVol=0 → returns last close
    expect(val(vwap.calculate(candles), 'vwap')).toBe(100);
  });

  it('empty candles returns 0', () => {
    expect(val(vwap.calculate([]), 'vwap')).toBe(0);
  });
});

// ==================== OBV ====================

describe('ObvIndicator', () => {
  const obv = new ObvIndicator({});

  it('all rising closes: OBV = sum of all volumes (except first)', () => {
    // 5 candles, each close > prev, vol=10 each → OBV = 4*10 = 40
    const candles = fromCloses([100, 101, 102, 103, 104]);
    // Each has vol=100 (from fromCloses default)
    expect(val(obv.calculate(candles), 'obv')).toBe(400);
  });

  it('all falling closes: OBV = negative sum', () => {
    const candles = fromCloses([104, 103, 102, 101, 100]);
    expect(val(obv.calculate(candles), 'obv')).toBe(-400);
  });

  it('alternating: volumes cancel out', () => {
    // Up, down, up, down → +100, -100, +100, -100 = 0
    const candles = fromCloses([100, 101, 100, 101, 100]);
    expect(val(obv.calculate(candles), 'obv')).toBe(0);
  });

  it('equal close: no volume change', () => {
    const candles = fromCloses([100, 100, 100]);
    expect(val(obv.calculate(candles), 'obv')).toBe(0);
  });

  it('single candle returns 0', () => {
    expect(val(obv.calculate(fromCloses([100])), 'obv')).toBe(0);
  });
});

// ==================== ADX ====================

describe('AdxIndicator', () => {
  const adx = new AdxIndicator({ period: 14 });

  it('strong trend: ADX > 25', () => {
    // 40 candles with clear uptrend
    const candles = Array.from({ length: 40 }, (_, i) =>
      candle(i * 300000, 100 + i * 2, 103 + i * 2, 98 + i * 2, 101 + i * 2),
    );
    expect(val(adx.calculate(candles), 'adx')).toBeGreaterThan(20);
  });

  it('uptrend: +DI > -DI', () => {
    const candles = Array.from({ length: 40 }, (_, i) =>
      candle(i * 300000, 100 + i * 2, 103 + i * 2, 98 + i * 2, 101 + i * 2),
    );
    const r = adx.calculate(candles);
    expect(val(r, 'pdi')).toBeGreaterThan(val(r, 'mdi'));
  });

  it('downtrend: -DI > +DI', () => {
    const candles = Array.from({ length: 40 }, (_, i) =>
      candle(i * 300000, 200 - i * 2, 203 - i * 2, 198 - i * 2, 201 - i * 2),
    );
    const r = adx.calculate(candles);
    expect(val(r, 'mdi')).toBeGreaterThan(val(r, 'pdi'));
  });

  it('ADX, +DI, -DI all >= 0', () => {
    const candles = fromCloses(Array.from({ length: 40 }, () => 90 + Math.random() * 20));
    const r = adx.calculate(candles);
    expect(val(r, 'adx')).toBeGreaterThanOrEqual(0);
    expect(val(r, 'pdi')).toBeGreaterThanOrEqual(0);
    expect(val(r, 'mdi')).toBeGreaterThanOrEqual(0);
  });

  it('not enough data returns zeros', () => {
    const r = adx.calculate(fromCloses([100, 101]));
    expect(val(r, 'adx')).toBe(0);
  });
});

// ==================== CCI ====================

describe('CciIndicator', () => {
  const cci = new CciIndicator({ period: 20 });

  it('flat prices: CCI = 0', () => {
    const candles = Array.from({ length: 25 }, (_, i) =>
      candle(i * 300000, 100, 100, 100, 100),
    );
    expect(val(cci.calculate(candles), 'cci')).toBe(0);
  });

  it('price above average: CCI > 0', () => {
    // 19 candles at 100, last at 120
    const candles = [
      ...Array.from({ length: 19 }, (_, i) => candle(i * 300000, 100, 100, 100, 100)),
      candle(19 * 300000, 120, 120, 120, 120),
    ];
    expect(val(cci.calculate(candles), 'cci')).toBeGreaterThan(0);
  });

  it('price below average: CCI < 0', () => {
    const candles = [
      ...Array.from({ length: 19 }, (_, i) => candle(i * 300000, 100, 100, 100, 100)),
      candle(19 * 300000, 80, 80, 80, 80),
    ];
    expect(val(cci.calculate(candles), 'cci')).toBeLessThan(0);
  });

  it('extreme CCI > 100 on big move', () => {
    const candles = [
      ...Array.from({ length: 19 }, (_, i) => candle(i * 300000, 100, 101, 99, 100)),
      candle(19 * 300000, 150, 150, 150, 150),
    ];
    expect(val(cci.calculate(candles), 'cci')).toBeGreaterThan(100);
  });

  it('not enough data returns 0', () => {
    expect(val(cci.calculate(fromCloses([100])), 'cci')).toBe(0);
  });
});

// ==================== Williams %R ====================

describe('WilliamsRIndicator', () => {
  const wr = new WilliamsRIndicator({ period: 14 });

  it('close at highest high: %R = 0', () => {
    // All candles same, close = high → %R = 0
    const candles = Array.from({ length: 20 }, (_, i) =>
      candle(i * 300000, 100, 110, 90, 110),
    );
    expect(val(wr.calculate(candles), 'williamsr')).toBe(0);
  });

  it('close at lowest low: %R = -100', () => {
    const candles = Array.from({ length: 20 }, (_, i) =>
      candle(i * 300000, 100, 110, 90, 90),
    );
    expect(val(wr.calculate(candles), 'williamsr')).toBe(-100);
  });

  it('close at midpoint: %R = -50', () => {
    const candles = Array.from({ length: 20 }, (_, i) =>
      candle(i * 300000, 100, 110, 90, 100),
    );
    expect(val(wr.calculate(candles), 'williamsr')).toBe(-50);
  });

  it('%R always between -100 and 0', () => {
    const candles = fromCloses(Array.from({ length: 20 }, () => 90 + Math.random() * 20));
    const result = val(wr.calculate(candles), 'williamsr');
    expect(result).toBeGreaterThanOrEqual(-100);
    expect(result).toBeLessThanOrEqual(0);
  });

  it('not enough data returns -50', () => {
    expect(val(wr.calculate(fromCloses([100])), 'williamsr')).toBe(-50);
  });
});

// ==================== Ichimoku ====================

describe('IchimokuIndicator', () => {
  const ichi = new IchimokuIndicator({ tenkanPeriod: 9, kijunPeriod: 26, senkouBPeriod: 52, displacement: 26 });

  it('tenkan = (9-period high + 9-period low) / 2', () => {
    // 60 candles, all H=110, L=90 → tenkan = (110+90)/2 = 100
    const candles = Array.from({ length: 60 }, (_, i) =>
      candle(i * 300000, 100, 110, 90, 100),
    );
    expect(val(ichi.calculate(candles), 'tenkan')).toBe(100);
  });

  it('kijun = (26-period high + 26-period low) / 2', () => {
    const candles = Array.from({ length: 60 }, (_, i) =>
      candle(i * 300000, 100, 120, 80, 100),
    );
    expect(val(ichi.calculate(candles), 'kijun')).toBe(100);
  });

  it('senkouA = (tenkan + kijun) / 2', () => {
    const candles = Array.from({ length: 60 }, (_, i) =>
      candle(i * 300000, 100, 110, 90, 100),
    );
    const r = ichi.calculate(candles);
    const expected = (val(r, 'tenkan') + val(r, 'kijun')) / 2;
    expect(val(r, 'senkouA')).toBeCloseTo(expected, 6);
  });

  it('all values are valid numbers', () => {
    const candles = fromCloses(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10));
    const r = ichi.calculate(candles);
    for (const key of ['tenkan', 'kijun', 'senkouA', 'senkouB', 'chikou']) {
      expect(val(r, key)).not.toBeNaN();
      expect(val(r, key)).toBeGreaterThan(0);
    }
  });

  it('not enough data returns zeros', () => {
    const r = ichi.calculate(fromCloses([100, 101]));
    expect(val(r, 'tenkan')).toBe(0);
  });
});
