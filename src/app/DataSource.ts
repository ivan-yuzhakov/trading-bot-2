import { DataSource } from 'typeorm';
import type { Config } from './Config.js';
import { Strategy } from '../entity/Strategy.js';
import { Trade } from '../entity/Trade.js';
import { TradeStep } from '../entity/TradeStep.js';
import { CandleSyncState } from '../entity/CandleSyncState.js';
import { Log } from '../entity/Log.js';
import { OptimizationResult } from '../entity/OptimizationResult.js';

export function createDataSource(config: Config): DataSource {
  return new DataSource({
    type: 'mysql',
    host: config.db.host,
    port: config.db.port,
    username: config.db.username,
    password: config.db.password,
    database: config.db.database,
    synchronize: false,
    logging: false,
    entities: [Strategy, Trade, TradeStep, CandleSyncState, Log, OptimizationResult],
    dateStrings: true,
  });
}
