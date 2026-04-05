function dashboard() {
  return {
    strategies: [],
    trades: [],
    stats: {},
    balances: {},
    connectivity: {},
    showStrategyForm: false,
    newStrategy: this.emptyStrategy(),
    pollInterval: null,

    emptyStrategy() {
      return {
        id: null,
        pair: '',
        exchange: 'binance',
        buy_threshold: '0.5',
        sell_threshold: '0.5',
        stop_loss_pct: '',
        money_management: {
          mode: 'fixed',
          amount: '100',
          maxConcurrentTrades: 3,
          maxExposurePerPair: '500',
          dailyLossLimit: '50',
        },
        analyzers: [
          { name: 'rsi', weight: '1', configStr: '{"period":14}' },
        ],
      };
    },

    async init() {
      this.newStrategy = this.emptyStrategy();
      await this.refresh();
      this.pollInterval = setInterval(() => this.refresh(), 10000);
    },

    async refresh() {
      await Promise.all([
        this.loadStrategies(),
        this.loadTrades(),
        this.loadStats(),
      ]);
    },

    async loadStrategies() {
      try {
        const res = await fetch('/api/strategies');
        const data = await res.json();
        if (!data.error) this.strategies = data;
      } catch (e) { console.error(e); }
    },

    async loadTrades() {
      try {
        const res = await fetch('/api/trades');
        const data = await res.json();
        if (!data.error) this.trades = data;
      } catch (e) { console.error(e); }
    },

    async loadStats() {
      try {
        const res = await fetch('/api/statistics');
        const data = await res.json();
        if (!data.error) this.stats = data;
      } catch (e) { console.error(e); }
    },

    async loadBalance(exchange) {
      try {
        const res = await fetch(`/api/balance/${exchange}`);
        const data = await res.json();
        if (!data.error) this.balances[exchange] = data;
      } catch (e) { console.error(e); }
    },

    async checkConnectivity(exchange) {
      try {
        const res = await fetch(`/api/connectivity/${exchange}`);
        const data = await res.json();
        this.connectivity[exchange] = data.connected;
      } catch (e) { this.connectivity[exchange] = false; }
    },

    async saveStrategy() {
      const s = { ...this.newStrategy };
      s.analyzers = s.analyzers.map(a => ({
        name: a.name,
        weight: a.weight,
        config: JSON.parse(a.configStr || '{}'),
      }));

      try {
        const res = await fetch('/api/strategies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(s),
        });
        const data = await res.json();
        if (data.status) {
          this.showStrategyForm = false;
          this.newStrategy = this.emptyStrategy();
          await this.loadStrategies();
        } else {
          alert(data.error || 'Error saving strategy');
        }
      } catch (e) { alert('Error: ' + e.message); }
    },

    async toggleStrategy(id, currentActive) {
      const closePosition = currentActive ? confirm('Close open position?') : false;
      try {
        await fetch(`/api/strategies/${id}/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ closePosition }),
        });
        await this.loadStrategies();
      } catch (e) { console.error(e); }
    },

    editStrategy(s) {
      this.newStrategy = {
        id: s.id,
        pair: s.pair,
        exchange: s.exchange,
        buy_threshold: s.buy_threshold,
        sell_threshold: s.sell_threshold,
        stop_loss_pct: s.stop_loss_pct || '',
        money_management: { ...s.money_management },
        analyzers: s.analyzers.map(a => ({
          name: a.name,
          weight: a.weight,
          configStr: JSON.stringify(a.config),
        })),
      };
      this.showStrategyForm = true;
    },
  };
}
