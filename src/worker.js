// Сервер «Бюджет на конвертах»: Telegram-бот + хранение данных мини-приложения.
// Секрет BOT_TOKEN задаётся в настройках Worker в Cloudflare (Variables and Secrets).
import { DurableObject } from 'cloudflare:workers';


const ENVS = [
  { id: 'food', ic: '🛒', name: 'Продукты', kw: ['продукт', 'еда', 'еду', 'магаз', 'пятёроч', 'пятероч', 'магнит', 'перекрест', 'лента', 'ашан', 'вкусвил', 'хлеб', 'молок', 'овощ', 'фрукт', 'мясо', 'закупк', 'продукты'] },
  { id: 'home', ic: '🧴', name: 'Быт и химия', alt: ['other'], kw: ['быт', 'хими', 'порош', 'мыло', 'шампун', 'хоз', 'уборк', 'посуд'] },
  { id: 'transport', ic: '🚌', name: 'Транспорт', kw: ['такси', 'метро', 'автобус', 'бензин', 'проезд', 'транспорт', 'заправ', 'парковк', 'каршер', 'электрич', 'поезд'] },
  { id: 'kids', ic: '🧸', name: 'Дети', alt: ['other'], kw: ['дет', 'ребен', 'ребён', 'садик', 'школ', 'игрушк', 'кружок', 'кружк', 'памперс', 'подгуз'] },
  { id: 'health', ic: '💊', name: 'Здоровье', alt: ['other'], kw: ['аптек', 'лекарств', 'врач', 'здоров', 'анализ', 'стоматолог', 'зуб', 'таблет'] },
  { id: 'clothes', ic: '👕', name: 'Одежда', alt: ['shop', 'other'], kw: ['одежд', 'обув', 'куртк', 'ботин', 'кроссов', 'футболк', 'джинс', 'платье', 'штаны'] },
  { id: 'fun', ic: '🎉', name: 'Отдых и кафе', kw: ['кафе', 'ресторан', 'кино', 'кофе', 'бар', 'доставк', 'развлеч', 'отдых', 'пицц', 'суши', 'бургер', 'шаурм'] },
  { id: 'safe', ic: '🛟', name: 'Подушка', save: true, kw: ['подушк', 'копилк', 'отлож'] },
  { id: 'goal', ic: '🏝️', name: 'Отпуск', save: true, kw: ['цель', 'отпуск'] },
  { id: 'shop', ic: '🛍️', name: 'Покупки', legacy: false, kw: ['покупк', 'таобао', 'taobao', 'вайлдб', 'wildb', 'озон', 'ozon', 'маркетплейс', 'алиэкспр', 'заказ'], alt: ['clothes', 'other'] },
  { id: 'other', ic: '📦', name: 'Прочее', legacy: false, kw: ['прочее', 'разное'] },
];

const HELP =
  'Пиши траты прямо сюда, как другу:\n\n' +
  '• <code>500 продукты</code>\n' +
  '• <code>такси 300</code>\n' +
  '• <code>1,5к кафе с друзьями</code>\n' +
  '• <code>еда 50 ю</code>, <code>кофе 4$</code> — в любой валюте\n' +
  '• <code>отложил 5к юаней</code> — в копилку\n\n' +
  'Я сам пойму категорию и валюту. <code>итоги</code> — сколько потрачено за месяц. Ошибся — /undo.';

/* ---------- хранилище: один объект на пользователя ---------- */
/* первые пользователи (семья) — полный доступ бесплатно */
const FREE_USERS = ['svetlana_znatnyiplov', 'roman77gor'];

/* ---------- рассылка ---------- */
const BC_VER = 'news-1';
const BC_VIDEO = 'promo/news-1.mp4';
const BC_TEXT = (gift) => 'Привет! Это бот «Бюджет в конвертах» 👋\n\n' +
  'За последние недели тут многое поменялось. Самое полезное:\n\n' +
  '💬 <b>Писать траты можно как сообщение другу:</b> «кофе 300», «вчера такси 500». Можно голосовым, бот сам разберёт.\n' +
  '🧾 <b>Фото чека</b> — бот сам разнесёт покупки по конвертам.\n' +
  '☀️ <b>Утром бот подскажет, сколько можно потратить сегодня</b>, чтобы уложиться в месяц. Вечером спросит, всё ли записал.\n' +
  '⏰ <b>«Напомни 25-го оплатить интернет 500»</b> — напомнит в нужный день и сам запишет трату.\n' +
  '🍲 <b>ИИ-повар:</b> напиши «хочу на неделю китайскую кухню», и он соберёт меню, список покупок и примерную стоимость корзины.\n' +
  '👫 <b>Общий бюджет на двоих:</b> позови партнёра, и вы будете вести одни конверты.\n' +
  '🐷 <b>Питомец-копилка:</b> растёт, когда откладываешь, и грустит, если перерасходуешь.\n\n' +
  'Ещё появились челленджи недели, значки за привычки и импорт выписки из банка.\n\n' +
  (gift ? 'Ты с нами с самого начала, поэтому у тебя полный доступ навсегда 🎁\n\n' : '') +
  'Попробуй прямо сейчас: напиши боту любую трату 👇';
async function sendNews(env, chat, gift, origin) {
  const base = env.ORIGIN || origin + '/';
  const a = await tg(env, 'sendAnimation', { chat_id: chat, animation: new URL(BC_VIDEO, base).href, caption: 'Что нового в боте 💌' });
  if (!a.ok && a.error_code === 403) return a;
  return tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', text: BC_TEXT(gift), reply_markup: appButton(origin) });
}

export class UserStore extends DurableObject {
  /* реестр (один экземпляр с именем __registry__) */
  async regUpdate(uid, patch) {
    const k = 'u:' + uid;
    const v = { first: Date.now(), ...((await this.ctx.storage.get(k)) || {}), ...patch };
    if (!v.paid && v.user && FREE_USERS.includes(String(v.user).toLowerCase())) Object.assign(v, { paid: true, paidAt: Date.now(), gift: true });
    await this.ctx.storage.put(k, v);
    return v;
  }
  async regList() {
    const m = await this.ctx.storage.list({ prefix: 'u:' });
    return [...m.entries()].map(([k, v]) => ({ uid: +k.slice(2), ...v }));
  }
  async getAdmin() { return (await this.ctx.storage.get('admin')) || null; }
  async regGet(uid) { return (await this.ctx.storage.get('u:' + uid)) || null; }
  async meta(k, v) { if (v === undefined) return (await this.ctx.storage.get('m:' + k)) ?? null; if (v === null) await this.ctx.storage.delete('m:' + k); else await this.ctx.storage.put('m:' + k, v); return v; }
  /* общий бюджет */
  async getLink() { return (await this.ctx.storage.get('link')) || null; }
  async setLink(owner) { if (owner) await this.ctx.storage.put('link', owner); else await this.ctx.storage.delete('link'); }
  async members(patch) { let m = (await this.ctx.storage.get('members')) || []; if (patch) { m = patch(m); await this.ctx.storage.put('members', m); } return m; }
  async getMembers() { return (await this.ctx.storage.get('members')) || []; }
  async setMembers(m) { await this.ctx.storage.put('members', m); return m; }
  async invite(code) { if (code) await this.ctx.storage.put('invite', code); return (await this.ctx.storage.get('invite')) || null; }
  async claimAdmin(id) {
    const a = await this.ctx.storage.get('admin');
    if (a) return a;
    await this.ctx.storage.put('admin', id);
    return id;
  }
  async getState() {
    return (await this.ctx.storage.get('state')) || null;
  }
  async putState(incoming, deleted = []) {
    const cur = (await this.ctx.storage.get('state')) || {};
    const del = new Set(deleted);
    const ids = new Set((incoming.tx || []).map((t) => t.id));
    // траты, добавленные ботом, пока приложение было открыто, не теряем
    const extra = (cur.tx || []).filter((t) => !ids.has(t.id) && !del.has(t.id));
    const state = { ...incoming, srv: cur.srv || {}, tx: [...(incoming.tx || []), ...extra] };
    await this.ctx.storage.put('state', state);
    return state;
  }
  async srvGet() { const s = (await this.ctx.storage.get('state')) || {}; return s.srv || {}; }
  async srvPatch(patch) {
    const s = (await this.ctx.storage.get('state')) || {};
    s.srv = { ...(s.srv || {}), ...patch };
    await this.ctx.storage.put('state', s);
    return s.srv;
  }
  async aiTick(day, max) {
    const s = (await this.ctx.storage.get('state')) || {};
    const a = (s.srv && s.srv.ai) || {};
    const n = a.d === day ? a.n || 0 : 0;
    if (n >= max) return false;
    s.srv = { ...(s.srv || {}), ai: { d: day, n: n + 1 } };
    await this.ctx.storage.put('state', s);
    return true;
  }
  async seenUpd(id) {
    const list = (await this.ctx.storage.get('upd')) || [];
    if (list.includes(id)) return true;
    list.push(id); while (list.length > 40) list.shift();
    await this.ctx.storage.put('upd', list);
    return false;
  }
  async addTx(tx) {
    const s = (await this.ctx.storage.get('state')) || {};
    s.tx = [...(s.tx || []), tx];
    await this.ctx.storage.put('state', s);
    return s;
  }
  async undo(by) {
    const s = (await this.ctx.storage.get('state')) || {};
    const list = s.tx || [];
    let idx = -1;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].src === 'bot' && (!by || !list[i].by || list[i].by === by)) { idx = i; break; }
    if (idx < 0) return null;
    const [removed] = list.splice(idx, 1);
    s.tx = list;
    await this.ctx.storage.put('state', s);
    return removed;
  }
  /* напоминания */
  async remAdd(rem) {
    const list = (await this.ctx.storage.get('rems')) || [];
    list.push(rem); list.sort((a, b) => a.at - b.at);
    await this.ctx.storage.put('rems', list);
    return list[0].at;
  }
  async remList() { return (await this.ctx.storage.get('rems')) || []; }
  async remDel(id) {
    const list = ((await this.ctx.storage.get('rems')) || []).filter((x) => x.id !== id);
    await this.ctx.storage.put('rems', list);
    return list.length ? list[0].at : null;
  }
  async remDue(now) {
    const list = (await this.ctx.storage.get('rems')) || [];
    const due = list.filter((x) => x.at <= now), rest = list.filter((x) => x.at > now);
    await this.ctx.storage.put('rems', rest);
    for (const d of due) await this.ctx.storage.put('rs:' + d.id, d);
    return { due, next: rest.length ? rest[0].at : null };
  }
  async remSent(id, del) { const v = await this.ctx.storage.get('rs:' + id); if (del) await this.ctx.storage.delete('rs:' + id); return v || null; }
  async setPending(p) { await this.ctx.storage.put('pending', p); }
  /* скрины выписок, ожидающие подтверждения */
  async shotPut(id, o) { await this.ctx.storage.put('shot:' + id, o); const m = await this.ctx.storage.list({ prefix: 'shot:' }); const ks = [...m.keys()].sort(); while (ks.length > 8) await this.ctx.storage.delete(ks.shift()); }
  async shotGet(id) { return (await this.ctx.storage.get('shot:' + id)) || null; }
  async shotToggle(id, i) { const o = await this.ctx.storage.get('shot:' + id); if (!o || !o.items[i]) return o || null; o.items[i].on = !o.items[i].on; await this.ctx.storage.put('shot:' + id, o); return o; }
  async shotDel(id) { const o = await this.ctx.storage.get('shot:' + id); await this.ctx.storage.delete('shot:' + id); return o || null; }
  async addTxs(list) {
    const s = (await this.ctx.storage.get('state')) || {};
    const have = new Set((s.tx || []).map((t) => t.imp).filter(Boolean));
    const add = list.filter((t) => !t.imp || !have.has(t.imp));
    s.tx = [...(s.tx || []), ...add];
    await this.ctx.storage.put('state', s);
    return { state: s, added: add };
  }
  async takePending() {
    const p = await this.ctx.storage.get('pending');
    await this.ctx.storage.delete('pending');
    return p || null;
  }
}

/* ---------- помощники ---------- */
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
export const CURS = {
  RUB: { sym: '₽', tok: ['₽', 'рублей', 'рубля', 'рубль', 'руб.', 'руб', 'rub', 'р.', 'р'] },
  CNY: { sym: '¥', tok: ['¥', 'юаней', 'юаня', 'юани', 'юань', 'cny', 'rmb', 'ю'] },
  USD: { sym: '$', tok: ['$', 'долларов', 'доллара', 'доллар', 'долл', 'баксов', 'бакса', 'бакс', 'usd'] },
  EUR: { sym: '€', tok: ['€', 'евро', 'eur'] },
  KZT: { sym: '₸', tok: ['₸', 'тенге', 'kzt'] },
  GEL: { sym: '₾', tok: ['₾', 'лари', 'gel'] },
  THB: { sym: '฿', tok: ['฿', 'батов', 'бата', 'бат', 'thb'] },
  TRY: { sym: '₺', tok: ['₺', 'лир', 'лиры', 'лира', 'try'] },
  AED: { sym: 'AED', tok: ['дирхамов', 'дирхама', 'дирхам', 'aed'] },
};
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const fmt = (n, cur = 'RUB') => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ' + (CURS[cur]?.sym || cur);
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// «50 юаней такси» → { cur: 'CNY', rest: '50 такси' }
export function extractCurrency(text) {
  for (const [code, c] of Object.entries(CURS)) {
    for (const tok of c.tok) {
      const sym = !/[a-zа-яё]/i.test(tok);
      const re = sym ? new RegExp(reEsc(tok)) : new RegExp('(?<=^|[\\s\\d])' + reEsc(tok) + '(?=$|[\\s.,!?)])', 'i');
      const m = text.match(re);
      if (m) return { cur: code, rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
    }
  }
  return { cur: null, rest: text };
}

export function conv(a, from, to, rates) {
  if (from === to) return a;
  if (!rates || !rates[from] || !rates[to]) return null;
  return (a / rates[from]) * rates[to];
}

export async function getRates() {
  const key = new Request('https://rates.cache/usd-v1');
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) { const hit = await cache.match(key); if (hit) return hit.json(); }
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    if (j.result !== 'success') return null;
    const rates = {};
    for (const c of Object.keys(CURS)) if (j.rates[c]) rates[c] = j.rates[c];
    if (cache) await cache.put(key, new Response(JSON.stringify(rates), { headers: { 'cache-control': 'max-age=21600', 'content-type': 'application/json' } }));
    return rates;
  } catch { return null; }
}
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

