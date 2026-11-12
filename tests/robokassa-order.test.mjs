import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { UserStore } from '../src/worker.js';

test('the rollout accepts test checkout configuration but keeps live checkout closed', async () => {
  const env = { BOT_TOKEN: 'test-only', ROBO_LOGIN: 'test-store', ROBO_PASS1: 'test-one', ROBO_PASS2: 'test-two', ROBO_LIVE: '1' };
  const url = 'https://konverty.example/checkout';
  const live = await worker.fetch(new Request(url, { method: 'POST' }), env);
  assert.equal(live.status, 503);

  const testPage = await worker.fetch(new Request(url), { ...env, ROBO_TEST: '1' });
  assert.equal(testPage.status, 200);
  const html = await testPage.text();
  assert.match(html, /Тестовая оплата/);
  assert.match(html, /action="\/checkout"/);
});

test('web checkout consumes a valid code once and confirms only the matching order', async () => {
  const data = new Map();
  const storage = {
    async get(key) { return data.get(key); },
    async put(key, value) {
      if (typeof key === 'string') data.set(key, value);
      else for (const [name, entry] of Object.entries(key)) data.set(name, entry);
    },
  };
  const registry = new UserStore({ storage }, {});
  await registry.meta('web_code:42', { digest: 'code', expires: Date.now() + 60000 });
  assert.equal(await registry.createRoboOrder(42, 'wrong', '990.00', false), null);
  const order = await registry.createRoboOrder(42, 'code', '990.00', false);
  assert.equal(await registry.createRoboOrder(42, 'code', '990.00', false), null);
  assert.equal(await registry.confirmRoboOrder(order.inv, '1.00', false), 'mismatch');
  assert.equal(await registry.confirmRoboOrder(order.inv, '990.00', true), 'mismatch');
  assert.equal(await registry.regGet(42), null);
  assert.equal((await registry.confirmRoboOrder(order.inv, '990.00', false)).status, 'confirmed');
  assert.equal((await registry.regGet(42)).paid, true);
  assert.equal(await registry.confirmRoboOrder(order.inv, '990.00', false), 'duplicate');

  await registry.meta('web_code:43', { digest: 'old', expires: Date.now() - 1000 });
  assert.equal(await registry.createRoboOrder(43, 'old', '990.00', true), null);
  await registry.meta('web_code:43', { digest: 'test', expires: Date.now() + 60000 });
  const testOrder = await registry.createRoboOrder(43, 'test', '990.00', true);
  assert.equal(await registry.confirmRoboOrder(testOrder.inv, '990.00', true), 'test_confirmed');
  assert.equal(await registry.regGet(43), null);

  await registry.meta('web_code:44', { digest: 'pdf', expires: Date.now() + 60000 });
  const pdfOrder = await registry.createRoboOrder(44, 'pdf', '299.00', false, 'pdf');
  assert.equal((await registry.confirmRoboOrder(pdfOrder.inv, '299.00', false)).status, 'pdf_confirmed');
  const firstPeriod = await registry.regGet(44);
  assert.equal(firstPeriod.paid, undefined);
  assert.ok(firstPeriod.pdfUntil > Date.now());
  assert.equal(await registry.confirmRoboOrder(pdfOrder.inv, '299.00', false), 'duplicate');
  assert.equal((await registry.regGet(44)).pdfUntil, firstPeriod.pdfUntil);
  await registry.meta('web_code:44', { digest: 'renew', expires: Date.now() + 60000 });
  const renewal = await registry.createRoboOrder(44, 'renew', '299.00', false, 'pdf');
  assert.equal((await registry.confirmRoboOrder(renewal.inv, '299.00', false)).status, 'pdf_confirmed');
  assert.equal((await registry.regGet(44)).pdfUntil, firstPeriod.pdfUntil + 30 * 864e5);
});
