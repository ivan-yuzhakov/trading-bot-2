import { Decimal } from 'decimal.js';
import type { App } from '../app/App.js';
import type { BacktestConfig, BacktestResult, BacktestTrade } from './types.js';
import type { Timeframe } from '../candles/types.js';
import { CandleAggregator } from '../candles/CandleAggregator.js';
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

    // Ensure candles are loaded for the requested range
    await this.#ensureCandles(strategy.exchange, strategy.pair, config.startDate, config.endDate);

    const candles = await this.#app.tradeManager.candleManager.store.get(
      strategy.exchange, strategy.pair, config.startDate, config.endDate,
    );

    if (candles.length < 50) {
      throw new Error(`Not enough candles for backtest (${candles.length}). Need at least 50.`);
    }

    // Setup analyzers (skip those that don't support backtest)
    const analyzers: (WeightedAnalyzer & { timeframe: Timeframe })[] = [];
    for (const ac of strategy.analyzers) {
      const analyzer = this.#createAnalyzer(ac);
      if (analyzer && analyzer.supportsBacktest) {
        analyzers.push({ analyzer, weight: ac.weight, timeframe: (ac.timeframe || '5m') as Timeframe });
      }
    }

    const signalAggregator = new SignalAggregator();
    const aggregator = new CandleAggregator();
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

      // Build candles per analyzer timeframe
      const analyzersWithCandles: WeightedAnalyzer[] = analyzers.map(a => {
        if (a.timeframe === '5m') return { ...a, candles: window };
        return { ...a, candles: aggregator.aggregate(window, a.timeframe) };
      });

      // Run signals
      const result = signalAggregator.aggregate(analyzersWithCandles, window, currentPrice, activeTradeForAnalyzer);
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

  /** Streaming version — sends results via callback as they are computed. */
  async runStreaming(config: BacktestConfig, send: (event: any) => void): Promise<void> {
    const strategyRepo = this.#app.db.getRepository(Strategy);
    const strategy = await strategyRepo.findOneByOrFail({ id: config.strategyId });

    // Send loading status
    send({ type: 'status', message: 'Loading candles...' });
    await this.#ensureCandles(strategy.exchange, strategy.pair, config.startDate, config.endDate);

    const candles = await this.#app.tradeManager.candleManager.store.get(
      strategy.exchange, strategy.pair, config.startDate, config.endDate,
    );

    if (candles.length < 50) {
      send({ type: 'error', message: `Not enough candles (${candles.length})` });
      return;
    }

    send({ type: 'status', message: `Processing ${candles.length} candles...` });

    // Setup analyzers
    const analyzers: (WeightedAnalyzer & { timeframe: Timeframe })[] = [];
    for (const ac of strategy.analyzers) {
      const analyzer = this.#createAnalyzer(ac);
      if (analyzer && analyzer.supportsBacktest) {
        analyzers.push({ analyzer, weight: ac.weight, timeframe: (ac.timeframe || '5m') as Timeframe });
      }
    }

    const signalAggregator = new SignalAggregator();
    const aggregator = new CandleAggregator();
    const mmConfig = strategy.money_management;

    let balance = new Decimal(config.initialBalance);
    let peakBalance = balance;
    let maxDrawdown = new Decimal(0);
    let activeTrade: { entryPrice: Decimal; entryTime: number; quantity: Decimal } | null = null;
    const trades: BacktestTrade[] = [];

    const buyThreshold = new Decimal(strategy.buy_threshold);
    const sellThreshold = new Decimal(strategy.sell_threshold);
    const lookback = 200;

    // Send candles in chunks for chart (downsample for display)
    const candleStep = Math.max(1, Math.floor(candles.length / 2000)); // max 2000 candles for chart
    const chartCandles: any[] = [];
    for (let i = 0; i < candles.length; i += candleStep) {
      chartCandles.push({ t: candles[i].t, o: candles[i].o, h: candles[i].h, l: candles[i].l, c: candles[i].c });
    }
    send({ type: 'candles', data: chartCandles });

    // Process candles
    let lastEquitySendTime = 0;
    for (let i = lookback; i < candles.length; i++) {
      const window = candles.slice(Math.max(0, i - lookback), i + 1);
      const currentCandle = candles[i];
      const currentPrice = currentCandle.c;

      const activeTradeForAnalyzer: ActiveTrade | undefined = activeTrade ? {
        id: 0,
        entryPrice: activeTrade.entryPrice.toString(),
        quantity: activeTrade.quantity.toString(),
      } : undefined;

      const analyzersWithCandles: WeightedAnalyzer[] = analyzers.map(a => {
        if (a.timeframe === '5m') return { ...a, candles: window };
        return { ...a, candles: aggregator.aggregate(window, a.timeframe) };
      });

      const result = signalAggregator.aggregate(analyzersWithCandles, window, currentPrice, activeTradeForAnalyzer);
      const totalBuy = new Decimal(result.totalBuyWeight);
      const totalSell = new Decimal(result.totalSellWeight);

      if (!activeTrade && totalBuy.greaterThanOrEqualTo(buyThreshold)) {
        let amount: Decimal;
        if (mmConfig.mode === 'percentage') {
          amount = balance.times(mmConfig.amount).dividedBy(100);
        } else {
          amount = Decimal.min(new Decimal(mmConfig.amount), balance);
        }
        const commission = amount.times(COMMISSION_RATE);
        const netAmount = amount.minus(commission);
        balance = balance.minus(amount);
        activeTrade = { entryPrice: new Decimal(currentPrice), entryTime: currentCandle.t, quantity: netAmount.dividedBy(currentPrice) };

        send({ type: 'trade', action: 'buy', time: currentCandle.t, price: currentPrice });
      } else if (activeTrade && totalSell.greaterThanOrEqualTo(sellThreshold)) {
        const sellValue = activeTrade.quantity.times(currentPrice);
        const commission = sellValue.times(COMMISSION_RATE);
        const netSellValue = sellValue.minus(commission);
        const totalCommission = activeTrade.entryPrice.times(activeTrade.quantity).times(COMMISSION_RATE).plus(commission);
        const profit = new Decimal(currentPrice).minus(activeTrade.entryPrice).times(activeTrade.quantity).minus(totalCommission);
        const profitPct = new Decimal(currentPrice).minus(activeTrade.entryPrice).dividedBy(activeTrade.entryPrice).times(100);
        balance = balance.plus(netSellValue);

        const trade: BacktestTrade = {
          entryPrice: activeTrade.entryPrice.toString(), exitPrice: currentPrice,
          entryTime: activeTrade.entryTime, exitTime: currentCandle.t,
          quantity: activeTrade.quantity.toDecimalPlaces(8).toString(),
          profit: profit.toDecimalPlaces(8).toString(),
          profitPct: profitPct.toDecimalPlaces(4).toString(),
          commission: totalCommission.toDecimalPlaces(8).toString(),
        };
        trades.push(trade);
        activeTrade = null;

        send({ type: 'trade', action: 'sell', time: currentCandle.t, price: currentPrice, profit: trade.profit, profitPct: trade.profitPct });
      }

      const equity = activeTrade ? balance.plus(activeTrade.quantity.times(currentPrice)) : balance;
      if (equity.greaterThan(peakBalance)) peakBalance = equity;
      const drawdown = peakBalance.isZero() ? new Decimal(0) : peakBalance.minus(equity).dividedBy(peakBalance).times(100);
      if (drawdown.greaterThan(maxDrawdown)) maxDrawdown = drawdown;

      // Send equity every ~hour of candle data
      if (currentCandle.t - lastEquitySendTime >= 3600000) {
        send({ type: 'equity', time: currentCandle.t, equity: equity.toDecimalPlaces(2).toString() });
        lastEquitySendTime = currentCandle.t;
      }

      // Yield to event loop every 1000 candles to keep WS alive
      if (i % 1000 === 0) {
        send({ type: 'progress', processed: i - lookback, total: candles.length - lookback });
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Final summary
    let totalProfit = new Decimal(0);
    let wins = 0;
    for (const t of trades) {
      totalProfit = totalProfit.plus(t.profit);
      if (new Decimal(t.profit).greaterThan(0)) wins++;
    }

    send({
      type: 'done',
      totalProfit: totalProfit.toDecimalPlaces(8).toString(),
      winRate: trades.length > 0 ? (wins / trades.length * 100).toFixed(2) : '0',
      maxDrawdown: maxDrawdown.toDecimalPlaces(2).toString(),
      totalTrades: trades.length,
      trades,
    });
  }

  /** Fetch missing candles, scanning by day chunks to find and fill gaps. */
  async #ensureCandles(exchange: string, pair: string, startDate: number, endDate: number): Promise<void> {
    const store = this.#app.tradeManager.candleManager.store;
    const ex = this.#app.tradeManager.getExchange(exchange);
    if (!ex) throw new Error(`Exchange ${exchange} not found`);

    const TF = 5 * 60 * 1000;
    const DAY = 24 * 60 * 60 * 1000;
    let totalFetched = 0;

    // Scan day by day, check count, fetch if gaps found
    let dayStart = startDate;
    while (dayStart < endDate) {
      const dayEnd = Math.min(dayStart + DAY, endDate);
      const expected = Math.floor((dayEnd - dayStart) / TF);
      const actual = await store.countRange(exchange, pair, dayStart, dayEnd);

      if (actual < expected) {
        // Gap in this day — fetch entire day from exchange
        let currentStart = dayStart;
        while (currentStart < dayEnd) {
          const batch = await ex.fetchCandles(pair, '5m', currentStart, dayEnd, 1000);
          if (batch.length === 0) break;

          const toStore = batch.map(c => ({ t: c.openTime, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));
          await store.store(exchange, pair, toStore);
          totalFetched += batch.length;

          currentStart = batch[batch.length - 1].openTime + TF;
          if (batch.length < 1000) break;
          await new Promise(r => setTimeout(r, 100));
        }
      }

      dayStart += DAY;
    }

    if (totalFetched > 0) {
      this.#app.logger.log(`[BacktestEngine] Fetched ${totalFetched} candles for ${pair}`);
    }
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
