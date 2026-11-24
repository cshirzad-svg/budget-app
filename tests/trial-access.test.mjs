import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import worker, { UserStore } from '../src/worker.js';

function registryForTest() {
  const data = new Map();
  const storage = {
    async get(key) { return data.get(key); },
    async put(key, value) {
      if (typeof key === 'string') data.set(key, value);
      else for (const [name, entry] of Object.entries(key)) data.set(name, entry);
    },
    async list({ prefix = '' } = {}) { return new Map([...data].filter(([key]) => key.startsWith(prefix))); },
    async delete(keys) { for (const key of [].concat(keys)) data.delete(key); },
  };
  return new UserStore({ storage }, {});
}

function initData(id, token) {
  const query = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Test' }) });
  const check = [...query].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + '=' + v).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  query.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return query.toString();
}

test('existing unpaid users receive 72 hours from rollout, new users from first use, and expiry never resets', async () => {
  const registry = registryForTest(), day = 864e5, start = Date.now();
  await registry.regUpdate(42, { first: start - 100 * day, trialEnd: start - 97 * day });
  const old = await registry.accessStatus(42, start);
  assert.equal(old.trialEnd, start + 3 * day);
  assert.equal((await registry.regGet(42)).first, start - 100 * day);
  assert.equal((await registry.accessStatus(42, old.trialEnd - 1)).active, true);
  const expired = await registry.accessStatus(42, old.trialEnd);
  assert.equal(expired.active, false);
  assert.equal(expired.pdf, false);
  assert.equal((await registry.accessStatus(42, start + 100 * day)).trialEnd, old.trialEnd);
  await registry.regUpdate(43, { first: start + 10 * day });
  assert.equal((await registry.accessStatus(43, start + 10 * day)).trialEnd, start + 13 * day);
});

test('paid, manually granted and gifted access remains intact including legacy PDF rights', async () => {
  const registry = registryForTest(), start = Date.now(), past = start - 100 * 864e5;
  await registry.claimAdmin(99);
  for (const [id, patch] of [[42, { paid: true }], [43, { paid: true, gift: true }], [44, { gift: true }]]) {
    await registry.regUpdate(id, { first: past, trialEnd: past, ...patch });
    const before = { ...await registry.regGet(id) };
    const access = await registry.accessStatus(id, start);
    assert.equal(access.active, true);
    assert.equal(access.pdf, true);
    assert.deepEqual(await registry.regGet(id), before);
  }
  assert.equal((await registry.accessStatus(99, start)).active, true);
  await registry.regUpdate(45, { first: past, paid: true, roboLifetime: true, trialEnd: past, pdfUntil: start + 864e5 });
  assert.equal((await registry.accessStatus(45, start)).pdf, true);
  assert.equal((await registry.accessStatus(45, start + 864e5)).pdf, false);
  assert.equal((await registry.accessStatus(45, start + 864e5)).active, true);
});

test('expired trials reject bot writes, old callbacks, AI and API writes but keep state readable; payment restores access', async (t) => {
  const registry = registryForTest(), now = Date.now();
  await registry.claimAdmin(99);
  await registry.ensureTrialPolicy(now - 10 * 864e5);
  await registry.regUpdate(42, { first: now - 10 * 864e5, trialPolicy: 8, trialEnd: now - 1 });
  const messages = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { messages.push(JSON.parse(options.body)); return Response.json({ ok: true }); });
  const env = {
    BOT_TOKEN: 'test-only', ROBO_LOGIN: 'test-store', ROBO_LIVE_PASS1: 'one', ROBO_LIVE_PASS2: 'two', ROBO_LIVE: '1',
    ROBO_MD5: value => createHash('md5').update(value).digest('hex'),
    USERS: { idFromName: name => name, get: () => registry },
  };
  const auth = { 'X-Init-Data': initData(42, env.BOT_TOKEN), 'content-type': 'application/json' };
  const origin = 'https://konverty.example';
  const state = { cur: 'RUB', income: 1000, tx: [{ id: 123, sum: 30, note: 'saved' }] };
  await registry.putState(state);
  const put = () => worker.fetch(new Request(origin + '/api/state', { method: 'PUT', headers: auth, body: JSON.stringify({ state: { ...state, income: 9999 } }) }), env);
  assert.equal((await put()).status, 402);
  assert.equal((await registry.getState()).income, 1000);
  const get = await (await worker.fetch(new Request(origin + '/api/state', { headers: auth }), env)).json();
  assert.equal(get.ok, true);
  assert.equal(get.state.tx[0].id, 123);
  assert.equal(get.access.active, false);
  const webhook = body => worker.fetch(new Request(origin + '/tg', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': createHash('sha256').update('wh:' + env.BOT_TOKEN).digest('hex').slice(0, 48) }, body: JSON.stringify(body),
  }), env);
  await webhook({ message: { chat: { id: 42, type: 'private' }, from: { id: 42 }, text: 'кофе 300' } });
  await webhook({ callback_query: { id: 'old', from: { id: 42 }, message: { chat: { id: 42, type: 'private' }, message_id: 1 }, data: 'e:food' } });
  assert.ok(messages.some(m => m.text?.includes('Три бесплатных дня закончились')));
  assert.equal((await registry.getState()).tx.length, 1);
  await registry.meta('ai_consent:42', { revision: 7, acceptedAt: now });
  assert.equal((await worker.fetch(new Request(origin + '/api/ai', { method: 'POST', headers: auth, body: JSON.stringify({ act: 'menu' }) }), env)).status, 402);
  await registry.openCheckoutPurchase('payment', 42);
  await registry.redeemCheckoutPurchase('payment', 'browser');
  const order = await registry.createRoboOrder('browser', '990.00', false);
  await registry.confirmRoboOrder(order.inv, '990.00', false);
  assert.equal((await put()).status, 200);
  assert.equal((await registry.accessStatus(42)).paid, true);
  assert.equal((await registry.accessStatus(42)).pdf, false);
});
