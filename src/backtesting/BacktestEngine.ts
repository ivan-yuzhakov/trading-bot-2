import { Decimal } from 'decimal.js';
import type { App } from '../app/App.js';
import type { BacktestConfig, BacktestDirectConfig, BacktestResult, BacktestTrade, StrategyParams } from './types.js';
import { TradingCore } from '../trading/TradingCore.js';
import { Strategy } from '../entity/Strategy.js';
import type { Candle } from '../candles/types.js';
import type { ActiveTrade } from '../analyzers/types.js';

export interface RunCoreOptions {
  /** When true, omit candles array from result (saves memory for optimization). */
  lite?: boolean;
}

export class BacktestEngine {
  #app: App;
  #core = new TradingCore();

  constructor(app: App) {
    this.#app = app;
  }

  /** Run backtest for a DB-stored strategy. */
  async run(config: BacktestConfig): Promise<BacktestResult> {
    const strategy = await this.#app.db.getRepository(Strategy).findOneByOrFail({ id: config.strategyId });

    await this.ensureCandles(strategy.exchange, strategy.pair, config.startDate, config.endDate);

    const candles = await this.#app.tradeManager.candleManager.store.get(
      strategy.exchange, strategy.pair, config.startDate, config.endDate,
    );

    if (candles.length < 50) {
      throw new Error(`Not enough candles for backtest (${candles.length}). Need at least 50.`);
    }

