import type { App } from '../app/App.js';
import { ExchangeAdapter } from '../exchange/ExchangeAdapter.js';
import { BinanceAdapter } from '../exchange/BinanceAdapter.js';
import { BybitAdapter } from '../exchange/BybitAdapter.js';
import { CandleManager } from '../candles/CandleManager.js';
import { PairRunner } from './PairRunner.js';
import { MoneyManager } from './MoneyManager.js';
import { Strategy } from '../entity/Strategy.js';
import type { ExchangeOrder } from '../exchange/types.js';

export class TradeManager {
  #app: App;
  #exchanges: Map<string, ExchangeAdapter> = new Map();
  #runners: Map<number, PairRunner> = new Map();
  #candleManager: CandleManager;
  #moneyManager: MoneyManager;

  constructor(app: App) {
    this.#app = app;
    this.#candleManager = new CandleManager(app);
    this.#moneyManager = new MoneyManager(app);
  }

  get candleManager(): CandleManager { return this.#candleManager; }
  get runners(): Map<number, PairRunner> { return this.#runners; }
  get exchanges(): Map<string, ExchangeAdapter> { return this.#exchanges; }

  async init(): Promise<void> {
    // Initialize exchange adapters
    const binance = new BinanceAdapter(this.#app);
    this.#exchanges.set('binance', binance);

    const bybit = new BybitAdapter(this.#app);
    this.#exchanges.set('bybit', bybit);

    // Only init exchanges with API keys configured
    if (this.#app.config.binance.apiKey) {
      await binance.init();

      // Connect user stream for order updates
      await binance.connectUserStream((order: ExchangeOrder) => {
        this.#onOrderUpdate(order);
      });
    }

    await bybit.init();

    // Load active strategies and start PairRunners
    const strategyRepo = this.#app.db.getRepository(Strategy);
    const strategies = await strategyRepo.find({ where: { active: 1 } });

    for (const strategy of strategies) {
      await this.startPair(strategy);
    }

    this.#app.logger.log(`[TradeManager] initialized with ${strategies.length} active strategies`);
  }

  async startPair(strategy: Strategy): Promise<void> {
    if (this.#runners.has(strategy.id)) {
      this.#app.logger.log(`[TradeManager] Strategy #${strategy.id} already running`);
      return;
    }

    const exchange = this.#exchanges.get(strategy.exchange);
    if (!exchange) {
      this.#app.logger.error(`[TradeManager] Unknown exchange: ${strategy.exchange}`);
      return;
    }

    // Init candle system for this pair (blocks until history is synced)
    await this.#candleManager.initPair(exchange, strategy.pair);

    // Create and start PairRunner
    const runner = new PairRunner(this.#app, exchange, this.#candleManager, strategy, this.#moneyManager);
    await runner.init();
    await runner.start();

    this.#runners.set(strategy.id, runner);
  }

  async stopPair(strategyId: number, closePosition: boolean = false): Promise<void> {
    const runner = this.#runners.get(strategyId);
    if (!runner) return;

    const exchange = this.#exchanges.get(runner.strategy.exchange);
    if (exchange) {
      await this.#candleManager.stopPair(exchange, runner.strategy.pair);
    }

    await runner.stop(closePosition);
    this.#runners.delete(strategyId);
  }

  getExchange(name: string): ExchangeAdapter | undefined {
    return this.#exchanges.get(name);
  }

  #onOrderUpdate(order: ExchangeOrder): void {
    // Route order update to the correct PairRunner
    for (const [_, runner] of this.#runners) {
      if (runner.strategy.pair === order.symbol) {
        runner.onOrderFill(order.orderId, order.status, order.commission, order.commissionAsset).catch((e) => {
          this.#app.logger.error(`[TradeManager] Order fill error: ${e}`);
        });
      }
    }
  }

  /** Graceful shutdown */
  async shutdown(): Promise<void> {
    this.#app.logger.log('[TradeManager] Shutting down...');
    for (const [id, runner] of this.#runners) {
      await runner.stop(false);
    }
    this.#runners.clear();
  }
}
