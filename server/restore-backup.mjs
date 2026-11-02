// Расшифровка резервной копии, присланной ботом в Telegram.
// Запуск: BOT_TOKEN=... node server/restore-backup.mjs konverty-2026-11-02.db.enc  → konverty-2026-11-02.db
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const file = process.argv[2];
if (!file || !process.env.BOT_TOKEN) { console.error('Нужно: BOT_TOKEN=... node server/restore-backup.mjs <файл.enc>'); process.exit(1); }
const b = fs.readFileSync(file);
if (b.subarray(0, 4).toString() !== 'KNV1') { console.error('Не похоже на копию бота'); process.exit(1); }
const key = crypto.createHash('sha256').update('backup:' + process.env.BOT_TOKEN).digest();
const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(4, 16));
d.setAuthTag(b.subarray(16, 32));
const out = file.replace(/\.enc$/, '') || file + '.db';
fs.writeFileSync(out, zlib.gunzipSync(Buffer.concat([d.update(b.subarray(32)), d.final()])));
console.log('Готово:', out, '— положи его как /var/lib/konverty/konverty.db (сервис остановить перед заменой)');
