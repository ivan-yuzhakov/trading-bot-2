export interface IndicatorResult {
  name: string;
  values: Record<string, string>;
  timestamp: number;
}

export interface IndicatorConfig {
  [key: string]: unknown;
}
