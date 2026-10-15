// Сервер «Бюджет на конвертах»: Telegram-бот + хранение данных мини-приложения.
// Секрет BOT_TOKEN задаётся в настройках Worker в Cloudflare (Variables and Secrets).
import { DurableObject } from 'cloudflare:workers';

const TZ = 'Europe/Moscow';

const ENVS = [
  { id: 'food', ic: '🛒', name: 'Продукты', kw: ['продукт', 'еда', 'еду', 'магаз', 'пятёроч', 'пятероч', 'магнит', 'перекрест', 'лента', 'ашан', 'вкусвил', 'хлеб', 'молок', 'овощ', 'фрукт', 'мясо', 'закупк', 'продукты'] },
  { id: 'home', ic: '🧴', name: 'Быт и химия', kw: ['быт', 'хими', 'порош', 'мыло', 'шампун', 'хоз', 'уборк', 'посуд'] },
  { id: 'transport', ic: '🚌', name: 'Транспорт', kw: ['такси', 'метро', 'автобус', 'бензин', 'проезд', 'транспорт', 'заправ', 'парковк', 'каршер', 'электрич', 'поезд'] },
  { id: 'kids', ic: '🧸', name: 'Дети', kw: ['дет', 'ребен', 'ребён', 'садик', 'школ', 'игрушк', 'кружок', 'кружк', 'памперс', 'подгуз'] },
  { id: 'health', ic: '💊', name: 'Здоровье', kw: ['аптек', 'лекарств', 'врач', 'здоров', 'анализ', 'стоматолог', 'зуб', 'таблет'] },
  { id: 'clothes', ic: '👕', name: 'Одежда', kw: ['одежд', 'обув', 'куртк', 'ботин', 'кроссов', 'футболк', 'джинс', 'платье', 'штаны'] },
  { id: 'fun', ic: '🎉', name: 'Отдых и кафе', kw: ['кафе', 'ресторан', 'кино', 'кофе', 'бар', 'доставк', 'развлеч', 'отдых', 'пицц', 'суши', 'бургер', 'шаурм'] },
  { id: 'safe', ic: '🛟', name: 'Подушка', save: true, kw: ['подушк', 'копилк', 'отлож'] },
  { id: 'goal', ic: '🏝️', name: 'Отпуск', save: true, kw: ['цель', 'отпуск'] },
];

const HELP =
  'Пиши траты прямо сюда, как другу:\n\n' +
  '• <code>500 продукты</code>\n' +
  '• <code>такси 300</code>\n' +
  '• <code>1,5к кафе с друзьями</code>\n' +
  '• <code>3000 копилка</code> — отложить\n\n' +
  'Я сам пойму конверт и посчитаю остаток. Ошибся — отправь /undo.';

/* ---------- хранилище: один объект на пользователя ---------- */
export class UserStore extends DurableObject {
  async getState() {
    return (await this.ctx.storage.get('state')) || null;
  }
  async putState(incoming, deleted = []) {
    const cur = (await this.ctx.storage.get('state')) || {};
    const del = new Set(deleted);
    const ids = new Set((incoming.tx || []).map((t) => t.id));
    // траты, добавленные ботом, пока приложение было открыто, не теряем
    const extra = (cur.tx || []).filter((t) => !ids.has(t.id) && !del.has(t.id));
    const state = { ...incoming, tx: [...(incoming.tx || []), ...extra] };
    await this.ctx.storage.put('state', state);
    return state;
  }
  async addTx(tx) {
    const s = (await this.ctx.storage.get('state')) || {};
    s.tx = [...(s.tx || []), tx];
    await this.ctx.storage.put('state', s);
    return s;
  }
  async undo() {
    const s = (await this.ctx.storage.get('state')) || {};
    const list = s.tx || [];
    let idx = -1;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].src === 'bot') { idx = i; break; }
    if (idx < 0) return null;
    const [removed] = list.splice(idx, 1);
    s.tx = list;
    await this.ctx.storage.put('state', s);
    return removed;
  }
  async setPending(p) { await this.ctx.storage.put('pending', p); }
  async takePending() {
    const p = await this.ctx.storage.get('pending');
    await this.ctx.storage.delete('pending');
    return p || null;
  }
}

