import { Decimal } from 'decimal.js';
import { Mutex } from 'async-mutex';
import type { App } from '../app/App.js';
import type { ExchangeAdapter } from '../exchange/ExchangeAdapter.js';
import type { CandleManager } from '../candles/CandleManager.js';
import type { Candle, Timeframe } from '../candles/types.js';
import { NewsAnalyzer } from '../analyzers/NewsAnalyzer.js';
import { TradingCore } from './TradingCore.js';
import type { WeightedAnalyzer } from './SignalAggregator.js';
import { MoneyManager } from './MoneyManager.js';
import type { ActiveTrade } from '../analyzers/types.js';
import { Strategy } from '../entity/Strategy.js';
import { Trade } from '../entity/Trade.js';
import { TradeStep } from '../entity/TradeStep.js';

export class PairRunner {
  #app: App;
  #exchange: ExchangeAdapter;
  #candleManager: CandleManager;
  #strategy: Strategy;
  #core: TradingCore;
  #analyzers: (WeightedAnalyzer & { timeframe: Timeframe })[] = [];
  #moneyManager: MoneyManager;
  #mutex = new Mutex();
  #activeTrade: ActiveTrade | null = null;
  #running = false;
  #newsAnalyzer: NewsAnalyzer | null = null;

  constructor(app: App, exchange: ExchangeAdapter, candleManager: CandleManager, strategy: Strategy, moneyManager: MoneyManager) {
    this.#app = app;
    this.#exchange = exchange;
    this.#candleManager = candleManager;
    this.#strategy = strategy;
    this.#core = new TradingCore();
    this.#moneyManager = moneyManager;
  }

  get strategy(): Strategy { return this.#strategy; }
  get activeTrade(): ActiveTrade | null { return this.#activeTrade; }
  get running(): boolean { return this.#running; }

  async init(): Promise<void> {
    this.#analyzers = this.#core.createAnalyzers(this.#app, this.#strategy, false);

    // Start NewsAnalyzer background job if present
    for (const a of this.#analyzers) {
      if (a.analyzer instanceof NewsAnalyzer) {
        this.#newsAnalyzer = a.analyzer;
        await a.analyzer.start(this.#strategy.pair);
      }
    }

    // Recover active trade from DB
    const tradeRepo = this.#app.db.getRepository(Trade);
    const openTrade = await tradeRepo.findOne({
      where: { strategy_id: this.#strategy.id, status: 'open' },
      relations: ['steps'],
    });

    if (openTrade && openTrade.entry_price) {
      this.#activeTrade = {
        id: openTrade.id,
        entryPrice: openTrade.entry_price,
        quantity: openTrade.quantity,
        stopLossPrice: openTrade.stop_loss_price || undefined,
      };
      this.#app.logger.log(`[PairRunner] ${this.#strategy.pair}: recovered open trade #${openTrade.id}`);
    }
  }

  async start(): Promise<void> {
    this.#running = true;

    this.#candleManager.on('candle:closed', (event: { exchange: string; pair: string; candle: Candle; tf: Timeframe }) => {
      if (event.exchange === this.#exchange.name && event.pair === this.#strategy.pair) {
        this.#onCandleClosed().catch((e) => {
          this.#app.logger.error(`[PairRunner] ${this.#strategy.pair} error: ${e}`);
        });
      }
    });

    this.#app.logger.log(`[PairRunner] ${this.#strategy.pair}: started`);
  }

  async stop(closePosition: boolean = false): Promise<void> {
    this.#running = false;
    if (closePosition && this.#activeTrade) await this.#closePosition('Manual stop');
    if (this.#newsAnalyzer) this.#newsAnalyzer.stop();
    this.#app.logger.log(`[PairRunner] ${this.#strategy.pair}: stopped`);
  }

  async onOrderFill(orderId: string, status: string, commission?: string, commissionAsset?: string): Promise<void> {
    await this.#mutex.runExclusive(async () => {
      const stepRepo = this.#app.db.getRepository(TradeStep);
      const step = await stepRepo.findOne({ where: { exchange_order_id: orderId } });
      if (!step) return;

      step.status = status === 'FILLED' ? 'filled' : status === 'CANCELED' ? 'cancelled' : step.status;
      if (commission) step.commission = commission;
      if (commissionAsset) step.commission_asset = commissionAsset;
      if (status === 'FILLED') step.filled_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await stepRepo.save(step);

      if (step.side === 'SELL' && status === 'FILLED') {
        const tradeRepo = this.#app.db.getRepository(Trade);
        const trade = await tradeRepo.findOne({ where: { id: step.trade_id }, relations: ['steps'] });
        if (trade && trade.entry_price) {
          trade.status = 'closed';
          trade.exit_price = step.price;
          trade.closed_at = new Date().toISOString().slice(0, 19).replace('T', ' ');

          const stepCommissions = (trade.steps || []).map(s => s.commission).filter(Boolean) as string[];
          const { profit, profitPct } = this.#core.calculateProfit(trade.entry_price, step.price, trade.quantity, stepCommissions);
          trade.profit = profit;
          trade.profit_pct = profitPct;

          await tradeRepo.save(trade);
          this.#activeTrade = null;
          this.#app.logger.log(`[PairRunner] ${this.#strategy.pair}: trade #${trade.id} closed. Profit: ${trade.profit}`);
        }
      }
    });
  }

