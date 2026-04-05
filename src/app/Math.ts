import { Decimal } from 'decimal.js';

type Num = string | number | Decimal;

export function MathPlus(...nums: Num[]): string {
  return nums.reduce<Decimal>((sum, n) => sum.plus(n), new Decimal(0)).toString();
}

export function MathMinus(a: Num, b: Num): string {
  return new Decimal(a).minus(b).toString();
}

export function MathMultiple(...nums: Num[]): string {
  return nums.reduce<Decimal>((prod, n) => prod.times(n), new Decimal(1)).toString();
}

export function MathDivide(a: Num, b: Num): string {
  return new Decimal(a).dividedBy(b).toString();
}

export function MathMax(...nums: Num[]): string {
  return Decimal.max(...nums.map(n => new Decimal(n))).toString();
}

export function MathMin(...nums: Num[]): string {
  return Decimal.min(...nums.map(n => new Decimal(n))).toString();
}

export function MathFloor(n: Num): string {
  return new Decimal(n).floor().toString();
}

export function MathCeil(n: Num): string {
  return new Decimal(n).ceil().toString();
}

export function MathAbs(n: Num): string {
  return new Decimal(n).abs().toString();
}

export function MathGt(a: Num, b: Num): boolean {
  return new Decimal(a).greaterThan(b);
}

export function MathLt(a: Num, b: Num): boolean {
  return new Decimal(a).lessThan(b);
}

export function MathGte(a: Num, b: Num): boolean {
  return new Decimal(a).greaterThanOrEqualTo(b);
}

export function MathLte(a: Num, b: Num): boolean {
  return new Decimal(a).lessThanOrEqualTo(b);
}

export function MathRound(n: Num, dp: number): string {
  return new Decimal(n).toDecimalPlaces(dp).toString();
}
