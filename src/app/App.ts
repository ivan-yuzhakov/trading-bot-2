import { DataSource } from 'typeorm';
import { Config } from './Config.js';
import { Logger } from './Logger.js';
import { Redis } from './Redis.js';
import { createDataSource } from './DataSource.js';
import { TradeManager } from '../trading/TradeManager.js';

export class App {
  config: Config;
  logger: Logger;
  db: DataSource;
  redis: Redis;
  tradeManager: TradeManager;

  constructor() {
    this.config = new Config();
    this.logger = new Logger(this);
    this.db = createDataSource(this.config);
    this.redis = new Redis(this);
    this.tradeManager = new TradeManager(this);
  }

  async init(): Promise<void> {
    await this.db.initialize();
    this.logger.log('[Database] initialized');

    await this.redis.init();
    await this.tradeManager.init();
  }

  async shutdown(): Promise<void> {
    await this.tradeManager.shutdown();
    await this.db.destroy();
    this.redis.client.disconnect();
  }
}
