import { Decimal } from 'decimal.js';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { App } from '../app/App.js';
import { BacktestEngine } from '../backtesting/BacktestEngine.js';
import type { BacktestDirectConfig, BacktestResult, BacktestTrade, StrategyParams } from '../backtesting/types.js';
import { OptimizationResult } from '../entity/OptimizationResult.js';
import type { OptimizationConfig, ParamRange, RangeInfo, VariantParams } from './types.js';

/** Check if a value is a {from, to, step} range descriptor. */
export function isRange(v: unknown): v is ParamRange {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 3) return false;
  const o = v as Record<string, unknown>;
  return typeof o.from === 'number' && typeof o.to === 'number' && typeof o.step === 'number';
}

/** Expand a range into an array of discrete values. */
export function expandRange(range: ParamRange): number[] {
  const values: number[] = [];
  const precision = Math.max(
    decimalPlaces(range.from),
    decimalPlaces(range.to),
    decimalPlaces(range.step),
  );
  // Use Decimal to avoid floating point drift
  let current = new Decimal(range.from);
  const to = new Decimal(range.to);
  const step = new Decimal(range.step);

  while (current.lessThanOrEqualTo(to)) {
    values.push(Number(current.toDecimalPlaces(precision).toString()));
    current = current.plus(step);
  }

  return values;
}

function decimalPlaces(n: number): number {
  const s = String(n);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Recursively find all range descriptors in a nested object. Returns paths and their expanded values. */
export function extractRanges(obj: unknown, prefix: string = ''): RangeInfo[] {
  const ranges: RangeInfo[] = [];
  if (typeof obj !== 'object' || obj === null) return ranges;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const childPath = prefix ? `${prefix}[${i}]` : `[${i}]`;
      if (isRange(obj[i])) {
        ranges.push({ path: childPath, values: expandRange(obj[i]) });
      } else if (typeof obj[i] === 'object' && obj[i] !== null) {
        ranges.push(...extractRanges(obj[i], childPath));
      }
    }
  } else {
    for (const key of Object.keys(obj)) {
      const val = (obj as Record<string, unknown>)[key];
      const childPath = prefix ? `${prefix}.${key}` : key;
      if (isRange(val)) {
        ranges.push({ path: childPath, values: expandRange(val as ParamRange) });
      } else if (typeof val === 'object' && val !== null) {
        ranges.push(...extractRanges(val, childPath));
      }
    }
  }

  return ranges;
}

/** Compute cartesian product of all range value arrays. Returns array of param assignments. */
export function cartesianProduct(ranges: RangeInfo[]): VariantParams[] {
  if (ranges.length === 0) return [{}];

  const result: VariantParams[] = [];
  const indices = new Array(ranges.length).fill(0);
  const sizes = ranges.map(r => r.values.length);
  const total = sizes.reduce((a, b) => a * b, 1);

  for (let i = 0; i < total; i++) {
    const params: VariantParams = {};
    for (let j = 0; j < ranges.length; j++) {
      params[ranges[j].path] = ranges[j].values[indices[j]];
    }
    result.push(params);

    // Increment indices (odometer-style)
    for (let j = ranges.length - 1; j >= 0; j--) {
      indices[j]++;
      if (indices[j] < sizes[j]) break;
      indices[j] = 0;
    }
  }

  return result;
}

/** Deep clone an object and set values at dot/bracket paths. */
export function applyVariant(template: Record<string, unknown>, params: VariantParams): Record<string, unknown> {
  const clone = structuredClone(template);

  for (const [path, value] of Object.entries(params)) {
    setDeepValue(clone, path, value);
  }

  return clone;
}

function setDeepValue(obj: any, path: string, value: unknown): void {
  // Parse path like "analyzers[0].config.period" or "buy_threshold"
  const segments = parsePath(path);
  let current = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    current = current[segments[i]];
  }

  current[segments[segments.length - 1]] = value;
}

function parsePath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  const parts = path.split(/\.|\[|\]/).filter(Boolean);
  for (const p of parts) {
    const n = Number(p);
    segments.push(Number.isInteger(n) && p !== '' && String(n) === p ? n : p);
  }
  return segments;
}

