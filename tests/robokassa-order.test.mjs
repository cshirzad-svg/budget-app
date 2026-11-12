import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker, { UserStore } from '../src/worker.js';

function registryForTest() {
  const data = new Map();
  const storage = {
    async get(key) { return data.get(key); },
    async put(key, value) {
      if (typeof key === 'string') data.set(key, value);
      else for (const [name, entry] of Object.entries(key)) data.set(name, entry);
    },
  };
  return new UserStore({ storage }, {});
}

test('website checkout confirms the browser in Telegram and exposes only the applicable tariff', async () => {
  const registry = registryForTest();
  const env = {
    BOT_TOKEN: 'test-only',
    ROBO_LOGIN: 'test-store',
    ROBO_PASS1: 'test-one',
    ROBO_PASS2: 'test-two',
    ROBO_LIVE: '1',
    ROBO_MD5: (value) => createHash('md5').update(value).digest('hex'),
    USERS: { idFromName: (name) => name, get: () => registry },
  };
  const origin = 'https://konverty.example';
  const checkout = origin + '/checkout';
  assert.equal((await worker.fetch(new Request(checkout, { method: 'POST' }), env)).status, 503);
  env.ROBO_TEST = '1';

  const initial = await worker.fetch(new Request(checkout), env);
  const cookie = initial.headers.get('set-cookie').split(';')[0];
  const page = await initial.text();
  const id = page.match(/start=buy_([a-f0-9]{48})/)[1];
  assert.ok(!cookie.includes(id));
  assert.match(page, /Тестовая оплата/);
  assert.match(page, /990 ₽/);
  assert.doesNotMatch(page, /299 ₽|webcode/);

  const request = (url, options = {}) => new Request(url, { ...options, headers: { cookie, origin } });
  assert.equal(await (await worker.fetch(request(checkout + '/status'), env)).text(), 'pending');
  assert.equal(await registry.linkCheckout(id, 42), true);
  assert.equal(await registry.linkCheckout(id, 43), false);
  assert.equal(await (await worker.fetch(request(checkout + '/status'), env)).text(), 'full');
  assert.equal(await (await worker.fetch(new Request(checkout + '/status'), env)).text(), 'expired');
  const linkedPage = await (await worker.fetch(request(checkout), env)).text();
  assert.match(linkedPage, /name="product" value="full"/);
  assert.doesNotMatch(linkedPage, /299 ₽|webcode/);

  const submit = (product) => worker.fetch(request(checkout, {
    method: 'POST', body: new URLSearchParams({ product, offer: 'yes' }),
  }), env);
  assert.equal((await submit('pdf')).headers.get('location'), checkout);
  const payment = new URL((await submit('full')).headers.get('location'));
  assert.equal(payment.origin, 'https://auth.robokassa.ru');
  assert.equal(payment.searchParams.get('IsTest'), '1');
  assert.equal(payment.searchParams.get('OutSum'), '990.00');
  assert.equal(payment.searchParams.has('Shp_uid'), false);
  assert.equal((await submit('full')).headers.get('location'), checkout);
  const inv = payment.searchParams.get('InvId');
  const callback = (signature) => worker.fetch(new Request(origin + '/pay/result', {
    method: 'POST',
    body: new URLSearchParams({ InvId: inv, OutSum: '990.00', SignatureValue: signature }),
  }), env);
  assert.equal((await callback('bad-signature')).status, 400);
  const signed = await callback(env.ROBO_MD5('990.00:' + inv + ':' + env.ROBO_PASS2));
  assert.equal(await signed.text(), 'OK' + inv);
  assert.equal(await registry.regGet(42), null);

  await registry.regUpdate(42, { paid: true });
  const next = await worker.fetch(request(checkout), env);
  const nextCookie = next.headers.get('set-cookie').split(';')[0];
  const nextId = (await next.text()).match(/start=buy_([a-f0-9]{48})/)[1];
  assert.equal(await registry.linkCheckout(nextId, 42), true);
  const pdfPage = await (await worker.fetch(new Request(checkout, { headers: { cookie: nextCookie } }), env)).text();
  assert.match(pdfPage, /name="product" value="pdf"/);
  assert.match(pdfPage, /299 ₽/);
  assert.doesNotMatch(pdfPage, /990 ₽/);
});

test('matching an order grants only its entitlement and repeated confirmation does not extend it', async () => {
  const registry = registryForTest();
  const create = async (id, user, sum, testMode, product = 'full') => {
    await registry.openCheckout(id);
    assert.equal(await registry.createRoboOrder(id, sum, testMode, product), null);
    assert.equal(await registry.linkCheckout(id, user), true);
    return registry.createRoboOrder(id, sum, testMode, product);
  };

  const order = await create('full', 42, '990.00', false);
  assert.equal(await registry.createRoboOrder('full', '990.00', false), null);
  assert.equal(await registry.confirmRoboOrder(order.inv, '1.00', false), 'mismatch');
  assert.equal(await registry.confirmRoboOrder(order.inv, '990.00', true), 'mismatch');
  assert.equal(await registry.regGet(42), null);
  assert.equal((await registry.confirmRoboOrder(order.inv, '990.00', false)).status, 'confirmed');
  assert.equal((await registry.regGet(42)).paid, true);
  assert.equal(await registry.confirmRoboOrder(order.inv, '990.00', false), 'duplicate');

  const testOrder = await create('test', 43, '990.00', true);
  assert.equal(await registry.confirmRoboOrder(testOrder.inv, '990.00', true), 'test_confirmed');
  assert.equal(await registry.regGet(43), null);
  assert.equal(await create('pdf-without-full', 43, '299.00', false, 'pdf'), null);

  const pdfOrder = await create('pdf', 42, '299.00', false, 'pdf');
  assert.equal((await registry.confirmRoboOrder(pdfOrder.inv, '299.00', false)).status, 'pdf_confirmed');
  const firstPeriod = await registry.regGet(42);
  assert.ok(firstPeriod.pdfUntil > Date.now());
  assert.equal(await registry.confirmRoboOrder(pdfOrder.inv, '299.00', false), 'duplicate');
  assert.equal((await registry.regGet(42)).pdfUntil, firstPeriod.pdfUntil);
  const renewal = await create('renew', 42, '299.00', false, 'pdf');
  assert.equal((await registry.confirmRoboOrder(renewal.inv, '299.00', false)).status, 'pdf_confirmed');
  assert.equal((await registry.regGet(42)).pdfUntil, firstPeriod.pdfUntil + 30 * 864e5);
});