/* ---------- даты ---------- */
const pad2 = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ymd = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
// «локальное сейчас» пользователя: UTC-поля этой даты = его местное время
function localNow(state) {
  const off = state && Number.isFinite(state.tz) ? state.tz : 180;
  return new Date(Date.now() + off * 60000);
}
const todayUTC = (state) => { const n = localNow(state); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); };
export const todayStr = (state) => ymd(new Date(todayUTC(state)));
const MON3 = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// «вчера такси 300», «15.10 кафе 500», «3 дня назад 200 еда», «12 октября 900 одежда»
export function extractDate(text, state) {
  const base = todayUTC(state);
  const ago = (n) => ymd(new Date(base - n * 864e5));
  const fix = (y, m, d) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const now = new Date(base);
    let yy = y ?? now.getUTCFullYear();
    if (yy < 100) yy += 2000;
    let t = Date.UTC(yy, m - 1, d);
    if (y == null && t > base) t = Date.UTC(yy - 1, m - 1, d);
    if (t > base || base - t > 400 * 864e5) return null;
    return ymd(new Date(t));
  };
  const rules = [
    [/(^|\s)позавчера(?=$|[\s.,!])/i, () => ago(2)],
    [/(^|\s)вчера(?=$|[\s.,!])/i, () => ago(1)],
    [/(^|\s)сегодня(?=$|[\s.,!])/i, () => ago(0)],
    [/(^|\s)(\d{1,2})\s*(?:дн(?:я|ей|ь)|д\.?)\s*назад(?=$|[\s.,!])/i, (m) => (+m[2] <= 60 ? ago(+m[2]) : null), true],
    [/(^|\s)(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?=$|\s)/, (m) => fix(m[4] ? +m[4] : null, +m[3], +m[2]), true],
    [new RegExp('(^|\\s)(\\d{1,2})\\s+(' + MON_GEN.join('|') + ')(?=$|[\\s.,!])', 'i'), (m) => fix(null, MON_GEN.indexOf(m[3].toLowerCase()) + 1, +m[2]), true],
  ];
  for (const [re, fn, numeric] of rules) {
    const m = text.match(re);
    if (!m) continue;
    const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    if (numeric && !/\d/.test(rest)) continue; // число нужно оставить под сумму
    const date = fn(m);
    if (date) return { date, rest };
  }
  return { date: null, rest: text };
}

// «1,5к кафе» → { sum: 1500, note: 'кафе' }
export function parseExpense(raw, state) {
  const { date, rest: noDate } = extractDate(raw, state);
  const { cur, rest: text } = extractCurrency(noDate);
  const m = text.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(к|k|тыс\.?|тысяч[аи]?)?(?=\s|$|[.,!?])/i);
  if (!m) return null;
  let sum = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
  if (m[2]) sum *= 1000;
  sum = Math.round(sum * 100) / 100;
  if (!sum || sum <= 0 || sum > 10_000_000) return null;
  const note = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length))
    .replace(/₽|руб(лей|ля|ль)?\.?/gi, ' ')
    .replace(/(^|\s)р\.?(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return { sum, note, cur, date };
}

/* ---------- категории пользователя ---------- */
export function getCats(state) {
  if (Array.isArray(state?.cats) && state.cats.length) return state.cats;
  return ENVS.filter((e) => e.legacy !== false).map((e) => ({ id: e.id, ic: state?.i?.[e.id] || e.ic, name: state?.n?.[e.id] || e.name, save: !!e.save, amt: state?.a?.[e.id] }));
}
const catInfo = (id, state) => getCats(state).find((c) => c.id === id) || { id, ic: '📦', name: 'Прочее', save: false };

export function detectEnv(note, state) {
  const t = note.toLowerCase();
  if (!t) return null;
  const cats = getCats(state);
  for (const c of cats) {
    const nm = (c.name || '').toLowerCase().trim();
    if (nm.length >= 3 && t.includes(nm)) return c.id;
  }
  for (const c of cats) {
    const words = (c.name || '').toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 4);
    if (words.some((w) => t.includes(w.slice(0, Math.max(4, w.length - 2))))) return c.id;
  }
  for (const e of ENVS) {
    if (!e.kw.some((k) => t.includes(k))) continue;
    if (cats.some((c) => c.id === e.id)) return e.id;
    if (e.save) { const s = cats.find((c) => c.save); if (s) return s.id; }
    if (e.alt) { const a = e.alt.find((id) => cats.some((c) => c.id === id)); if (a) return a; }
  }
  return null;
}

/* ---------- периоды ---------- */
export function period(state, off = 0) {
  const sd = state?.start || 1;
  const n = new Date(todayUTC(state));
  let y = n.getUTCFullYear(), m = n.getUTCMonth();
  if (n.getUTCDate() < sd) m--;
  const s = new Date(Date.UTC(y, m + off, sd)), e = new Date(Date.UTC(y, m + off + 1, sd));
  const last = new Date(e - 864e5);
  const label = sd === 1 ? MONTHS[s.getUTCMonth()] : `${s.getUTCDate()} ${MON3[s.getUTCMonth()]} – ${last.getUTCDate()} ${MON3[last.getUTCMonth()]}`;
  const elapsed = off === 0 ? Math.round((n - s) / 864e5) + 1 : Math.round((e - s) / 864e5);
  return { s: ymd(s), e: ymd(e), label, elapsed, days: Math.round((e - s) / 864e5) };
}
const txDate = (t) => t.date || `${t.m || '0000-00'}-${pad2(t.day || 1)}`;
const inPeriod = (t, P) => { const d = txDate(t); return d >= P.s && d < P.e; };
const dateHuman = (d, state) => {
  const t = todayStr(state);
  if (d === t) return 'сегодня';
  if (d === ymd(new Date(todayUTC(state) - 864e5))) return 'вчера';
  return `${+d.slice(8)} ${MON3[+d.slice(5, 7) - 1]}`;
};

function makeTx(p, envId, state, rates) {
  const main = state.cur || 'RUB';
  const cur = p.cur || main;
  const base = conv(p.sum, cur, main, rates);
  if (base == null) return null;
  const usd = conv(p.sum, cur, 'USD', rates);
  return { id: Date.now(), date: p.date || todayStr(state), env: envId, sum: Math.round(base), orig: p.sum, cur, usd: usd == null ? null : Math.round(usd * 100) / 100, note: p.note, src: 'bot' };
}

export function monthReport(state, rates, off = 0) {
  const main = state.cur || 'RUB', P = period(state, off);
  const list = (state.tx || []).filter((t) => inPeriod(t, P));
  const isSave = (t) => catInfo(t.env, state).save;
  const spent = list.filter((t) => !isSave(t)).reduce((a, t) => a + t.sum, 0);
  const saved = list.filter(isSave).reduce((a, t) => a + t.sum, 0);
  const show = [...new Set([main, 'CNY', 'USD', 'RUB'])];
  const multi = (v) => show.map((c) => { const x = conv(v, main, c, rates); return x == null ? null : fmt(x, c); }).filter(Boolean).join(' ≈ ');
  const by = {};
  list.filter((t) => !isSave(t)).forEach((t) => { by[t.env] = (by[t.env] || 0) + t.sum; });
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, v]) => { const e = catInfo(id, state); return `${e.ic} ${e.name} — ${fmt(v, main)} (${spent ? Math.round((v / spent) * 100) : 0}%)`; });
  const head = `за ${P.label}`;
  if (!list.length) return `📅 Итоги ${head}: пока нет записей. Напиши, например: еда 50 ю`;
  let out = `📅 Итоги ${head}\n\n💸 Потрачено: ${multi(spent)}`;
  out += `\n📆 В среднем в день: ${fmt(spent / Math.max(1, P.elapsed), main)}`;
  if (top.length) out += `\n\nКуда ушло больше всего:\n${top.join('\n')}`;
  if (saved) out += `\n\n🐷 Отложено: ${multi(saved)}`;
  return out;
}

function summary(state, envId, tx) {
  const e = catInfo(envId, state);
  const main = state.cur || 'RUB', P = period(state);
  const amt = tx.cur && tx.cur !== main ? `${fmt(tx.orig, tx.cur)} (≈ ${fmt(tx.sum, main)})` : fmt(tx.sum, main);
  const when = tx.date && tx.date !== todayStr(state) ? `\n📅 Записал на ${dateHuman(tx.date, state)}` : '';
  if (!inPeriod(tx, P)) return `${e.ic} ${e.save ? 'Отложено' : '−'}${e.save ? ' ' : ''}${amt} → «${e.name}»${when} (прошлый месяц)`;
  const spent = (state.tx || []).filter((t) => t.env === envId && inPeriod(t, P)).reduce((a, t) => a + t.sum, 0);
  if (e.save) return `${e.ic} Отложено ${amt} → «${e.name}» 🐷${when}\nЗа месяц отложено: ${fmt(spent, main)}`;
  const line = `${e.ic} −${amt} → «${e.name}»${when}`;
  const plan = e.amt;
  if (state.mode === 'simple' || !plan) return line + `\nЗа месяц на «${e.name}»: ${fmt(spent, main)}`;
  const left = plan - spent;
  return line + (left >= 0 ? `\nОсталось в конверте: ${fmt(left, main)}` : `\n😬 Перерасход: ${fmt(-left, main)}`);
}

/* ---------- утро / вечер ---------- */
const sumOf = (list) => list.reduce((a, t) => a + t.sum, 0);
export function morningText(state) {
  const main = state.cur || 'RUB', P = period(state);
  const isSave = (t) => catInfo(t.env, state).save;
  const txP = (state.tx || []).filter((t) => inPeriod(t, P) && !isSave(t));
  const spent = sumOf(txP);
  const plan = getCats(state).filter((c) => !c.save).reduce((a, c) => a + (c.amt || 0), 0);
  if (state.mode !== 'simple' && plan) {
    const left = plan - spent, daysLeft = Math.max(1, P.days - P.elapsed + 1);
    if (left <= 0) return `☀️ Доброе утро! Бюджет месяца уже потрачен, перерасход ${fmt(-left, main)}. Сегодня лучше без лишних трат 💪`;
    return `☀️ Доброе утро! Сегодня можно потратить до <b>${fmt(left / daysLeft, main)}</b>.\nЗа месяц ушло ${fmt(spent, main)} из ${fmt(plan, main)}.`;
  }
  const y = ymd(new Date(todayUTC(state) - 864e5));
  const ySpent = sumOf((state.tx || []).filter((t) => txDate(t) === y && !isSave(t)));
  if (!(state.tx || []).length) return '☀️ Доброе утро! Не забывай записывать траты: просто напиши мне, например, <code>кофе 300</code>.';
  return `☀️ Доброе утро! Вчера ушло ${fmt(ySpent, main)}.\nЗа месяц: ${fmt(spent, main)}.`;
}
const CH_SRV = { nodeliv: ['🛵 Неделя без доставки', /доставк|самокат|яндекс ?еда|delivery|деливери|заказ еды|wolt/i], coffee: ['☕ Кофе дома', /кофе|coffee|латте|капучино|раф|американо|starbucks|кофейн/i], food: ['🛒 Еда в рамках'], zero: ['🧘 3 дня без трат'], save10: ['🐷 Отложи 10%'] };
function chLine(state) {
  const ch = state.ch; if (!ch || ch.status !== 'active' || !CH_SRV[ch.id]) return '';
  const [t, ban] = CH_SRV[ch.id], n = Math.floor((todayUTC(state) - Date.parse(ch.start + 'T00:00:00Z')) / 864e5) + 1;
  if (n < 1 || n > 7) return '';
  if (ban && (state.tx || []).some((x) => txDate(x) >= ch.start && ban.test(x.note || ''))) return `\n\n🏁 ${t}: похоже, сорвалось 😬 Открой приложение и начни заново — получится!`;
  return `\n\n🏁 ${t}: день ${n} из 7${n === 7 ? ' — последний, продержись!' : ' — держишься! 🔥'}`;
}
export function eveningText(state) {
  const main = state.cur || 'RUB', today = todayStr(state);
  const isSave = (t) => catInfo(t.env, state).save;
  const list = (state.tx || []).filter((t) => txDate(t) === today && !isSave(t));
  if (!list.length) {
    const st = streakOf(state);
    const pet = state.pet && state.pet.name ? `\n${state.pet.name} скучает и ждёт новостей 💤` : '';
    return { text: (st >= 2 ? `🌙 Сегодня ни одной записи. 🔥 Серия ${st} дн. под угрозой! День без трат или забыл записать?` : '🌙 Сегодня ни одной записи. День без трат или забыл записать?') + '\n📸 Можно просто скинуть скрин истории операций из банка — запишу сам.' + pet + chLine(state), empty: true };
  }
  const by = {};
  list.forEach((t) => { by[t.env] = (by[t.env] || 0) + t.sum; });
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, v]) => { const c = catInfo(id, state); return `${c.ic} ${c.name} — ${fmt(v, main)}`; });
  let text = `🌙 Итог дня: <b>${fmt(sumOf(list), main)}</b>\n${top.join('\n')}`;
  const P = period(state), plan = getCats(state).filter((c) => !c.save).reduce((a, c) => a + (c.amt || 0), 0);
  if (state.mode !== 'simple' && plan) {
    const left = plan - sumOf((state.tx || []).filter((t) => inPeriod(t, P) && !isSave(t)));
    const daysLeft = Math.max(1, P.days - P.elapsed);
    text += left > 0 ? `\n\nЗавтра можно до ${fmt(left / daysLeft, main)}.` : `\n\n😬 Бюджет месяца превышен на ${fmt(-left, main)}.`;
  }
  return { text: text + chLine(state) + '\n\nВсё записал? Платил картой или Алипеем — скинь скрин истории операций, я разнесу сам 📸', empty: false };
}
/* ---------- «напомни …» ---------- */
const WD = [['воскресень', 0], ['понедельник', 1], ['вторник', 2], ['сред', 3], ['четверг', 4], ['пятниц', 5], ['суббот', 6]];
export function parseReminder(raw, state) {
  let t = ' ' + raw.replace(/^\s*\/?(напомни(ть)?|напоминание)(?=\s|$)[:,]?/i, '').trim() + ' ';
  const tz = Number.isFinite(state.tz) ? state.tz : 180;
  const nowL = Date.now() + tz * 60000; // «местное» время в UTC-полях
  const base = new Date(nowL);
  let day = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  let mins = null, dayGiven = false, rel = null;
  const cut = (re) => { const m = t.match(re); if (m) t = t.replace(m[0], ' '); return m; };
  let m;
  if ((m = cut(/\sчерез\s+(полчаса|час|(\d+)\s*(мин[а-яё]*|м(?=\s)|час[а-яё]*|ч(?=\s)|д(ень|ня|ней)))/i))) {
    if (/полчаса/i.test(m[1])) rel = 30;
    else if (/^час$/i.test(m[1])) rel = 60;
    else { const n = +m[2], u = m[3].toLowerCase(); rel = u.startsWith('м') ? n : u.startsWith('ч') ? n * 60 : n * 1440; }
  }
  if (rel != null) return finish(nowL + rel * 60000);
  if (cut(/\sпослезавтра\s/i)) { day += 2 * 864e5; dayGiven = true; }
  else if (cut(/\sзавтра\s/i)) { day += 864e5; dayGiven = true; }
  else if (cut(/\sсегодня\s/i)) dayGiven = true;
  if (!dayGiven && (m = cut(/\s(в|во)\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)\s/i))) {
    const w = WD.find(([k]) => m[2].toLowerCase().startsWith(k))[1];
    let d = (w - new Date(day).getUTCDay() + 7) % 7; if (d === 0) d = 7;
    day += d * 864e5; dayGiven = true;
  }
  if (!dayGiven && (m = cut(/\s(\d{1,2})[.\/](\d{1,2})\s/))) {
    let y = base.getUTCFullYear(); let d = Date.UTC(y, +m[2] - 1, +m[1]);
    if (d < day) d = Date.UTC(y + 1, +m[2] - 1, +m[1]);
    day = d; dayGiven = true;
  }
  if (!dayGiven && (m = cut(/\s(\d{1,2})\s*(-?го)?\s*(числа|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s/i))) {
    const mon = MON_GEN.indexOf(m[3].toLowerCase());
    let y = base.getUTCFullYear(), mo = mon >= 0 ? mon : base.getUTCMonth();
    let d = Date.UTC(y, mo, +m[1]);
    if (d < day) d = mon >= 0 ? Date.UTC(y + 1, mo, +m[1]) : Date.UTC(y, mo + 1, +m[1]);
    day = d; dayGiven = true;
  }
  if ((m = cut(/\s(в|к)\s*(\d{1,2})([:.](\d{2}))?\s*(утра|дня|вечера|ночи|ч|час[а-яё]*)?\s/i)) || (m = cut(/\s()(\d{1,2})([:](\d{2}))\s*(утра|дня|вечера|ночи)?\s/))) {
    let h = +m[2]; const mi = m[4] ? +m[4] : 0, pr = (m[5] || '').toLowerCase();
    if ((pr === 'дня' || pr === 'вечера') && h < 12) h += 12;
    if (pr === 'ночи' && h === 12) h = 0;
    if (h < 24 && mi < 60) mins = h * 60 + mi;
  } else if (cut(/\sутром\s/i)) mins = 9 * 60;
  else if (cut(/\sднём\s|\sднем\s/i)) mins = 13 * 60;
  else if (cut(/\sвечером\s/i)) mins = 19 * 60;
  if (mins == null && !dayGiven) return null;
  if (mins == null) mins = 10 * 60;
  let at = day + mins * 60000;
  if (at <= nowL && !dayGiven) at += 864e5;
  if (at <= nowL) return null;
  return finish(at);
  function finish(atL) {
    const text = t.replace(/\s+/g, ' ').replace(/^[\s,:–-]+|[\s,.]+$/g, '').trim();
    return { atLocal: atL, at: atL - tz * 60000, text };
  }
}
const whenHuman = (atL, state) => {
  const tz = Number.isFinite(state.tz) ? state.tz : 180;
  const d = new Date(atL), today = todayUTC(state), dd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const hmS = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  const diff = Math.round((dd - today) / 864e5);
  void tz;
  return (diff === 0 ? 'сегодня' : diff === 1 ? 'завтра' : diff === 2 ? 'послезавтра' : `${d.getUTCDate()} ${MON_GEN[d.getUTCMonth()]}`) + ' в ' + hmS;
};

