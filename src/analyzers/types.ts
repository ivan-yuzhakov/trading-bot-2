export interface Signal {
  action: 'buy' | 'sell' | 'hold';
  weight: string;
  reason: string;
}

export interface AnalyzerConfig {
  [key: string]: unknown;
}

export interface ActiveTrade {
  id: number;
  entryPrice: string;
  quantity: string;
  stopLossPrice?: string;
}

export interface AggregatedSignal {
  totalBuyWeight: string;
  totalSellWeight: string;
  signals: Array<{ analyzerName: string; signal: Signal }>;
}
