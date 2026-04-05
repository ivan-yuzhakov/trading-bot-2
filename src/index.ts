import 'reflect-metadata';
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import { WebSocketServer } from 'ws';
import { App } from './app/App.js';
import { registerAdminRoutes } from './admin/routes.js';
import { BacktestEngine } from './backtesting/BacktestEngine.js';

const MySQLStore = MySQLStoreFactory(session as any);

const app = new App();
const server = express();

const sessionStore = new MySQLStore({
  host: app.config.db.host,
  port: app.config.db.port,
  user: app.config.db.username,
  password: app.config.db.password,
  database: app.config.db.database,
});

server.use(session({
  secret: app.config.session.secret,
  store: sessionStore as any,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: app.config.session.maxAge,
  },
}));

server.use('/public', express.static('public'));
server.use(express.json());
server.use(express.urlencoded({ extended: true }));

server.use((req: any, _res, next) => {
  req.auth = req.session?.auth === app.config.admin.hash;
  next();
});

server.set('twig options', {
  allowAsync: true,
  strict_variables: false,
});

server.set('views', './views');
server.set('view engine', 'twig');

server.locals['version'] = app.config.version;

registerAdminRoutes(server, app);

server.get('/', (req: any, res) => {
  if (!req.auth) {
    return res.render('auth.twig', {});
  }
  res.render('admin.twig', { auth: true });
});

server.post('/auth', (req: any, res) => {
  if (!req.auth) {
    const password = String(req.body.password);
    if (password !== app.config.admin.password) {
      return res.json({ error: 'Wrong password' });
    }
  }
  req.session.auth = app.config.admin.hash;
  return res.json({ status: true });
});

server.all('/{*path}', (_req, res) => {
  res.redirect('/');
});

(async () => {
  await app.init();

  const httpServer = server.listen(app.config.port, () => {
    app.logger.log(`Server starts http://127.0.0.1:${app.config.port}`, app.config.mode === 'prod');
  });

  // WebSocket server for backtest streaming
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/backtest' });
  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'run') {
          const engine = new BacktestEngine(app);
          await engine.runStreaming(msg.config, (event) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify(event));
            }
          });
        }
      } catch (e: any) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
        }
      }
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    httpServer.close();
    await app.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