/* ---------- помощники ---------- */
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽';
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const store = (env, uid) => env.USERS.get(env.USERS.idFromName(String(uid)));

async function webhookSecret(token) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('wh:' + token))).slice(0, 48);
}

// Проверка подписи данных, которые Telegram передаёт мини-приложению
export async function checkInitData(initData, token) {
  if (!initData) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const enc = new TextEncoder();
  const k1 = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', k1, enc.encode(token));
  const k2 = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', k2, enc.encode(dcs)));
  if (sig !== hash) return null;
  try { return JSON.parse(p.get('user') || 'null'); } catch { return null; }
}

// «1,5к кафе» → { sum: 1500, note: 'кафе' }
export function parseExpense(text) {
  const m = text.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(к|k|тыс\.?|тысяч[аи]?)?(?=\s|$|₽|р(?:\s|$|\.)|руб)/i);
  if (!m) return null;
  let sum = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
  if (m[2]) sum *= 1000;
  sum = Math.round(sum);
  if (!sum || sum <= 0 || sum > 10_000_000) return null;
  const note = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length))
    .replace(/₽|руб(лей|ля|ль)?\.?/gi, ' ')
    .replace(/(^|\s)р\.?(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return { sum, note };
}

export function detectEnv(note, state) {
  const t = note.toLowerCase();
  const names = state?.n || {};
  for (const e of ENVS) {
    const nm = (names[e.id] || '').toLowerCase().trim();
    if (nm && nm.length >= 3 && t.includes(nm)) return e.id;
  }
  for (const e of ENVS) if (e.kw.some((k) => t.includes(k))) return e.id;
  return null;
}

const envInfo = (id, state) => {
  const d = ENVS.find((e) => e.id === id);
  return { ...d, name: state?.n?.[id] || d.name, ic: state?.i?.[id] || d.ic };
};

function dayToday() {
  return +new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric' }).format(new Date());
}

function summary(state, envId, sum) {
  const e = envInfo(envId, state);
  const spent = (state.tx || []).filter((t) => t.env === envId).reduce((a, t) => a + t.sum, 0);
  const plan = state.a?.[envId];
  if (e.save) return `${e.ic} Отложено ${fmt(sum)} → «${e.name}» 🐷\nЗа месяц в конверте: ${fmt(spent)}`;
  let line = `${e.ic} −${fmt(sum)} → «${e.name}»`;
  if (plan == null) return line + '\nОткрой приложение и задай сумму конверта, тогда буду считать остаток.';
  const left = plan - spent;
  return line + (left >= 0 ? `\nОсталось в конверте: ${fmt(left)}` : `\n😬 Перерасход: ${fmt(-left)}`);
}

/* ---------- Telegram ---------- */
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}
const appButton = (origin) => ({ inline_keyboard: [[{ text: '📊 Открыть бюджет', web_app: { url: origin + '/' } }]] });

