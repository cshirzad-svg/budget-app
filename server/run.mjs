// Запуск бота на своём сервере (Россия) вместо Cloudflare Workers.
// Тот же src/worker.js, а вокруг него — замены облачных сервисов:
//   Durable Objects → SQLite (node:sqlite), статика → папка public/, cron → таймер,
//   Workers AI → REST API Cloudflare (ключ в /etc/konverty.env).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.KONVERTY_DATA || '/var/lib/konverty';
const PORT = +process.env.PORT || 8787;
fs.mkdirSync(DATA, { recursive: true });

/* повторный перенос данных из Cloudflare: если в git поменялся server/reimport.txt */
{
  const flag = path.join(ROOT, 'server', 'reimport.txt'), done = path.join(DATA, 'reimport.applied');
  const want = fs.existsSync(flag) ? fs.readFileSync(flag, 'utf8').trim() : '';
  const have = fs.existsSync(done) ? fs.readFileSync(done, 'utf8').trim() : '';
  if (want && want !== have) {
    const { execFileSync } = await import('node:child_process');
    try {
      execFileSync(process.execPath, [...process.execArgv, path.join(ROOT, 'server', 'import.mjs'), process.env.EXPORT_FROM || 'https://konverty.app'], { stdio: 'inherit', env: process.env, timeout: 120000 });
      fs.writeFileSync(done, want);
    } catch (e) { console.error('reimport failed', e.message); }
  }
}

