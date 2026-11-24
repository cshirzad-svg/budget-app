// Edit existing service notices. Do not send another announcement.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { tg } from '/var/lib/konverty/worker.build.mjs';
const send = process.argv.includes('--apply');
const db = new DatabaseSync('/var/lib/konverty/konverty.db');
db.exec('PRAGMA busy_timeout=5000');
const get = db.prepare('SELECT v FROM kv WHERE ns=? AND k=?');
const put = db.prepare('INSERT INTO kv(ns,k,v) VALUES(?,?,?) ON CONFLICT(ns,k) DO UPDATE SET v=excluded.v');
const read = (ns, key) => JSON.parse(get.get(ns, key)?.v || 'null');
const admin = read('__registry__', 'admin');
const pid = execFileSync('systemctl', ['show', 'konverty', '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim();
const saved = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(value => {
  const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)];
}));
const env = { BOT_TOKEN: saved.BOT_TOKEN, TG_API: saved.TG_API || 'https://konverty-budget.cshirzad.workers.dev/tgrelay', TG_PREFER_RELAY: true };
if (!env.BOT_TOKEN) throw new Error('Bot configuration missing');
const stats = { eligible: 0, updated: 0, alreadyUpdated: 0, retainedAccess: 0, failed: 0 };
for (const row of db.prepare("SELECT k,v FROM kv WHERE ns=? AND k LIKE 'trial-policy-8:%'").all('__service_notices__')) {
  const notice = JSON.parse(row.v), uid = Number(row.k.slice('trial-policy-8:'.length));
  if (notice.state !== 'sent' || !notice.messageId) continue;
  const u = read('__registry__', 'u:' + uid) || {}, owner = u.link || uid;
  const account = read('__registry__', 'u:' + owner) || {};
  const full = !!account.paid || !!account.gift || owner === admin;
  if (full) { stats.retainedAccess++; continue; }
  if (notice.paymentButtonRevision === 1) { stats.alreadyUpdated++; continue; }
  stats.eligible++;
  if (!send) continue;
  const secret = randomBytes(32).toString('hex'), id = createHash('sha256').update(secret).digest('hex').slice(0, 48);
  put.run('__registry__', 'checkout:' + id, JSON.stringify({ expires: Date.now() + 7 * 864e5, uid: owner, purchase: true }));
  const result = await tg(env, 'editMessageReplyMarkup', {
    chat_id: uid, message_id: notice.messageId,
    reply_markup: { inline_keyboard: [
      [{ text: '💎 Оплатить полный доступ · 990 ₽', url: 'https://konverty.app/checkout/open/' + secret }],
      [{ text: '📊 Открыть бюджет', web_app: { url: 'https://konverty.app/' } }],
    ] },
  });
  if (result.ok) { stats.updated++; put.run('__service_notices__', row.k, JSON.stringify({ ...notice, paymentButtonRevision: 1, buttonUpdatedAt: Date.now() })); }
  else stats.failed++;
  await new Promise(resolve => setTimeout(resolve, 100));
}
console.log(JSON.stringify({ mode: send ? 'apply' : 'preview', ...stats }));
db.close();
