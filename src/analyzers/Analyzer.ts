import type { App } from '../app/App.js';
import type { Candle } from '../candles/types.js';
import type { Signal, AnalyzerConfig, ActiveTrade } from './types.js';

export abstract class Analyzer {
  protected app: App;
  protected config: AnalyzerConfig;
  readonly name: string;

  constructor(app: App, name: string, config: AnalyzerConfig) {
    this.app = app;
    this.name = name;
    this.config = config;
  }

  abstract analyze(candles: Candle[], currentPrice: string, trade?: ActiveTrade): Signal;

  /** Whether this analyzer can work in backtest mode */
  get supportsBacktest(): boolean {
    return true;
  }
}
