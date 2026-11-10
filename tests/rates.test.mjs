import test from 'node:test';
import assert from 'node:assert/strict';

test('rates on Node: concurrent and repeated messages share a bounded request; expired rates refresh', async () => {
  const { getRates } = await import('../src/worker.js');
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  let now = originalNow(), calls = 0;
  Date.now = () => now;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.ok(options.signal instanceof AbortSignal);
    await Promise.resolve();
    return Response.json({ result: 'success', rates: { USD: 1, RUB: 90 + calls, CNY: 7 } });
  };
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => getRates()));
    assert.equal(calls, 1);
    assert.ok(results.every(r => r.RUB === 91));
    assert.equal((await getRates()).RUB, 91);
    assert.equal(calls, 1);
    now += 6 * 3600 * 1000 + 1;
    assert.equal((await getRates()).RUB, 92);
    assert.equal(calls, 2);
    now += 6 * 3600 * 1000 + 1;
    globalThis.fetch = async () => { throw new Error('network unavailable'); };
    assert.equal(await getRates(), null, 'do not silently use expired exchange rates');
    globalThis.fetch = async () => Response.json({ result: 'success', rates: { USD: 1, RUB: 95 } });
    assert.equal((await getRates()).RUB, 95, 'failed request does not block a later recovery');
  } finally {
    globalThis.fetch = originalFetch; Date.now = originalNow;
  }
});
