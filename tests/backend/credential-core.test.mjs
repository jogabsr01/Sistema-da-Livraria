import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPinHasher, createSessionTokens } from '../../backend/credential-core.mjs';
const config = () => ({ environment: 'dev', installationId: randomUUID(), pepper: randomBytes(32), tokenKey: randomBytes(32) });

test('PINs use per-record salts and verify without storing the input', async () => {
  const hasher = createPinHasher(config()), id = randomUUID(), pin = '2468';
  const a = await hasher.hash(pin, id), b = await hasher.hash(pin, id);
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.hash, b.hash);
  assert.deepEqual(Object.keys(a).sort(), ['algorithm', 'hash', 'salt', 'version']);
  assert.equal(await hasher.verify(pin, id, a), true);
  assert.equal(await hasher.verify('8642', id, a), false);
});

test('PIN verifier is bound to account, installation, environment and server pepper', async () => {
  const c = config(), id = randomUUID(), record = await createPinHasher(c).hash('2468', id);
  assert.equal(await createPinHasher(c).verify('2468', randomUUID(), record), false);
  for (const changed of [{ environment: 'prod' }, { installationId: randomUUID() }, { pepper: randomBytes(32) }]) {
    assert.equal(await createPinHasher({ ...c, ...changed }).verify('2468', id, record), false);
  }
});

test('malformed verifier records and KDF substitutions fail closed', async () => {
  const hasher = createPinHasher(config()), id = randomUUID(), record = await hasher.hash('2468', id);
  for (const changed of [{ hash: 'x'.repeat(64) }, { salt: '' }, { algorithm: 'scrypt-N1' }, { version: 2 }, { hash: record.hash.slice(2) }]) {
    assert.equal(await hasher.verify('2468', id, { ...record, ...changed }), false);
  }
  for (const pin of [2468, '123', '12345', 'abcd', '', null]) {
    await assert.rejects(hasher.hash(pin, id), { code: 'INVALID_PIN' });
    assert.equal(await hasher.verify(pin, id, record), false);
  }
});

test('credential factories reject absent or malformed private configuration', () => {
  for (const c of [undefined, {}, { ...config(), pepper: 'not-a-key' }, { ...config(), environment: 'preview' }]) {
    assert.throws(() => createPinHasher(c), { code: 'CREDENTIAL_CONFIGURATION_UNAVAILABLE' });
  }
  assert.throws(() => createSessionTokens({ ...config(), tokenKey: Buffer.alloc(1) }), { code: 'CREDENTIAL_CONFIGURATION_UNAVAILABLE' });
});

test('session tokens are random, hash-only at rest, scoped and canonical', () => {
  const c = config(), service = createSessionTokens(c), a = service.issue(), b = service.issue();
  assert.notEqual(a.rawToken, b.rawToken); assert.equal(a.rawToken.length, 43);
  assert.equal(a.tokenHash.length, 64); assert.equal(service.hash(a.rawToken), a.tokenHash);
  assert.notEqual(createSessionTokens({ ...c, environment: 'prod' }).hash(a.rawToken), a.tokenHash);
  assert.notEqual(createSessionTokens({ ...c, tokenKey: randomBytes(32) }).hash(a.rawToken), a.tokenHash);
  assert.notEqual(createSessionTokens({ ...c, installationId: randomUUID() }).hash(a.rawToken), a.tokenHash);
  for (const token of ['', null, 'x'.repeat(42), 'A'.repeat(42) + 'B']) assert.throws(() => service.hash(token), { code: 'INVALID_SESSION_TOKEN' });
});
