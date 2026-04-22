import type { Express } from 'express';
import type { App } from '../app/App.js';
import { authRequired, authJson } from './middleware.js';
import { Strategy } from '../entity/Strategy.js';
import { Trade } from '../entity/Trade.js';
import { BacktestEngine } from '../backtesting/BacktestEngine.js';
import { OptimizationResult } from '../entity/OptimizationResult.js';
import { readFile } from 'node:fs/promises';

export function registerAdminRoutes(server: Express, app: App): void {
  const router = server;

  // ==================== Pages ====================

  router.get('/admin', authRequired, (_req, res) => {
    res.render('admin.twig', { auth: true });
  });

  router.get('/backtest', authRequired, (_req, res) => {
    res.render('backtest.twig', { auth: true });
  });

  // ==================== API: Strategies ====================

  router.get('/api/strategies', authJson, async (_req, res) => {
    try {
      const repo = app.db.getRepository(Strategy);
      const strategies = await repo.find({ order: { id: 'ASC' } });

      // Attach runner status
      const result = strategies.map((s) => {
        const runner = app.tradeManager.runners.get(s.id);
        return {
          ...s,
          isRunning: !!runner?.running,
          activeTrade: runner?.activeTrade || null,
        };
      });

      res.json(result);
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  router.post('/api/strategies', authJson, async (req: any, res) => {
    try {
      const repo = app.db.getRepository(Strategy);
      const data = req.body;

      let strategy: Strategy;
      if (data.id) {
        strategy = await repo.findOneByOrFail({ id: data.id });
        Object.assign(strategy, {
          pair: data.pair,
          exchange: data.exchange,
          analyzers: data.analyzers,
          buy_threshold: data.buy_threshold,
          sell_threshold: data.sell_threshold,
          stop_loss_pct: data.stop_loss_pct || null,
          money_management: data.money_management,
        });
      } else {
        strategy = repo.create({
          pair: data.pair,
          exchange: data.exchange,
          analyzers: data.analyzers,
          buy_threshold: data.buy_threshold,
          sell_threshold: data.sell_threshold,
          stop_loss_pct: data.stop_loss_pct || null,
          money_management: data.money_management,
          active: 0,
        });
      }

      await repo.save(strategy);
      res.json({ status: true, strategy });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  router.post('/api/strategies/:id/toggle', authJson, async (req: any, res) => {
    try {
      const id = +req.params.id;
      const repo = app.db.getRepository(Strategy);
      const strategy = await repo.findOneByOrFail({ id });

      if (strategy.active) {
        // Stop
        const closePosition = req.body.closePosition === true;
        await app.tradeManager.stopPair(id, closePosition);
        strategy.active = 0;
      } else {
        // Start
        strategy.active = 1;
        await repo.save(strategy);
        await app.tradeManager.startPair(strategy);
      }

      await repo.save(strategy);
      res.json({ status: true, active: strategy.active });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // ==================== API: Trades ====================

  router.get('/api/trades', authJson, async (req: any, res) => {
    try {
      const repo = app.db.getRepository(Trade);
      const strategyId = req.query.strategy_id ? +req.query.strategy_id : undefined;
      const status = req.query.status as string | undefined;

      const where: any = {};
      if (strategyId) where.strategy_id = strategyId;
      if (status) where.status = status;

      const trades = await repo.find({
        where,
        relations: ['steps'],
        order: { id: 'DESC' },
        take: 100,
      });

      res.json(trades);
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // ==================== API: Balance ====================

  router.get('/api/balance/:exchange', authJson, async (req: any, res) => {
    try {
      const exchange = app.tradeManager.getExchange(req.params.exchange);
      if (!exchange) {
        res.json({ error: 'Unknown exchange' });
        return;
      }

      const balances = await exchange.getBalance();
      res.json(balances);
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // ==================== API: Connectivity ====================

  router.get('/api/connectivity/:exchange', authJson, async (req: any, res) => {
    try {
      const exchange = app.tradeManager.getExchange(req.params.exchange);
      if (!exchange) {
        res.json({ connected: false, error: 'Unknown exchange' });
        return;
      }

      const connected = await exchange.checkConnectivity();
      res.json({ connected });
    } catch (e: any) {
      res.json({ connected: false, error: e.message });
    }
  });

  // ==================== API: Available Pairs ====================

  router.get('/api/pairs/:exchange', authJson, async (req: any, res) => {
    try {
      const exchange = app.tradeManager.getExchange(req.params.exchange);
      if (!exchange) {
        res.json({ error: 'Unknown exchange' });
        return;
      }

      const pairs = await exchange.getAvailablePairs();
      // Filter USDT pairs
      const usdtPairs = pairs.filter((p) => p.quoteAsset === 'USDT');
      res.json(usdtPairs);
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // ==================== API: Statistics ====================

  router.get('/api/statistics', authJson, async (_req, res) => {
    try {
      const tradeRepo = app.db.getRepository(Trade);
      const closedTrades = await tradeRepo.find({
        where: { status: 'closed' },
        order: { closed_at: 'ASC' },
      });

      // Group profit by month
      const profits: Record<string, string> = {};
      let totalProfit = '0';
      const { MathPlus } = await import('../app/Math.js');

      for (const t of closedTrades) {
        if (!t.profit || !t.closed_at) continue;
        const month = t.closed_at.substring(0, 7); // YYYY-MM
        profits[month] = MathPlus(profits[month] || '0', t.profit);
        totalProfit = MathPlus(totalProfit, t.profit);
      }

      res.json({
        profits,
        totalProfit,
        totalTrades: closedTrades.length,
        winRate: closedTrades.length > 0
          ? (closedTrades.filter((t) => t.profit && parseFloat(t.profit) > 0).length / closedTrades.length * 100).toFixed(2)
          : '0',
      });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // ==================== API: Candle status ====================

  router.get('/api/candles/status', authJson, async (_req, res) => {
    try {
      const result: any[] = [];
      for (const [_, runner] of app.tradeManager.runners) {
        const s = runner.strategy;
        const count = await app.tradeManager.candleManager.store.count(s.exchange, s.pair);
        const last = await app.tradeManager.candleManager.store.getLast(s.exchange, s.pair);
        result.push({
          pair: s.pair,
          exchange: s.exchange,
          candleCount: count,
          lastCandleTime: last?.t || null,
        });
      }
      res.json(result);
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // ==================== Pages: Optimization ====================

  router.get('/optimization', authRequired, (_req, res) => {
    res.render('optimization.twig', { auth: true });
  });

  // ==================== API: Optimization ====================

  router.get('/api/optimization/runs', authJson, async (_req, res) => {
    try {
      const repo = app.db.getRepository(OptimizationResult);
      const runs = await repo.query(`
        SELECT run_id, run_name, pair, exchange, total_variants,
               MAX(total_profit_pct) as best_profit_pct,
               ROUND(AVG(total_profit_pct), 4) as avg_profit_pct,
               MIN(created_at) as created_at
        FROM optimization_results
        WHERE status = 'completed'
        GROUP BY run_id, run_name, pair, exchange, total_variants
        ORDER BY created_at DESC
      `);
      res.json(runs);
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  router.get('/api/optimization/results', authJson, async (req: any, res) => {
    try {
      const repo = app.db.getRepository(OptimizationResult);
      const runId = req.query.run_id;
      if (!runId) { res.json({ error: 'run_id required' }); return; }

      const sort = req.query.sort || 'total_profit_pct';
      const order = (req.query.order || 'desc').toUpperCase();
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = parseInt(req.query.offset) || 0;

      const allowedSorts = ['total_profit', 'total_profit_pct', 'final_balance', 'win_rate', 'max_drawdown', 'total_trades', 'profit_factor', 'avg_profit_per_trade', 'variant_index'];
      const sortField = allowedSorts.includes(sort) ? sort : 'total_profit_pct';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      const qb = repo.createQueryBuilder('r')
        .where('r.run_id = :runId', { runId })
        .andWhere('r.status = :status', { status: 'completed' });

      if (req.query.min_profit) {
        qb.andWhere('r.total_profit_pct >= :minProfit', { minProfit: parseFloat(req.query.min_profit) });
      }
      if (req.query.min_win_rate) {
        qb.andWhere('r.win_rate >= :minWinRate', { minWinRate: parseFloat(req.query.min_win_rate) });
      }
      if (req.query.min_trades) {
        qb.andWhere('r.total_trades >= :minTrades', { minTrades: parseInt(req.query.min_trades) });
      }

      const total = await qb.getCount();
      const results = await qb
        .orderBy(`r.${sortField}`, sortOrder as 'ASC' | 'DESC')
        .skip(offset)
        .take(limit)
        .getMany();

      res.json({ results, total });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  router.get('/api/optimization/results/:id/details', authJson, async (req: any, res) => {
    try {
      const repo = app.db.getRepository(OptimizationResult);
      const result = await repo.findOneByOrFail({ id: +req.params.id });

      if (!result.detail_file) {
        res.json({ error: 'No detail file' });
        return;
      }

      const content = await readFile(result.detail_file, 'utf-8');
      const detail = JSON.parse(content);
      detail.variant_index = result.variant_index;
      res.json(detail);
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  router.post('/api/optimization/results/:id/apply', authJson, async (req: any, res) => {
    try {
      const optRepo = app.db.getRepository(OptimizationResult);
      const result = await optRepo.findOneByOrFail({ id: +req.params.id });

      const snapshot = result.strategy_snapshot as any;
      const stratRepo = app.db.getRepository(Strategy);
      const strategy = stratRepo.create({
        pair: snapshot.pair,
        exchange: snapshot.exchange,
        analyzers: snapshot.analyzers,
        buy_threshold: String(snapshot.buy_threshold),
        sell_threshold: String(snapshot.sell_threshold),
        stop_loss_pct: snapshot.stop_loss_pct != null ? String(snapshot.stop_loss_pct) : null,
        money_management: snapshot.money_management,
        active: 0,
      });

      await stratRepo.save(strategy);
      res.json({ status: true, strategy });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // ==================== API: Backtest ====================

  router.post('/api/backtest', authJson, async (req: any, res) => {
    // Long operation — disable timeout
    req.setTimeout(0);
    res.setTimeout(0);
    try {
      const engine = new BacktestEngine(app);
      const result = await engine.run({
        strategyId: req.body.strategyId,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        initialBalance: req.body.initialBalance,
      });
      res.json(result);
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

}