/* ---------- отчёт за неделю и итоги месяца ---------- */
export function weekText(state) {
  const main = state.cur || 'RUB', today = todayUTC(state);
  const isSave = (t) => catInfo(t.env, state).save;
  const rng = (a, b) => (state.tx || []).filter((t) => { const d = Date.parse(txDate(t) + 'T00:00:00Z'); return d > today - a * 864e5 && d <= today - b * 864e5 && !isSave(t); });
  const w = rng(7, 0), pw = rng(14, 7);
  if (!w.length) return null;
  const s = sumOf(w), ps = sumOf(pw);
  const by = {}; w.forEach((t) => { by[t.env] = (by[t.env] || 0) + t.sum; });
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, v]) => { const c = catInfo(id, state); return `${c.ic} ${c.name} — ${fmt(v, main)}`; });
  const days = new Set(w.map(txDate)); const noSpend = 7 - days.size;
  const big = w.reduce((a, t) => (t.sum > a.sum ? t : a), w[0]);
  let out = `📊 <b>Неделя в цифрах</b>\n\n💸 Потрачено: <b>${fmt(s, main)}</b>`;
  if (ps) { const d = Math.round(((s - ps) / ps) * 100); out += d > 0 ? `\n📈 На ${d}% больше, чем неделей раньше` : d < 0 ? `\n📉 На ${-d}% меньше, чем неделей раньше 👏` : '\nСтолько же, сколько неделей раньше'; }
  out += `\n\nБольше всего:\n${top.join('\n')}`;
  out += `\n\n🧾 Самая крупная трата: ${fmt(big.sum, main)}${big.note ? ' — ' + big.note : ''}`;
  if (noSpend) out += `\n🧘 Дней без трат: ${noSpend}`;
  return out;
}
export function monthStartText(state, rates) {
  const prev = (state.tx || []).filter((t) => inPeriod(t, period(state, -1)));
  if (!prev.length) return null;
  const isSave = (t) => catInfo(t.env, state).save;
  const main = state.cur || 'RUB', P = period(state, -1);
  const spent = sumOf(prev.filter((t) => !isSave(t)));
  const plan = getCats(state).filter((c) => !c.save).reduce((a, c) => a + (c.amt || 0), 0);
  let head = '🗓 <b>Новый месяц!</b> Вот как прошёл прошлый:\n\n';
  if (state.mode !== 'simple' && plan) head += spent <= plan ? `🏆 Уложился в план! Сэкономлено ${fmt(plan - spent, main)}.\n\n` : `😬 План превышен на ${fmt(spent - plan, main)}. В этом месяце получится лучше 💪\n\n`;
  void P;
  return head + monthReport(state, rates, -1);
}
const hm = (t) => { const [h, m] = String(t || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
const APPKB = (env) => (env.ORIGIN ? [[{ text: '📊 Открыть бюджет', web_app: { url: env.ORIGIN } }]] : []);
async function runSchedule(env) {
  const reg = store(env, '__registry__');
  try {
    if ((await reg.meta('whv')) !== 3 && env.ORIGIN) {
      const o = env.ORIGIN.replace(/\/$/, '');
      const w = await tg(env, 'setWebhook', { url: o + '/tg', secret_token: await webhookSecret(env.BOT_TOKEN), allowed_updates: ['message', 'callback_query', 'pre_checkout_query'] });
      if (w.ok) { await reg.meta('whv', 3); await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Мой бюджет', web_app: { url: o + '/' } } }); }
    }
  } catch (e) { console.error('whv', e); }
  const users = await reg.regList();
  const now = Date.now();
  let rates = null;
  for (const u of users) {
    const local = new Date(now + (Number.isFinite(u.tz) ? u.tz : 180) * 60000);
    const mins = local.getUTCHours() * 60 + local.getUTCMinutes(), today = ymd(local);
    /* напоминания «напомни …» */
    if (u.remNext && u.remNext <= now) {
      try {
        const { due, next } = await store(env, u.uid).remDue(now);
        for (const d of due) {
          const kb = [];
          if (d.sum) kb.push([{ text: `✅ Оплатил — записать ${fmt(d.sum, d.cur || 'RUB')}`, callback_data: 'r:pay:' + d.id }]);
          kb.push([{ text: '👍 Сделал', callback_data: 'r:ok:' + d.id }, { text: '⏰ Через час', callback_data: 'r:sn:' + d.id }]);
          await tg(env, 'sendMessage', { chat_id: u.uid, text: '⏰ Напоминание: ' + d.text, reply_markup: { inline_keyboard: kb } });
        }
        await reg.regUpdate(u.uid, { remNext: next });
      } catch (e) { console.error('rem', u.uid, e); }
    }
    /* регулярные платежи */
    if (Array.isArray(u.subs) && u.subs.length && mins >= 10 * 60) {
      const ym = today.slice(0, 7), dim = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
      const sent = u.subSent || {};
      const dueSubs = u.subs.filter((x) => x && x.on !== false && Math.min(+x.day || 1, dim) === local.getUTCDate() && sent[x.id] !== ym);
      for (const x of dueSubs) {
        await tg(env, 'sendMessage', { chat_id: u.uid, text: `🔁 Сегодня платёж: ${x.ic || '💳'} ${x.name} — ${fmt(x.sum, x.cur || 'RUB')}`, reply_markup: { inline_keyboard: [[{ text: '✅ Оплатил — записать', callback_data: 's:pay:' + x.id }], [{ text: '⏭ Не в этот раз', callback_data: 's:skip:' + x.id }]] } });
        sent[x.id] = ym;
      }
      if (dueSubs.length) await reg.regUpdate(u.uid, { subSent: sent });
    }
    const n = u.notif;
    if (!n) continue;
    /* отчёт за неделю: воскресенье 20:00, итоги месяца: день начала месяца 10:00 */
    const wOn = n.w !== false && (n.m || n.e || n.w), moOn = n.mo !== false && (n.m || n.e || n.mo);
    const wk = ymd(new Date(local.getTime() - local.getUTCDay() * 864e5));
    if (wOn && local.getUTCDay() === 0 && mins >= 20 * 60 && u.last_w !== wk) {
      try {
        const st = (await store(env, u.link || u.uid).getState()) || {};
        const t = weekText(st);
        if (t) await tg(env, 'sendMessage', { chat_id: u.uid, parse_mode: 'HTML', text: t, reply_markup: { inline_keyboard: APPKB(env) } });
        await reg.regUpdate(u.uid, { last_w: wk });
      } catch (e) { console.error('week', u.uid, e); }
    }
    if (moOn && mins >= 10 * 60) {
      try {
        const st0 = { start: u.start || 1 };
        if (local.getUTCDate() === Math.min(st0.start, 28) && u.last_mo !== today) {
          const st = (await store(env, u.link || u.uid).getState()) || {};
          rates = rates || (await getRates());
          const t = monthStartText(st, rates);
          if (t) await tg(env, 'sendMessage', { chat_id: u.uid, parse_mode: 'HTML', text: t, reply_markup: { inline_keyboard: APPKB(env) } });
          await reg.regUpdate(u.uid, { last_mo: today });
        }
      } catch (e) { console.error('month', u.uid, e); }
    }
    if (!n.m && !n.e) continue;
    for (const k of ['m', 'e']) {
      const at = hm(n[k + 't']);
      if (!n[k] || at == null || mins < at || mins >= at + 60 || u['last_' + k] === today) continue;
      try {
        const state = (await store(env, u.link || u.uid).getState()) || {};
        let body;
        if (k === 'm') body = { text: morningText(state), reply_markup: { inline_keyboard: [[{ text: '📊 Открыть бюджет', web_app: { url: env.ORIGIN || '' } }]] } };
        else {
          const ev = eveningText(state);
          const kb = ev.empty ? [[{ text: '🧘 Без трат', callback_data: 'ns' }], [{ text: '📊 Открыть бюджет', web_app: { url: env.ORIGIN || '' } }]] : [[{ text: '📊 Открыть бюджет', web_app: { url: env.ORIGIN || '' } }]];
          body = { text: ev.text, reply_markup: { inline_keyboard: kb } };
        }
        if (!env.ORIGIN) delete body.reply_markup;
        const r = await tg(env, 'sendMessage', { chat_id: u.uid, parse_mode: 'HTML', ...body });
        const patch = { ['last_' + k]: today };
        if (!r.ok && r.error_code === 403) patch.notif = { ...n, m: false, e: false };
        await reg.regUpdate(u.uid, patch);
      } catch (e) { console.error('schedule', u.uid, e); }
    }
  }
}

/* ---------- выгрузка в Excel (CSV) ---------- */
export function buildCsv(state) {
  const main = state.cur || 'RUB';
  const q = (v) => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const num = (v) => String(Math.round((v || 0) * 100) / 100).replace('.', ',');
  const rows = [['Дата', 'Категория', 'Тип', `Сумма, ${main}`, 'Сумма в валюте траты', 'Валюта', 'Комментарий', 'Откуда']];
  [...(state.tx || [])].sort((a, b) => txDate(a).localeCompare(txDate(b))).forEach((t) => {
    const c = catInfo(t.env, state);
    rows.push([txDate(t), `${c.ic} ${c.name}`, c.save ? 'Отложено' : 'Трата', num(t.sum), num(t.orig ?? t.sum), t.cur || main, t.note || '', t.src === 'bot' ? 'бот' : 'приложение']);
  });
  return '\ufeff' + rows.map((r) => r.map(q).join(';')).join('\r\n');
}

/* ---------- Telegram ---------- */
async function tg(env, method, body) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    console.error('tg', method, e);
    return { ok: false };
  }
}
let ORIGIN_FIX = null;
const appButton = (origin) => ({ inline_keyboard: [[{ text: '📊 Открыть бюджет', web_app: { url: (ORIGIN_FIX || origin + '/') } }]] });

/* ---------- ключевые слова вместо команд ---------- */
export const KB = { keyboard: [[{ text: '☀️ Сегодня' }, { text: '📊 Итоги месяца' }], [{ text: '📅 Неделя' }, { text: '✉️ Категории' }], [{ text: '⏰ Напоминания' }, { text: '🔁 Платежи' }], [{ text: '↩️ Отменить' }, { text: '💡 Помощь' }]], resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Напиши трату: кофе 300' };
export function keywordOf(raw) {
  const t = raw.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s/]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /\d/.test(t)) return null;
  const has = (re) => re.test(t);
  if (has(/^\/?(start|старт|начать|меню|привет|здравствуй\S*|хай|hello|hi)$/)) return 'start';
  if (has(/^\/?(help|помощь|помоги|инструкция|команды|что (ты )?умеешь|как (пользоваться|писать|записать|это работает))$/)) return 'help';
  if (has(/^\/?(undo|отмена|отменить|отмени|удали( последн\S*)?( трату| запись)?|удалить( последн\S*)?( трату| запись)?|назад|ошибся)$/)) return 'undo';
  if (has(/^\/?(reminders|напоминания|мои напоминания|список напоминаний)$/)) return 'rem';
  if (has(/^\/?(subs|подписки|платежи|регулярные( платежи)?|мои платежи|мои подписки)$/)) return 'subs';
  if (has(/^\/?(today|сегодня|сколько можно( потратить)?( сегодня)?|можно сегодня|лимит|остаток|сколько осталось|траты за сегодня|сколько (я )?потратил сегодня)$/)) return 'today';
  if (has(/^\/?(week|неделя|за неделю|итоги недели|отчет за неделю|траты за неделю)$/)) return 'week';
  if (has(/^\/?(cats|категории|конверты|мои категории|по категориям)$/)) return 'cats';
  if (has(/^\/?(report|month|итоги|итог|итоги месяца|итоги за месяц|итог за месяц|отчет за месяц|отчет|месяц|статистика|сколько (я )?потратил|траты за месяц|за месяц|баланс)$/)) return 'report';
  return null;
}
export function todayText(state) {
  const main = state.cur || 'RUB', P = period(state), today = todayStr(state);
  const isSave = (t) => catInfo(t.env, state).save;
  const spT = (state.tx || []).filter((t) => inPeriod(t, P) && !isSave(t));
  const tod = spT.filter((t) => txDate(t) === today), todS = sumOf(tod), before = sumOf(spT.filter((t) => txDate(t) < today));
  const plan = getCats(state).filter((c) => !c.save).reduce((a, c) => a + (c.amt || 0), 0);
  let out = '';
  if (state.mode !== 'simple' && plan) {
    const norm = Math.max(0, (plan - before) / Math.max(1, P.days - P.elapsed + 1)), left = norm - todS;
    out = left >= 0 ? `☀️ Сегодня можно ещё <b>${fmt(left, main)}</b>\nНорма на день ${fmt(norm, main)}, потрачено ${fmt(todS, main)}.` : `😬 Сегодня уже сверх нормы на <b>${fmt(-left, main)}</b>\nНорма на день ${fmt(norm, main)}, потрачено ${fmt(todS, main)}.`;
  } else out = `☀️ Сегодня потрачено: <b>${fmt(todS, main)}</b>\nЗа месяц: ${fmt(sumOf(spT), main)}.`;
  if (tod.length) out += '\n\n' + tod.slice(-8).map((t) => { const c = catInfo(t.env, state); return `${c.ic} ${t.note || c.name} — ${fmt(t.sum, main)}`; }).join('\n');
  return out;
}
export function catsText(state) {
  const main = state.cur || 'RUB', P = period(state), simple = state.mode === 'simple';
  const list = (state.tx || []).filter((t) => inPeriod(t, P));
  const rows = getCats(state).map((c) => {
    const s = sumOf(list.filter((t) => t.env === c.id));
    if (c.save) return `${c.ic} ${c.name}: отложено ${fmt(s, main)}`;
    if (simple || !c.amt) return `${c.ic} ${c.name}: ${fmt(s, main)}`;
    const left = c.amt - s;
    return `${c.ic} ${c.name}: ${fmt(s, main)} из ${fmt(c.amt, main)}${left < 0 ? ' 😬' : ` (осталось ${fmt(left, main)})`}`;
  });
  return `✉️ <b>Категории за ${P.label}</b>\n\n` + rows.join('\n');
}

