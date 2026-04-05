const backtestPage = {
  lang: i18n.lang,
  strategies: [],
  config: {
    strategyId: '',
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    initialBalance: '10000',
  },
  result: null,
  running: false,
  progress: 0,
  statusText: '',
  chart: null,
  candleSeries: null,
  equitySeries: null,
  markers: [],
  ws: null,

  async init() {
    try {
      const res = await fetch('/api/strategies');
      const data = await res.json();
      if (!data.error) {
        this.strategies = data;
        if (data.length > 0) this.config.strategyId = data[0].id;
      }
    } catch (e) { console.error(e); }
  },

  runBacktest() {
    this.running = true;
    this.result = null;
    this.progress = 0;
    this.statusText = this.t('runningBacktest');
    this.markers = [];

    // Init chart immediately
    this.initChart();

    // Connect WebSocket
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws/backtest`);

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: 'run',
        config: {
          strategyId: +this.config.strategyId,
          startDate: new Date(this.config.startDate).getTime(),
          endDate: new Date(this.config.endDate).getTime(),
          initialBalance: this.config.initialBalance,
        },
      }));
    };

    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      this.handleMessage(msg);
    };

    this.ws.onerror = () => {
      this.statusText = 'WebSocket error';
      this.running = false;
    };

    this.ws.onclose = () => {
      if (this.running) {
        this.statusText = 'Connection lost';
        this.running = false;
      }
    };
  },

  handleMessage(msg) {
    switch (msg.type) {
      case 'status':
        this.statusText = msg.message;
        break;

      case 'progress':
        this.progress = Math.round(msg.processed / msg.total * 100);
        this.statusText = `${this.t('runningBacktest')} ${this.progress}%`;
        break;

      case 'candles':
        if (this.candleSeries) {
          this.candleSeries.setData(msg.data.map(c => ({
            time: Math.floor(c.t / 1000),
            open: parseFloat(c.o),
            high: parseFloat(c.h),
            low: parseFloat(c.l),
            close: parseFloat(c.c),
          })));
          this.chart.timeScale().fitContent();
        }
        break;

      case 'trade':
        if (msg.action === 'buy') {
          this.markers.push({
            time: Math.floor(msg.time / 1000),
            position: 'belowBar',
            color: '#e8b820',
            shape: 'arrowUp',
            text: 'BUY',
          });
        } else {
          const color = parseFloat(msg.profit) >= 0 ? '#27ae60' : '#e74c3c';
          this.markers.push({
            time: Math.floor(msg.time / 1000),
            position: 'aboveBar',
            color,
            shape: 'arrowDown',
            text: `SELL ${msg.profitPct}%`,
          });
        }
        if (this.candleSeries) {
          this.candleSeries.setMarkers([...this.markers].sort((a, b) => a.time - b.time));
        }
        break;

      case 'equity':
        if (this.equitySeries) {
          // Append equity point
          this.equitySeries.update({
            time: Math.floor(msg.time / 1000),
            value: parseFloat(msg.equity),
          });
        }
        break;

      case 'done':
        this.result = msg;
        this.running = false;
        this.progress = 100;
        this.statusText = '';
        if (this.ws) { this.ws.close(); this.ws = null; }
        break;

      case 'error':
        alert(msg.message);
        this.running = false;
        if (this.ws) { this.ws.close(); this.ws = null; }
        break;
    }
  },

  initChart() {
    const container = document.getElementById('chart-container');
    if (!container || typeof LightweightCharts === 'undefined') return;
    container.innerHTML = '';

    this.chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: 500,
      layout: { background: { color: '#0a0a0a' }, textColor: '#888' },
      grid: { vertLines: { color: '#151515' }, horzLines: { color: '#151515' } },
      timeScale: { timeVisible: true },
      crosshair: { mode: 0 },
    });

    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: '#27ae60', downColor: '#e74c3c',
      wickUpColor: '#27ae60', wickDownColor: '#e74c3c',
      borderVisible: false,
    });

    this.equitySeries = this.chart.addLineSeries({
      color: '#e8b820', lineWidth: 2,
      priceScaleId: 'equity',
    });

    this.chart.priceScale('equity').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
  },

  t(key) {
    const lang = this.lang;
    return i18n._translations[lang]?.[key] || i18n._translations.en[key] || key;
  },

  toggleLang() {
    const newLang = this.lang === 'en' ? 'ru' : 'en';
    i18n.setLang(newLang);
    this.lang = newLang;
  },
};
