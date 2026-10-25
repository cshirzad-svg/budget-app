// Перенос данных из Cloudflare в SQLite на сервере.
// Запуск: BOT_TOKEN=... node server/import.mjs [https://konverty.app]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DATA = process.env.KONVERTY_DATA || '/var/lib/konverty';
const SRC = (process.argv[2] || process.env.EXPORT_FROM || 'https://konverty.app').replace(/\/$/, '');
if (!process.env.BOT_TOKEN) { console.error('Нужен BOT_TOKEN'); process.exit(1); }
const key = crypto.createHash('sha256').update('export:' + process.env.BOT_TOKEN).digest('hex');

const r = await fetch(SRC + '/__export', { headers: { 'x-export-key': key } });
const j = await r.json().catch(() => null);
if (!r.ok || !j || !j.ok) { console.error('Выгрузка не удалась:', r.status, j); process.exit(1); }

fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'export-' + j.at + '.json'), JSON.stringify(j));
const db = new DatabaseSync(path.join(DATA, 'konverty.db'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (ns TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (ns, k)) WITHOUT ROWID;');
const put = db.prepare('INSERT INTO kv (ns, k, v) VALUES (?, ?, ?) ON CONFLICT (ns, k) DO UPDATE SET v = excluded.v');
const clear = db.prepare('DELETE FROM kv WHERE ns = ?');
let n = 0;
db.exec('BEGIN');
const load = (ns, obj) => { clear.run(ns); for (const [k, v] of Object.entries(obj || {})) { put.run(ns, k, JSON.stringify(v)); n++; } };
load('__registry__', j.registry);
for (const [id, obj] of Object.entries(j.users || {})) load(String(id), obj);
db.exec('COMMIT');
db.close();
console.log(`Готово: пользователей ${Object.keys(j.users || {}).length}, записей ${n}. Копия выгрузки: ${DATA}/export-${j.at}.json`);