/* ---------- ИИ: повар, советник, чек ---------- */
const LLM = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const VISION = '@cf/meta/llama-3.2-11b-vision-instruct';
const AI_MAX = 15;
async function aiText(env, messages, max = 1400) {
  const r = await env.AI.run(LLM, { messages, max_tokens: max, temperature: 0.6 });
  const v = r && r.response;
  return typeof v === 'string' ? v : v ? JSON.stringify(v) : '';
}
export function pickJSON(t) {
  if (!t) return null;
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  const raw = t.slice(a, b + 1);
  try { return JSON.parse(raw); } catch (e) { /* ниже чиним */ }
  try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')); } catch (e) { return null; }
}
const DAYS7 = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MEALS = ['завтрак', 'обед', 'ужин'];
export function cleanMenu(j, people) {
  if (!j || !Array.isArray(j.days) || !Array.isArray(j.shop)) return null;
  const days = DAYS7.map((d, i) => { const x = j.days[i] || []; const arr = Array.isArray(x) ? x : [x.d, x.b, x.l, x.dn]; return [d, ...[1, 2, 3].map((k) => String(arr[k] || '—').slice(0, 80))]; });
  const shop = [];
  for (const g of j.shop.slice(0, 10)) {
    const name = String((Array.isArray(g) ? g[0] : g.c) || '🧺 Продукты').slice(0, 30);
    const items = ((Array.isArray(g) ? g[1] : g.i) || []).slice(0, 25).map((it) => {
      const [n, q, u, pr] = Array.isArray(it) ? it : [it.n, it.q, it.u, it.p];
      return [Math.max(0.05, +q || 1), String(u || 'шт.').slice(0, 6), String(n || '').slice(0, 40), Math.max(0, +pr || 0)];
    }).filter((x) => x[2]);
    if (items.length) shop.push([name, items]);
  }
  if (!shop.length) return null;
  return { title: String(j.title || 'Твоё меню').slice(0, 60), days, shop, p: people, at: Date.now() };
}
const basketRub = (m) => m.shop.reduce((a, [, items]) => a + items.reduce((b, [q, , , pr]) => b + q * pr, 0), 0);
export async function makeMenu(env, state, request) {
  const srv = state.srv || {};
  const people = state.people || 2;
  const food = getCats(state).find((c) => c.id === 'food' || /прод|еда/i.test(c.name));
  const rates = await getRates();
  const weekBudget = food && food.amt ? conv(food.amt / 4.345, state.cur || 'RUB', 'RUB', rates) : null;
  const prefs = (srv.prefs || []).join(', ');
  const sys = 'Ты повар-экономист. Составляешь простое домашнее меню на 7 дней (завтрак, обед, ужин) и список покупок на всю неделю. ' +
    'Используй остатки: суп или основное блюдо можно есть 2 дня подряд, пиши «(вчерашний)». Блюда реальные, понятные, по-русски. ' +
    'Количества — на всю неделю для указанного числа людей. Единицы: кг, л, шт., уп. Цена — примерная средняя цена в рублях за 1 единицу в обычном российском супермаркете в 2026 году. ' +
    'Отвечай ТОЛЬКО JSON без пояснений, строго в формате: ' +
    '{"title":"короткое название недели","days":[["Пн","завтрак","обед","ужин"], ... 7 строк],"shop":[["🥩 Мясо и рыба",[["Куриное филе",1.5,"кг",420]]],["🌾 Крупы",[...]],["🥕 Овощи и фрукты",[...]],["🥛 Молочное и яйца",[...]],["🍞 Прочее",[...]]]}';
  const user = `Людей: ${people}. ${weekBudget ? `Бюджет на продукты на неделю: около ${Math.round(weekBudget)} рублей, постарайся уложиться. ` : ''}${prefs ? `Не использовать / учесть: ${prefs}. ` : ''}Пожелания: ${request || 'обычное сытное и недорогое меню'}.`;
  const out = await aiText(env, [{ role: 'system', content: sys }, { role: 'user', content: user }], 1600);
  const m = cleanMenu(pickJSON(out), people);
  if (m) m.q = request || '';
  return m;
}
export async function swapMeal(env, state, di, mi, wish) {
  const m = state.srv && state.srv.menuAI;
  if (!m) return null;
  const cur = m.days[di][mi + 1];
  const sys = 'Ты повар-экономист. Предложи ОДНО другое простое домашнее блюдо на замену. Отвечай ТОЛЬКО JSON: {"n":"название блюда","add":[["продукт",количество,"кг|л|шт.|уп.",цена_руб_за_единицу]]} — в add только продукты, которых нужно докупить, количества на ' + (m.p || 2) + ' чел.';
  const prefs = ((state.srv || {}).prefs || []).join(', ');
  const out = await aiText(env, [{ role: 'system', content: sys }, { role: 'user', content: `Заменить «${cur}» (${MEALS[mi]}, ${DAYS7[di]}). Меню недели: ${m.days.map((d) => d.slice(1).join(', ')).join('; ')}. ${prefs ? 'Не использовать: ' + prefs + '. ' : ''}${wish ? 'Пожелание: ' + wish : ''}` }], 400);
  const j = pickJSON(out);
  if (!j || !j.n) return null;
  m.days[di][mi + 1] = String(j.n).slice(0, 80);
  const add = (Array.isArray(j.add) ? j.add : []).slice(0, 8).map((it) => [Math.max(0.05, +it[1] || 1), String(it[2] || 'шт.').slice(0, 6), String(it[0] || '').slice(0, 40), Math.max(0, +it[3] || 0)]).filter((x) => x[2]);
  if (add.length) {
    let g = m.shop.find((x) => x[0] === '➕ Для замен');
    if (!g) { g = ['➕ Для замен', []]; m.shop.push(g); }
    g[1].push(...add);
  }
  m.at = Date.now();
  return m;
}
export function menuSummary(m, state, rates) {
  const main = state.cur || 'RUB', k = state.priceK || 1;
  const sum = conv(basketRub(m) * k * ((state.people || m.p) / (m.p || 1)), 'RUB', main, rates);
  const food = getCats(state).find((c) => c.id === 'food' || /прод|еда/i.test(c.name));
  const wk = food && food.amt ? food.amt / 4.345 : null;
  let out = `👨‍🍳 <b>${m.title}</b>\n\n` + m.days.map((d) => `<b>${d[0]}</b>: ${d[1]} · ${d[2]} · ${d[3]}`).join('\n');
  if (sum != null) out += `\n\n🛒 Корзина на неделю ≈ <b>${fmt(sum, main)}</b>`;
  if (sum != null && wk) out += wk >= sum ? `\n✅ Влезает в конверт «${food.name}» (${fmt(wk, main)} в неделю)` : `\n❗ Больше конверта «${food.name}» на ${fmt(sum - wk, main)}. Напиши «подешевле», и я переделаю`;
  return out + '\n\nСписок покупок — в приложении, вкладка «Еда». Заменить блюдо: «замени ужин в среду».';
}
export function foodIntent(t) {
  const x = t.toLowerCase().replace(/ё/g, 'е');
  if (/^(я\s+)?(не люблю|не ем|не ешь|аллергия на|исключи)\s+\S/.test(x)) return 'pref';
  if (/^(мои )?предпочтения$|^сбрось предпочтения$|^забудь предпочтения$/.test(x)) return 'prefs';
  if (/^замени\s/.test(x) && /(завтрак|обед|ужин)/.test(x)) return 'swap';
  if (/^подешевле$|^дешевле$/.test(x)) return 'menu';
  if (/\d/.test(x) && !/меню|рацион/.test(x)) return null;
  if (/(^|\s)(меню|рацион)(\s|$)|кухн[яюие]|что (приготовить|поесть|покушать)|^хочу (на неделю|поесть|есть)|на неделю (хочу|поесть)|^(придумай|составь|подбери|предложи) (еду|блюда|меню|рацион)/.test(x)) return 'menu';
  return null;
}
export function isQuestion(t) {
  const x = t.toLowerCase();
  return t.length >= 8 && !/\d/.test(t) && (/\?$/.test(t.trim()) || /^(как|почему|зачем|что|сколько|на что|где|куда|посоветуй|подскажи|объясни|стоит ли|можно ли|помоги)\s/.test(x));
}
export async function advise(env, state, question) {
  const main = state.cur || 'RUB', P = period(state);
  const list = (state.tx || []).filter((t) => inPeriod(t, P));
  const by = {};
  list.forEach((t) => { const c = catInfo(t.env, state); by[c.name] = (by[c.name] || 0) + t.sum; });
  const plan = getCats(state).filter((c) => !c.save && c.amt).map((c) => `${c.name}: план ${Math.round(c.amt)}`).join('; ');
  const ctx = `Валюта: ${main}. Месяц: ${P.label}; с начала месяца прошло ${P.elapsed} дней из ${P.days} (это дни, не деньги). Траты по категориям: ${Object.entries(by).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ') || 'нет'}. ${plan ? 'Планы: ' + plan + '.' : ''} Доход: ${state.income || 'не указан'}.`;
  const sys = 'Ты дружелюбный помощник по личным финансам внутри бота «Бюджет в конвертах». Отвечай по-русски, коротко (до 6 предложений), конкретно и по цифрам пользователя. Без markdown, можно эмодзи. Не давай инвестиционных советов про конкретные акции или крипту.';
  return (await aiText(env, [{ role: 'system', content: sys }, { role: 'user', content: ctx + '\n\nВопрос: ' + question }], 500)).trim();
}
async function fileBytes(env, fileId) {
  const f = await tg(env, 'getFile', { file_id: fileId });
  if (!f.ok) return null;
  return new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.result.file_path}`)).arrayBuffer());
}
export async function readReceipt(env, bytes) {
  const prompt = 'Это фото кассового чека. Найди ИТОГОВУЮ сумму покупки. Ответь ТОЛЬКО JSON: {"total":число,"cur":"RUB|CNY|USD|EUR|KZT|GEL|THB|TRY|AED","store":"название магазина или пусто","date":"YYYY-MM-DD или null","kind":"продукты|кафе|аптека|одежда|транспорт|быт|другое"}. Если это не чек — {"total":null}.';
  const run = () => env.AI.run(VISION, { messages: [{ role: 'user', content: prompt }], image: [...bytes], max_tokens: 200 });
  let r;
  try { r = await run(); } catch (e) {
    if (/agree/i.test(String(e && e.message))) { await env.AI.run(VISION, { prompt: 'agree' }); r = await run(); } else throw e;
  }
  const v = r && (r.response || r.description);
  return pickJSON(typeof v === 'string' ? v : JSON.stringify(v || ''));
}
/* скрин истории операций (Alipay, WeChat, Сбер, Т-Банк…) */
const VISION2 = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct'];
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
const SHOT_PROMPT = 'Это скриншот. Это может быть список операций из банка или кошелька (Alipay, WeChat Pay, Сбер, Т-Банк и т.п.), фото кассового чека или что-то другое.\n' +
  'Если это СПИСОК ОПЕРАЦИЙ, перепиши КАЖДУЮ операцию сверху вниз. НИЧЕГО НЕ ВЫДУМЫВАЙ: если сумма строки закрыта кнопкой, плашкой или обрезана краем экрана — пропусти строку целиком; если не видна только дата — поставь "d":"". Никогда не подставляй сумму или дату из соседней строки. Итоги месяца в шапке («Expenses», «Income», «Расходы за месяц») НЕ включай. Ответь ТОЛЬКО JSON:\n' +
  '{"type":"list","cur":"CNY","items":[{"d":"дата как на экране: 10-14, Today, Yesterday, Сегодня, Вчера, 14 октября","t":"время ЧЧ:ММ или пусто","m":"получатель или описание как на экране","a":-12.90,"k":"одно слово из: продукты, кафе, доставка, такси, транспорт, аптека, одежда, быт, связь, развлечения, перевод, другое","n":"коротко по-русски, 1–3 слова: «Такси DiDi», «Кофе Luckin», «Аренда пауэрбанка»"}]}\n' +
  'a — расход со знаком минус, поступление со знаком плюс. cur — валюта: ¥ или Alipay/WeChat — CNY, ₽ или Сбер/Т-Банк — RUB, $ — USD.\n' +
  'В "n" пиши только по-русски или латиницей, без иероглифов и без имён водителей. Подсказки: 打车/快车/滴滴 — такси; 充电宝 — аренда пауэрбанка (быт); 外卖 — доставка; 订单付款 с категорией Food — кафе; Transfer/转账 — перевод.\n' +
  'Если это ЧЕК — ответь {"type":"receipt"}. Если ни то ни другое — {"type":"other"}.';
async function visionRun(env, model, prompt, bytes) {
  const r = await env.AI.run(model, { messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64(bytes) } }] }], max_tokens: 2500, temperature: 0.1 });
  const v = r && (r.response !== undefined ? r.response : r.result && r.result.response);
  return typeof v === 'string' ? v : JSON.stringify(v || '');
}
export async function readShot(env, bytes) {
  for (const m of VISION2) {
    try { const j = pickJSON(await visionRun(env, m, SHOT_PROMPT, bytes)); if (j && j.type) return j; } catch (e) { console.error('shot', m, e && e.message); }
  }
  return null;
}
const MONR = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export function shotDate(d, state) {
  const today = todayStr(state), x = String(d || '').toLowerCase().trim();
  const yest = ymd(new Date(todayUTC(state) - 864e5));
  if (!x) return null;
  if (/today|сегодня|今天/.test(x)) return today;
  if (/yesterday|вчера|昨天/.test(x)) return yest;
  const Y = +today.slice(0, 4);
  const mk = (y, m, dd) => { if (!(m >= 1 && m <= 12 && dd >= 1 && dd <= 31)) return null; let s = `${y}-${pad2(m)}-${pad2(dd)}`; if (s > today) s = `${y - 1}-${pad2(m)}-${pad2(dd)}`; return s; };
  let m;
  if ((m = x.match(/(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})/))) return mk(+m[1], +m[2], +m[3]);
  if ((m = x.match(/(\d{1,2})月(\d{1,2})/))) return mk(Y, +m[1], +m[2]);
  if ((m = x.match(/(\d{1,2})[-/](\d{1,2})/))) return mk(Y, +m[1], +m[2]);
  if ((m = x.match(/(\d{1,2})\.(\d{1,2})/))) return mk(Y, +m[2], +m[1]);
  if ((m = x.match(/(\d{1,2})\s*([а-я]+)/))) { const i = MONR.findIndex((r) => m[2].startsWith(r)); if (i >= 0) return mk(Y, i + 1, +m[1]); }
  return today;
}
const SHOT_K = { 'продукты': 'продукты', 'кафе': 'кафе', 'доставка': 'доставка', 'такси': 'такси', 'транспорт': 'метро', 'аптека': 'аптека', 'одежда': 'одежда', 'быт': 'быт', 'связь': 'связь', 'развлечения': 'кино' };
export function shotItems(j, state) {
  const cur = CURS[String(j.cur || '').toUpperCase()] ? String(j.cur).toUpperCase() : state.cur || 'RUB';
  const cats = getCats(state), spend = cats.filter((c) => !c.save);
  const fallback = (detectEnv('прочее', state)) || (spend[0] || cats[0] || { id: 'other' }).id;
  const tx = state.tx || [], keys = new Set(tx.map((t) => t.imp).filter(Boolean));
  const items = [], seen = new Set();
  let income = 0;
  for (const it of (Array.isArray(j.items) ? j.items : []).slice(0, 40)) {
    const a = +String(it.a ?? '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.+-]/g, '');
    if (!Number.isFinite(a) || a === 0) continue;
    if (a > 0) { income += a; continue; }
    const d0 = shotDate(it.d, state), amt = Math.round(-a * 100) / 100, date = d0 || todayStr(state), time = /^\d{1,2}:\d{2}$/.test(String(it.t || '').trim()) ? String(it.t).trim().padStart(5, '0') : '';
    const imp = `shot:${date}:${time}:${amt.toFixed(2)}`;
    if (seen.has(imp)) continue; seen.add(imp);
    const k = String(it.k || '').toLowerCase().trim();
    const KN = { 'продукты': 'Продукты', 'кафе': 'Кафе', 'доставка': 'Доставка', 'такси': 'Такси', 'транспорт': 'Транспорт', 'аптека': 'Аптека', 'одежда': 'Одежда', 'быт': 'Быт', 'связь': 'Связь', 'развлечения': 'Развлечения', 'перевод': 'Перевод' };
    let note = String(it.n || it.m || '').replace(/[«»"]/g, '').replace(/[\u3000-\u9fff\uff00-\uffef]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (note.length < 3 || /уплата по заказу|оплата заказа|order payment/i.test(note)) note = KN[k] || 'Покупка';
    note = note.slice(0, 40);
    const env = (k === 'перевод' ? null : detectEnv(`${SHOT_K[k] || ''} ${note}`.trim(), state)) || fallback;
    const dup = keys.has(imp) ? 'imp' : tx.some((t) => txDate(t) === date && (t.cur || state.cur) === cur && Math.abs((t.orig ?? t.sum) - amt) < 0.01) ? 'soft' : '';
    items.push({ date, time, amt, note, env, imp, dup: dup || (d0 ? '' : 'nodate'), on: !dup && !!d0 && k !== 'перевод' });
  }
  return { cur, items: items.slice(0, 24), income: Math.round(income * 100) / 100 };
}
const money2 = (v, c) => (v % 1 ? fmt(Math.floor(v), c).replace(/(\d)(\D*)$/, `$1,${String(Math.round((v % 1) * 100)).padStart(2, '0')}$2`) : fmt(v, c));
export function shotView(o, state) {
  const cats = (id) => catInfo(id, state);
  const on = o.items.filter((x) => x.on), total = on.reduce((a, x) => a + x.amt, 0);
  let t = `📸 <b>Нашёл на скрине ${o.items.length} ${o.items.length === 1 ? 'трату' : o.items.length < 5 ? 'траты' : 'трат'}</b>\n\n`;
  t += o.items.map((x, i) => `${x.on ? '✅' : '▫️'} ${i + 1}. ${dateHuman(x.date, state)}${x.time ? ' ' + x.time : ''} · ${esc(x.note)} — <b>${money2(x.amt, o.cur)}</b> ${cats(x.env).ic}${x.dup === 'imp' ? ' <i>(уже записано)</i>' : x.dup === 'soft' ? ' <i>(похоже, уже есть)</i>' : x.dup === 'nodate' ? ' <i>(дата не видна — проверь)</i>' : ''}`).join('\n');
  if (o.income) t += `\n\n➕ Поступления ${fmt(o.income, o.cur)} не записываю.`;
  t += '\n\nНажми на номер, чтобы убрать или вернуть трату.';
  const nums = o.items.map((x, i) => ({ text: `${x.on ? '✅' : '▫️'} ${i + 1}`, callback_data: `sh:t:${o.id}:${i}` }));
  const rows = []; for (let i = 0; i < nums.length; i += 6) rows.push(nums.slice(i, i + 6));
  rows.push([{ text: on.length ? `💾 Записать ${on.length} · ${money2(Math.round(total * 100) / 100, o.cur)}` : 'Ничего не выбрано', callback_data: `sh:ok:${o.id}` }], [{ text: '✖️ Не надо', callback_data: `sh:no:${o.id}` }]);
  return { text: t, reply_markup: { inline_keyboard: rows } };
}
export function streakOf(state) {
  const days = new Set((state.tx || []).map(txDate));
  ((state.srv || {}).ns || []).forEach((d) => days.add(d));
  let d = todayUTC(state), n = 0;
  if (!days.has(ymd(new Date(d)))) d -= 864e5;
  while (days.has(ymd(new Date(d)))) { n++; d -= 864e5; }
  return n;
}

/* ---------- общий бюджет и доступ ---------- */
async function userStore(env, uid, name) {
  const own = store(env, uid);
  const link = await own.getLink();
  const b = link ? store(env, link) : own;
  return {
    owner: link || uid, own, b,
    getState: () => b.getState(), putState: (a, c) => b.putState(a, c), addTx: (t) => b.addTx({ ...t, by: t.by || uid, byName: t.byName || name || '' }),
    addTxs: (l) => b.addTxs(l.map((t) => ({ ...t, by: t.by || uid, byName: t.byName || name || '' }))),
    undo: () => b.undo(uid), srvGet: () => b.srvGet(), srvPatch: (x) => b.srvPatch(x), aiTick: (d, m) => b.aiTick(d, m),
    remAdd: (x) => own.remAdd(x), remList: () => own.remList(), remDel: (i) => own.remDel(i), remDue: (n) => own.remDue(n), remSent: (i, d) => own.remSent(i, d),
    setPending: (x) => own.setPending(x), takePending: () => own.takePending(), seenUpd: (i) => own.seenUpd(i),
  };
}
const TRIAL_DAYS = 7;
async function accessOf(env, owner) {
  const reg = store(env, '__registry__');
  const [admin, u] = await Promise.all([reg.getAdmin(), reg.regGet(owner)]);
  if (admin === owner || (u && u.paid)) return { paid: true, active: true };
  let te = u && u.trialEnd;
  if (!te) { te = Date.now() + TRIAL_DAYS * 864e5; await reg.regUpdate(owner, { trialEnd: te }); }
  return { paid: false, trialEnd: te, active: Date.now() < te };
}
const priceStars = (env) => Math.max(1, parseInt(env.PRICE_STARS || '600', 10) || 600);
const invoiceBody = (env, owner) => ({ title: 'Бюджет в конвертах — навсегда', description: 'Полный доступ к боту и приложению без ограничений: траты, конверты, ИИ-повар, напоминания, общий бюджет на двоих.', payload: 'full:' + owner, currency: 'XTR', prices: [{ label: 'Полный доступ', amount: priceStars(env) }], provider_token: '' });
async function sendPaywall(env, chat, owner, acc) {
  await tg(env, 'sendMessage', { chat_id: chat, text: `🔒 Пробный период закончился${acc && acc.trialEnd ? ' ' + new Date(acc.trialEnd).toLocaleDateString('ru-RU') : ''}.\n\nВсе твои записи сохранены. Чтобы продолжить вести бюджет, открой полный доступ навсегда — один раз, без подписки 👇` });
  await tg(env, 'sendInvoice', { chat_id: chat, ...invoiceBody(env, owner) });
}
async function botName(env) {
  const reg = store(env, '__registry__');
  let n = await reg.meta('botname');
  if (!n) { const me = await tg(env, 'getMe', {}); if (me.ok) { n = me.result.username; await reg.meta('botname', n); } }
  return n || 'konverty_budget_bot';
}
async function makeInvite(env, owner) {
  const own = store(env, owner);
  let code = await own.invite();
  if (!code) { code = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10); await own.invite(code); await store(env, '__registry__').meta('inv:' + code, owner); }
  return { code, link: `https://t.me/${await botName(env)}?start=join_${code}` };
}
async function unlinkPartner(env, owner, pid) {
  await store(env, owner).setMembers((await store(env, owner).getMembers()).filter((m) => m.id !== pid));
  await store(env, pid).setLink(null);
  await store(env, '__registry__').regUpdate(pid, { link: null });
}

