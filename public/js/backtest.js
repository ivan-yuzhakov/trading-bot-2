function backtest() {
  return {
    strategies: [],
    config: {
      strategyId: '',
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      initialBalance: '10000',
    },
    result: null,
    running: false,
    chart: null,

    async init() {
      const res = await fetch('/api/strategies');
      const data = await res.json();
      if (!data.error) {
        this.strategies = data;
        if (data.length > 0) this.config.strategyId = data[0].id;
      }
    },

    async runBacktest() {
      this.running = true;
      this.result = null;

      try {
        const res = await fetch('/api/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            strategyId: +this.config.strategyId,
            startDate: new Date(this.config.startDate).getTime(),
            endDate: new Date(this.config.endDate).getTime(),
            initialBalance: this.config.initialBalance,
          }),
        });

        const data = await res.json();
        if (data.error) {
          alert(data.error);
          return;
        }

        this.result = data;
        this.$nextTick(() => this.renderChart(data));
      } catch (e) {
        alert('Error: ' + e.message);
      } finally {
        this.running = false;
      }
    },

    renderChart(data) {
      const container = document.getElementById('chart-container');
      if (!container) return;
      container.innerHTML = '';

      if (typeof LightweightCharts === 'undefined') {
        container.textContent = 'Chart library not loaded';
        return;
      }

      const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 500,
        layout: {
          background: { color: '#1a1a2e' },
          textColor: '#e0e0e0',
        },
        grid: {
          vertLines: { color: '#2a2a4a' },
          horzLines: { color: '#2a2a4a' },
        },
        timeScale: { timeVisible: true },
      });

      // Candlestick series
      if (data.candles && data.candles.length > 0) {
        const candleSeries = chart.addCandlestickSeries({
          upColor: '#00d4ff',
          downColor: '#ff6b6b',
          wickUpColor: '#00d4ff',
          wickDownColor: '#ff6b6b',
        });

        candleSeries.setData(data.candles.map(c => ({
          time: Math.floor(c.t / 1000),
          open: parseFloat(c.o),
          high: parseFloat(c.h),
          low: parseFloat(c.l),
          close: parseFloat(c.c),
        })));

        // Trade markers
        if (data.trades && data.trades.length > 0) {
          const markers = [];
          for (const t of data.trades) {
            if (t.entryTime) {
              markers.push({
                time: Math.floor(t.entryTime / 1000),
                position: 'belowBar',
                color: '#00d4ff',
                shape: 'arrowUp',
                text: 'BUY',
              });
            }
            if (t.exitTime) {
              markers.push({
                time: Math.floor(t.exitTime / 1000),
                position: 'aboveBar',
                color: '#ff6b6b',
                shape: 'arrowDown',
                text: 'SELL',
              });
            }
          }
          markers.sort((a, b) => a.time - b.time);
          candleSeries.setMarkers(markers);
        }
      }

      // Equity curve
      if (data.equityCurve && data.equityCurve.length > 0) {
        const equitySeries = chart.addLineSeries({
          color: '#ffd700',
          lineWidth: 2,
          priceScaleId: 'right',
        });

        equitySeries.setData(data.equityCurve.map(e => ({
          time: Math.floor(e.time / 1000),
          value: parseFloat(e.equity),
        })));
      }

      chart.timeScale().fitContent();
      this.chart = chart;
    },
  };
}
