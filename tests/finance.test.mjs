// Тесты финансовой логики бота. Запуск: node --import ./tests/loader.mjs --test tests/
// Ничего не пишет в настоящую базу: состояние живёт в памяти.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UserStore, period, morningText, todayText, todayStr, getCats, monthReport, buildCsv, conv } from '../src/worker.js';

// фиксируем «сейчас» (UTC), чтобы тесты не зависели от дня запуска
const realNow = Date.now;
const at = (iso) => { Date.now = () => Date.parse(iso); };
test.after(() => { Date.now = realNow; });

// хранилище в памяти вместо Durable Object / SQLite
const memStore = () => {
  const m = new Map();
  return new UserStore({ storage: {
    get: async (k) => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)); },
    delete: async (k) => m.delete(k), list: async () => new Map(m),
  } }, {});
};

const num = (s) => +String(s).replace(/<[^>]+>/g, '').match(/[\d\s  ]+(?=\s*₽)/)[0].replace(/\D/g, '');

// бюджет: 3 конверта + копилка, месяц с 1-го, Москва
const base = () => ({ cur: 'RUB', start: 1, tz: 180, mode: 'env', tx: [], cats: null });
function withPlan(s) {
  const cats = getCats(s).map((c) => ({ ...c }));
  return { s, cats };
}

test('период: месяц с 1-го, 2 ноября', () => {
  at('2026-11-02T09:00:00Z');
  const P = period({ start: 1, tz: 180 });
  assert.equal(P.s, '2026-11-01'); assert.equal(P.e, '2026-12-01');
  assert.equal(P.days, 30); assert.equal(P.elapsed, 2);
});

test('период: месяц с 25-го, до начала нового', () => {
  at('2026-11-02T09:00:00Z');
  const P = period({ start: 25, tz: 180 });
  assert.equal(P.s, '2026-10-25'); assert.equal(P.e, '2026-11-25');
  assert.equal(P.days, 31); assert.equal(P.elapsed, 9);
});

test('период: февраль и високосный год', () => {
  at('2028-02-15T09:00:00Z');
  assert.equal(period({ start: 1, tz: 180 }).days, 29);
  at('2027-02-15T09:00:00Z');
  assert.equal(period({ start: 1, tz: 180 }).days, 28);
});

test('часовой пояс: в 23:30 по Москве 31 октября ещё октябрь', () => {
  at('2026-10-31T20:30:00Z'); // 23:30 МСК
  assert.equal(todayStr({ tz: 180 }), '2026-10-31');
  assert.equal(period({ start: 1, tz: 180 }).s, '2026-10-01');
  at('2026-10-31T21:30:00Z'); // 00:30 МСК, 1 ноября
  assert.equal(todayStr({ tz: 180 }), '2026-11-01');
  assert.equal(period({ start: 1, tz: 180 }).s, '2026-11-01');
  // Чэнду (UTC+8): там уже 1 ноября раньше
  at('2026-10-31T16:30:00Z');
  assert.equal(todayStr({ tz: 480 }), '2026-11-01');
});

test('утро: лимит на день = (план − потрачено) / оставшиеся дни', () => {
  at('2026-11-11T05:00:00Z'); // 11 ноября, 08:00 МСК; осталось 20 дней включая сегодня
  const s = base();
  s.cats = getCats(s).map((c) => ({ ...c, amt: c.save ? 10000 : 0 }));
  const spend = s.cats.filter((c) => !c.save);
  spend[0].amt = 30000; spend[1].amt = 10000; // план 40 000
  s.tx = [
    { id: 1, date: '2026-11-03', env: spend[0].id, sum: 12000 },
    { id: 2, date: '2026-11-10', env: spend[1].id, sum: 8000 },
    { id: 3, date: '2026-11-05', env: s.cats.find((c) => c.save).id, sum: 10000 }, // копилка не трата
    { id: 4, date: '2026-10-30', env: spend[0].id, sum: 99999 }, // прошлый месяц не считается
  ];
  const t = morningText(s);
  assert.match(t, /1\s000/); // (40000 − 20000) / 20 = 1000
  assert.match(t, /20\s000.*из 40\s000/s);
});

