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

test('the admin Telegram button opens the 990-ruble test checkout and sends confirmation without granting access', async (t) => {
  const registry = registryForTest();
  const admin = 42;
  await registry.claimAdmin(admin);
  const messages = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.telegram.org/bottest-only/sendMessage');
    messages.push(JSON.parse(options.body));
    return Response.json({ ok: true });
  });
  const env = {
    BOT_TOKEN: 'test-only',
    ROBO_LOGIN: 'test-store',
    ROBO_PASS1: 'test-one',
    ROBO_PASS2: 'test-two',
    ROBO_TEST: '1',
    ROBO_MD5: (value) => createHash('md5').update(value).digest('hex'),
    USERS: { idFromName: (name) => name, get: () => registry },
  };
  const origin = 'https://konverty.example';
  const sendStart = (id) => worker.fetch(new Request(origin + '/tg', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': createHash('sha256').update('wh:' + env.BOT_TOKEN).digest('hex').slice(0, 48) },
    body: JSON.stringify({ message: { chat: { id, type: 'private' }, from: { id }, text: '/start' } }),
  }), env);
  await sendStart(43);
  assert.ok(messages[0].reply_markup.inline_keyboard.flat().every((button) => !button.url));
  await sendStart(admin);
  const button = messages[2].reply_markup.inline_keyboard.flat().find((button) => button.url);
  assert.match(button.text, /Купить за 990 ₽/);
  const open = () => worker.fetch(new Request(button.url), env);
  const redirect = await open();
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get('location'), '/checkout');
  assert.equal((await open()).status, 404);
  const cookie = redirect.headers.get('set-cookie').split(';')[0];
  const checkout = origin + '/checkout';
  const headers = { cookie, origin };
  const page = await (await worker.fetch(new Request(checkout, { headers }), env)).text();
  assert.match(page, /Полный доступ/);
  assert.match(page, /990 ₽/);
  assert.doesNotMatch(page, /299 ₽|Подтвердить в Telegram|webcode/);
  const form = (product) => worker.fetch(new Request(checkout, {
    method: 'POST', headers, body: new URLSearchParams({ offer: 'yes', product }),
  }), env);
  assert.equal((await form('pdf')).headers.get('location'), checkout);
  const payment = new URL((await form('full')).headers.get('location'));
  assert.equal(payment.origin, 'https://auth.robokassa.ru');
  assert.equal(payment.searchParams.get('IsTest'), '1');
  assert.equal(payment.searchParams.get('OutSum'), '990.00');
  assert.equal(payment.searchParams.has('Shp_uid'), false);
  const inv = payment.searchParams.get('InvId');
  const confirm = () => worker.fetch(new Request(origin + '/pay/result', {
    method: 'POST',
    body: new URLSearchParams({ InvId: inv, OutSum: '990.00', SignatureValue: env.ROBO_MD5('990.00:' + inv + ':' + env.ROBO_PASS2) }),
  }), env);
  assert.equal(await (await confirm()).text(), 'OK' + inv);
  assert.equal(await (await confirm()).text(), 'OK' + inv);
  const confirmations = messages.filter((message) => message.text.includes('Тестовая оплата подтверждена'));
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].chat_id, admin);
  assert.equal((await registry.regGet(admin))?.paid, undefined);
  const returnPage = await (await worker.fetch(new Request(origin + '/pay/ok'), env)).text();
  assert.match(returnPage, /Проверяем тестовую оплату/);
  assert.match(returnPage, /Вернуться в бот/);
  delete env.ROBO_TEST;
  await sendStart(admin);
  assert.ok(messages.at(-2).reply_markup.inline_keyboard.flat().every((button) => !button.url));
});