  async #onCandleClosed(): Promise<void> {
    if (!this.#running) return;

    await this.#mutex.runExclusive(async () => {
      const requiredLookback = this.#core.calculateLookback(this.#analyzers);
      const baseCandles = await this.#candleManager.getCandles(this.#exchange.name, this.#strategy.pair, '5m', requiredLookback);
      if (baseCandles.length < requiredLookback / 4) return;

      const currentPrice = baseCandles[baseCandles.length - 1].c;

      const decision = this.#core.evaluate(
        this.#analyzers, baseCandles, currentPrice,
        this.#activeTrade || undefined,
        this.#strategy.buy_threshold, this.#strategy.sell_threshold,
      );

      if (decision.action === 'buy') {
        await this.#openPosition(currentPrice, decision.signal);
      } else if (decision.action === 'sell') {
        await this.#closePosition(`Sell signal: ${decision.signal.totalSellWeight}`);
      }
    });
  }

  async #openPosition(price: string, signalResult: any): Promise<void> {
    const mm = this.#strategy.money_management;
    const check = await this.#moneyManager.canOpenTrade(this.#strategy.id, mm);
    if (!check.allowed) {
      this.#app.logger.log(`[PairRunner] ${this.#strategy.pair}: cannot open trade — ${check.reason}`);
      return;
    }

    const balances = await this.#exchange.getBalance();
    const usdtBalance = balances.find((b) => b.asset === 'USDT');
    if (!usdtBalance) return;

    const { quantity } = this.#core.calculatePositionSize(usdtBalance.free, price, mm);
    if (new Decimal(quantity).lessThanOrEqualTo(0)) return;

    const order = await this.#exchange.placeOrder(this.#strategy.pair, 'BUY', price, quantity);
    if (!order) return;

    const savedTrade = await this.#app.db.transaction(async (manager) => {
      const trade = manager.create(Trade, {
        strategy_id: this.#strategy.id,
        pair: this.#strategy.pair,
        exchange: this.#exchange.name,
        status: 'open' as const,
        entry_price: price,
        quantity,
        stop_loss_price: this.#strategy.stop_loss_pct ? this.#core.calculateStopLoss(price, this.#strategy.stop_loss_pct) : null,
        signal_snapshot: signalResult,
      });
      const saved = await manager.save(Trade, trade);

      const step = manager.create(TradeStep, {
        trade_id: saved.id,
        side: 'BUY' as const,
        price,
        quantity,
        exchange_order_id: order.orderId,
        status: order.status === 'FILLED' ? 'filled' as const : 'pending' as const,
      });
      await manager.save(TradeStep, step);
      return saved;
    });

    this.#activeTrade = {
      id: savedTrade.id,
      entryPrice: price,
      quantity,
      stopLossPrice: savedTrade.stop_loss_price || undefined,
    };

    if (order.orderId === '-1') await this.onOrderFill('-1', 'FILLED');

    this.#app.logger.log(`[PairRunner] ${this.#strategy.pair}: opened trade #${savedTrade.id} BUY @ ${price} qty ${quantity}`);
  }

  async #closePosition(reason: string): Promise<void> {
    if (!this.#activeTrade) return;

    const candles = await this.#candleManager.getCandles(this.#exchange.name, this.#strategy.pair, '5m', 1);
    const currentPrice = candles[candles.length - 1]?.c || '0';

    const order = await this.#exchange.placeOrder(this.#strategy.pair, 'SELL', currentPrice, this.#activeTrade.quantity);
    if (!order) return;

    const stepRepo = this.#app.db.getRepository(TradeStep);
    const step = stepRepo.create({
      trade_id: this.#activeTrade.id,
      side: 'SELL',
      price: currentPrice,
      quantity: this.#activeTrade.quantity,
      exchange_order_id: order.orderId,
      status: order.status === 'FILLED' ? 'filled' : 'pending',
    });
    await stepRepo.save(step);

    if (order.orderId === '-1') await this.onOrderFill('-1', 'FILLED');

    this.#app.logger.log(`[PairRunner] ${this.#strategy.pair}: closing trade #${this.#activeTrade.id} SELL @ ${currentPrice}. Reason: ${reason}`);
  }
}
