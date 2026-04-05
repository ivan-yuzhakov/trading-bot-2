export interface BacktestConfig {
  strategyId: number;
  startDate: number;
  endDate: number;
  initialBalance: string;
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