/** Convert a strategy-shaped plain object (with string numbers) to StrategyParams. */
function toStrategyParams(obj: Record<string, unknown>): StrategyParams {
  // Ensure analyzer weights are strings (ranges produce numbers after applyVariant)
  const analyzers = (obj.analyzers as any[]).map(a => ({
    ...a,
    weight: String(a.weight),
  }));

  return {
    pair: String(obj.pair),
    exchange: String(obj.exchange),
    analyzers,
    buy_threshold: String(obj.buy_threshold),
    sell_threshold: String(obj.sell_threshold),
    stop_loss_pct: obj.stop_loss_pct != null ? String(obj.stop_loss_pct) : null,
    money_management: obj.money_management as StrategyParams['money_management'],
  };
}

/** Compute extended statistics from backtest trades. */
function computeExtendedStats(trades: BacktestTrade[], initialBalance: string) {
  let totalProfit = new Decimal(0);
  let totalCommission = new Decimal(0);
  let grossProfit = new Decimal(0);
  let grossLoss = new Decimal(0);
  let wins = 0;
  let losses = 0;
  let bestTrade = new Decimal(0);
  let worstTrade = new Decimal(0);
  let totalDurationMs = 0;

  for (const t of trades) {
    const p = new Decimal(t.profit);
    totalProfit = totalProfit.plus(p);
    totalCommission = totalCommission.plus(t.commission);

    if (p.greaterThan(0)) {
      grossProfit = grossProfit.plus(p);
      wins++;
    } else {
      grossLoss = grossLoss.plus(p.abs());
      losses++;
    }

    if (p.greaterThan(bestTrade)) bestTrade = p;
    if (p.lessThan(worstTrade)) worstTrade = p;

    totalDurationMs += t.exitTime - t.entryTime;
  }

  const avgProfitPerTrade = trades.length > 0
    ? totalProfit.dividedBy(trades.length)
    : new Decimal(0);

  const avgTradeDurationSec = trades.length > 0
    ? Math.round(totalDurationMs / trades.length / 1000)
    : 0;

  const profitFactor = grossLoss.isZero()
    ? (grossProfit.isZero() ? new Decimal(0) : new Decimal(999))
    : grossProfit.dividedBy(grossLoss);

  const totalProfitPct = new Decimal(initialBalance).isZero()
    ? new Decimal(0)
    : totalProfit.dividedBy(initialBalance).times(100);

  const finalBalance = new Decimal(initialBalance).plus(totalProfit);

  return {
    totalProfit: totalProfit.toDecimalPlaces(8).toString(),
    totalProfitPct: totalProfitPct.toDecimalPlaces(4).toString(),
    finalBalance: finalBalance.toDecimalPlaces(8).toString(),
    winRate: trades.length > 0 ? (wins / trades.length * 100).toFixed(2) : '0',
    winningTrades: wins,
    losingTrades: losses,
    avgProfitPerTrade: avgProfitPerTrade.toDecimalPlaces(8).toString(),
    avgTradeDuration: avgTradeDurationSec,
    bestTradeProfit: bestTrade.toDecimalPlaces(8).toString(),
    worstTradeProfit: worstTrade.toDecimalPlaces(8).toString(),
    totalCommission: totalCommission.toDecimalPlaces(8).toString(),
    profitFactor: profitFactor.toDecimalPlaces(4).toString(),
  };
}

/** Format variant params for console display. */
function formatParams(params: VariantParams): string {
  return Object.entries(params)
    .map(([k, v]) => {
      // Shorten path for display: analyzers[0].config.period → a0.period
      const short = k
        .replace(/analyzers\[(\d+)\]\.config\./, 'a$1.')
        .replace(/analyzers\[(\d+)\]\./, 'a$1.')
        .replace(/money_management\./, 'mm.');
      return `${short}=${v}`;
    })
    .join(', ');
}

export class GridSearchEngine {
  #app: App;

  constructor(app: App) {
    this.#app = app;
  }

