// One-time service notice requested by the owner. Recipient data stays on the VPS.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { tg } from '/var/lib/konverty/worker.build.mjs';

const send = process.argv.includes('--send');
const db = new DatabaseSync('/var/lib/konverty/konverty.db');
db.exec('PRAGMA busy_timeout=5000');
const get = db.prepare('SELECT v FROM kv WHERE ns=? AND k=?');
const put = db.prepare('INSERT INTO kv(ns,k,v) VALUES(?,?,?) ON CONFLICT(ns,k) DO UPDATE SET v=excluded.v');
const start = JSON.parse(get.get('__registry__', 'm:trial_policy:8')?.v || 'null');
if (!start) throw new Error('Trial policy has not started');
const admin = JSON.parse(get.get('__registry__', 'admin')?.v || 'null');
const users = db.prepare("SELECT k,v FROM kv WHERE ns=? AND k LIKE 'u:%'").all('__registry__');
const pid = execFileSync('systemctl', ['show', 'konverty', '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim();
const saved = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(value => {
  const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)];
}));
const env = { BOT_TOKEN: saved.BOT_TOKEN, TG_API: saved.TG_API || 'https://konverty-budget.cshirzad.workers.dev/tgrelay', TG_PREFER_RELAY: true };
if (!env.BOT_TOKEN) throw new Error('Bot configuration is missing');
const stats = { trial: 0, retained: 0, blocked: 0, alreadyAttempted: 0, delivered: 0, failed: 0 };
const queue = [];
for (const row of users) {
  const uid = row.k.slice(2), u = JSON.parse(row.v);
  if (u.blocked) { stats.blocked++; continue; }
  const key = 'trial-policy-8:' + uid;
  if (get.get('__service_notices__', key)) { stats.alreadyAttempted++; continue; }
  const paid = String(admin) === uid || !!u.paid || !!u.gift;
  const end = u.trialPolicy === 8 ? u.trialEnd : Math.max(u.trialEnd || 0, Math.max(u.first || start, start) + 3 * 864e5);
  const until = new Date(end).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'long', timeStyle: 'short' });
  const text = paid
    ? '💎 Твой доступ сохранён\n\nМы вводим для пользователей без полного доступа три пробных дня. Тебя это ограничение не затрагивает: ранее выданный полный доступ остаётся, платить 990 ₽ повторно или заново не нужно.\n\n' + (!u.roboLifetime ? 'Ранее предоставленный доступ к PDF тоже сохраняется.' : 'PDF остаётся отдельным дополнением за 299 ₽ на 30 дней; уже оплаченный срок сохраняется.') + '\n\nАвтоматических списаний нет. Спасибо, что пользуешься «Бюджетом в конвертах» 💌'
    : '💌 Три пробных дня в «Бюджете в конвертах»\n\nТвой пробный доступ уже начался и действует до ' + until + ' (мск). В этот период доступны текстовый бюджет и PDF-выписки. Для распознавания PDF нужно отдельное согласие на ИИ-обработку.\n\nПосле пробного периода полный доступ стоит 990 ₽ одним платежом на весь срок работы сервиса: текстовый бюджет, голосовые траты и ИИ-повар. Голос и ИИ-повар открываются после оплаты. PDF после пробного периода — отдельное дополнение за 299 ₽ на 30 дней с ручным продлением.\n\nАвтоматических списаний нет. Если не покупать доступ, сохранённые записи останутся доступны для просмотра и выгрузки.';
  stats[paid ? 'retained' : 'trial']++;
  queue.push({ uid, key, text });
}
console.log(JSON.stringify({ mode: send ? 'send' : 'preview', ...stats }));
if (!send) {
  console.log('Trial example:', queue.find(x => !x.text.startsWith('💎'))?.text || 'none');
  console.log('Retained-access example:', queue.find(x => x.text.startsWith('💎'))?.text || 'none');
} else {
  for (const item of queue) {
    // Claim before sending; even an ambiguous network result is not automatically resent.
    db.exec('BEGIN IMMEDIATE');
    if (get.get('__service_notices__', item.key)) { db.exec('COMMIT'); stats.alreadyAttempted++; continue; }
    put.run('__service_notices__', item.key, JSON.stringify({ state: 'sending', attemptedAt: Date.now() }));
    db.exec('COMMIT');
    const result = await tg(env, 'sendMessage', {
      chat_id: Number(item.uid), text: item.text, disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [
        [{ text: '📊 Открыть бюджет', web_app: { url: 'https://konverty.app/' } }],
        [{ text: 'Условия доступа и возврат', url: 'https://konverty.app/offer' }],
      ] },
    });
    put.run('__service_notices__', item.key, JSON.stringify({ state: result.ok ? 'sent' : 'failed', attemptedAt: Date.now(), ...(result.ok ? { messageId: result.result?.message_id } : { code: result.error_code || null }) }));
    stats[result.ok ? 'delivered' : 'failed']++;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log(JSON.stringify({ completed: true, ...stats }));
}
db.close();