async function transcribe(env, fileId) {
  if (!env.AI) return null;
  try {
    const f = await tg(env, 'getFile', { file_id: fileId });
    if (!f.ok) return null;
    const buf = await (await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.result.file_path}`)).arrayBuffer();
    if (buf.byteLength > 6e6) return null;
    let b64 = ''; const u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i += 0x8000) b64 += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    b64 = btoa(b64);
    try {
      const r = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: b64, language: 'ru', initial_prompt: 'Траты: кофе 300, такси 500, еда 50 юаней, отложил 5000.' });
      if (r && r.text && r.text.trim()) return r.text.trim();
    } catch (e) { console.error('whisper-turbo', e); }
    const r2 = await env.AI.run('@cf/openai/whisper', { audio: [...u8] });
    return r2 && r2.text ? r2.text.trim() : null;
  } catch (e) { console.error('voice', e); return null; }
}

async function foodMenu(env, st, state, chat, request, origin) {
  if (!env.AI) { await tg(env, 'sendMessage', { chat_id: chat, text: 'ИИ-повар пока недоступен.' }); return; }
  if (!(await st.aiTick(todayStr(state), AI_MAX))) { await tg(env, 'sendMessage', { chat_id: chat, text: '😴 На сегодня лимит запросов к ИИ закончился. Завтра продолжим!' }); return; }
  await tg(env, 'sendMessage', { chat_id: chat, text: '👨‍🍳 Составляю меню и список покупок… Это займёт секунд 20.' });
  let m = null;
  try { m = await makeMenu(env, state, request); } catch (e) { console.error('menu', e); }
  if (!m) { await tg(env, 'sendMessage', { chat_id: chat, text: '😕 Не получилось составить меню. Попробуй ещё раз или сформулируй иначе.' }); return; }
  const flags = { ...((state.srv || {}).flags || {}), chef: 1 };
  await st.srvPatch({ menuAI: m, flags });
  await tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', text: menuSummary(m, { ...state, srv: { ...(state.srv || {}), menuAI: m } }, await getRates()),
    reply_markup: { inline_keyboard: [[{ text: '📖 Открыть меню и список', web_app: { url: origin + '/?tab=food' } }], [{ text: '🔄 Другое меню', callback_data: 'm:again' }, { text: '💸 Подешевле', callback_data: 'm:cheap' }]] } });
}

async function onUpdate(update, env, origin) {
  if (update.pre_checkout_query) {
    const pq = update.pre_checkout_query;
    await tg(env, 'answerPreCheckoutQuery', { pre_checkout_query_id: pq.id, ok: /^full:\d+$/.test(pq.invoice_payload || '') });
    return;
  }
  if (update.callback_query && /^j[yn]:/.test(update.callback_query.data || '')) {
    const q = update.callback_query, uid = q.from.id, code = q.data.slice(3), reg = store(env, '__registry__');
    const done = (text) => tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text });
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
    if (q.data.startsWith('jn:')) { await done('Ок, остаёмся каждый со своим бюджетом.'); return; }
    const owner = await reg.meta('inv:' + code);
    if (!owner || owner === uid) { await done('Ссылка устарела.'); return; }
    const mem = await store(env, owner).getMembers();
    if (mem.length >= 1 && !mem.some((m) => m.id === uid)) { await done('😕 В этом бюджете уже двое. Попроси владельца убрать старого участника.'); return; }
    if (!mem.some((m) => m.id === uid)) await store(env, owner).setMembers([...mem, { id: uid, name: q.from.first_name || '', user: q.from.username || '' }]);
    await store(env, uid).setLink(owner);
    await reg.regUpdate(uid, { link: owner });
    const ou = await reg.regGet(owner);
    await done(`👫 Готово! Теперь у вас с ${(ou && ou.name) || 'партнёром'} общий бюджет. Пиши траты как обычно — они попадут в общий.`);
    await tg(env, 'sendMessage', { chat_id: uid, text: 'Открой приложение, чтобы увидеть общий бюджет 👇', reply_markup: appButton(origin) });
    await tg(env, 'sendMessage', { chat_id: owner, text: `👫 ${q.from.first_name || 'Партнёр'} присоединился к твоему бюджету! Теперь вы видите траты друг друга.` });
    return;
  }
  if (update.callback_query && /^bc:/.test(update.callback_query.data || '')) {
    const q = update.callback_query, reg = store(env, '__registry__'), admin = await reg.getAdmin();
    const edit = (text) => tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text });
    if (admin !== q.from.id) { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Только для админа' }); return; }
    if (q.data === 'bc:no') { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Отменено' }); await edit('✖️ Рассылка отменена.'); return; }
    const ver = q.data.slice(3);
    if (ver !== BC_VER || (await reg.meta('bc:' + ver))) { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Эта рассылка уже отправлена' }); return; }
    await reg.meta('bc:' + ver, Date.now());
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Отправляю…' });
    await edit('📤 Отправляю…');
    const list = (await reg.regList()).filter((u) => u.uid !== admin && !u.blocked);
    let ok = 0, fail = 0;
    for (const u of list) {
      const r = await sendNews(env, u.uid, !!u.gift, origin);
      if (r && r.ok) ok++; else { fail++; if (r && r.error_code === 403) await reg.regUpdate(u.uid, { blocked: true }); }
      await new Promise((res) => setTimeout(res, 60));
    }
    await edit(`✅ Рассылка отправлена: ${ok} доставлено${fail ? `, ${fail} не дошло (бот заблокирован или чат удалён)` : ''}.`);
    return;
  }
  if (update.callback_query && /^sh:/.test(update.callback_query.data || '')) {
    const q = update.callback_query, uid = q.from.id, [, act, id, i] = q.data.split(':');
    const own = store(env, uid), st = await userStore(env, uid, q.from.first_name);
    const edit = (body) => tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML', ...body });
    if (act === 't') {
      const o = await own.shotToggle(id, +i);
      if (!o) { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Список устарел, пришли скрин ещё раз' }); return; }
      await tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
      await edit(shotView(o, (await st.getState()) || {}));
      return;
    }
    const o = await own.shotDel(id);
    if (!o) { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Уже обработано' }); return; }
    if (act === 'no') { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Ок' }); await edit({ text: '✖️ Ничего не записал.' }); return; }
    const state = (await st.getState()) || {}, rates = await getRates();
    const list = o.items.filter((x) => x.on).map((x, k) => { const t = makeTx({ sum: x.amt, cur: o.cur, note: x.note, date: x.date }, x.env, state, rates); return t && { ...t, id: Date.now() + k, imp: x.imp }; }).filter(Boolean);
    if (!list.length) { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Нечего записывать' }); await edit({ text: '✖️ Ничего не записал.' }); return; }
    const { state: s2, added } = await st.addTxs(list);
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: `Записал ${added.length} ✓` });
    const main = s2.cur || 'RUB', by = {};
    added.forEach((t) => { by[t.env] = (by[t.env] || 0) + t.sum; });
    const lines = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([e, v]) => { const c = catInfo(e, s2); return `${c.ic} ${c.name} — ${fmt(v, main)}`; });
    await edit({ text: `✅ Записал ${added.length} ${added.length === 1 ? 'трату' : added.length < 5 ? 'траты' : 'трат'} на <b>${fmt(added.reduce((a, t) => a + t.sum, 0), main)}</b>${added.length < list.length ? ` (${list.length - added.length} уже были)` : ''}\n\n${lines.join('\n')}`, reply_markup: appButton(origin) });
    return;
  }
  if (update.callback_query && update.callback_query.data === 'ns') {
    const q = update.callback_query;
    try { const st0 = await userStore(env, q.from.id), s0 = (await st0.getState()) || {}; const ns = new Set(((s0.srv || {}).ns || [])); ns.add(todayStr(s0)); await st0.srvPatch({ ns: [...ns].slice(-120) }); } catch (e) { console.error('ns', e); }
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Засчитано 🧘' });
    await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: '🧘 День без трат! Так держать 💪', reply_markup: appButton(origin) });
    return;
  }
  if (update.callback_query && /^[rs]:/.test(update.callback_query.data || '')) {
    const q = update.callback_query, uid = q.from.id, [kind, act, id] = q.data.split(':');
    const st = await userStore(env, uid, q.from.first_name), reg = store(env, '__registry__');
    const edit = (text, kb) => tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text, reply_markup: kb || appButton(origin) });
    const state0 = (await st.getState()) || {};
    if (kind === 'r') {
      const d = await st.remSent(+id, act !== 'sn');
      if (!d) { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Уже обработано' }); return; }
      if (act === 'sn') {
        await st.remSent(+id, true);
        const nd = { ...d, id: Date.now(), at: Date.now() + 3600e3 };
        await reg.regUpdate(uid, { remNext: await st.remAdd(nd) });
        await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Напомню через час ⏰' });
        await edit(`⏰ ${d.text}\n\nОтложено на час.`, { inline_keyboard: [] });
        return;
      }
      if (act === 'pay' && d.sum) {
        const parsed = { sum: d.sum, cur: d.cur, note: d.text, date: null };
        const envId = detectEnv(d.text, state0) || 'other';
        const tx = makeTx(parsed, getCats(state0).some((c) => c.id === envId) ? envId : getCats(state0)[0].id, state0, await getRates());
        if (tx) { const s2 = await st.addTx(tx); await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Записал ✓' }); await edit('✅ ' + d.text + '\n\n' + summary(s2, tx.env, tx)); return; }
      }
      await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Отлично 👍' });
      await edit('✅ Готово: ' + d.text, { inline_keyboard: [] });
      return;
    }
    const sub = (state0.subs || []).find((x) => String(x.id) === id);
    if (!sub) { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Платёж не найден' }); return; }
    if (act === 'skip') { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Ок' }); await edit(`⏭ ${sub.name}: в этот раз пропускаем.`, { inline_keyboard: [] }); return; }
    const envId = getCats(state0).some((c) => c.id === sub.env) ? sub.env : (detectEnv(sub.name, state0) || getCats(state0)[0].id);
    const tx = makeTx({ sum: sub.sum, cur: sub.cur, note: sub.name, date: null }, envId, state0, await getRates());
    if (!tx) { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Не смог получить курс, попробуй позже' }); return; }
    const s2 = await st.addTx(tx);
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Записал ✓' });
    await edit('🔁 ' + summary(s2, envId, tx));
    return;
  }
  if (update.callback_query && /^m:/.test(update.callback_query.data || '')) {
    const q = update.callback_query, st = await userStore(env, q.from.id, q.from.first_name), state = (await st.getState()) || {};
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: '👨‍🍳 Готовлю…' });
    const last = (state.srv && state.srv.menuAI && state.srv.menuAI.q) || '';
    await foodMenu(env, st, state, q.from.id, q.data === 'm:cheap' ? (last + ', подешевле, бюджетные продукты').replace(/^, /, '') : last, origin);
    return;
  }
  if (update.callback_query && /^rd:/.test(update.callback_query.data || '')) {
    const q = update.callback_query, st = store(env, q.from.id);
    const next = await st.remDel(+q.data.slice(3));
    await store(env, '__registry__').regUpdate(q.from.id, { remNext: next });
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Отменено' });
    await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: '🗑 Напоминание отменено.' });
    return;
  }
  if (update.callback_query) {
    const q = update.callback_query;
    const uid = q.from.id;
    const [, envId] = (q.data || '').split(':');
    const st = await userStore(env, uid, q.from.first_name);
    const p = await st.takePending();
    const state0 = (await st.getState()) || {};
    if (!p || !getCats(state0).some((c) => c.id === envId)) {
      await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Эта трата уже записана или устарела' });
      return;
    }
    const tx = makeTx(p, envId, state0, await getRates());
    if (!tx) {
      await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Не смог получить курс валюты, попробуй ещё раз' });
      return;
    }
    const s = await st.addTx(tx);
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Записал ✓' });
    await tg(env, 'editMessageText', {
      chat_id: q.message.chat.id, message_id: q.message.message_id,
      text: summary(s, envId, tx), reply_markup: appButton(origin),
    });
    return;
  }

  const msg = update.message;
  if (!msg || msg.chat.type !== 'private') return;
  const uid = msg.from.id, chat = msg.chat.id;
  const st = await userStore(env, uid, msg.from.first_name);
  if (update.update_id && (await st.seenUpd(update.update_id))) return;
  let text = (msg.text || msg.caption || '').trim();
  if (msg.successful_payment) {
    const sp = msg.successful_payment, owner = +String(sp.invoice_payload || '').split(':')[1] || st.owner;
    const reg0 = store(env, '__registry__');
    await reg0.regUpdate(owner, { paid: true, paidAt: Date.now(), charge: sp.telegram_payment_charge_id, stars: sp.total_amount, payer: uid });
    await tg(env, 'sendMessage', { chat_id: chat, text: '💎 Спасибо! Полный доступ открыт навсегда. Пиши траты как раньше 🙂', reply_markup: appButton(origin) });
    const adm = await reg0.getAdmin();
    if (adm) await tg(env, 'sendMessage', { chat_id: adm, text: `💰 Новая оплата: ${msg.from.first_name || ''}${msg.from.username ? ' @' + msg.from.username : ''} — ⭐ ${sp.total_amount}` });
    return;
  }
  if (/^\/start join_/.test(text)) {
    const code = text.split('join_')[1].trim(), owner = await store(env, '__registry__').meta('inv:' + code);
    if (!owner) { await tg(env, 'sendMessage', { chat_id: chat, text: 'Ссылка-приглашение устарела. Попроси новую.' }); return; }
    if (owner === uid) { await tg(env, 'sendMessage', { chat_id: chat, text: 'Это твоя собственная ссылка 🙂 Отправь её партнёру.' }); return; }
    const ou = await store(env, '__registry__').regGet(owner);
    await tg(env, 'sendMessage', { chat_id: chat, text: `👫 ${(ou && ou.name) || 'Тебя'} приглашает вести общий бюджет.\n\nВы будете видеть траты друг друга, конверты и цели. Твой личный бюджет (если был) скроется, пока ты в общем.`, reply_markup: { inline_keyboard: [[{ text: '✅ Присоединиться', callback_data: 'jy:' + code }], [{ text: 'Нет, спасибо', callback_data: 'jn:' + code }]] } });
    return;
  }
  if (/^\/?(paysupport|terms|поддержка)/i.test(text)) {
    if (/^\/?terms/i.test(text)) { await tg(env, 'sendMessage', { chat_id: chat, text: `📄 Условия: 7 дней бесплатно, дальше полный доступ навсегда за ⭐ ${priceStars(env)} (разовый платёж через Telegram Stars). Если что-то не работает — напиши «поддержка» и опиши проблему, ответим и при необходимости вернём оплату.` }); return; }
    const adm = await store(env, '__registry__').getAdmin(), body = text.replace(/^\/?(paysupport|поддержка)\s*/i, '');
    if (!body) { await tg(env, 'sendMessage', { chat_id: chat, text: '🛟 Опиши проблему одним сообщением, начиная со слова «поддержка». Например: «поддержка не проходит оплата».' }); return; }
    if (adm) await tg(env, 'sendMessage', { chat_id: adm, text: `🛟 Поддержка от ${msg.from.first_name || ''}${msg.from.username ? ' @' + msg.from.username : ''} (id ${uid}):\n\n${body.slice(0, 1500)}` });
    await tg(env, 'sendMessage', { chat_id: chat, text: '🛟 Передал создателю, он ответит здесь же.' });
    return;
  }
  if (!/^\/(start|help|admin|stats|grant)/.test(text)) {
    const acc = await accessOf(env, st.owner);
    if (!acc.active) { await sendPaywall(env, chat, st.owner, acc); return; }
  }
  const imgDoc = msg.document && /^image\//.test(msg.document.mime_type || '') ? msg.document : null;
  if ((msg.photo || imgDoc) && !/\d/.test(text)) {
    const state = (await st.getState()) || {};
    if (!env.AI) { await tg(env, 'sendMessage', { chat_id: chat, text: 'Фото чеков пока не понимаю. Напиши сумму текстом: «продукты 1500».' }); return; }
    if (!(await st.aiTick(todayStr(state), AI_MAX))) { await tg(env, 'sendMessage', { chat_id: chat, text: '😴 На сегодня лимит запросов к ИИ закончился. Напиши сумму текстом: «продукты 1500».' }); return; }
    await tg(env, 'sendMessage', { chat_id: chat, text: '🔎 Смотрю, что на фото…' });
    let j = null, bytes = null;
    try { bytes = await fileBytes(env, imgDoc ? imgDoc.file_id : msg.photo[msg.photo.length - 1].file_id); } catch (e) { console.error('file', e); }
    if (!bytes) { await tg(env, 'sendMessage', { chat_id: chat, text: '😕 Не смог скачать фото, пришли ещё раз.' }); return; }
    const shot = await readShot(env, bytes);
    if (shot && shot.type === 'list') {
      const o = { id: Date.now(), ...shotItems(shot, state) };
      if (!o.items.length) { await tg(env, 'sendMessage', { chat_id: chat, text: o.income ? `На скрине только поступления (${fmt(o.income, o.cur)}), трат нет 🙂` : '😕 Не разобрал операции на скрине. Пришли скрин крупнее, без обрезанных строк.' }); return; }
      await store(env, uid).shotPut(o.id, o);
      await tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', ...shotView(o, state) });
      try { const f0 = (await st.srvGet()).flags || {}; if (!f0.shot) await st.srvPatch({ flags: { ...f0, shot: 1 } }); } catch (e) { /* не критично */ }
      return;
    }
    if (shot && shot.type === 'other') { await tg(env, 'sendMessage', { chat_id: chat, text: '🤔 Не похоже ни на чек, ни на список операций. Пришли фото чека или скрин истории операций из банка (Alipay, WeChat, Сбер, Т-Банк).' }); return; }
    try { j = await readReceipt(env, bytes); } catch (e) { console.error('receipt', e); }
    const total = j && +String(j.total).replace(',', '.').replace(/[^\d.]/g, '');
    if (!total || total <= 0) { await tg(env, 'sendMessage', { chat_id: chat, text: '😕 Не смог прочитать сумму. Сфоткай чек ровнее, при хорошем свете, или напиши: «продукты 1500».' }); return; }
    const cur = CURS[String(j.cur || '').toUpperCase()] ? String(j.cur).toUpperCase() : state.cur || 'RUB';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(j.date || '')) && String(j.date) <= todayStr(state) && String(j.date) > ymd(new Date(todayUTC(state) - 60 * 864e5)) ? j.date : null;
    const kindMap = { 'продукты': 'продукты', 'кафе': 'кафе', 'аптека': 'аптека', 'одежда': 'одежда', 'транспорт': 'такси', 'быт': 'быт' };
    const note = ('Чек' + (j.store ? ' ' + String(j.store).slice(0, 30) : '')).trim();
    const envId = detectEnv(`${kindMap[j.kind] || ''} ${j.store || ''}`.trim(), state) || detectEnv('продукты', state) || getCats(state)[0].id;
    const tx = makeTx({ sum: total, cur, note, date }, envId, state, await getRates());
    if (!tx) { await tg(env, 'sendMessage', { chat_id: chat, text: '😕 Не смог получить курс валюты, попробуй позже.' }); return; }
    const s2 = await st.addTx(tx);
    await st.srvPatch({ flags: { ...((state.srv || {}).flags || {}), receipt: 1 } });
    await tg(env, 'sendMessage', { chat_id: chat, text: '🧾 ' + summary(s2, envId, tx) + '\n\nСумма или категория не те? Нажми «↩️ Отменить» и напиши вручную.', reply_markup: appButton(origin) });
    return;
  }
  if (!text && (msg.voice || msg.audio)) {
    const heard = await transcribe(env, (msg.voice || msg.audio).file_id);
    if (!heard) { await tg(env, 'sendMessage', { chat_id: chat, text: '🎤 Не смог разобрать голосовое. Скажи ещё раз чуть чётче или напиши текстом: «кофе 300».' }); return; }
    text = heard.replace(/[.!?…]+$/g, '').trim();
    try { const f0 = (await st.srvGet()).flags || {}; if (!f0.voice) await st.srvPatch({ flags: { ...f0, voice: 1 } }); } catch (e) { /* не критично */ }
    await tg(env, 'sendMessage', { chat_id: chat, text: `🎤 Услышал: «${text}»` });
  }
  if (!text) return;

  const reg = store(env, '__registry__');
  await reg.regUpdate(uid, { seen: Date.now(), name: msg.from.first_name || '', user: msg.from.username || '' });
  const fi = foodIntent(text);
  if (fi) {
    const state = (await st.getState()) || {};
    const srv = state.srv || {};
    if (fi === 'pref') {
      const what = text.replace(/^(я\s+)?(не люблю|не ем|не ешь|аллергия на|исключи)\s+/i, '').split(/,|\sи\s/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      const prefs = [...new Set([...(srv.prefs || []), ...what])].slice(0, 20);
      await st.srvPatch({ prefs });
      await tg(env, 'sendMessage', { chat_id: chat, text: `👌 Запомнил: не использовать ${what.join(', ')}.\nВсе предпочтения: ${prefs.join(', ')}.\n\nНапиши «меню на неделю», и я учту.` });
      return;
    }
    if (fi === 'prefs') {
      if (/сбрось|забудь/i.test(text)) { await st.srvPatch({ prefs: [] }); await tg(env, 'sendMessage', { chat_id: chat, text: '🧹 Предпочтения сброшены.' }); return; }
      await tg(env, 'sendMessage', { chat_id: chat, text: (srv.prefs || []).length ? `🍽 Не использую в меню: ${srv.prefs.join(', ')}.\nСбросить: «сбрось предпочтения».` : 'Предпочтений пока нет. Напиши, например: «не люблю грибы».' });
      return;
    }
    if (fi === 'swap') {
      if (!srv.menuAI) { await tg(env, 'sendMessage', { chat_id: chat, text: 'Сначала составим меню: напиши «меню на неделю».' }); return; }
      const x = text.toLowerCase();
      const mi = MEALS.findIndex((w) => x.includes(w));
      const DW = [['понедельник', 'пн'], ['вторник', 'вт'], ['сред', 'ср'], ['четверг', 'чт'], ['пятниц', 'пт'], ['суббот', 'сб'], ['воскресень', 'вс']];
      let di = DW.findIndex(([a, b]) => x.includes(a) || new RegExp('(^|\\s)' + b + '(\\s|$)').test(x));
      if (di < 0) di = (new Date(todayUTC(state)).getUTCDay() + 6) % 7;
      if (!(await st.aiTick(todayStr(state), AI_MAX))) { await tg(env, 'sendMessage', { chat_id: chat, text: '😴 Лимит запросов к ИИ на сегодня закончился.' }); return; }
      const old = srv.menuAI.days[di][mi + 1];
      let m = null; try { m = await swapMeal(env, state, di, mi, ''); } catch (e) { console.error('swap', e); }
      if (!m) { await tg(env, 'sendMessage', { chat_id: chat, text: '😕 Не получилось заменить, попробуй ещё раз.' }); return; }
      await st.srvPatch({ menuAI: m });
      await tg(env, 'sendMessage', { chat_id: chat, text: `🔄 ${DAYS7[di]}, ${MEALS[mi]}: «${old}» → «${m.days[di][mi + 1]}»`, reply_markup: { inline_keyboard: [[{ text: '📖 Открыть меню', web_app: { url: origin + '/?tab=food' } }]] } });
      return;
    }
    await foodMenu(env, st, state, chat, /^(подешевле|дешевле)$/i.test(text) ? ((srv.menuAI && srv.menuAI.q) || '') + ', подешевле' : text, origin);
    return;
  }
  const kw = keywordOf(text);
  if (kw === 'today' || kw === 'week' || kw === 'cats') {
    const state = (await st.getState()) || {};
    const body = kw === 'today' ? todayText(state) : kw === 'cats' ? catsText(state) : (weekText(state) || '📅 За последние 7 дней трат нет. Напиши, например: кофе 300');
    await tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', text: body, reply_markup: appButton(origin) });
    return;
  }
  if (kw === 'start' || kw === 'help') text = '/start';
  else if (kw === 'undo') text = '/undo';
  else if (kw === 'rem') text = 'напоминания';
  else if (kw === 'subs') text = 'подписки';
  else if (kw === 'report') text = 'итоги';
  if (text.startsWith('/start') || text.startsWith('/help')) {
    if (kw === 'help' || text.startsWith('/help')) {
      await tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', reply_markup: KB, text:
        '💡 <b>Как со мной общаться</b>\n\n' +
        '<b>Записать трату</b> — просто напиши: <code>кофе 300</code>, <code>вчера такси 500</code>, <code>еда 50 ю</code>, <code>10$ подписка</code>\n' +
        '<b>Отложить</b> — <code>отложил 5к</code>\n' +
        '<b>Голосом</b> — запиши голосовое 🎤\n' +
        '<b>Напомнить</b> — <code>напомни в 16:30 оплатить интернет 500</code>\n' +
        '<b>Чек</b> — просто сфоткай и пришли 🧾\n' +
        '<b>Выписка</b> — скрин истории операций из Alipay, WeChat, Сбера или Т-Банка 📸 — запишу всё сразу\n' +
        '<b>Меню</b> — <code>меню на неделю, китайская кухня</code>, <code>не люблю грибы</code>, <code>замени ужин в среду</code> 👨‍🍳\n' +
        '<b>Вопрос</b> — <code>на что я больше всего трачу?</code> 🤖\n\n' +
        'А ещё понимаю слова: <b>сегодня</b>, <b>итоги</b>, <b>неделя</b>, <b>категории</b>, <b>напоминания</b>, <b>платежи</b>, <b>отменить</b>. Или жми кнопки внизу 👇' });
      return;
    }
    await tg(env, 'sendMessage', {
      chat_id: chat, parse_mode: 'HTML', reply_markup: appButton(origin),
      text: '👋 Привет! Я веду твой бюджет прямо в чате.\n\n' +
        '<b>Как это работает:</b>\n' +
        '1️⃣ Нажми «📊 Открыть бюджет» и за минуту настрой: режим, валюту, доход.\n' +
        '2️⃣ Пиши траты сюда, как другу:\n' +
        '   • <code>кофе 300</code>\n   • <code>вчера такси 35 ю</code>\n   • <code>отложил 5к</code>\n' +
        '3️⃣ Я сам разложу по категориям и покажу графики в приложении.\n\n' +
        '🎤 Можно голосом: просто запиши голосовое «такси пятьсот».\n' +
        '⏰ <code>напомни в 16:30 оплатить интернет 500</code>\n\n' +
        'Кнопки внизу 👇 — сводки, напоминания, отмена. Команды учить не нужно.',
    });
    await tg(env, 'sendMessage', { chat_id: chat, text: 'Готов записывать 🙂 Напиши первую трату, например: кофе 300', reply_markup: KB });
    return;
  }
  if (text === '/admin') {
    const a = await reg.claimAdmin(uid);
    await tg(env, 'sendMessage', { chat_id: chat, text: a === uid ? '👑 Ты админ: сюда будут приходить отзывы. /stats — статистика.' : 'Админ уже назначен.' });
    return;
  }
  if (/^\/?(broadcast|рассылка)$/i.test(text)) {
    if ((await reg.getAdmin()) !== uid) return;
    const list = (await reg.regList()).filter((u) => u.uid !== uid && !u.blocked);
    await sendNews(env, chat, false, origin);
    const sent = await reg.meta('bc:' + BC_VER);
    await tg(env, 'sendMessage', { chat_id: chat, text: sent ? `👆 Это рассылка «${BC_VER}», она уже отправлена ${new Date(sent).toLocaleString('ru-RU')}.` :
      `👆 Так выглядит рассылка.\nПолучат: ${list.length} чел. — ${list.map((u) => u.name || u.user || u.uid).slice(0, 20).join(', ')}${list.length > 20 ? '…' : ''}`,
      reply_markup: sent ? undefined : { inline_keyboard: [[{ text: `✅ Отправить всем (${list.length})`, callback_data: 'bc:' + BC_VER }], [{ text: '✖️ Отмена', callback_data: 'bc:no' }]] } });
    return;
  }
  if (/^\/grant\s+\d+/.test(text)) {
    if ((await reg.getAdmin()) !== uid) return;
    const gid = +text.split(/\s+/)[1];
    await reg.regUpdate(gid, { paid: true, paidAt: Date.now(), gift: true });
    await tg(env, 'sendMessage', { chat_id: chat, text: `💎 Выдал полный доступ пользователю ${gid}.` });
    return;
  }
  if (text === '/stats') {
    if ((await reg.getAdmin()) !== uid) { await tg(env, 'sendMessage', { chat_id: chat, text: 'Команда только для админа.' }); return; }
    const list = await reg.regList(), wk = Date.now() - 7 * 864e5, day = Date.now() - 864e5;
    for (const u of list.slice(0, 300)) { try { const s0 = (await store(env, u.uid).getState()) || {}; u.n = (s0.tx || []).length; u.onb = !!s0.onboarded || u.onb; } catch (e) { /* пропускаем */ } }
    const c = (f) => list.filter(f).length;
    await tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', text:
      `📊 <b>Статистика</b>\n\n👥 Всего зашли: ${list.length}\n🧭 Прошли настройку: ${c((u) => u.onb)}\n✍️ Записали хотя бы 1 трату: ${c((u) => u.n > 0)}\n🔥 Активны за сутки: ${c((u) => u.seen > day)}\n📅 Активны за неделю: ${c((u) => u.seen > wk)}\n🔔 С напоминаниями: ${c((u) => u.notif && (u.notif.m || u.notif.e))}\n💎 Оплатили: ${c((u) => u.paid && !u.gift)}\n👫 В общих бюджетах: ${c((u) => u.link)}\n\n` +
      list.sort((a, b) => (b.seen || 0) - (a.seen || 0)).slice(0, 15).map((u) => `• ${u.name || u.uid}${u.user ? ' @' + u.user : ''} — ${u.n || 0} записей${u.paid ? ' 💎' : ''} · id ${u.uid}`).join('\n') });
    return;
  }
  if (text.startsWith('/undo')) {
    const r = await st.undo();
    await tg(env, 'sendMessage', {
      chat_id: chat,
      text: r ? `↩️ Удалил последнюю трату: ${fmt(r.orig ?? r.sum, r.cur || 'RUB')}${r.note ? ' — ' + r.note : ''}` : 'Нечего отменять: траты из чата не найдены.',
    });
    return;
  }
  if (/^\/?(напоминания|reminders)$/i.test(text)) {
    const list = await st.remList(), state = (await st.getState()) || {};
    if (!list.length) { await tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', text: 'Напоминаний нет. Напиши, например:\n<code>напомни завтра в 10 оплатить интернет 500</code>' }); return; }
    const tz = Number.isFinite(state.tz) ? state.tz : 180;
    await tg(env, 'sendMessage', { chat_id: chat, text: '⏰ Напоминания:\n\n' + list.map((x, i) => `${i + 1}. ${whenHuman(x.at + tz * 60000, state)} — ${x.text}`).join('\n'),
      reply_markup: { inline_keyboard: list.slice(0, 10).map((x, i) => [{ text: `🗑 Отменить ${i + 1}`, callback_data: 'rd:' + x.id }]) } });
    return;
  }
  if (/^\/?(напомни|напомнить|напоминание)(\s|$)/i.test(text)) {
    const state = (await st.getState()) || {};
    const r0 = parseReminder(text, state);
    if (!r0) { await tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', text: '⏰ Не понял, когда напомнить. Примеры:\n<code>напомни в 16:30 оплатить интернет</code>\n<code>напомни завтра в 10 позвонить в банк</code>\n<code>напомни через 2 часа забрать посылку</code>\n<code>напомни 25 числа аренда 30000</code>' }); return; }
    if (!r0.text) { await tg(env, 'sendMessage', { chat_id: chat, text: 'О чём напомнить? Например: напомни в 16:30 оплатить интернет' }); return; }
    const pe = parseExpense(r0.text, state);
    const rem = { id: Date.now(), at: r0.at, text: r0.text, sum: pe ? pe.sum : null, cur: pe ? pe.cur || state.cur || 'RUB' : null };
    await reg.regUpdate(uid, { remNext: await st.remAdd(rem), tz: state.tz });
    await tg(env, 'sendMessage', { chat_id: chat, text: `⏰ Напомню ${whenHuman(r0.atLocal, state)}: ${r0.text}${rem.sum ? '\nВ напоминании будет кнопка «Оплатил», и я сам запишу трату.' : ''}`, reply_markup: { inline_keyboard: [[{ text: '🗑 Отменить', callback_data: 'rd:' + rem.id }]] } });
    return;
  }
  if (/^\/?(подписки|платежи|регулярные|subs)$/i.test(text)) {
    const state = (await st.getState()) || {}, main = state.cur || 'RUB', subs = (state.subs || []).filter((x) => x.on !== false);
    if (!subs.length) { await tg(env, 'sendMessage', { chat_id: chat, text: '🔁 Регулярных платежей пока нет. Добавь их в приложении: вкладка «Конверты» → «Регулярные платежи». Я буду напоминать в день оплаты.', reply_markup: appButton(origin) }); return; }
    const rates = await getRates(), tot = subs.reduce((a, x) => a + (conv(x.sum, x.cur || main, main, rates) || 0), 0);
    await tg(env, 'sendMessage', { chat_id: chat, text: '🔁 Регулярные платежи:\n\n' + subs.sort((a, b) => a.day - b.day).map((x) => `${x.ic || '💳'} ${x.name} — ${fmt(x.sum, x.cur || main)}, ${x.day}-го`).join('\n') + `\n\nВсего в месяц ≈ ${fmt(tot, main)}`, reply_markup: appButton(origin) });
    return;
  }
  if (/^\/?(итоги|итог|месяц|отч[её]т|month|report)$/i.test(text)) {
    const state = (await st.getState()) || {};
    await tg(env, 'sendMessage', { chat_id: chat, text: monthReport(state, await getRates()), reply_markup: appButton(origin) });
    return;
  }

  const state = (await st.getState()) || {};
  const parsed = parseExpense(text, state);
  if (!parsed && env.AI && isQuestion(text)) {
    if (!(await st.aiTick(todayStr(state), AI_MAX))) { await tg(env, 'sendMessage', { chat_id: chat, text: '😴 На сегодня лимит вопросов к ИИ закончился. Завтра продолжим!' }); return; }
    let a = ''; try { a = await advise(env, state, text); } catch (e) { console.error('advise', e); }
    await tg(env, 'sendMessage', { chat_id: chat, text: a ? '🤖 ' + a.slice(0, 1500) : '😕 Не получилось ответить, попробуй ещё раз.', reply_markup: appButton(origin) });
    return;
  }
  if (!parsed) {
    await tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', text: '🤔 Не нашёл сумму.\n\n' + HELP });
    return;
  }
  const envId = detectEnv(parsed.note, state);
  if (!envId) {
    await st.setPending(parsed);
    const kb = getCats(state).map((c) => ({ text: `${c.ic} ${c.name}`, callback_data: `e:${c.id}` }));
    const rows = [];
    for (let i = 0; i < kb.length; i += 2) rows.push(kb.slice(i, i + 2));
    await tg(env, 'sendMessage', {
      chat_id: chat, text: `Куда записать ${fmt(parsed.sum, parsed.cur || state.cur || 'RUB')}${parsed.note ? ` («${parsed.note}»)` : ''}?`,
      reply_markup: { inline_keyboard: rows },
    });
    return;
  }
  const tx = makeTx(parsed, envId, state, await getRates());
  if (!tx) {
    await tg(env, 'sendMessage', { chat_id: chat, text: '😕 Не смог получить курс валюты. Попробуй ещё раз чуть позже.' });
    return;
  }
  const s = await st.addTx(tx);
  await reg.regUpdate(uid, { n: (s.tx || []).length });
  await tg(env, 'sendMessage', { chat_id: chat, text: summary(s, envId, tx), reply_markup: appButton(origin) });
}

/* ---------- маршруты ---------- */
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedule(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = url.origin;
    if (!env.ORIGIN) env.ORIGIN = origin + '/';
    ORIGIN_FIX = env.ORIGIN;

    if (!env.BOT_TOKEN && url.pathname !== '/') {
      return json({ ok: false, error: 'BOT_TOKEN не задан в настройках Worker' }, 500);
    }

    // Один раз открыть в браузере: привязывает бота к этому серверу
    if (url.pathname === '/setup') {
      const base = (env.ORIGIN || origin + '/').replace(/\/$/, '');
      const r = await tg(env, 'setWebhook', {
        url: base + '/tg',
        secret_token: await webhookSecret(env.BOT_TOKEN),
        allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
        drop_pending_updates: true,
      });
      await tg(env, 'setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Мой бюджет', web_app: { url: base + '/' } },
      });
      const rc = await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: '👋 Начать и кнопки' }] });
      const rd = await tg(env, 'setMyDescription', { description:
        '💌 Бюджет, который ведётся сам.\n\n' +
        'Пиши траты как другу: «кофе 300», «такси 35 ю», «отложил 5к». Можно голосом 🎤\n\n' +
        'Я разложу всё по категориям, посчитаю в любой валюте и покажу, сколько можно потратить сегодня.\n\n' +
        '⏰ Напомню об оплатах, пришлю итоги недели и месяца.\n\nКоманды учить не нужно: пиши обычными словами или жми кнопки.\n\nЖми «Старт» 👇' });
      const rs = await tg(env, 'setMyShortDescription', { short_description: '💌 Бюджет в Telegram: пиши траты как другу, а я посчитаю, сколько можно тратить сегодня.' });
      return new Response(
        (r.ok ? '✅ Готово! Бот подключён к серверу. Можно закрыть страницу и писать боту.' : '❌ Ошибка: ' + JSON.stringify(r)) + `\n\nКоманды: ${rc.ok ? '✅' : '❌ ' + JSON.stringify(rc)}\nОписание: ${rd.ok ? '✅' : '❌ ' + JSON.stringify(rd)}\nКороткое описание: ${rs.ok ? '✅' : '❌ ' + JSON.stringify(rs)}`,
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

    if (url.pathname === '/api/rates') {
      const rates = await getRates();
      return json({ ok: !!rates, rates });
    }

    if (url.pathname === '/api/feedback' && request.method === 'POST') {
      const user = await checkInitData(request.headers.get('X-Init-Data'), env.BOT_TOKEN);
      if (!user) return json({ ok: false, error: 'unauthorized' }, 401);
      const { text } = await request.json().catch(() => ({}));
      if (!text || String(text).trim().length < 3) return json({ ok: false }, 400);
      const admin = await store(env, '__registry__').getAdmin();
      if (admin) {
        await tg(env, 'sendMessage', { chat_id: admin, text: `💬 Отзыв от ${user.first_name || ''}${user.username ? ' @' + user.username : ''} (id ${user.id}):\n\n${String(text).slice(0, 1500)}` });
      }
      return json({ ok: true });
    }

    if (url.pathname === '/api/ai' && request.method === 'POST') {
      const user = await checkInitData(request.headers.get('X-Init-Data'), env.BOT_TOKEN);
      if (!user) return json({ ok: false, error: 'unauthorized' }, 401);
      const st = await userStore(env, user.id, user.first_name), state = (await st.getState()) || {};
      const b = await request.json().catch(() => ({}));
      if (b.act === 'prefs') return json({ ok: true, srv: await st.srvPatch({ prefs: (Array.isArray(b.prefs) ? b.prefs : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 20) }) });
      if (b.act === 'clear') return json({ ok: true, srv: await st.srvPatch({ menuAI: null }) });
      if (!env.AI) return json({ ok: false, error: 'no_ai' });
      if (!(await st.aiTick(todayStr(state), AI_MAX))) return json({ ok: false, error: 'limit' });
      if (b.act === 'menu') {
        let m = null; try { m = await makeMenu(env, state, String(b.prompt || '').slice(0, 300)); } catch (e) { console.error('menu', e); }
        if (!m) return json({ ok: false, error: 'ai' });
        return json({ ok: true, srv: await st.srvPatch({ menuAI: m, flags: { ...((state.srv || {}).flags || {}), chef: 1 } }) });
      }
      if (b.act === 'swap') {
        let m = null; try { m = await swapMeal(env, state, Math.max(0, Math.min(6, +b.day || 0)), Math.max(0, Math.min(2, +b.meal || 0)), String(b.wish || '').slice(0, 100)); } catch (e) { console.error('swap', e); }
        if (!m) return json({ ok: false, error: 'ai' });
        return json({ ok: true, srv: await st.srvPatch({ menuAI: m }) });
      }
      return json({ ok: false }, 400);
    }

    if (url.pathname === '/api/team' && request.method === 'POST') {
      const user = await checkInitData(request.headers.get('X-Init-Data'), env.BOT_TOKEN);
      if (!user) return json({ ok: false, error: 'unauthorized' }, 401);
      const st = await userStore(env, user.id, user.first_name);
      const b = await request.json().catch(() => ({}));
      if (b.act === 'invite') {
        if (st.owner !== user.id) return json({ ok: false, error: 'not_owner' });
        return json({ ok: true, ...(await makeInvite(env, user.id)) });
      }
      if (b.act === 'remove' && st.owner === user.id) {
        const pid = +b.id; await unlinkPartner(env, user.id, pid);
        await tg(env, 'sendMessage', { chat_id: pid, text: '👋 Тебя убрали из общего бюджета. Теперь у тебя снова свой личный бюджет.' });
        return json({ ok: true });
      }
      if (b.act === 'leave' && st.owner !== user.id) {
        await unlinkPartner(env, st.owner, user.id);
        await tg(env, 'sendMessage', { chat_id: st.owner, text: `👋 ${user.first_name || 'Партнёр'} вышел из общего бюджета.` });
        return json({ ok: true });
      }
      if (b.act === 'invoice') {
        const r2 = await tg(env, 'createInvoiceLink', invoiceBody(env, st.owner));
        return json({ ok: !!r2.ok, link: r2.result || null });
      }
      if (b.act === 'pic' && typeof b.png === 'string' && b.png.length < 6e6) {
        const bin = Uint8Array.from(atob(b.png.replace(/^data:image\/\w+;base64,/, '')), (c) => c.charCodeAt(0));
        const fd = new FormData();
        fd.append('chat_id', String(user.id));
        fd.append('caption', '📸 Твои итоги. Перешли друзьям или выложи в сторис 🙂');
        fd.append('photo', new Blob([bin], { type: 'image/png' }), 'itogi.png');
        const r3 = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, { method: 'POST', body: fd });
        const j3 = await r3.json().catch(() => ({}));
        return json({ ok: !!j3.ok });
      }
      return json({ ok: false }, 400);
    }

    if (url.pathname === '/api/export' && request.method === 'POST') {
      const user = await checkInitData(request.headers.get('X-Init-Data'), env.BOT_TOKEN);
      if (!user) return json({ ok: false, error: 'unauthorized' }, 401);
      const state = (await (await userStore(env, user.id)).getState()) || {};
      const fd = new FormData();
      fd.append('chat_id', String(user.id));
      fd.append('caption', `📤 Все твои траты (${(state.tx || []).length} шт.). Открывается в Excel и Google Таблицах.`);
      fd.append('document', new Blob([buildCsv(state)], { type: 'text/csv' }), `budget-${todayStr(state)}.csv`);
      const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      return json({ ok: !!j.ok }, j.ok ? 200 : 502);
    }

    if (url.pathname === '/api/state') {
      const user = await checkInitData(request.headers.get('X-Init-Data'), env.BOT_TOKEN);
      if (!user) return json({ ok: false, error: 'unauthorized' }, 401);
      const st = await userStore(env, user.id, user.first_name);
      const reg = store(env, '__registry__');
      const info = async () => {
        const acc = await accessOf(env, st.owner);
        const mem = await store(env, st.owner).getMembers();
        const ou = await reg.regGet(st.owner);
        return { ...acc, price: priceStars(env), me: user.id, owner: st.owner, isOwner: st.owner === user.id, members: [{ id: st.owner, name: (ou && ou.name) || '' }, ...mem.map((m) => ({ id: m.id, name: m.name }))] };
      };
      if (request.method === 'GET') {
        await reg.regUpdate(user.id, { seen: Date.now(), name: user.first_name || '', user: user.username || '' });
        return json({ ok: true, state: await st.getState(), access: await info() });
      }
      if (request.method === 'PUT') {
        const body = await request.json();
        if (!body || typeof body.state !== 'object') return json({ ok: false }, 400);
        const s = await st.putState(body.state, Array.isArray(body.deleted) ? body.deleted : []);
        await reg.regUpdate(user.id, { seen: Date.now(), tz: s.tz, notif: s.notif, subs: st.owner === user.id ? (s.subs || []).slice(0, 50) : [], start: s.start || 1, onb: !!s.onboarded, n: (s.tx || []).length, name: user.first_name || '', user: user.username || '' });
        return json({ ok: true, state: s });
      }
      return json({ ok: false }, 405);
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('not found', { status: 404 });
  },
};