  async run(config: OptimizationConfig, outputDir: string, force: boolean = false): Promise<void> {
    const ranges = extractRanges(config.strategy);
    const variants = cartesianProduct(ranges);
    const totalVariants = variants.length;

    // Print summary
    const pair = String(config.strategy.pair);
    const exchange = String(config.strategy.exchange);
    console.log(`\nOptimization: ${config.name}`);
    console.log(`Pair: ${pair} | Exchange: ${exchange} | Period: ${config.backtest.startDate} → ${config.backtest.endDate}`);
    console.log(`Initial balance: ${config.backtest.initialBalance}`);

    if (ranges.length === 0) {
      console.log(`Parameters: no ranges (single variant)`);
    } else {
      console.log(`Parameters: ${ranges.length} range(s), ${totalVariants} total combinations`);
      for (const r of ranges) {
        console.log(`  - ${r.path}: ${r.values[0]}..${r.values[r.values.length - 1]} (${r.values.length} values)`);
      }
    }

    if (totalVariants > 100000 && !force) {
      console.error(`\nToo many combinations (${totalVariants}). Use --force to proceed.`);
      return;
    }

    // Initialize
    const engine = new BacktestEngine(this.#app);
    // Deterministic run_id from config hash — enables resumability on restart
    const runId = createHash('sha256')
      .update(JSON.stringify(config))
      .digest('hex')
      .slice(0, 32);

    console.log(`Run ID: ${runId}`);

    const startDate = new Date(config.backtest.startDate).getTime();
    const endDate = new Date(config.backtest.endDate).getTime();
    const initialBalance = config.backtest.initialBalance;

    // Download candles once
    console.log(`\nDownloading candles...`);
    await engine.ensureCandles(exchange, pair, startDate, endDate);

    // Load candles into memory once
    const candles = await this.#app.tradeManager.candleManager.store.get(exchange, pair, startDate, endDate);
    console.log(`Loaded ${candles.length} candles into memory\n`);

    if (candles.length < 50) {
      console.error(`Not enough candles (${candles.length}). Need at least 50.`);
      return;
    }

    // Create output directory
    const runDir = join(outputDir, runId);
    await mkdir(runDir, { recursive: true });

    const directConfig: BacktestDirectConfig = { startDate, endDate, initialBalance };

    const repo = this.#app.db.getRepository(OptimizationResult);

    // Force mode: delete previous results for this run_id to restart from scratch
    if (force) {
      const deleted = await repo.delete({ run_id: runId });
      if (deleted.affected) {
        console.log(`Force mode: deleted ${deleted.affected} previous results for this config`);
      }
    }

    const startTime = Date.now();
    let completed = 0;
    let skipped = 0;
    let failed = 0;
    const PROGRESS_INTERVAL = 100;

    const logProgress = (currentIdx: number) => {
      const processed = completed + skipped + failed;
      const remaining = totalVariants - currentIdx - 1;
      const elapsedMs = Date.now() - startTime;
      const elapsedMin = (elapsedMs / 60000).toFixed(1);
      // ETA based on completed (actual work done), not skipped
      const avgPerVariantMs = completed > 0 ? elapsedMs / completed : 0;
      const etaMs = avgPerVariantMs * remaining;
      const etaStr = avgPerVariantMs > 0
        ? etaMs > 3600000
          ? `${(etaMs / 3600000).toFixed(1)}h`
          : `${(etaMs / 60000).toFixed(1)}min`
        : '?';
      const rate = completed > 0 ? (completed / (elapsedMs / 1000)).toFixed(1) : '0';
      console.log(`  >>> Progress: ${processed}/${totalVariants} (done=${completed} skipped=${skipped} failed=${failed}) | elapsed ${elapsedMin}min | ${rate} var/s | ETA ${etaStr}`);
    };

    for (let i = 0; i < totalVariants; i++) {
      const params = variants[i];

      // Check resumability — skip already completed variants (same config = same run_id)
      if (!force) {
        const existing = await repo.findOneBy({ run_id: runId, variant_index: i });
        if (existing?.status === 'completed') {
          skipped++;
          if ((i + 1) % PROGRESS_INTERVAL === 0) logProgress(i);
          continue;
        }
      }

      const strategyObj = applyVariant(structuredClone(config.strategy), params);
      const strategyParams = toStrategyParams(strategyObj);

      const t0 = Date.now();
      let result: BacktestResult;
      let status = 'completed';

      try {
        result = engine.runDirect(directConfig, strategyParams, candles, { lite: true });
      } catch (e: any) {
        console.error(`  [${i + 1}/${totalVariants}] FAILED: ${e.message}`);
        status = 'failed';
        failed++;

        // Save failed result
        const failedResult = new OptimizationResult();
        failedResult.run_name = config.name;
        failedResult.run_id = runId;
        failedResult.variant_index = i;
        failedResult.total_variants = totalVariants;
        failedResult.pair = pair;
        failedResult.exchange = exchange;
        failedResult.params = params;
        failedResult.strategy_snapshot = strategyObj;
        failedResult.start_date = startDate;
        failedResult.end_date = endDate;
        failedResult.initial_balance = initialBalance;
        failedResult.total_profit = '0';
        failedResult.total_profit_pct = '0';
        failedResult.final_balance = initialBalance;
        failedResult.win_rate = '0';
        failedResult.max_drawdown = '0';
        failedResult.total_trades = 0;
        failedResult.winning_trades = 0;
        failedResult.losing_trades = 0;
        failedResult.avg_profit_per_trade = '0';
        failedResult.avg_trade_duration = 0;
        failedResult.best_trade_profit = '0';
        failedResult.worst_trade_profit = '0';
        failedResult.total_commission = '0';
        failedResult.profit_factor = '0';
        failedResult.execution_time_ms = Date.now() - t0;
        failedResult.detail_file = '';
        failedResult.status = 'failed';
        await repo.save(failedResult);
        continue;
      }

      const executionTime = Date.now() - t0;
      const stats = computeExtendedStats(result.trades, initialBalance);

      // Save detail file
      const detailFileName = `variant-${i}.json`;
      const detailFilePath = join(runDir, detailFileName);
      const detailData = {
        strategy: strategyObj,
        params,
        trades: result.trades,
        equityCurve: result.equityCurve,
      };
      await writeFile(detailFilePath, JSON.stringify(detailData), 'utf-8');

      // Save to DB
      const optResult = new OptimizationResult();
      optResult.run_name = config.name;
      optResult.run_id = runId;
      optResult.variant_index = i;
      optResult.total_variants = totalVariants;
      optResult.pair = pair;
      optResult.exchange = exchange;
      optResult.params = params;
      optResult.strategy_snapshot = strategyObj;
      optResult.start_date = startDate;
      optResult.end_date = endDate;
      optResult.initial_balance = initialBalance;
      optResult.total_profit = stats.totalProfit;
      optResult.total_profit_pct = stats.totalProfitPct;
      optResult.final_balance = stats.finalBalance;
      optResult.win_rate = stats.winRate;
      optResult.max_drawdown = result.maxDrawdown;
      optResult.total_trades = result.totalTrades;
      optResult.winning_trades = stats.winningTrades;
      optResult.losing_trades = stats.losingTrades;
      optResult.avg_profit_per_trade = stats.avgProfitPerTrade;
      optResult.avg_trade_duration = stats.avgTradeDuration;
      optResult.best_trade_profit = stats.bestTradeProfit;
      optResult.worst_trade_profit = stats.worstTradeProfit;
      optResult.total_commission = stats.totalCommission;
      optResult.profit_factor = stats.profitFactor;
      optResult.execution_time_ms = executionTime;
      optResult.detail_file = detailFilePath;
      optResult.status = status;
      await repo.save(optResult);

      completed++;
      const profitSign = parseFloat(stats.totalProfitPct) >= 0 ? '+' : '';
      console.log(`  [${i + 1}/${totalVariants}] ${formatParams(params)} → ${profitSign}${stats.totalProfitPct}% profit, ${result.totalTrades} trades, ${stats.winRate}% win`);

      if ((i + 1) % PROGRESS_INTERVAL === 0) logProgress(i);
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Completed: ${completed} | Skipped: ${skipped} | Failed: ${failed}`);
    console.log(`Time: ${totalTime}s | Run ID: ${runId}`);
    console.log(`Details: ${runDir}`);

    // Print top 5
    const top5 = await repo.find({
      where: { run_id: runId, status: 'completed' },
      order: { total_profit_pct: 'DESC' },
      take: 5,
    });

    if (top5.length > 0) {
      console.log(`\nTop 5 variants:`);
      for (const r of top5) {
        console.log(`  #${r.variant_index} → ${r.total_profit_pct}% profit, ${r.total_trades} trades, ${r.win_rate}% win | ${formatParams(r.params as VariantParams)}`);
      }
    }

    console.log('');
  }
}
