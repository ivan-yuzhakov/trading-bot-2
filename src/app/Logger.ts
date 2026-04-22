import type { App } from './App.js';
import { Log } from '../entity/Log.js';

export class Logger {
  #app: App;
  #running: number;
  #closed = false;
  #pending: Set<Promise<void>> = new Set();

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
    this.#enqueue('info', text, send);
  }

  error(text: string): void {
    console.error(text);
    this.#enqueue('error', text, true);
  }

  /** Wait for all pending writes then stop accepting new ones. */
  async close(): Promise<void> {
    this.#closed = true;
    await Promise.allSettled(this.#pending);
  }

  #enqueue(level: string, description: string, send: boolean): void {
    if (this.#closed) return;
    const p = this.#write(level, description, send);
    this.#pending.add(p);
    p.finally(() => this.#pending.delete(p));
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
