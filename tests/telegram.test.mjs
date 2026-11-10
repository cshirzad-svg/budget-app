import test from 'node:test';
import assert from 'node:assert/strict';
import { tg } from '../src/worker.js';

test('VPS sends via relay first, falls back after failure, then reuses working route', async () => {
  const originalFetch = globalThis.fetch;
  const env = { BOT_TOKEN: 'test-only', TG_API: 'https://relay.example/tgrelay/', TG_PREFER_RELAY: true };
  const requests = [];
  let relayFails = false;
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    assert.ok(options.signal instanceof AbortSignal);
    if (relayFails && url.startsWith('https://relay.example/')) throw new Error('relay unavailable');
    return Response.json({ ok: true, result: { id: 1 } });
  };
  try {
    assert.equal((await tg(env, 'getMe', {})).ok, true);
    assert.equal(requests[0], 'https://relay.example/tgrelay/bottest-only/getMe');
    relayFails = true;
    assert.equal((await tg(env, 'getMe', {})).ok, true);
    assert.equal(requests[1], 'https://relay.example/tgrelay/bottest-only/getMe');
    assert.equal(requests[2], 'https://api.telegram.org/bottest-only/getMe');
    assert.equal((await tg(env, 'getMe', {})).ok, true);
    assert.equal(requests[3], 'https://api.telegram.org/bottest-only/getMe');
  } finally { globalThis.fetch = originalFetch; }
});
