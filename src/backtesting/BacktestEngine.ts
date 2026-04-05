import { Decimal } from 'decimal.js';
import type { App } from '../app/App.js';
import type { BacktestConfig, BacktestResult, BacktestTrade } from './types.js';
import type { Candle } from '../candles/types.js';
import type { WeightedAnalyzer } from '../trading/SignalAggregator.js';
import { SignalAggregator } from '../trading/SignalAggregator.js';
import { Strategy, type AnalyzerConfig } from '../entity/Strategy.js';
import { Analyzer } from '../analyzers/Analyzer.js';
import { RsiAnalyzer } from '../analyzers/RsiAnalyzer.js';
import { BollingerAnalyzer } from '../analyzers/BollingerAnalyzer.js';
import { MaCrossAnalyzer } from '../analyzers/MaCrossAnalyzer.js';
import { MacdAnalyzer } from '../analyzers/MacdAnalyzer.js';
import { VolumeAnalyzer } from '../analyzers/VolumeAnalyzer.js';
import { ProfitTargetAnalyzer } from '../analyzers/ProfitTargetAnalyzer.js';
import { StopLossAnalyzer } from '../analyzers/StopLossAnalyzer.js';
import type { ActiveTrade } from '../analyzers/types.js';

const COMMISSION_RATE = new Decimal('0.001'); // 0.1% per trade

export class BacktestEngine {
  #app: App;

  constructor(app: App) {
    this.#app = app;
  }

  async run(config: BacktestConfig): Promise<BacktestResult> {
    // Load strategy
    const strategyRepo = this.#app.db.getRepository(Strategy);
    const strategy = await strategyRepo.findOneByOrFail({ id: config.strategyId });

    // Load candles from Redis
    const candles = await this.#app.tradeManager.candleManager.store.get(
      strategy.exchange, strategy.pair, config.startDate, config.endDate,
    );

    if (candles.length < 50) {
      throw new Error(`Not enough candles for backtest (${candles.length}). Need at least 50.`);
    }

    // Setup analyzers (skip those that don't support backtest)
    const analyzers: WeightedAnalyzer[] = [];
    for (const ac of strategy.analyzers) {
      const analyzer = this.#createAnalyzer(ac);
      if (analyzer && analyzer.supportsBacktest) {
        analyzers.push({ analyzer, weight: ac.weight });
      }
    }

    const signalAggregator = new SignalAggregator();
    const mmConfig = strategy.money_management;

    // Simulation state
    let balance = new Decimal(config.initialBalance);
    let peakBalance = balance;
    let maxDrawdown = new Decimal(0);
    let activeTrade: { entryPrice: Decimal; entryTime: number; quantity: Decimal } | null = null;
    const trades: BacktestTrade[] = [];
    const equityCurve: BacktestResult['equityCurve'] = [];

    const buyThreshold = new Decimal(strategy.buy_threshold);
    const sellThreshold = new Decimal(strategy.sell_threshold);

    // Walk through candles one by one
    const lookback = 200;

    for (let i = lookback; i < candles.length; i++) {
      const window = candles.slice(Math.max(0, i - lookback), i + 1);
      const currentCandle = candles[i];
      const currentPrice = currentCandle.c;

      // Build ActiveTrade for analyzers
      const activeTradeForAnalyzer: ActiveTrade | undefined = activeTrade ? {
        id: 0,
        entryPrice: activeTrade.entryPrice.toString(),
        quantity: activeTrade.quantity.toString(),
      } : undefined;

      // Run signals
      const result = signalAggregator.aggregate(analyzers, window, currentPrice, activeTradeForAnalyzer);
      const totalBuy = new Decimal(result.totalBuyWeight);
      const totalSell = new Decimal(result.totalSellWeight);

      // Decision
      if (!activeTrade && totalBuy.greaterThanOrEqualTo(buyThreshold)) {
        // BUY
        let amount: Decimal;
        if (mmConfig.mode === 'percentage') {
          amount = balance.times(mmConfig.amount).dividedBy(100);
        } else {
          amount = Decimal.min(new Decimal(mmConfig.amount), balance);
        }

        const commission = amount.times(COMMISSION_RATE);
        const netAmount = amount.minus(commission);
        const quantity = netAmount.dividedBy(currentPrice);

        balance = balance.minus(amount);
        activeTrade = {
          entryPrice: new Decimal(currentPrice),
          entryTime: currentCandle.t,
          quantity,
        };
      } else if (activeTrade && totalSell.greaterThanOrEqualTo(sellThreshold)) {
        // SELL
        const sellValue = activeTrade.quantity.times(currentPrice);
        const commission = sellValue.times(COMMISSION_RATE);
        const netSellValue = sellValue.minus(commission);
        const totalCommission = activeTrade.entryPrice.times(activeTrade.quantity).times(COMMISSION_RATE).plus(commission);

        const profit = new Decimal(currentPrice).minus(activeTrade.entryPrice).times(activeTrade.quantity).minus(totalCommission);
        const profitPct = new Decimal(currentPrice).minus(activeTrade.entryPrice).dividedBy(activeTrade.entryPrice).times(100);

        balance = balance.plus(netSellValue);

        trades.push({
          entryPrice: activeTrade.entryPrice.toString(),
          exitPrice: currentPrice,
          entryTime: activeTrade.entryTime,
          exitTime: currentCandle.t,
          quantity: activeTrade.quantity.toDecimalPlaces(8).toString(),
          profit: profit.toDecimalPlaces(8).toString(),
          profitPct: profitPct.toDecimalPlaces(4).toString(),
          commission: totalCommission.toDecimalPlaces(8).toString(),
        });

        activeTrade = null;
      }

      // Track equity
      const equity = activeTrade
        ? balance.plus(activeTrade.quantity.times(currentPrice))
        : balance;

      if (equity.greaterThan(peakBalance)) peakBalance = equity;
      const drawdown = peakBalance.isZero() ? new Decimal(0) : peakBalance.minus(equity).dividedBy(peakBalance).times(100);
      if (drawdown.greaterThan(maxDrawdown)) maxDrawdown = drawdown;

      // Record equity curve every 12 candles (1 hour)
      if (i % 12 === 0) {
        equityCurve.push({ time: currentCandle.t, equity: equity.toDecimalPlaces(2).toString() });
      }
    }

    // Calculate totals
    let totalProfit = new Decimal(0);
    let wins = 0;
    for (const t of trades) {
      totalProfit = totalProfit.plus(t.profit);
      if (new Decimal(t.profit).greaterThan(0)) wins++;
    }

    return {
      trades,
      totalProfit: totalProfit.toDecimalPlaces(8).toString(),
      winRate: trades.length > 0 ? (wins / trades.length * 100).toFixed(2) : '0',
      maxDrawdown: maxDrawdown.toDecimalPlaces(2).toString(),
      totalTrades: trades.length,
      equityCurve,
      candles: candles.map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })),
    };
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
      // news analyzer skipped — supportsBacktest = false
      default: return null;
    }
  }
}
