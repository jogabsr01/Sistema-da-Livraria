import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupResendEmail, sendResendEmail } from '../../backend/email-provider.mjs';

const providerId = '11111111-1111-4111-8111-111111111111';

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return body; } };
}

test('Resend send carries the stable idempotency key and returns the provider id', async () => {
  let request;
  const result = await sendResendEmail({ apiKey: 're_test', from: 'Livraria <dev@example.invalid>', to: 'owner@example.invalid', subject: 'Código', text: 'Mensagem', idempotencyKey: 'email:one', fetchImpl: async (...args) => { request = args; return response(200, { id: providerId }); } });
  assert.deepEqual(result, { id: providerId });
  assert.equal(request[0], 'https://api.resend.com/emails');
  assert.equal(request[1].headers['idempotency-key'], 'email:one');
  assert.equal(JSON.parse(request[1].body).text, 'Mensagem');
});

test('Resend transport failure is classified as an unresolved result', async () => {
  await assert.rejects(sendResendEmail({ apiKey: 're_test', from: 'Livraria <dev@example.invalid>', to: 'owner@example.invalid', subject: 'Código', text: 'Mensagem', idempotencyKey: 'email:two', fetchImpl: async () => { throw Error('timeout'); } }), { code: 'EMAIL_DELIVERY_RESULT_UNKNOWN', status: 503 });
});

test('Resend lookup distinguishes a confirmed email from a definitive miss', async () => {
  let calls = 0;
  const found = await lookupResendEmail({ apiKey: 're_test', providerId, fetchImpl: async url => { calls++; assert.equal(url, `https://api.resend.com/emails/${providerId}`); return response(200, { id: providerId, last_event: 'delivered' }); } });
  assert.deepEqual(found, { status: 'FOUND', id: providerId, lastEvent: 'delivered' });
  const missing = await lookupResendEmail({ apiKey: 're_test', providerId, fetchImpl: async () => response(404, {}) });
  assert.deepEqual(missing, { status: 'NOT_FOUND' });
  assert.equal(calls, 1);
});