async function onUpdate(update, env, origin) {
  if (update.callback_query) {
    const q = update.callback_query;
    const uid = q.from.id;
    const [, envId] = (q.data || '').split(':');
    const st = store(env, uid);
    const p = await st.takePending();
    if (!p || !ENVS.some((e) => e.id === envId)) {
      await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Эта трата уже записана или устарела' });
      return;
    }
    const tx = { id: Date.now(), day: dayToday(), env: envId, sum: p.sum, note: p.note, src: 'bot' };
    const s = await st.addTx(tx);
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Записал ✓' });
    await tg(env, 'editMessageText', {
      chat_id: q.message.chat.id, message_id: q.message.message_id,
      text: summary(s, envId, p.sum), reply_markup: appButton(origin),
    });
    return;
  }

  const msg = update.message;
  if (!msg || !msg.text || msg.chat.type !== 'private') return;
  const uid = msg.from.id, chat = msg.chat.id, text = msg.text.trim();
  const st = store(env, uid);

  if (text.startsWith('/start') || text.startsWith('/help')) {
    await tg(env, 'sendMessage', {
      chat_id: chat, parse_mode: 'HTML', reply_markup: appButton(origin),
      text: '👋 Привет! Я веду твой бюджет на конвертах.\n\n' + HELP,
    });
    return;
  }
  if (text.startsWith('/undo')) {
    const r = await st.undo();
    await tg(env, 'sendMessage', {
      chat_id: chat,
      text: r ? `↩️ Удалил последнюю трату: ${fmt(r.sum)}${r.note ? ' — ' + r.note : ''}` : 'Нечего отменять: траты из чата не найдены.',
    });
    return;
  }

  const parsed = parseExpense(text);
  if (!parsed) {
    await tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', text: '🤔 Не нашёл сумму.\n\n' + HELP });
    return;
  }
  const state = (await st.getState()) || {};
  const envId = detectEnv(parsed.note, state);
  if (!envId) {
    await st.setPending(parsed);
    const kb = ENVS.map((e) => {
      const i = envInfo(e.id, state);
      return { text: `${i.ic} ${i.name}`, callback_data: `e:${e.id}` };
    });
    const rows = [];
    for (let i = 0; i < kb.length; i += 2) rows.push(kb.slice(i, i + 2));
    await tg(env, 'sendMessage', {
      chat_id: chat, text: `Куда записать ${fmt(parsed.sum)}${parsed.note ? ` («${parsed.note}»)` : ''}?`,
      reply_markup: { inline_keyboard: rows },
    });
    return;
  }
  const tx = { id: Date.now(), day: dayToday(), env: envId, sum: parsed.sum, note: parsed.note, src: 'bot' };
  const s = await st.addTx(tx);
  await tg(env, 'sendMessage', { chat_id: chat, text: summary(s, envId, parsed.sum), reply_markup: appButton(origin) });
}

/* ---------- маршруты ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = url.origin;

    if (!env.BOT_TOKEN && url.pathname !== '/') {
      return json({ ok: false, error: 'BOT_TOKEN не задан в настройках Worker' }, 500);
    }

    // Один раз открыть в браузере: привязывает бота к этому серверу
    if (url.pathname === '/setup') {
      const r = await tg(env, 'setWebhook', {
        url: origin + '/tg',
        secret_token: await webhookSecret(env.BOT_TOKEN),
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      });
      await tg(env, 'setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Мой бюджет', web_app: { url: origin + '/' } },
      });
      return new Response(
        r.ok ? '✅ Готово! Бот подключён к серверу. Можно закрыть страницу и писать боту.' : '❌ Ошибка: ' + JSON.stringify(r),
        { headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }

    if (url.pathname === '/tg' && request.method === 'POST') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== (await webhookSecret(env.BOT_TOKEN))) {
        return new Response('forbidden', { status: 403 });
      }
      const update = await request.json();
      try { await onUpdate(update, env, origin); } catch (e) { console.error(e); }
      return new Response('ok');
    }

    if (url.pathname === '/api/state') {
      const user = await checkInitData(request.headers.get('X-Init-Data'), env.BOT_TOKEN);
      if (!user) return json({ ok: false, error: 'unauthorized' }, 401);
      const st = store(env, user.id);
      if (request.method === 'GET') return json({ ok: true, state: await st.getState() });
      if (request.method === 'PUT') {
        const body = await request.json();
        if (!body || typeof body.state !== 'object') return json({ ok: false }, 400);
        const s = await st.putState(body.state, Array.isArray(body.deleted) ? body.deleted : []);
        return json({ ok: true, state: s });
      }
      return json({ ok: false }, 405);
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('not found', { status: 404 });
  },
};
