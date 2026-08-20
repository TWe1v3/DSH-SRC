import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildViewModel } from './view-model.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const storeFile = path.join(dshHome, 'storages', 'src-sessions.json');
const htmlFile = path.join(dirname, '..', 'ui', 'graph.html');
let routesRegistered = false;

function readStore() {
  try { return JSON.parse(fs.readFileSync(storeFile, 'utf8')); }
  catch { return { schemaVersion: 2, sessions: {} }; }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function dshSrc(ctx) {
  if (!ctx.webServer || routesRegistered) return;
  routesRegistered = true;
  ctx.webServer.register({
    kind: 'exact', path: '/src-graph-api', handler: (_req, res) => sendJson(res, 200, buildViewModel(readStore())),
  });
  ctx.webServer.register({
    kind: 'exact', path: '/src-graph', handler: (_req, res) => {
      try {
        const html = fs.readFileSync(htmlFile, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'self'",
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(html);
      } catch { res.writeHead(404).end('Not Found'); }
    },
  });
}

dshSrc.inject = ['webServer'];
export default dshSrc;
