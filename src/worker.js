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
export class UserStore extends DurableObject {
  /* реестр (один экземпляр с именем __registry__) */
  async regUpdate(uid, patch) {
    const k = 'u:' + uid;
    const v = { first: Date.now(), ...((await this.ctx.storage.get(k)) || {}), ...patch };
    await this.ctx.storage.put(k, v);
    return v;
  }
  async regList() {
    const m = await this.ctx.storage.list({ prefix: 'u:' });
    return [...m.entries()].map(([k, v]) => ({ uid: +k.slice(2), ...v }));
  }
  async getAdmin() { return (await this.ctx.storage.get('admin')) || null; }
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
export function eveningText(state) {
  const main = state.cur || 'RUB', today = todayStr(state);
  const isSave = (t) => catInfo(t.env, state).save;
  const list = (state.tx || []).filter((t) => txDate(t) === today && !isSave(t));
  if (!list.length) return { text: '🌙 Сегодня ни одной записи. День без трат или забыл записать?', empty: true };
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
  return { text: text + '\n\nВсё записал? 🙂', empty: false };
}
const hm = (t) => { const [h, m] = String(t || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
async function runSchedule(env) {
  const reg = store(env, '__registry__');
  const users = await reg.regList();
  for (const u of users) {
    const n = u.notif;
    if (!n || (!n.m && !n.e)) continue;
    const local = new Date(Date.now() + (Number.isFinite(u.tz) ? u.tz : 180) * 60000);
    const mins = local.getUTCHours() * 60 + local.getUTCMinutes(), today = ymd(local);
    for (const k of ['m', 'e']) {
      const at = hm(n[k + 't']);
      if (!n[k] || at == null || mins < at || mins >= at + 60 || u['last_' + k] === today) continue;
      try {
        const state = (await store(env, u.uid).getState()) || {};
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
const appButton = (origin) => ({ inline_keyboard: [[{ text: '📊 Открыть бюджет', web_app: { url: origin + '/' } }]] });

async function onUpdate(update, env, origin) {
  if (update.callback_query && update.callback_query.data === 'ns') {
    const q = update.callback_query;
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Засчитано 🧘' });
    await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: '🧘 День без трат! Так держать 💪', reply_markup: appButton(origin) });
    return;
  }
  if (update.callback_query) {
    const q = update.callback_query;
    const uid = q.from.id;
    const [, envId] = (q.data || '').split(':');
    const st = store(env, uid);
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
  if (!msg || !msg.text || msg.chat.type !== 'private') return;
  const uid = msg.from.id, chat = msg.chat.id, text = msg.text.trim();
  const st = store(env, uid);

  const reg = store(env, '__registry__');
  await reg.regUpdate(uid, { seen: Date.now(), name: msg.from.first_name || '', user: msg.from.username || '' });
  if (text.startsWith('/start') || text.startsWith('/help')) {
    await tg(env, 'sendMessage', {
      chat_id: chat, parse_mode: 'HTML', reply_markup: appButton(origin),
      text: '👋 Привет! Я веду твой бюджет прямо в чате.\n\n' +
        '<b>Как это работает:</b>\n' +
        '1️⃣ Нажми «📊 Открыть бюджет» и за минуту настрой: режим, валюту, доход.\n' +
        '2️⃣ Пиши траты сюда, как другу:\n' +
        '   • <code>кофе 300</code>\n   • <code>вчера такси 35 ю</code>\n   • <code>отложил 5к</code>\n' +
        '3️⃣ Я сам разложу по категориям и покажу графики в приложении.\n\n' +
        '<code>итоги</code> — сводка за месяц, /undo — отменить последнюю запись.',
    });
    return;
  }
  if (text === '/admin') {
    const a = await reg.claimAdmin(uid);
    await tg(env, 'sendMessage', { chat_id: chat, text: a === uid ? '👑 Ты админ: сюда будут приходить отзывы. /stats — статистика.' : 'Админ уже назначен.' });
    return;
  }
  if (text === '/stats') {
    if ((await reg.getAdmin()) !== uid) { await tg(env, 'sendMessage', { chat_id: chat, text: 'Команда только для админа.' }); return; }
    const list = await reg.regList(), wk = Date.now() - 7 * 864e5, day = Date.now() - 864e5;
    const c = (f) => list.filter(f).length;
    await tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', text:
      `📊 <b>Статистика</b>\n\n👥 Всего зашли: ${list.length}\n🧭 Прошли настройку: ${c((u) => u.onb)}\n✍️ Записали хотя бы 1 трату: ${c((u) => u.n > 0)}\n🔥 Активны за сутки: ${c((u) => u.seen > day)}\n📅 Активны за неделю: ${c((u) => u.seen > wk)}\n🔔 С напоминаниями: ${c((u) => u.notif && (u.notif.m || u.notif.e))}\n\n` +
      list.sort((a, b) => (b.seen || 0) - (a.seen || 0)).slice(0, 15).map((u) => `• ${u.name || u.uid}${u.user ? ' @' + u.user : ''} — ${u.n || 0} записей`).join('\n') });
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
  if (/^\/?(итоги|итог|месяц|отч[её]т|month|report)(\s|$)/i.test(text)) {
    const state = (await st.getState()) || {};
    await tg(env, 'sendMessage', { chat_id: chat, text: monthReport(state, await getRates()), reply_markup: appButton(origin) });
    return;
  }

  const state = (await st.getState()) || {};
  const parsed = parseExpense(text, state);
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

    if (url.pathname === '/api/export' && request.method === 'POST') {
      const user = await checkInitData(request.headers.get('X-Init-Data'), env.BOT_TOKEN);
      if (!user) return json({ ok: false, error: 'unauthorized' }, 401);
      const state = (await store(env, user.id).getState()) || {};
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
      const st = store(env, user.id);
      const reg = store(env, '__registry__');
      if (request.method === 'GET') {
        await reg.regUpdate(user.id, { seen: Date.now(), name: user.first_name || '', user: user.username || '' });
        return json({ ok: true, state: await st.getState() });
      }
      if (request.method === 'PUT') {
        const body = await request.json();
        if (!body || typeof body.state !== 'object') return json({ ok: false }, 400);
        const s = await st.putState(body.state, Array.isArray(body.deleted) ? body.deleted : []);
        await reg.regUpdate(user.id, { seen: Date.now(), tz: s.tz, notif: s.notif, onb: !!s.onboarded, n: (s.tx || []).length, name: user.first_name || '', user: user.username || '' });
        return json({ ok: true, state: s });
      }
      return json({ ok: false }, 405);
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('not found', { status: 404 });
  },
};
