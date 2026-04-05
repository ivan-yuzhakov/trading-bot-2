import { Decimal } from 'decimal.js';
import { Mutex } from 'async-mutex';
import type { App } from '../app/App.js';
import type { ExchangeAdapter } from '../exchange/ExchangeAdapter.js';
import type { CandleManager } from '../candles/CandleManager.js';
import type { Candle, Timeframe } from '../candles/types.js';
import { Analyzer } from '../analyzers/Analyzer.js';
import { RsiAnalyzer } from '../analyzers/RsiAnalyzer.js';
import { BollingerAnalyzer } from '../analyzers/BollingerAnalyzer.js';
import { MaCrossAnalyzer } from '../analyzers/MaCrossAnalyzer.js';
import { MacdAnalyzer } from '../analyzers/MacdAnalyzer.js';
import { VolumeAnalyzer } from '../analyzers/VolumeAnalyzer.js';
import { ProfitTargetAnalyzer } from '../analyzers/ProfitTargetAnalyzer.js';
import { StopLossAnalyzer } from '../analyzers/StopLossAnalyzer.js';
import { NewsAnalyzer } from '../analyzers/NewsAnalyzer.js';
import { SignalAggregator, type WeightedAnalyzer } from './SignalAggregator.js';
import { MoneyManager } from './MoneyManager.js';
import type { ActiveTrade } from '../analyzers/types.js';
import { Strategy, type AnalyzerConfig } from '../entity/Strategy.js';
import { Trade } from '../entity/Trade.js';
import { TradeStep } from '../entity/TradeStep.js';

export class PairRunner {
  #app: App;
  #exchange: ExchangeAdapter;
  #candleManager: CandleManager;
  #strategy: Strategy;
  #analyzers: WeightedAnalyzer[] = [];
  #signalAggregator: SignalAggregator;
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
    this.#signalAggregator = new SignalAggregator();
    this.#moneyManager = moneyManager;
  }

  get strategy(): Strategy { return this.#strategy; }
  get activeTrade(): ActiveTrade | null { return this.#activeTrade; }
  get running(): boolean { return this.#running; }

  async init(): Promise<void> {
    // Instantiate analyzers from strategy config
    for (const ac of this.#strategy.analyzers) {
      const analyzer = this.#createAnalyzer(ac);
      if (analyzer) {
        this.#analyzers.push({ analyzer, weight: ac.weight });

        // Start NewsAnalyzer background job
        if (analyzer instanceof NewsAnalyzer) {
          this.#newsAnalyzer = analyzer;
          await analyzer.start(this.#strategy.pair);
        }
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

    // Listen for closed candles
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

    if (closePosition && this.#activeTrade) {
      await this.#closePosition('Manual stop');
    }

    if (this.#newsAnalyzer) {
      this.#newsAnalyzer.stop();
    }

    this.#app.logger.log(`[PairRunner] ${this.#strategy.pair}: stopped`);
  }

  /** Handle order fill events from exchange */
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

      // If sell step filled, close the trade
      if (step.side === 'SELL' && status === 'FILLED') {
        const tradeRepo = this.#app.db.getRepository(Trade);
        const trade = await tradeRepo.findOne({ where: { id: step.trade_id }, relations: ['steps'] });
        if (trade) {
          trade.status = 'closed';
          trade.exit_price = step.price;
          trade.closed_at = new Date().toISOString().slice(0, 19).replace('T', ' ');

          if (trade.entry_price) {
            // Sum commissions from all steps
            let totalCommission = new Decimal(0);
            for (const s of trade.steps || []) {
              if (s.commission) totalCommission = totalCommission.plus(s.commission);
            }

            const profit = new Decimal(step.price).minus(trade.entry_price)
              .times(trade.quantity).minus(totalCommission);
            const profitPct = new Decimal(step.price).minus(trade.entry_price)
              .dividedBy(trade.entry_price).times(100);
            trade.profit = profit.toDecimalPlaces(8).toString();
            trade.profit_pct = profitPct.toDecimalPlaces(4).toString();
          }

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
      // Get candles for analysis
      const candles = await this.#candleManager.getCandles(this.#exchange.name, this.#strategy.pair, '5m', 200);
      if (candles.length < 50) return; // Not enough data

      const currentPrice = candles[candles.length - 1].c;

      // Run signal aggregation
      const result = this.#signalAggregator.aggregate(this.#analyzers, candles, currentPrice, this.#activeTrade || undefined);

      const buyThreshold = new Decimal(this.#strategy.buy_threshold);
      const sellThreshold = new Decimal(this.#strategy.sell_threshold);
      const totalBuy = new Decimal(result.totalBuyWeight);
      const totalSell = new Decimal(result.totalSellWeight);

      // Decision
      if (!this.#activeTrade && totalBuy.greaterThanOrEqualTo(buyThreshold)) {
        await this.#openPosition(currentPrice, result);
      } else if (this.#activeTrade && totalSell.greaterThanOrEqualTo(sellThreshold)) {
        await this.#closePosition(`Sell signal: ${result.totalSellWeight}`);
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

    // Get balance
    const balances = await this.#exchange.getBalance();
    const usdtBalance = balances.find((b) => b.asset === 'USDT');
    if (!usdtBalance) return;

    const quantity = this.#moneyManager.calculateQuantity(usdtBalance.free, price, mm);
    if (new Decimal(quantity).lessThanOrEqualTo(0)) return;

    // Place buy order
    const order = await this.#exchange.placeOrder(this.#strategy.pair, 'BUY', price, quantity);
    if (!order) return;

    // Save trade + step to DB in a single transaction
    const savedTrade = await this.#app.db.transaction(async (manager) => {
      const trade = manager.create(Trade, {
        strategy_id: this.#strategy.id,
        pair: this.#strategy.pair,
        exchange: this.#exchange.name,
        status: 'open' as const,
        entry_price: price,
        quantity,
        stop_loss_price: this.#strategy.stop_loss_pct ? this.#calculateStopLoss(price) : null,
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

    // Dev mode auto-fill BUY
    if (order.orderId === '-1') {
      await this.onOrderFill('-1', 'FILLED');
    }

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

    // If dev mode (orderId=-1), simulate fill immediately
    if (order.orderId === '-1') {
      await this.onOrderFill('-1', 'FILLED');
    }

    this.#app.logger.log(`[PairRunner] ${this.#strategy.pair}: closing trade #${this.#activeTrade.id} SELL @ ${currentPrice}. Reason: ${reason}`);
  }

  #calculateStopLoss(entryPrice: string): string {
    const pct = new Decimal(this.#strategy.stop_loss_pct!);
    return new Decimal(entryPrice).times(new Decimal(1).minus(pct.dividedBy(100))).toDecimalPlaces(8).toString();
  }

  #createAnalyzer(config: AnalyzerConfig): Analyzer | null {
    const c = config.config;
    switch (config.name) {
      case 'rsi': return new RsiAnalyzer(this.#app, c);
      case 'bollinger': return new BollingerAnalyzer(this.#app, c);
      case 'ma_cross': return new MaCrossAnalyzer(this.#app, c);
      case 'macd': return new MacdAnalyzer(this.#app, c);
      case 'volume': return new VolumeAnalyzer(this.#app, c);
      case 'profit_target': return new ProfitTargetAnalyzer(this.#app, c);
      case 'stop_loss': return new StopLossAnalyzer(this.#app, c);
      case 'news': return new NewsAnalyzer(this.#app, c);
      default:
        this.#app.logger.error(`[PairRunner] Unknown analyzer: ${config.name}`);
        return null;
    }
  }
}
