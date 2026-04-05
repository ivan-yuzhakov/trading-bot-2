import { Redis as IORedis } from 'ioredis';
import type { App } from './App.js';

export class Redis {
  #app: App;
  client: IORedis;

  constructor(app: App) {
    this.#app = app;
    this.client = new IORedis(app.config.redis.url);
  }

  async init(): Promise<void> {
    try {
      const result = await this.client.ping();
      if (result !== 'PONG') throw new Error('Redis ping failed');
    } catch (e) {
      console.error('No connection to Redis', this.#app.config.redis.url);
      console.error('Error:', JSON.stringify(e));
      process.exit(0);
    }

    console.log('[Redis] initialized');
  }
}
