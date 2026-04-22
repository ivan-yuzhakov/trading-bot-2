import type { BacktestResult } from '../backtesting/types.js';

export interface ParamRange {
  from: number;
  to: number;
  step: number;
}

export interface OptimizationConfig {
  name: string;
  backtest: {
    startDate: string;
    endDate: string;
    initialBalance: string;
  };
  strategy: Record<string, unknown>;
}

export interface RangeInfo {
  path: string;
  values: number[];
}

export interface VariantParams {
  [path: string]: number;
}

export interface VariantResult {
  variantIndex: number;
  params: VariantParams;
  result: BacktestResult;
}