test('«Сегодня»: норма не меняется от сегодняшних трат, меняется остаток', () => {
  at('2026-11-11T10:00:00Z');
  const s = base();
  s.cats = getCats(s).map((c) => ({ ...c, amt: 0 }));
  const e = s.cats.find((c) => !c.save); e.amt = 40000;
  s.tx = [{ id: 1, date: '2026-11-03', env: e.id, sum: 20000 }, { id: 2, date: '2026-11-11', env: e.id, sum: 300 }];
  const t = todayText(s);
  assert.match(t, /можно ещё <b>700/); // норма 1000, потрачено 300
  assert.match(t, /Норма на день 1\s000/);
  s.tx.push({ id: 3, date: '2026-11-11', env: e.id, sum: 2000 });
  assert.match(todayText(s), /сверх нормы на <b>1\s300/);
});

test('бюджет кончился: утро не показывает отрицательный лимит', () => {
  at('2026-11-20T05:00:00Z');
  const s = base();
  s.cats = getCats(s).map((c) => ({ ...c, amt: 0 }));
  const e = s.cats.find((c) => !c.save); e.amt = 10000;
  s.tx = [{ id: 1, date: '2026-11-05', env: e.id, sum: 12500 }];
  assert.match(morningText(s), /перерасход 2\s500/);
});

test('100 операций: изменить 20, удалить 10 — итоги совпадают с ручным расчётом', async () => {
  at('2026-11-25T09:00:00Z');
  const st = memStore();
  const s = base();
  s.cats = getCats(s).map((c) => ({ ...c, amt: 0 }));
  const spendIds = s.cats.filter((c) => !c.save).map((c) => c.id);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  s.tx = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, date: `2026-11-${String(1 + (i % 24)).padStart(2, '0')}`, env: spendIds[i % spendIds.length], sum: Math.round(50 + rnd() * 3000), note: 'т' + i }));
  await st.putState(s);
  // приложение меняет 20 сумм и удаляет 10
  const cur = await st.getState();
  for (let i = 0; i < 20; i++) cur.tx[i * 3].sum += 111;
  const del = cur.tx.filter((_, i) => i % 10 === 5).map((t) => t.id);
  cur.tx = cur.tx.filter((t) => !del.includes(t.id));
  // пока приложение было открыто, бот записал ещё 3 траты
  for (let i = 0; i < 3; i++) await st.addTx({ id: 5000 + i, date: '2026-11-25', env: spendIds[0], sum: 400, note: 'бот' + i });
  const saved = await st.putState(cur, del);
  const expected = cur.tx.reduce((a, t) => a + t.sum, 0) + 1200;
  assert.equal(saved.tx.length, 90 + 3, 'удалённые убраны, траты бота не потерялись');
  assert.equal(saved.tx.reduce((a, t) => a + t.sum, 0), expected);
  assert.ok(!saved.tx.some((t) => del.includes(t.id)), 'удалённые не вернулись');
  // итоги месяца, CSV и «потрачено» в утреннем тексте — одна и та же сумма
  const rep = monthReport(saved, null);
  assert.equal(num(rep.match(/Потрачено: [^\n≈]+/)[0]), expected);
  const csvSum = buildCsv(saved).split('\n').slice(1).filter(Boolean).reduce((a, l) => a + (+(l.match(/;(-?\d+(?:[.,]\d+)?);/) || [0, 0])[1].replace(',', '.') || 0), 0);
  assert.equal(Math.round(csvSum), expected, 'CSV совпадает');
});

test('повторное сохранение того же состояния не дублирует траты', async () => {
  const st = memStore();
  const s = { ...base(), tx: [{ id: 1, date: '2026-11-01', env: 'food', sum: 100 }] };
  await st.putState(s); await st.putState(s); await st.putState(s);
  assert.equal((await st.getState()).tx.length, 1);
});

test('повторный Telegram update не обрабатывается дважды', async () => {
  const st = memStore();
  assert.equal(await st.seenUpd(777), false);
  assert.equal(await st.seenUpd(777), true);
});

test('валюта: без курсов конвертация честно возвращает null, а не 0', () => {
  assert.equal(conv(100, 'RUB', 'RUB', null), 100);
  assert.equal(conv(100, 'USD', 'RUB', null), null);
  const r = { RUB: 90, CNY: 7, USD: 1 };
  assert.equal(Math.round(conv(70, 'CNY', 'RUB', r)), 900);
});
