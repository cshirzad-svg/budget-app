// Refresh public bot descriptions without displaying credentials or user records.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tg } from '/var/lib/konverty/worker.build.mjs';

const pid = execFileSync('systemctl', ['show', 'konverty', '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim();
const saved = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(value => {
  const i = value.indexOf('=');
  return [value.slice(0, i), value.slice(i + 1)];
}));
const env = { BOT_TOKEN: saved.BOT_TOKEN, TG_API: saved.TG_API || 'https://konverty-budget.cshirzad.workers.dev/tgrelay', TG_PREFER_RELAY: true };
if (!env.BOT_TOKEN) throw new Error('Bot configuration is missing');
const before = await tg(env, 'getMyDescription', {});
if (!before.ok) throw new Error('Could not read existing description');
const legal = before.result.description.split('\n').filter(line => /ИНН|самозанятый/i.test(line)).join('\n');
const description = '💌 Бюджет в конвертах — учёт расходов в Telegram.\n\nТекстовый бюджет и PDF — 3 дня бесплатно. Затем полный доступ — 990 ₽ одним платежом: текстовый учёт, голосовые траты и ИИ-повар на весь срок работы сервиса. PDF после пробного периода — отдельно 299 ₽ на 30 дней, продление вручную.\n\nДля ИИ требуется отдельное согласие.\nОферта: https://konverty.app/offer\n' + legal;
if (description.length > 512) throw new Error('Description is too long');
const full = await tg(env, 'setMyDescription', { description });
const short = await tg(env, 'setMyShortDescription', { short_description: '💌 Бюджет в Telegram. Текст и PDF — 3 дня бесплатно. Полный доступ — 990 ₽. PDF — 299 ₽/30 дней.' });
console.log(JSON.stringify({ descriptionUpdated: !!full.ok, shortDescriptionUpdated: !!short.ok }));
if (!full.ok || !short.ok) process.exitCode = 1;
