import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { App } from '../app/App.js';
import { GridSearchEngine } from './GridSearchEngine.js';
import type { OptimizationConfig } from './types.js';

async function main() {
  const args = process.argv.slice(2);

  const configFile = args.find(a => !a.startsWith('--'));
  if (!configFile) {
    console.error('Usage: npm run optimize -- <config.json> [--force] [--output-dir=./optimization-results]');
    process.exit(1);
  }

  const force = args.includes('--force');
  const outputDirArg = args.find(a => a.startsWith('--output-dir='));
  const outputDir = outputDirArg
    ? resolve(outputDirArg.split('=')[1])
    : resolve('optimization-results');

  // Read and validate config
  let config: OptimizationConfig;
  try {
    const raw = await readFile(resolve(configFile), 'utf-8');
    config = JSON.parse(raw);
  } catch (e: any) {
    console.error(`Failed to read config file: ${e.message}`);
    process.exit(1);
  }

  if (!config.name || !config.backtest || !config.strategy) {
    console.error('Invalid config: must have "name", "backtest", and "strategy" fields');
    process.exit(1);
  }

  if (!config.backtest.startDate || !config.backtest.endDate || !config.backtest.initialBalance) {
    console.error('Invalid config: backtest must have "startDate", "endDate", "initialBalance"');
    process.exit(1);
  }

  if (!config.strategy.pair || !config.strategy.exchange) {
    console.error('Invalid config: strategy must have "pair" and "exchange"');
    process.exit(1);
  }

  // Initialize app
  const app = new App();
  try {
    await app.init();
    console.log('App initialized (DB + Redis)');

    const engine = new GridSearchEngine(app);
    await engine.run(config, outputDir, force);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  } finally {
    await app.shutdown();
    process.exit(0);
  }
}

main();
