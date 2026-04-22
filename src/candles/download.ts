import 'reflect-metadata';
import { App } from '../app/App.js';
import { BacktestEngine } from '../backtesting/BacktestEngine.js';

async function main() {
  const args = process.argv.slice(2);

  const pair = args.find(a => !a.startsWith('--'));
  const startArg = args.find(a => a.startsWith('--from='));
  const endArg = args.find(a => a.startsWith('--to='));
  const exchangeArg = args.find(a => a.startsWith('--exchange='));

  if (!pair || !startArg || !endArg) {
    console.error('Usage: npm run candles -- ETHUSDT --from=2020-01-01 --to=2026-03-31 [--exchange=binance]');
    process.exit(1);
  }

  const exchange = exchangeArg ? exchangeArg.split('=')[1] : 'binance';
  const startDate = new Date(startArg.split('=')[1]).getTime();
  const endDate = new Date(endArg.split('=')[1]).getTime();

  if (isNaN(startDate) || isNaN(endDate)) {
    console.error('Invalid date format. Use YYYY-MM-DD.');
    process.exit(1);
  }

  if (startDate >= endDate) {
    console.error('--from must be before --to');
    process.exit(1);
  }

  const app = new App();
  try {
    await app.init();
    const engine = new BacktestEngine(app);
    await engine.ensureCandles(exchange, pair, startDate, endDate);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  } finally {
    await app.shutdown();
    process.exit(0);
  }
}

main();
