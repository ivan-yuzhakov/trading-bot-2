import { describe, it, expect } from 'vitest';
import { MathPlus, MathMinus, MathMultiple, MathDivide, MathMax, MathMin, MathFloor, MathCeil, MathAbs, MathGt, MathLt, MathGte, MathLte, MathRound } from '../src/app/Math.js';

describe('MathPlus', () => {
  it('basic addition', () => {
    expect(MathPlus('1', '2')).toBe('3');
    expect(MathPlus('100', '200', '300')).toBe('600');
  });

  it('no floating point errors', () => {
    expect(MathPlus('0.1', '0.2')).toBe('0.3');
    expect(MathPlus('0.1', '0.2', '0.3')).toBe('0.6');
    expect(MathPlus('1.1', '2.2')).toBe('3.3');
    expect(MathPlus('999999999.999999999', '0.000000001')).toBe('1000000000');
  });

  it('negative numbers', () => {
    expect(MathPlus('-1', '2')).toBe('1');
    expect(MathPlus('-5', '-3')).toBe('-8');
    expect(MathPlus('-100', '100')).toBe('0');
  });

  it('zero', () => {
    expect(MathPlus('0', '0')).toBe('0');
    expect(MathPlus('0', '5')).toBe('5');
    expect(MathPlus('5', '0')).toBe('5');
  });

  it('large numbers preserve precision', () => {
    expect(MathPlus('99999999999999999999', '1')).toBe('100000000000000000000');
    // Decimal.js may use exponential notation for very large results
    expect(parseFloat(MathPlus('999999999999', '1'))).toBe(1000000000000);
  });

  it('small decimals preserve precision', () => {
    // Decimal.js returns exponential for very small values — check numeric equality
    expect(parseFloat(MathPlus('0.000000001', '0.000000002'))).toBe(0.000000003);
  });

  it('mixed string and number inputs', () => {
    expect(MathPlus('5', 3)).toBe('8');
    expect(MathPlus(1, 2, 3)).toBe('6');
  });

  it('single argument', () => {
    expect(MathPlus('42')).toBe('42');
  });

  it('many arguments', () => {
    expect(MathPlus('1', '2', '3', '4', '5', '6', '7', '8', '9', '10')).toBe('55');
  });

  it('crypto-realistic values', () => {
    expect(MathPlus('1823.45678901', '0.00000001')).toBe('1823.45678902');
    expect(MathPlus('0.00012345', '0.00098765')).toBe('0.0011111');
  });
});

describe('MathMinus', () => {
  it('basic subtraction', () => {
    expect(MathMinus('10', '3')).toBe('7');
    expect(MathMinus('100', '100')).toBe('0');
  });

  it('no floating point errors', () => {
    expect(MathMinus('0.3', '0.1')).toBe('0.2');
    expect(MathMinus('1.0', '0.9')).toBe('0.1');
    expect(MathMinus('100.001', '0.001')).toBe('100');
  });

  it('result goes negative', () => {
    expect(MathMinus('3', '10')).toBe('-7');
    expect(MathMinus('0', '1')).toBe('-1');
    expect(MathMinus('0.001', '0.002')).toBe('-0.001');
  });

  it('double negative', () => {
    expect(MathMinus('-5', '-3')).toBe('-2');
    expect(MathMinus('-3', '-5')).toBe('2');
  });

  it('very large subtraction', () => {
    expect(MathMinus('100000000000000000000', '1')).toBe('99999999999999999999');
  });

  it('small decimals', () => {
    expect(parseFloat(MathMinus('0.000000003', '0.000000001'))).toBe(0.000000002);
  });
});

describe('MathMultiple', () => {
  it('basic multiplication', () => {
    expect(MathMultiple('2', '3')).toBe('6');
    expect(MathMultiple('2', '3', '4')).toBe('24');
  });

  it('no floating point errors', () => {
    expect(MathMultiple('0.1', '0.2')).toBe('0.02');
    expect(MathMultiple('0.1', '0.1', '0.1')).toBe('0.001');
    expect(MathMultiple('3', '0.1')).toBe('0.3');
    expect(MathMultiple('1.1', '1.1')).toBe('1.21');
  });

  it('by zero', () => {
    expect(MathMultiple('999999', '0')).toBe('0');
    expect(MathMultiple('0', '0')).toBe('0');
  });

  it('by one', () => {
    expect(MathMultiple('12345', '1')).toBe('12345');
  });

  it('negative numbers', () => {
    expect(MathMultiple('-2', '3')).toBe('-6');
    expect(MathMultiple('-2', '-3')).toBe('6');
    expect(MathMultiple('-1', '-1', '-1')).toBe('-1');
  });

  it('large numbers', () => {
    // Result is huge — just verify it's a valid number string starting correctly
    const result = MathMultiple('99999999999', '99999999999');
    expect(result).toMatch(/^9\.9999999998/);
  });

  it('small decimals', () => {
    expect(parseFloat(MathMultiple('0.00000001', '0.00000001'))).toBe(1e-16);
  });

  it('crypto quantity * price', () => {
    // 0.05432100 * 1823.45 = 99.05162745
    expect(MathMultiple('0.05432100', '1823.45')).toBe('99.05162745');
  });

  it('single argument', () => {
    expect(MathMultiple('42')).toBe('42');
  });
});

