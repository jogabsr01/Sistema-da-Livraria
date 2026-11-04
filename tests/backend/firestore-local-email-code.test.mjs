import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sealEmailDelivery } from '../../backend/email-delivery-crypto.mjs';
import { assertLocalEmailCodeAccess, extractLocalCode } from '../../scripts/firestore-local-email-code.mjs';

const env = { APP_ENV: 'dev', WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIRESTORE_PROJECT_ID: 'demo-livraria', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
test('local code inspection requires an interactive terminal, explicit flag and exact emulator without provider credentials', () => {
  const args = ['--show-local-code'];
  assert.doesNotThrow(() => assertLocalEmailCodeAccess(env, args, true));
  for (const change of [{ APP_ENV: 'prod' }, { FIRESTORE_EMULATOR_HOST: 'localhost:8080' },
    { WORKSPACE_FIRESTORE_PROJECT_ID: 'real-project' }, { WORKSPACE_EMAIL_PROVIDER_KEY: 'secret' },
    { GOOGLE_APPLICATION_CREDENTIALS: '/private' }]) assert.throws(() => assertLocalEmailCodeAccess({ ...env, ...change }, args, true));
  assert.throws(() => assertLocalEmailCodeAccess(env, args, false));
  assert.throws(() => assertLocalEmailCodeAccess(env, [], true));
});
test('extracts only an authenticated pending activation code and rejects tampering', () => {
  const settings = { mode: 'firestore', emailDeliveryKey: randomBytes(32) }, id = 'auth:synthetic';
  const entry = { type: 'EMAIL_DELIVERY', state: 'PENDING', idempotencyKey: id,
    payload: { deliveryCiphertext: sealEmailDelivery(settings, 'body', id, 'Código de uso único (válido por 15 minutos):\nabcDEF1\nNão compartilhe') } };
  assert.equal(extractLocalCode(entry, settings), 'abcDEF1');
  assert.throws(() => extractLocalCode({ ...entry, state: 'SUCCEEDED' }, settings));
  assert.throws(() => extractLocalCode({ ...entry, idempotencyKey: 'auth:other' }, settings));
});