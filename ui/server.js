#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildViewModel } from '../lib/view-model.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const storeFile = path.join(dshHome, 'storages', 'src-sessions.json');
const htmlFile = path.join(dirname, 'graph.html');
const portArg = process.argv.indexOf('--port');
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 8899;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1..65535 的整数');

function data() {
  try { return buildViewModel(JSON.parse(fs.readFileSync(storeFile, 'utf8'))); }
  catch { return buildViewModel({ sessions: {} }); }
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/src-graph-api') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data()));
    return;
  }
  if (url.pathname !== '/' && url.pathname !== '/src-graph') { res.writeHead(404).end('Not Found'); return; }
  try {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(htmlFile).pipe(res);
  } catch { res.writeHead(500).end('Failed to load UI'); }
}).listen(port, '127.0.0.1', () => {
  console.log(`[dsh-src] 探索记录：http://127.0.0.1:${port}`);
  console.log(`[dsh-src] 数据源：${storeFile}`);
});
