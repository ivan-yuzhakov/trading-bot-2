import { Decimal } from 'decimal.js';
import axios from 'axios';
import { Analyzer } from './Analyzer.js';
import type { App } from '../app/App.js';
import type { Candle } from '../candles/types.js';
import type { Signal, AnalyzerConfig, ActiveTrade } from './types.js';

interface NewsSentiment {
  score: number; // -1 to +1
  articles: number;
  lastUpdated: number;
}

/**
 * AI-powered news sentiment analyzer.
 * Periodically fetches crypto news for a specific coin via CryptoPanic API,
 * runs sentiment analysis via HuggingFace (ProsusAI/finbert),
 * caches results in Redis.
 *
 * Pair is always X/USDT — we analyze news for coin X.
 * Skipped during backtesting (returns hold with weight 0).
 */
export class NewsAnalyzer extends Analyzer {
  #refreshIntervalMs: number;
  #refreshTimer: ReturnType<typeof setInterval> | null = null;
  #coin: string = '';

  constructor(app: App, config: AnalyzerConfig) {
    super(app, 'news', config);
    this.#refreshIntervalMs = ((config.refreshIntervalMinutes as number) || 15) * 60 * 1000;
  }

  get supportsBacktest(): boolean {
    return false;
  }

  /** Start periodic news fetching for a coin. Call once per pair. */
  async start(pair: string): Promise<void> {
    // Extract coin from pair (e.g. BTCUSDT → BTC)
    this.#coin = pair.replace(/USDT$/i, '').toUpperCase();

    // Fetch immediately
    await this.#fetchAndAnalyze();

    // Then periodically
    this.#refreshTimer = setInterval(() => {
      this.#fetchAndAnalyze().catch((e) => {
        this.app.logger.error(`[NewsAnalyzer] Refresh error for ${this.#coin}: ${e}`);
      });
    }, this.#refreshIntervalMs);
  }

  stop(): void {
    if (this.#refreshTimer) {
      clearInterval(this.#refreshTimer);
      this.#refreshTimer = null;
    }
  }

  analyze(_candles: Candle[], _currentPrice: string, _trade?: ActiveTrade): Signal {
    // Read cached sentiment from Redis (sync — we read what was cached)
    // Since analyze() is sync, we use a cached value set by the background job
    const cached = this.#getCachedSync();
    if (!cached) {
      return { action: 'hold', weight: '0', reason: 'No news data available' };
    }

    const score = cached.score;

    if (score > 0.3) {
      const weight = Math.min((score - 0.3) / 0.7, 1);
      return { action: 'buy', weight: weight.toFixed(4), reason: `News sentiment positive: ${score.toFixed(2)} (${cached.articles} articles)` };
    }

    if (score < -0.3) {
      const weight = Math.min((-score - 0.3) / 0.7, 1);
      return { action: 'sell', weight: weight.toFixed(4), reason: `News sentiment negative: ${score.toFixed(2)} (${cached.articles} articles)` };
    }

    return { action: 'hold', weight: '0', reason: `News sentiment neutral: ${score.toFixed(2)}` };
  }

  // In-memory cache for sync access from analyze()
  #cachedSentiment: NewsSentiment | null = null;

  #getCachedSync(): NewsSentiment | null {
    return this.#cachedSentiment;
  }

  async #fetchAndAnalyze(): Promise<void> {
    try {
      const headlines = await this.#fetchNews();
      if (headlines.length === 0) {
        this.#cachedSentiment = { score: 0, articles: 0, lastUpdated: Date.now() };
        return;
      }

      const sentiment = await this.#analyzeSentiment(headlines);
      this.#cachedSentiment = {
        score: sentiment,
        articles: headlines.length,
        lastUpdated: Date.now(),
      };

      // Also cache in Redis for persistence across restarts
      const redisKey = `news:sentiment:${this.#coin}`;
      await this.app.redis.client.set(redisKey, JSON.stringify(this.#cachedSentiment), 'EX', Math.floor(this.#refreshIntervalMs / 1000) * 2);

      this.app.logger.log(`[NewsAnalyzer] ${this.#coin}: sentiment=${sentiment.toFixed(3)}, articles=${headlines.length}`);
    } catch (e: any) {
      this.app.logger.error(`[NewsAnalyzer] Error: ${e.message}`);
    }
  }

  async #fetchNews(): Promise<string[]> {
    const apiKey = this.app.config.cryptopanic.apiKey;
    if (!apiKey) {
      return [];
    }

    try {
      // CryptoPanic free API
      const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${apiKey}&currencies=${this.#coin}&kind=news&filter=important`;
      const response = await axios.get(url, { timeout: 10000 });

      if (response.data?.results) {
        return response.data.results
          .slice(0, 20)
          .map((r: any) => r.title as string)
          .filter((t: string) => t);
      }
    } catch (e: any) {
      this.app.logger.error(`[NewsAnalyzer] CryptoPanic fetch error: ${e.message}`);
    }

    return [];
  }

  async #analyzeSentiment(headlines: string[]): Promise<number> {
    const apiKey = this.app.config.huggingface.apiKey;
    if (!apiKey) {
      // Fallback: simple keyword-based sentiment
      return this.#simpleSentiment(headlines);
    }

    try {
      const response = await axios.post(
        'https://api-inference.huggingface.co/models/ProsusAI/finbert',
        { inputs: headlines.slice(0, 10) },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 30000,
        },
      );

      // finbert returns array of [{label, score}] for each input
      let totalScore = 0;
      let count = 0;

      for (const result of response.data) {
        if (Array.isArray(result)) {
          for (const r of result) {
            if (r.label === 'positive') totalScore += r.score;
            else if (r.label === 'negative') totalScore -= r.score;
            count++;
          }
        }
      }

      return count > 0 ? totalScore / count : 0;
    } catch (e: any) {
      this.app.logger.error(`[NewsAnalyzer] HuggingFace error: ${e.message}`);
      return this.#simpleSentiment(headlines);
    }
  }

  /** Fallback keyword-based sentiment when HuggingFace is unavailable */
  #simpleSentiment(headlines: string[]): number {
    const bullish = ['surge', 'rally', 'bull', 'soar', 'gain', 'high', 'buy', 'adoption', 'partnership', 'upgrade', 'breakout', 'moon'];
    const bearish = ['crash', 'plunge', 'bear', 'dump', 'drop', 'low', 'sell', 'hack', 'ban', 'fraud', 'investigation', 'sec'];

    let score = 0;
    for (const h of headlines) {
      const lower = h.toLowerCase();
      for (const w of bullish) if (lower.includes(w)) score += 0.1;
      for (const w of bearish) if (lower.includes(w)) score -= 0.1;
    }

    return Math.max(-1, Math.min(1, score));
  }
}