describe('MathDivide', () => {
  it('basic division', () => {
    expect(MathDivide('10', '2')).toBe('5');
    expect(MathDivide('1', '3')).toMatch(/^0\.3333333333/);
  });

  it('exact division', () => {
    expect(MathDivide('100', '4')).toBe('25');
    expect(MathDivide('1', '8')).toBe('0.125');
  });

  it('no floating point errors', () => {
    expect(MathDivide('0.3', '0.1')).toBe('3');
    expect(MathDivide('1', '0.1')).toBe('10');
  });

  it('very small result', () => {
    expect(parseFloat(MathDivide('1', '1000000000000000000'))).toBe(1e-18);
  });

  it('negative division', () => {
    expect(MathDivide('-10', '2')).toBe('-5');
    expect(MathDivide('10', '-2')).toBe('-5');
    expect(MathDivide('-10', '-2')).toBe('5');
  });

  it('divide by zero returns Infinity', () => {
    // Decimal.js returns Infinity, doesn't throw
    expect(MathDivide('1', '0')).toBe('Infinity');
    expect(MathDivide('-1', '0')).toBe('-Infinity');
  });

  it('zero divided by anything', () => {
    expect(MathDivide('0', '999')).toBe('0');
  });

  it('crypto: USDT amount / price = quantity', () => {
    const qty = MathDivide('100', '1823.45');
    expect(parseFloat(qty)).toBeCloseTo(0.05484, 4);
  });
});

describe('MathMax', () => {
  it('basic max', () => {
    expect(MathMax('1', '3', '2')).toBe('3');
    expect(MathMax('5', '5')).toBe('5');
  });

  it('negative numbers', () => {
    expect(MathMax('-1', '-3', '-2')).toBe('-1');
    expect(MathMax('-100', '0')).toBe('0');
  });

  it('decimals', () => {
    expect(MathMax('0.001', '0.002', '0.0015')).toBe('0.002');
  });

  it('single value', () => {
    expect(MathMax('42')).toBe('42');
  });

  it('string sorting trap: 9 < 10 numerically', () => {
    expect(MathMax('9', '10')).toBe('10');
    expect(MathMax('100', '99')).toBe('100');
  });
});

describe('MathMin', () => {
  it('basic min', () => {
    expect(MathMin('1', '3', '2')).toBe('1');
  });

  it('negative numbers', () => {
    expect(MathMin('-1', '-3', '-2')).toBe('-3');
  });

  it('string sorting trap', () => {
    expect(MathMin('9', '10')).toBe('9');
    expect(MathMin('2', '10')).toBe('2');
  });
});

describe('MathFloor', () => {
  it('positive decimals', () => {
    expect(MathFloor('1.9')).toBe('1');
    expect(MathFloor('1.0001')).toBe('1');
    expect(MathFloor('1.0')).toBe('1');
  });

  it('negative decimals floor toward -infinity', () => {
    expect(MathFloor('-1.1')).toBe('-2');
    expect(MathFloor('-0.5')).toBe('-1');
    expect(MathFloor('-1.0')).toBe('-1');
  });

  it('already integer', () => {
    expect(MathFloor('5')).toBe('5');
    expect(MathFloor('0')).toBe('0');
    expect(MathFloor('-3')).toBe('-3');
  });

  it('very small decimal', () => {
    expect(MathFloor('0.000000001')).toBe('0');
  });
});

describe('MathCeil', () => {
  it('positive decimals', () => {
    expect(MathCeil('1.1')).toBe('2');
    expect(MathCeil('1.0001')).toBe('2');
    expect(MathCeil('1.0')).toBe('1');
  });

  it('negative decimals ceil toward zero', () => {
    expect(MathCeil('-1.1')).toBe('-1');
    expect(MathCeil('-0.5')).toBe('0');
  });

  it('already integer', () => {
    expect(MathCeil('5')).toBe('5');
    expect(MathCeil('0')).toBe('0');
  });
});

describe('MathAbs', () => {
  it('positive stays positive', () => {
    expect(MathAbs('5')).toBe('5');
    expect(MathAbs('0.001')).toBe('0.001');
  });

  it('negative becomes positive', () => {
    expect(MathAbs('-5')).toBe('5');
    expect(MathAbs('-0.001')).toBe('0.001');
    expect(MathAbs('-99999999999999999')).toBe('99999999999999999');
  });

  it('zero', () => {
    expect(MathAbs('0')).toBe('0');
  });
});

