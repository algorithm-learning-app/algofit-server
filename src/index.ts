import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createSqliteStore } from './storage/sqlite.js';

const config = loadConfig();

if (config.dbPath !== ':memory:') {
  mkdirSync(dirname(config.dbPath), { recursive: true });
}

const store = createSqliteStore(config.dbPath);
const app = createApp({ store, secret: config.secret });

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    console.log(
      `algofit-server listening on http://${config.host}:${info.port} (db: ${config.dbPath})`,
    );
  },
);

function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
