const dashboard = {
  lang: i18n.lang,
  strategies: [],
  trades: [],
  stats: null,
  balances: {},
  connectivity: {},
  showStrategyForm: false,
  loadingCheck: false,
  loadingBalance: false,
  loadingSave: false,
  loadingToggle: {},
  newStrategy: {
    id: null, pair: '', exchange: 'binance',
    buy_threshold: '0.5', sell_threshold: '0.5', stop_loss_pct: '',
    money_management: { mode: 'fixed', amount: '100', maxConcurrentTrades: 3, maxExposurePerPair: '500', dailyLossLimit: '50' },
    analyzers: [{ name: 'rsi', weight: '1', timeframe: '5m', configStr: '{"period":14,"oversold":30,"overbought":70}' }],
  },
  pollInterval: null,

  emptyStrategy() {
    return {
      id: null, pair: '', exchange: 'binance',
      buy_threshold: '0.5', sell_threshold: '0.5', stop_loss_pct: '',
      money_management: { mode: 'fixed', amount: '100', maxConcurrentTrades: 3, maxExposurePerPair: '500', dailyLossLimit: '50' },
      analyzers: [{ name: 'rsi', weight: '1', timeframe: '5m', configStr: '{"period":14,"oversold":30,"overbought":70}' }],
    };
  },

  async init() {
    this.newStrategy = this.emptyStrategy();
    await this.checkConnectivity('binance');
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
    this.loadingBalance = true;
    try {
      const res = await fetch(`/api/balance/${exchange}`);
      const data = await res.json();
      if (!data.error) this.balances = { ...this.balances, [exchange]: data };
      else alert(data.error);
    } catch (e) { console.error(e); }
    finally { this.loadingBalance = false; }
  },

  async checkConnectivity(exchange) {
    this.loadingCheck = true;
    try {
      const res = await fetch(`/api/connectivity/${exchange}`);
      const data = await res.json();
      this.connectivity = { ...this.connectivity, [exchange]: data.connected };
    } catch (e) { this.connectivity = { ...this.connectivity, [exchange]: false }; }
    finally { this.loadingCheck = false; }
  },

  async saveStrategy() {
    const s = { ...this.newStrategy };
    try {
      s.analyzers = s.analyzers.map(a => ({
        name: a.name,
        weight: a.weight,
        timeframe: a.timeframe || '5m',
        config: JSON.parse(a.configStr || '{}'),
      }));
    } catch (e) {
      alert(i18n.t('invalidJson'));
      return;
    }

    this.loadingSave = true;
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
        alert(data.error || 'Error');
      }
    } catch (e) { alert('Error: ' + e.message); }
    finally { this.loadingSave = false; }
  },

  async toggleStrategy(id, currentActive) {
    const closePosition = currentActive ? confirm(i18n.t('closePosition')) : false;
    this.loadingToggle = { ...this.loadingToggle, [id]: true };
    try {
      await fetch(`/api/strategies/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closePosition }),
      });
      await this.loadStrategies();
    } catch (e) { console.error(e); }
    finally { this.loadingToggle = { ...this.loadingToggle, [id]: false }; }
  },

  t(key) {
    // Reference this.lang to create Alpine reactivity dependency
    const lang = this.lang;
    return i18n._translations[lang]?.[key] || i18n._translations.en[key] || key;
  },

  toggleLang() {
    const newLang = this.lang === 'en' ? 'ru' : 'en';
    i18n.setLang(newLang);
    this.lang = newLang;
  },

  analyzerDefaults: {
    rsi: '{"period":14,"oversold":30,"overbought":70}',
    bollinger: '{"period":20,"stdDev":2}',
    ma_cross: '{"fastPeriod":9,"slowPeriod":21}',
    macd: '{"fastPeriod":12,"slowPeriod":26,"signalPeriod":9}',
    volume: '{"period":20}',
    profit_target: '{"targetPct":1.0}',
    stop_loss: '{"lossPct":2.0}',
    news: '{"refreshIntervalMinutes":15}',
  },

  addAnalyzer() {
    this.newStrategy.analyzers.push({ name: 'rsi', weight: '1', timeframe: '5m', configStr: this.analyzerDefaults.rsi });
  },

  onAnalyzerChange(idx) {
    const a = this.newStrategy.analyzers[idx];
    a.configStr = this.analyzerDefaults[a.name] || '{}';
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
        timeframe: a.timeframe || '5m',
        configStr: JSON.stringify(a.config),
      })),
    };
    this.showStrategyForm = true;
  },
};
