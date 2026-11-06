import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/v1/health.js';

test('Vercel health preserves the Netlify handler status and body', async () => {
  for (const [method, status, body] of [
    ['GET', 200, { ok: true }],
    ['POST', 405, { error: { code: 'METHOD_NOT_ALLOWED' } }],
  ]) {
    const response = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(value) { this.statusCode = value; return this; },
      send(value) { this.body = value; return this; },
    };
    await handler({ method }, response);
    assert.equal(response.statusCode, status);
    assert.deepEqual(JSON.parse(response.body.toString()), body);
    assert.match(response.headers['content-type'], /application\/json/);
  }
});