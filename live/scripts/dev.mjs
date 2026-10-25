import { migrateLocal } from './migrate-local.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import worker from '../server/worker.mjs';
import { sqliteDB } from './sqlite-adapter.mjs';
process.chdir((await import('node:url')).fileURLToPath(new URL('..', import.meta.url)));
try {
  process.loadEnvFile('.env');
} catch {}
await fs.mkdir('.runtime', { recursive: true });
const db = sqliteDB(process.env.ORIA_DB_PATH || '.runtime/oria.sqlite');
migrateLocal(db);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};
const env = {
  DB: db,
  OWNER_EMAIL: process.env.OWNER_EMAIL || '',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  APP_ORIGIN: process.env.APP_ORIGIN || 'http://localhost:8787',
  ASSETS: {
    async fetch(req) {
      const pathname = decodeURIComponent(new URL(req.url).pathname),
        file = path.resolve('public', '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(path.resolve('public') + path.sep))
        return new Response('Not found', { status: 404 });
      try {
        return new Response(await fs.readFile(file), {
          headers: { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    },
  },
};
http
  .createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(env.APP_ORIGIN + req.url, {
        method: req.method,
        headers: req.headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      const result = await worker.fetch(request, env);
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end('Server error');
    }
  })
  .listen(Number(process.env.PORT || 8787), '0.0.0.0', () =>
    console.log('Oria live development: http://localhost:8787 (Google configuration required)'),
  );
