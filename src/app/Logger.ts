import type { App } from './App.js';
import { Log } from '../entity/Log.js';

export class Logger {
  #app: App;
  #running: number;

  constructor(app: App) {
    this.#app = app;
    this.#running = Math.floor(Date.now() / 1000);

    process.on('uncaughtException', (err) => {
      this.error(`Uncaught Exception: ${err.message}\n${err.stack}`);
    });

    process.on('unhandledRejection', (reason) => {
      this.error(`Unhandled Rejection: ${String(reason)}`);
    });
  }

  log(text: string, send: boolean = false): void {
    console.log(text);
    this.#write('info', text, send);
  }

  error(text: string): void {
    console.error(text);
    this.#write('error', text, true);
  }

  async #write(level: string, description: string, send: boolean): Promise<void> {
    try {
      const repo = this.#app.db.getRepository(Log);
      const log = repo.create({
        running: this.#running,
        level,
        description,
        sent: send ? 1 : 0,
      });
      await repo.save(log);
    } catch (e) {
      console.error('Logger write failed:', e);
    }
  }
}