describe('MathGt', () => {
  it('basic comparison', () => {
    expect(MathGt('2', '1')).toBe(true);
    expect(MathGt('1', '2')).toBe(false);
    expect(MathGt('1', '1')).toBe(false);
  });

  it('decimal precision', () => {
    expect(MathGt('0.10000000001', '0.1')).toBe(true);
    expect(MathGt('0.1', '0.10000000001')).toBe(false);
  });

  it('negative numbers', () => {
    expect(MathGt('-1', '-2')).toBe(true);
    expect(MathGt('-2', '-1')).toBe(false);
  });

  it('string sorting trap: "9" > "10" as string but 9 < 10 as number', () => {
    expect(MathGt('9', '10')).toBe(false);
    expect(MathGt('10', '9')).toBe(true);
  });
});

describe('MathLt', () => {
  it('basic', () => {
    expect(MathLt('1', '2')).toBe(true);
    expect(MathLt('2', '1')).toBe(false);
    expect(MathLt('1', '1')).toBe(false);
  });

  it('decimal precision', () => {
    expect(MathLt('0.1', '0.10000000001')).toBe(true);
  });

  it('negative', () => {
    expect(MathLt('-2', '-1')).toBe(true);
  });
});

describe('MathGte', () => {
  it('basic', () => {
    expect(MathGte('2', '1')).toBe(true);
    expect(MathGte('1', '1')).toBe(true);
    expect(MathGte('0', '1')).toBe(false);
  });
});

describe('MathLte', () => {
  it('basic', () => {
    expect(MathLte('1', '2')).toBe(true);
    expect(MathLte('1', '1')).toBe(true);
    expect(MathLte('2', '1')).toBe(false);
  });
});

describe('MathRound', () => {
  it('basic rounding', () => {
    expect(MathRound('1.23456', 2)).toBe('1.23');
    expect(MathRound('1.235', 2)).toBe('1.24');
    expect(MathRound('1.225', 2)).toBe('1.23'); // banker's rounding
  });

  it('round to 0 decimal places', () => {
    expect(MathRound('1.5', 0)).toBe('2');
    expect(MathRound('2.4', 0)).toBe('2');
  });

  it('round to 8 decimals (crypto standard)', () => {
    expect(MathRound('0.123456789123', 8)).toBe('0.12345679');
  });

  it('negative numbers', () => {
    expect(MathRound('-1.235', 2)).toBe('-1.24');
    expect(MathRound('-0.005', 2)).toBe('-0.01');
  });

  it('already fewer decimals than requested', () => {
    expect(MathRound('1.5', 4)).toBe('1.5');
    expect(MathRound('100', 2)).toBe('100');
  });

  it('very precise rounding', () => {
    // Decimal.js may return exponential — check numeric value
    expect(parseFloat(MathRound('0.000000015', 8))).toBe(0.00000002);
    expect(parseFloat(MathRound('0.000000014', 8))).toBe(0.00000001);
  });
});

describe('cross-function consistency', () => {
  it('a + b - b = a', () => {
    const a = '1823.45678901';
    const b = '999.99999999';
    expect(MathMinus(MathPlus(a, b), b)).toBe(a);
  });

  it('a * b / b = a', () => {
    const a = '12345.6789';
    const b = '98765.4321';
    expect(MathDivide(MathMultiple(a, b), b)).toBe(a);
  });

  it('max(a,b) >= min(a,b)', () => {
    const a = '-0.00001';
    const b = '0.00001';
    expect(MathGte(MathMax(a, b), MathMin(a, b))).toBe(true);
  });

  it('abs(a - b) = abs(b - a)', () => {
    expect(MathAbs(MathMinus('10', '3'))).toBe(MathAbs(MathMinus('3', '10')));
  });

  it('profit calculation: (sell - buy) * qty - commission', () => {
    const buy = '1800.50';
    const sell = '1836.51';
    const qty = '0.05432100';
    const commission = MathPlus(
      MathMultiple(buy, qty, '0.001'),
      MathMultiple(sell, qty, '0.001'),
    );
    const grossProfit = MathMultiple(MathMinus(sell, buy), qty);
    const netProfit = MathMinus(grossProfit, commission);

    // Verify manually: (1836.51 - 1800.50) * 0.054321 = 36.01 * 0.054321 = 1.95611721
    // Commission: (1800.50*0.054321*0.001) + (1836.51*0.054321*0.001) = 0.09780... + 0.09976... = 0.19756...
    // Net: 1.95611721 - 0.19756... ≈ 1.758...
    expect(parseFloat(netProfit)).toBeCloseTo(1.758, 2);
    expect(MathGt(grossProfit, '0')).toBe(true);
    expect(MathGt(netProfit, '0')).toBe(true);
    expect(MathLt(netProfit, grossProfit)).toBe(true);
  });
});
