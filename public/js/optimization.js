const optimizationPage = {
  lang: i18n.lang,
  runs: [],
  selectedRunId: null,
  results: [],
  totalResults: 0,
  page: 0,
  pageSize: 50,
  sortField: 'total_profit_pct',
  sortOrder: 'desc',
  filterMinProfit: '',
  filterMinWinRate: '',
  filterMinTrades: '',
  loadingResults: false,
  detailData: null,

  t(key) { return i18n.t(key); },
  toggleLang() {
    this.lang = this.lang === 'en' ? 'ru' : 'en';
    i18n.setLang(this.lang);
  },

  async init() {
    await this.loadRuns();
  },

  async loadRuns() {
    try {
      const res = await fetch('/api/optimization/runs');
      const data = await res.json();
      if (data.error) return;
      this.runs = data;
    } catch (e) { console.error(e); }
  },

  async selectRun(runId) {
    this.selectedRunId = runId;
    this.page = 0;
    await this.loadResults();
  },

  async loadResults() {
    if (!this.selectedRunId) return;
    this.loadingResults = true;
    try {
      const params = new URLSearchParams({
        run_id: this.selectedRunId,
        sort: this.sortField,
        order: this.sortOrder,
        limit: String(this.pageSize),
        offset: String(this.page * this.pageSize),
      });
      if (this.filterMinProfit) params.set('min_profit', this.filterMinProfit);
      if (this.filterMinWinRate) params.set('min_win_rate', this.filterMinWinRate);
      if (this.filterMinTrades) params.set('min_trades', this.filterMinTrades);

      const res = await fetch('/api/optimization/results?' + params);
      const data = await res.json();
      if (data.error) return;
      this.results = data.results;
      this.totalResults = data.total;
    } catch (e) { console.error(e); }
    this.loadingResults = false;
  },

  sortBy(field) {
    if (this.sortField === field) {
      this.sortOrder = this.sortOrder === 'desc' ? 'asc' : 'desc';
    } else {
      this.sortField = field;
      this.sortOrder = 'desc';
    }
    this.page = 0;
    this.loadResults();
  },

  prevPage() {
    if (this.page > 0) { this.page--; this.loadResults(); }
  },

  nextPage() {
    if ((this.page + 1) * this.pageSize < this.totalResults) { this.page++; this.loadResults(); }
  },

  formatParams(params) {
    if (!params || typeof params !== 'object') return '';
    return Object.entries(params)
      .map(([k, v]) => {
        const short = k
          .replace(/analyzers\[(\d+)\]\.config\./, 'a$1.')
          .replace(/analyzers\[(\d+)\]\./, 'a$1.')
          .replace(/money_management\./, 'mm.');
        return short + '=' + v;
      })
      .join(', ');
  },

  async showDetails(id) {
    try {
      const res = await fetch('/api/optimization/results/' + id + '/details');
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      this.detailData = data;
    } catch (e) { console.error(e); }
  },

  async applyAsStrategy(id) {
    if (!confirm(this.t('optApplyConfirm'))) return;
    try {
      const res = await fetch('/api/optimization/results/' + id + '/apply', { method: 'POST' });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      alert(this.t('optApplySuccess') + ' (ID: ' + data.strategy.id + ')');
    } catch (e) { console.error(e); }
  },
};