/* ---------- хранилище ---------- */
export const db = new DatabaseSync(path.join(DATA, 'konverty.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE IF NOT EXISTS kv (ns TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (ns, k)) WITHOUT ROWID;');
const qGet = db.prepare('SELECT v FROM kv WHERE ns = ? AND k = ?');
const qPut = db.prepare('INSERT INTO kv (ns, k, v) VALUES (?, ?, ?) ON CONFLICT (ns, k) DO UPDATE SET v = excluded.v');
const qDel = db.prepare('DELETE FROM kv WHERE ns = ? AND k = ?');
const qList = db.prepare('SELECT k, v FROM kv WHERE ns = ? AND k >= ? AND k < ? ORDER BY k');
const qAll = db.prepare('SELECT k, v FROM kv WHERE ns = ? ORDER BY k');

export function makeStorage(ns) {
  const get1 = (k) => { const r = qGet.get(ns, String(k)); return r ? JSON.parse(r.v) : undefined; };
  const put1 = (k, v) => { if (v === undefined) qDel.run(ns, String(k)); else qPut.run(ns, String(k), JSON.stringify(v)); };
  return {
    async get(k) { if (Array.isArray(k)) { const m = new Map(); for (const x of k) { const v = get1(x); if (v !== undefined) m.set(x, v); } return m; } return get1(k); },
    async put(k, v) { if (k && typeof k === 'object') { db.exec('BEGIN'); try { for (const [a, b] of Object.entries(k)) put1(a, b); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } else put1(k, v); },
    async delete(k) { if (Array.isArray(k)) { let n = 0; for (const x of k) n += qDel.run(ns, String(x)).changes; return n; } return qDel.run(ns, String(k)).changes > 0; },
    async list(o = {}) {
      const rows = o.prefix ? qList.all(ns, o.prefix, o.prefix + '￿') : qAll.all(ns);
      const m = new Map(); for (const r of rows) m.set(r.k, JSON.parse(r.v)); return m;
    },
  };
}

/* ---------- worker.js с подменой импорта cloudflare:workers ---------- */
const shimUrl = pathToFileURL(path.join(ROOT, 'server', 'shim.mjs')).href;
const src = fs.readFileSync(path.join(ROOT, 'src', 'worker.js'), 'utf8')
  .replace(/import\s*\{\s*DurableObject\s*\}\s*from\s*['"]cloudflare:workers['"];?/, `import { DurableObject } from '${shimUrl}';`);
const built = path.join(DATA, 'worker.build.mjs');
fs.writeFileSync(built, src);
const mod = await import(pathToFileURL(built).href + '?t=' + Date.now());
const worker = mod.default, UserStore = mod.UserStore;

/* ---------- переменные: [vars] из wrangler.toml + секреты из /etc/konverty.env ---------- */
function readVars() {
  const out = {}, t = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const sec = t.split(/^\[vars\]\s*$/m)[1]; if (!sec) return out;
  for (const line of sec.split('\n')) { if (/^\s*\[/.test(line)) break; const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"(.*)"\s*$/); if (m) out[m[1]] = m[2]; }
  return out;
}
const env = { ...readVars() };
delete env.MOVED; // флаг «переехали» относится только к старому Cloudflare Worker
for (const k of ['BOT_TOKEN', 'CF_ACCOUNT_ID', 'CF_AI_TOKEN', 'ORIGIN', 'PRODAMUS_KEY']) if (process.env[k]) env[k] = process.env[k];

/* Durable Objects: один объект на имя, вызовы к одному объекту идут строго по очереди (как в Cloudflare) */
const objs = new Map(), queues = new Map();
function stub(name) {
  name = String(name);
  let o = objs.get(name);
  if (!o) { o = new UserStore({ storage: makeStorage(name), id: { name, toString: () => name } }, env); objs.set(name, o); }
  return new Proxy({}, {
    get(_, m) {
      if (m === 'then') return undefined;
      return (...a) => {
        const prev = queues.get(name) || Promise.resolve();
        const run = prev.then(() => o[m](...a));
        queues.set(name, run.catch(() => {}));
        return run;
      };
    },
  });
}
env.USERS = { idFromName: (n) => String(n), get: (id) => stub(id) };

/* Workers AI через REST API */
if (env.CF_ACCOUNT_ID && env.CF_AI_TOKEN) {
  env.AI = {
    async run(model, input) {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`, {
        method: 'POST', headers: { authorization: 'Bearer ' + env.CF_AI_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) throw new Error((j.errors && j.errors.map((e) => e.message).join('; ')) || 'AI HTTP ' + r.status);
      return j.result;
    },
    async toMarkdown(docs) {
      const fd = new FormData();
      for (const d of [].concat(docs)) fd.append('files', d.blob, d.name);
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/tomarkdown`, { method: 'POST', headers: { authorization: 'Bearer ' + env.CF_AI_TOKEN }, body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) throw new Error((j.errors && j.errors.map((e) => e.message).join('; ')) || 'toMarkdown HTTP ' + r.status);
      return j.result;
    },
  };
} else console.warn('CF_ACCOUNT_ID/CF_AI_TOKEN не заданы — функции ИИ отключены');

/* статика из public/ (как Workers Assets) */
const PUB = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
function assetPath(p) {
  let f;
  try { f = decodeURIComponent(p); } catch { return null; }
  const cands = f.endsWith('/') ? [f + 'index.html'] : [f, f + '.html', f + '/index.html'];
  for (const c of cands) {
    const full = path.join(PUB, c);
    if (!full.startsWith(PUB + path.sep)) continue;
    try { if (fs.statSync(full).isFile()) return full; } catch {}
  }
  return null;
}
function serveFile(full, req) {
  const st = fs.statSync(full), type = TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream';
  const h = { 'content-type': type, 'cache-control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600', 'accept-ranges': 'bytes' };
  const range = req && req.headers.get('range'), m = range && range.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const s0 = m[1] ? +m[1] : st.size - +m[2], e0 = m[1] && m[2] ? +m[2] : st.size - 1;
    if (s0 >= 0 && s0 <= e0 && e0 < st.size) {
      return new Response(fs.createReadStream(full, { start: s0, end: e0 }), { status: 206, headers: { ...h, 'content-range': `bytes ${s0}-${e0}/${st.size}`, 'content-length': String(e0 - s0 + 1) } });
    }
  }
  return new Response(fs.createReadStream(full), { headers: { ...h, 'content-length': String(st.size) } });
}
env.ASSETS = { async fetch(req) { const u = new URL(req.url), f = assetPath(u.pathname); return f ? serveFile(f, req) : new Response('not found', { status: 404 }); } };
const WORKER_FIRST = new Set(['/', '/index.html', '/offer', '/privacy', '/consent']);

/* журнал последних ошибок для диагностики */
const ERRS = [];
const _err = console.error.bind(console);
console.error = (...a) => { ERRS.push(new Date().toISOString() + ' ' + a.map((x) => (x && x.cause ? 'cause=' + (x.cause.code || x.cause.message) + ' ' : '') + ((x && x.stack) || (typeof x === 'object' ? JSON.stringify(x) : String(x)))).join(' ').slice(0, 500)); while (ERRS.length > 40) ERRS.shift(); _err(...a); };
const { createHash } = await import('node:crypto');
async function health() {
  const out = { uptime: Math.round(process.uptime()), node: process.version, errors: ERRS.slice(-25) };
  const t0 = Date.now();
  out.tg = [];
  for (let i = 0; i < 6; i++) {
    const t = Date.now();
    try { const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(10000) }); out.tg.push(r.status + ' ' + (Date.now() - t) + 'ms'); }
    catch (e) { out.tg.push('ERR ' + String(e && e.cause ? (e.cause.code || e.cause.message) : e.message) + ' ' + (Date.now() - t) + 'ms'); }
  }
  try { const r = await fetch('https://konverty-budget.cshirzad.workers.dev/', { signal: AbortSignal.timeout(10000) }); out.wdev = r.status + ' ' + (Date.now() - t0) + 'ms'; } catch (e) { out.wdev = 'ERR ' + String(e && e.cause ? (e.cause.code || e.cause.message) : e.message); }
  const t1 = Date.now();
  try { const r = await fetch('https://api.cloudflare.com/client/v4/', { signal: AbortSignal.timeout(10000) }); out.cf = { status: r.status, ms: Date.now() - t1 }; }
  catch (e) { out.cf = { error: String(e && (e.cause && e.cause.code || e.message)), ms: Date.now() - t1 }; }
  return out;
}

/* ---------- HTTP ---------- */
const ctx = { waitUntil: (p) => Promise.resolve(p).catch((e) => console.error('waitUntil', e)), passThroughOnException() {} };
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'konverty.app';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = new URL(req.url, `${proto}://${host}`);
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined;
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const request = new Request(url, { method: req.method, headers, body });
    let resp;
    if (url.pathname === '/__health') {
      const key = createHash('sha256').update('health:' + (env.BOT_TOKEN || '')).digest('hex');
      resp = url.searchParams.get('key') === key ? new Response(JSON.stringify(await health(), null, 1), { headers: { 'content-type': 'application/json' } }) : new Response('forbidden', { status: 403 });
      const o = {}; resp.headers.forEach((v, k) => { o[k] = v; }); res.writeHead(resp.status, o); res.end(await resp.text()); return;
    }
    const file = req.method === 'GET' && !WORKER_FIRST.has(url.pathname) ? assetPath(url.pathname) : null;
    if (file) resp = serveFile(file, request);
    else resp = await worker.fetch(request, env, ctx);
    const out = {}; resp.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(resp.status, out);
    if (resp.body && req.method !== 'HEAD') { for await (const c of resp.body) res.write(c); }
    res.end();
  } catch (e) {
    console.error('request', req.method, req.url, e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
});
server.listen(PORT, '127.0.0.1', () => console.log('konverty: слушаю 127.0.0.1:' + PORT));

/* cron каждые 5 минут, как в Cloudflare */
let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try { await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, env, ctx); } catch (e) { console.error('cron', e); } finally { busy = false; }
}
if (process.env.KONVERTY_NO_CRON !== '1') {
  const ms = 5 * 60 * 1000;
  setTimeout(() => { tick(); setInterval(tick, ms); }, ms - (Date.now() % ms) + 2000);
}

/* ежедневная копия базы, хранится 7 дней */
function backup() {
  try {
    const dir = path.join(DATA, 'backups'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'konverty-' + new Date().toISOString().slice(0, 10) + '.db');
    if (!fs.existsSync(f)) db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
    for (const x of fs.readdirSync(dir).sort().slice(0, -7)) fs.rmSync(path.join(dir, x));
  } catch (e) { console.error('backup', e); }
}
setTimeout(backup, 60000); setInterval(backup, 6 * 3600 * 1000);

for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { server.close(); try { db.close(); } catch {} process.exit(0); });