    return this.#runCore(strategy, candles, config.initialBalance);
  }

  /** Run backtest with a plain strategy object and pre-fetched candles (no DB lookup). */
  runDirect(config: BacktestDirectConfig, strategy: StrategyParams, candles: Candle[], options?: RunCoreOptions): BacktestResult {
    if (candles.length < 50) {
      throw new Error(`Not enough candles for backtest (${candles.length}). Need at least 50.`);
    }

    return this.#runCore(strategy, candles, config.initialBalance, options);
  }

  /** Core backtest loop — single source of truth for both run() and runDirect(). */
  #runCore(strategy: StrategyParams, candles: Candle[], initialBalance: string, options?: RunCoreOptions): BacktestResult {
    const analyzers = this.#core.createAnalyzers(this.#app, strategy as Strategy, true);
    const mmConfig = strategy.money_management;

    let balance = new Decimal(initialBalance);
    let peakBalance = balance;
    let maxDrawdown = new Decimal(0);
    let activeTrade: { entryPrice: string; entryTime: number; quantity: string; buyAmount: string } | null = null;
    const trades: BacktestTrade[] = [];
    const equityCurve: BacktestResult['equityCurve'] = [];

    const lookback = this.#core.calculateLookback(analyzers);
    // Pre-aggregate higher TFs once per backtest — slicing per iteration gives identical results
    // to per-window aggregation but is ~1000× faster for long backtests.
    const preAggregated = this.#core.preAggregateForAnalyzers(candles, analyzers);

    for (let i = lookback; i < candles.length; i++) {
      const window = candles.slice(Math.max(0, i - lookback + 1), i + 1);
      const currentCandle = candles[i];
      const currentPrice = currentCandle.c;

      const activeTradeForAnalyzer: ActiveTrade | undefined = activeTrade ? {
        id: 0, entryPrice: activeTrade.entryPrice, quantity: activeTrade.quantity,
      } : undefined;

      // Same evaluate() as PairRunner uses
      const decision = this.#core.evaluate(
        analyzers, window, currentPrice, activeTradeForAnalyzer,
        strategy.buy_threshold, strategy.sell_threshold,
        preAggregated,
      );

      if (decision.action === 'buy' && !activeTrade) {
        const { quantity, amount } = this.#core.calculatePositionSize(balance.toString(), currentPrice, mmConfig);
        if (new Decimal(quantity).lessThanOrEqualTo(0)) continue;
        balance = balance.minus(amount);
        activeTrade = { entryPrice: currentPrice, entryTime: currentCandle.t, quantity, buyAmount: amount };
      } else if (decision.action === 'sell' && activeTrade) {
        const { profit, profitPct, totalCommission } = this.#core.calculateProfit(
          activeTrade.entryPrice, currentPrice, activeTrade.quantity,
        );

        // Return: original buy amount + net profit (profit already includes both commissions)
        balance = balance.plus(activeTrade.buyAmount).plus(profit);

        trades.push({
          entryPrice: activeTrade.entryPrice,
          exitPrice: currentPrice,
          entryTime: activeTrade.entryTime,
          exitTime: currentCandle.t,
          quantity: activeTrade.quantity,
          profit,
          profitPct,
          commission: totalCommission,
        });
        activeTrade = null;
      }

      const equity = activeTrade
        ? balance.plus(new Decimal(activeTrade.quantity).times(currentPrice))
        : balance;

      if (equity.greaterThan(peakBalance)) peakBalance = equity;
      const drawdown = peakBalance.isZero() ? new Decimal(0) : peakBalance.minus(equity).dividedBy(peakBalance).times(100);
      if (drawdown.greaterThan(maxDrawdown)) maxDrawdown = drawdown;

      if (i % 12 === 0) {
        equityCurve.push({ time: currentCandle.t, equity: equity.toDecimalPlaces(2).toString() });
      }
    }

    // If a trade is still open at end of period — treat as if it never happened.
    // Truncate equity curve to before the trade entry, recompute drawdown.
    if (activeTrade) {
      const cutoffTime = activeTrade.entryTime;
      while (equityCurve.length > 0 && equityCurve[equityCurve.length - 1].time >= cutoffTime) {
        equityCurve.pop();
      }
      let peak = new Decimal(initialBalance);
      let maxDD = new Decimal(0);
      for (const e of equityCurve) {
        const eq = new Decimal(e.equity);
        if (eq.greaterThan(peak)) peak = eq;
        const dd = peak.isZero() ? new Decimal(0) : peak.minus(eq).dividedBy(peak).times(100);
        if (dd.greaterThan(maxDD)) maxDD = dd;
      }
      maxDrawdown = maxDD;
      activeTrade = null;
    }

    let totalProfit = new Decimal(0);
    let wins = 0;
    for (const t of trades) {
      totalProfit = totalProfit.plus(t.profit);
      if (new Decimal(t.profit).greaterThan(0)) wins++;
    }

    const result: BacktestResult = {
      trades,
      totalProfit: totalProfit.toDecimalPlaces(8).toString(),
      winRate: trades.length > 0 ? (wins / trades.length * 100).toFixed(2) : '0',
      maxDrawdown: maxDrawdown.toDecimalPlaces(2).toString(),
      totalTrades: trades.length,
      equityCurve,
      candles: [],
    };

    if (!options?.lite) {
      result.candles = candles.map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c }));
    }

    return result;
  }

  async runStreaming(config: BacktestConfig, send: (event: any) => void): Promise<void> {
    const strategy = await this.#app.db.getRepository(Strategy).findOneByOrFail({ id: config.strategyId });

    send({ type: 'status', message: 'Loading candles...' });
    await this.ensureCandles(strategy.exchange, strategy.pair, config.startDate, config.endDate);

    const candles = await this.#app.tradeManager.candleManager.store.get(
      strategy.exchange, strategy.pair, config.startDate, config.endDate,
    );

    if (candles.length < 50) {
      send({ type: 'error', message: `Not enough candles (${candles.length})` });
      return;
    }

    send({ type: 'status', message: `Processing ${candles.length} candles...` });

    const analyzers = this.#core.createAnalyzers(this.#app, strategy, true);
    const mmConfig = strategy.money_management;

    let balance = new Decimal(config.initialBalance);
    let peakBalance = balance;
    let maxDrawdown = new Decimal(0);
    let activeTrade: { entryPrice: string; entryTime: number; quantity: string; buyAmount: string } | null = null;
    const trades: BacktestTrade[] = [];
    const lookback = this.#core.calculateLookback(analyzers);
    const preAggregated = this.#core.preAggregateForAnalyzers(candles, analyzers);

    // Send downsampled candles for chart
    const candleStep = Math.max(1, Math.floor(candles.length / 2000));
    const chartCandles: any[] = [];
    for (let i = 0; i < candles.length; i += candleStep) {
      chartCandles.push({ t: candles[i].t, o: candles[i].o, h: candles[i].h, l: candles[i].l, c: candles[i].c });
    }
    send({ type: 'candles', data: chartCandles });

    let lastEquitySendTime = 0;

    for (let i = lookback; i < candles.length; i++) {
      const window = candles.slice(Math.max(0, i - lookback + 1), i + 1);
      const currentCandle = candles[i];
      const currentPrice = currentCandle.c;

      const activeTradeForAnalyzer: ActiveTrade | undefined = activeTrade ? {
        id: 0, entryPrice: activeTrade.entryPrice, quantity: activeTrade.quantity,
      } : undefined;

      const decision = this.#core.evaluate(
        analyzers, window, currentPrice, activeTradeForAnalyzer,
        strategy.buy_threshold, strategy.sell_threshold,
        preAggregated,
      );

      if (decision.action === 'buy' && !activeTrade) {
        const { quantity, amount } = this.#core.calculatePositionSize(balance.toString(), currentPrice, mmConfig);
        if (new Decimal(quantity).lessThanOrEqualTo(0)) continue;
        balance = balance.minus(amount);
        activeTrade = { entryPrice: currentPrice, entryTime: currentCandle.t, quantity, buyAmount: amount };
        send({ type: 'trade', action: 'buy', time: currentCandle.t, price: currentPrice });
      } else if (decision.action === 'sell' && activeTrade) {
        const { profit, profitPct, totalCommission } = this.#core.calculateProfit(
          activeTrade.entryPrice, currentPrice, activeTrade.quantity,
        );

        balance = balance.plus(activeTrade.buyAmount).plus(profit);

        const trade: BacktestTrade = {
          entryPrice: activeTrade.entryPrice, exitPrice: currentPrice,
          entryTime: activeTrade.entryTime, exitTime: currentCandle.t,
          quantity: activeTrade.quantity, profit, profitPct, commission: totalCommission,
        };
        trades.push(trade);
        activeTrade = null;

        send({ type: 'trade', action: 'sell', time: currentCandle.t, price: currentPrice, profit, profitPct });
      }

      const equity = activeTrade ? balance.plus(new Decimal(activeTrade.quantity).times(currentPrice)) : balance;
      if (equity.greaterThan(peakBalance)) peakBalance = equity;
      const drawdown = peakBalance.isZero() ? new Decimal(0) : peakBalance.minus(equity).dividedBy(peakBalance).times(100);
      if (drawdown.greaterThan(maxDrawdown)) maxDrawdown = drawdown;

      if (currentCandle.t - lastEquitySendTime >= 3600000) {
        send({ type: 'equity', time: currentCandle.t, equity: equity.toDecimalPlaces(2).toString() });
        lastEquitySendTime = currentCandle.t;
      }

      if (i % 1000 === 0) {
        send({ type: 'progress', processed: i - lookback, total: candles.length - lookback });
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Open trade at end → treat as if it never happened (no force-close)
    if (activeTrade) {
      activeTrade = null;
      // Note: streaming sends drawdown live, so we don't recompute here
    }

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

  /** Download missing candles from exchange and store in Redis. Public for use by optimization. */
  async ensureCandles(exchange: string, pair: string, startDate: number, endDate: number): Promise<void> {
    const store = this.#app.tradeManager.candleManager.store;
    const ex = this.#app.tradeManager.getExchange(exchange);
    if (!ex) throw new Error(`Exchange ${exchange} not found`);

    const TF = 5 * 60 * 1000;
    const DAY = 24 * 60 * 60 * 1000;
    let totalFetched = 0;

    const startStr = new Date(startDate).toISOString().slice(0, 10);
    const endStr = new Date(endDate).toISOString().slice(0, 10);
    this.#app.logger.log(`[Candles] Checking ${pair} ${startStr} → ${endStr}...`);

    // Download range covers [startDate, endDate] inclusive — need endDate + TF as exclusive upper bound
    const downloadEnd = endDate + TF;
    let dayStart = startDate;
    while (dayStart < downloadEnd) {
      const dayEnd = Math.min(dayStart + DAY, downloadEnd);
      const expected = Math.floor((dayEnd - dayStart) / TF);
      const actual = await store.countRange(exchange, pair, dayStart, dayEnd);

      if (actual < expected) {
        const dayStr = new Date(dayStart).toISOString().slice(0, 10);
        this.#app.logger.log(`[Candles] Downloading ${pair} ${dayStr} (have ${actual}/${expected})...`);

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
      this.#app.logger.log(`[Candles] Total: ${totalFetched} candles fetched for ${pair} (${startStr} → ${endStr})`);
    } else {
      this.#app.logger.log(`[Candles] All candles for ${pair} already in cache`);
    }

    // Verify coverage for requested range
    const candles = await store.get(exchange, pair, startDate, endDate);
    const expectedTotal = Math.floor((endDate - startDate) / TF) + 1;
    const fmtDate = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19);

    if (candles.length === 0) {
      this.#app.logger.log(`[Candles] WARNING: no candles in range ${startStr} → ${endStr}`);
      return;
    }

    this.#app.logger.log(`[Candles] Verification ${pair} ${startStr} → ${endStr}: ${candles.length}/${expectedTotal} candles`);
    this.#app.logger.log(`[Candles]   actual range: ${fmtDate(candles[0].t)} → ${fmtDate(candles[candles.length - 1].t)}`);

    // Check for gaps
    let gapCount = 0;
    let maxGapMs = 0;
    let maxGapStart = 0;

    for (let i = 1; i < candles.length; i++) {
      const diff = candles[i].t - candles[i - 1].t;
      if (diff > TF) {
        gapCount++;
        if (diff > maxGapMs) {
          maxGapMs = diff;
          maxGapStart = candles[i - 1].t;
        }
      }
    }

    if (gapCount === 0) {
      this.#app.logger.log(`[Candles]   contiguous — no gaps`);
    } else {
      this.#app.logger.log(`[Candles]   WARNING: ${gapCount} gap(s) found, largest: ${(maxGapMs / 60000).toFixed(0)}min at ${fmtDate(maxGapStart)}`);
    }
  }
}
