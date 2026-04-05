import { Decimal } from 'decimal.js';
import type { App } from '../app/App.js';
import type { MoneyManagementConfig } from './types.js';
import { Trade } from '../entity/Trade.js';
import { Between } from 'typeorm';

export class MoneyManager {
  #app: App;

  constructor(app: App) {
    this.#app = app;
  }

  /** Calculate position size based on money management config. */
  calculateQuantity(balance: string, price: string, config: MoneyManagementConfig): string {
    let amount: Decimal;

    if (config.mode === 'percentage') {
      amount = new Decimal(balance).times(config.amount).dividedBy(100);
    } else {
      amount = new Decimal(config.amount);
    }

    // Ensure we don't exceed balance
    amount = Decimal.min(amount, balance);

    // Convert to quantity at current price
    const quantity = amount.dividedBy(price);
    return quantity.toDecimalPlaces(8).toString();
  }

  /** Check if we can open a new trade for a strategy. */
  async canOpenTrade(strategyId: number, config: MoneyManagementConfig): Promise<{ allowed: boolean; reason?: string }> {
    const tradeRepo = this.#app.db.getRepository(Trade);

    // Check max concurrent trades
    const openTrades = await tradeRepo.count({
      where: { strategy_id: strategyId, status: 'open' },
    });

    if (openTrades >= config.maxConcurrentTrades) {
      return { allowed: false, reason: `Max concurrent trades reached (${openTrades}/${config.maxConcurrentTrades})` };
    }

    // Check daily loss limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 19).replace('T', ' ');

    const closedToday = await tradeRepo.find({
      where: {
        strategy_id: strategyId,
        status: 'closed',
        closed_at: Between(todayStr, new Date().toISOString().slice(0, 19).replace('T', ' ')),
      },
    });

    let dailyPnl = new Decimal(0);
    for (const t of closedToday) {
      if (t.profit) dailyPnl = dailyPnl.plus(t.profit);
    }

    const dailyLimit = new Decimal(config.dailyLossLimit);
    if (dailyLimit.greaterThan(0) && dailyPnl.lessThan(dailyLimit.negated())) {
      return { allowed: false, reason: `Daily loss limit reached (${dailyPnl.toString()} < -${config.dailyLossLimit})` };
    }

    return { allowed: true };
  }
}
