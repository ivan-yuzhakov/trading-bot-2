export interface MoneyManagementConfig {
  mode: 'fixed' | 'percentage';
  amount: string;
  maxConcurrentTrades: number;
  maxExposurePerPair: string;
  dailyLossLimit: string;
}
