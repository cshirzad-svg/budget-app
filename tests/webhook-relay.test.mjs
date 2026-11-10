import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

test('moved Worker forwards only authenticated updates, preserving failure status for Telegram retries', async () => {
  const originalFetch = globalThis.fetch;
  const env = { MOVED: '1', BOT_TOKEN: 'test-only' };
  const secret = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('wh:' + env.BOT_TOKEN)))].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,48);
  let calls = 0, upstream = 200;
  const request = (key) => new Request('https://relay.example/tg', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': key, 'x-untrusted': 'do-not-forward' }, body: '{"update_id":1}' });
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://konverty.app/tg');
    assert.equal(options.headers['X-Telegram-Bot-Api-Secret-Token'], secret);
    assert.equal(options.headers['x-untrusted'], undefined);
    assert.equal(await new Response(options.body).text(), '{"update_id":1}');
    if (!upstream) throw new Error('connection unavailable');
    return new Response('origin result', { status: upstream });
  };
  try {
    assert.equal((await worker.fetch(request('wrong'), env)).status, 403);
    assert.equal(calls, 0);
    assert.equal((await worker.fetch(request(secret), env)).status, 200);
    upstream = 503;
    assert.equal((await worker.fetch(request(secret), env)).status, 503);
    upstream = 0;
    assert.equal((await worker.fetch(request(secret), env)).status, 503);
    assert.equal((await worker.fetch(new Request('https://relay.example/api/test', { method: 'POST' }), env)).status, 503);
  } finally { globalThis.fetch = originalFetch; }
});
