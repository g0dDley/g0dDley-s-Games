// Zombies From Mars — Node server: static files + direct-mode WebSocket.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createHub } from './game/core.js';

// Works both as native ESM (dev) and after esbuild's ESM->CJS transpile for
// packaging (Node's CJS wrapper already provides __dirname in that case, and
// referencing it is fine — import.meta.url has no meaning post-transpile).
const appDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(appDir, 'public');
const START_PORT = Number(process.env.PORT) || 8080;
const NO_OPEN = process.env.ZFM_NO_OPEN === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const hub = createHub();
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('error', () => { /* underlying http server's listen errors are handled below via port fallback */ });

wss.on('connection', (ws) => {
  const client = hub.connect({ send: (s) => { if (ws.readyState === ws.OPEN) ws.send(s); } });
  ws.on('message', (data) => client.onMessage(data.toString()));
  ws.on('close', () => client.onClose());
  ws.on('error', () => client.onClose());
});

function openBrowser(url) {
  if (NO_OPEN) return;
  try {
    const plat = process.platform;
    if (plat === 'win32') spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref();
    else if (plat === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  } catch (_) { /* headless environment: no browser to open, that's fine */ }
}

function listenWithFallback(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      listenWithFallback(port + 1, attemptsLeft - 1);
    } else {
      console.error('Failed to start server:', err.message);
      process.exitCode = 1;
    }
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`ZOMBIES FROM MARS server up on ${url}`);
    console.log('Leave this window open while you play. Close it to stop the server.');
    openBrowser(url);
  });
}

listenWithFallback(START_PORT, 10);
