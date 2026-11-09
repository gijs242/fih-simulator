// Fih Simulator game server: serves the client and runs the shared world over WebSockets.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Sim } from '../shared/sim.js';
import { WORLD } from '../shared/world.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const LB_FILE = path.join(DATA_DIR, 'leaderboard.json');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 40;

// ---- static files
const STATIC = {
  '/vendor/three.module.js': path.join(ROOT, 'node_modules/three/build/three.module.js'),
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function resolvePath(urlPath) {
  if (STATIC[urlPath]) return STATIC[urlPath];
  if (urlPath === '/') urlPath = '/index.html';
  let base = path.join(ROOT, 'client');
  if (urlPath.startsWith('/shared/')) { base = ROOT; }
  const full = path.normalize(path.join(base, urlPath));
  if (!full.startsWith(base)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200); res.end('ok'); return; }
  const file = resolvePath(decodeURIComponent(url.pathname));
  if (!file) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

// ---- leaderboard persistence
function loadAlltime() {
  try { return JSON.parse(fs.readFileSync(LB_FILE, 'utf8')); } catch { return []; }
}
let saveTimer = null;
function saveAlltime(list) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(LB_FILE, JSON.stringify(list));
    } catch (e) { console.error('leaderboard save failed', e.message); }
  }, 500);
}

const sim = new Sim({ alltime: loadAlltime(), onAlltimeChange: saveAlltime });

// ---- websockets
const wss = new WebSocketServer({ server, maxPayload: 4096 });
let nextClient = 1;
wss.on('connection', (ws) => {
  if (sim.players.size >= MAX_PLAYERS) { ws.close(1013, 'server full'); return; }
  const cid = nextClient++;
  ws.isAlive = true;
  let msgCount = 0, windowStart = Date.now();
  const send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  sim.addPlayer(cid, send);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    // basic flood protection
    const t = Date.now();
    if (t - windowStart > 1000) { windowStart = t; msgCount = 0; }
    if (++msgCount > 120) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    sim.handleMessage(cid, msg);
  });
  ws.on('close', () => sim.removePlayer(cid));
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// ---- fixed-rate simulation loop
const DT = 1 / WORLD.tickRate;
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  // if the server fell behind, simulate the missed ticks but only send one update
  let n = 0;
  while (acc >= DT) { acc -= DT; n++; sim.tick(DT, acc < DT); }
  if (n > 4) acc = 0;
}, 1000 / WORLD.tickRate / 2);

server.listen(PORT, () => console.log(`Fih Simulator running on http://localhost:${PORT}`));
