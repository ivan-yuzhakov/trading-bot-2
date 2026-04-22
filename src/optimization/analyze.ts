import 'reflect-metadata';
import { App } from '../app/App.js';
import { OptimizationResult } from '../entity/OptimizationResult.js';
import { readFile } from 'node:fs/promises';

async function main() {
  const args = process.argv.slice(2);
  const runId = args.find(a => a.startsWith('--run='))?.split('=')[1];
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '10');
  const orderBy = args.find(a => a.startsWith('--order='))?.split('=')[1] || 'profit';
  const showTrades = args.includes('--trades');
  const variantIdx = args.find(a => a.startsWith('--variant='))?.split('=')[1];

  const app = new App();
  try {
    await app.init();
    const repo = app.db.getRepository(OptimizationResult);

    const dbId = args.find(a => a.startsWith('--id='))?.split('=')[1];
    if (dbId) {
      const r = await repo.findOneBy({ id: parseInt(dbId) });
      if (!r) { console.log('Not found'); return; }
      console.log(`\n=== DB id=${r.id} | run=${r.run_id} | variant_index=${r.variant_index} ===`);
      console.log(`Profit: ${r.total_profit_pct}% (${r.total_profit})`);
      console.log(`Trades: ${r.total_trades} | Win: ${r.win_rate}% | DD: ${r.max_drawdown}%`);
      console.log(`PF: ${r.profit_factor} | AvgTrade: ${r.avg_profit_per_trade} | AvgDur: ${r.avg_trade_duration}s`);
      console.log(`Best: ${r.best_trade_profit} | Worst: ${r.worst_trade_profit}`);
      console.log(`Strategy snapshot:`, JSON.stringify(r.strategy_snapshot, null, 2));
      if (showTrades && r.detail_file) {
        const data = JSON.parse(await readFile(r.detail_file, 'utf-8'));
        console.log(`\n--- Trades (${data.trades.length}) ---`);
        for (const t of data.trades) {
          const dur = ((t.exitTime - t.entryTime) / 60000).toFixed(0);
          const sign = parseFloat(t.profit) >= 0 ? '+' : '';
          console.log(`  ${new Date(t.entryTime).toISOString().slice(0, 16)} → ${new Date(t.exitTime).toISOString().slice(11, 16)} ` +
                      `(${dur}m) | entry=${t.entryPrice} exit=${t.exitPrice} | ${sign}${t.profitPct}% (${sign}${t.profit})`);
        }
      }
      return;
    }

    if (variantIdx) {
      // Show details of one variant
      const idx = parseInt(variantIdx);
      const r = await repo.findOneBy({ run_id: runId, variant_index: idx });
      if (!r) { console.log('Not found'); return; }
      console.log(`\n=== Variant #${r.variant_index} ===`);
      console.log(`Profit: ${r.total_profit_pct}% (${r.total_profit})`);
      console.log(`Trades: ${r.total_trades} | Win: ${r.win_rate}% | DD: ${r.max_drawdown}%`);
      console.log(`PF: ${r.profit_factor} | AvgTrade: ${r.avg_profit_per_trade} | AvgDur: ${r.avg_trade_duration}s`);
      console.log(`Best: ${r.best_trade_profit} | Worst: ${r.worst_trade_profit}`);
      console.log(`Params:`, JSON.stringify(r.params, null, 2));

      if (showTrades && r.detail_file) {
        const data = JSON.parse(await readFile(r.detail_file, 'utf-8'));
        console.log(`\n--- Trades (${data.trades.length}) ---`);
        for (const t of data.trades) {
          const dur = ((t.exitTime - t.entryTime) / 60000).toFixed(0);
          const sign = parseFloat(t.profit) >= 0 ? '+' : '';
          console.log(`  ${new Date(t.entryTime).toISOString().slice(0, 16)} → ${new Date(t.exitTime).toISOString().slice(11, 16)} ` +
                      `(${dur}m) | entry=${t.entryPrice} exit=${t.exitPrice} | ${sign}${t.profitPct}% (${sign}${t.profit})`);
        }
      }
      return;
    }

    // List runs if no run_id
    if (!runId) {
      const runs = await repo.createQueryBuilder('r')
        .select('r.run_id', 'run_id')
        .addSelect('MAX(r.run_name)', 'run_name')
        .addSelect('MAX(r.total_variants)', 'total_variants')
        .addSelect('COUNT(*)', 'completed')
        .addSelect('MAX(r.total_profit_pct)', 'best_profit')
        .addSelect('MAX(r.created_at)', 'last_at')
        .groupBy('r.run_id')
        .orderBy('MAX(r.created_at)', 'DESC')
        .limit(20)
        .getRawMany();
      console.log('\nRuns:');
      for (const r of runs) {
        console.log(`  ${r.run_id} | ${r.run_name?.slice(0, 50)} | ${r.completed}/${r.total_variants} | best: ${r.best_profit}%`);
      }
      return;
    }

    // Top variants for a run
    const orderField = orderBy === 'win_rate' ? 'win_rate' :
                       orderBy === 'pf' ? 'profit_factor' :
                       orderBy === 'dd' ? 'max_drawdown' :
                       orderBy === 'trades' ? 'total_trades' :
                       'total_profit_pct';
    const direction = orderBy === 'dd' ? 'ASC' : 'DESC';

    const top = await repo.find({
      where: { run_id: runId, status: 'completed' },
      order: { [orderField]: direction },
      take: limit,
    });

    const total = await repo.count({ where: { run_id: runId } });
    const profitable = await repo.count({ where: { run_id: runId, status: 'completed' } as any });

    console.log(`\nRun: ${runId} | Total in DB: ${total}`);
    console.log(`\nTop ${limit} by ${orderBy}:`);
    console.log('idx  | profit% | balance | trades | win%  | DD%   | PF    | avgTrade | avgDur | best%   | worst%  | params');
    for (const r of top) {
      const params = Object.entries(r.params as Record<string, any>)
        .map(([k, v]) => `${k.replace('analyzers[0].config.', 'a0.').replace('analyzers[1].config.', 'a1.').replace('analyzers[2].config.', 'a2.').replace('analyzers[3].config.', 'a3.')}=${v}`)
        .join(' ');
      console.log(
        `${String(r.variant_index).padStart(4)} | ` +
        `${String(r.total_profit_pct).padStart(7)} | ` +
        `${String(r.final_balance).padStart(7)} | ` +
        `${String(r.total_trades).padStart(6)} | ` +
        `${String(r.win_rate).padStart(5)} | ` +
        `${String(r.max_drawdown).padStart(5)} | ` +
        `${String(r.profit_factor).padStart(5)} | ` +
        `${String(r.avg_profit_per_trade).padStart(8)} | ` +
        `${String(r.avg_trade_duration).padStart(6)} | ` +
        `${String(r.best_trade_profit).padStart(7)} | ` +
        `${String(r.worst_trade_profit).padStart(7)} | ` +
        `${params}`
      );
    }

    // Distribution stats
    const all = await repo.find({ where: { run_id: runId, status: 'completed' } });
    if (all.length > 0) {
      const profits = all.map(r => parseFloat(r.total_profit_pct)).sort((a, b) => a - b);
      const wins = all.map(r => parseFloat(r.win_rate)).sort((a, b) => a - b);
      const dds = all.map(r => parseFloat(r.max_drawdown)).sort((a, b) => a - b);
      const positive = profits.filter(p => p > 0).length;
      console.log(`\n--- Distribution (${all.length} variants) ---`);
      console.log(`Profitable: ${positive} (${(positive / all.length * 100).toFixed(1)}%)`);
      console.log(`Profit% — min: ${profits[0].toFixed(2)} | median: ${profits[Math.floor(profits.length / 2)].toFixed(2)} | max: ${profits[profits.length - 1].toFixed(2)}`);
      console.log(`Win% — min: ${wins[0].toFixed(2)} | median: ${wins[Math.floor(wins.length / 2)].toFixed(2)} | max: ${wins[wins.length - 1].toFixed(2)}`);
      console.log(`DD% — min: ${dds[0].toFixed(2)} | median: ${dds[Math.floor(dds.length / 2)].toFixed(2)} | max: ${dds[dds.length - 1].toFixed(2)}`);
    }
  } finally {
    await app.shutdown();
    process.exit(0);
  }
}

main();
