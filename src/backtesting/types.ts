import type { AnalyzerConfig, MoneyManagementConfig } from '../entity/Strategy.js';

export interface BacktestConfig {
  strategyId: number;
  startDate: number;
  endDate: number;
  initialBalance: string;
}

/** Config for running backtest without a DB-stored strategy. */
export interface BacktestDirectConfig {
  startDate: number;
  endDate: number;
  initialBalance: string;
}

/** Plain strategy object (no TypeORM decorators) for direct backtest runs. */
export interface StrategyParams {
  pair: string;
  exchange: string;
  analyzers: AnalyzerConfig[];
  buy_threshold: string;
  sell_threshold: string;
  stop_loss_pct: string | null;
  money_management: MoneyManagementConfig;
}

export interface BacktestTrade {
  entryPrice: string;
  exitPrice: string;
  entryTime: number;
  exitTime: number;
  quantity: string;
  profit: string;
  profitPct: string;
  commission: string;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  totalProfit: string;
  winRate: string;
  maxDrawdown: string;
  totalTrades: number;
  equityCurve: Array<{ time: number; equity: string }>;
  candles: Array<{ t: number; o: string; h: string; l: string; c: string }>;
}
