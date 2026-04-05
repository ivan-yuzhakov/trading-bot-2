import type { Candle } from '../candles/types.js';
import type { IndicatorResult, IndicatorConfig } from './types.js';

export abstract class Indicator {
  #config: IndicatorConfig;

  constructor(config: IndicatorConfig) {
    this.#config = config;
  }

  get config(): IndicatorConfig {
    return this.#config;
  }

  abstract calculate(candles: Candle[]): IndicatorResult;
}
