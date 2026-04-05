import crypto from 'crypto';

export class Config {
  mode: 'dev' | 'prod';
  port: number;
  version: number;

  db: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  };

  redis: {
    url: string;
  };

  binance: {
    apiKey: string;
    privateKey: string;
    demo: boolean;
  };

  bybit: {
    apiKey: string;
    apiSecret: string;
  };

  session: {
    secret: string;
    maxAge: number;
  };

  admin: {
    password: string;
    salt: string;
    hash: string;
  };

  huggingface: {
    apiKey: string;
  };

  cryptopanic: {
    apiKey: string;
  };

  constructor() {
    if (!process.env.dbHost) throw new Error('Env dbHost is required');
    if (!process.env.dbPort) throw new Error('Env dbPort is required');
    if (!process.env.dbUser) throw new Error('Env dbUser is required');
    if (process.env.dbPass === undefined) throw new Error('Env dbPass is required');
    if (!process.env.dbName) throw new Error('Env dbName is required');
    if (!process.env.redisUrl) throw new Error('Env redisUrl is required');
    if (!process.env.adminPass) throw new Error('Env adminPass is required');

    this.mode = process.env.mode === 'prod' ? 'prod' : 'dev';
    this.port = +(process.env.port || 3000);
    this.version = Date.now();

    this.db = {
      host: process.env.dbHost,
      port: +process.env.dbPort,
      database: process.env.dbName,
      username: process.env.dbUser,
      password: process.env.dbPass,
    };

    this.redis = {
      url: process.env.redisUrl,
    };

    this.binance = {
      apiKey: process.env.binanceApiKey || '',
      privateKey: process.env.binancePrivateKey || '',
      demo: process.env.binanceDemo === 'true',
    };

    this.bybit = {
      apiKey: process.env.bybitApiKey || '',
      apiSecret: process.env.bybitApiSecret || '',
    };

    this.session = {
      secret: this.mode === 'dev'
        ? (process.env.sessionSecret || 'dev_session_secret')
        : crypto.randomBytes(32).toString('hex'),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };

    this.admin = {
      password: process.env.adminPass,
      salt: this.mode === 'dev' ? 'dev_salt' : crypto.randomBytes(16).toString('hex'),
      hash: '',
    };

    this.admin.hash = crypto.createHash('md5')
      .update(this.admin.password + this.admin.salt)
      .digest('hex');

    this.huggingface = {
      apiKey: process.env.huggingfaceApiKey || '',
    };

    this.cryptopanic = {
      apiKey: process.env.cryptopanicApiKey || '',
    };

    process.env.TZ = 'UTC';

    console.log(`Mode: ${this.mode}`);
    console.log('[Config] initialized');
  }
}
