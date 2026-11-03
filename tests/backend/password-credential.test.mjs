import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPasswordHasher } from '../../backend/credential-core.mjs';

const configuration = { environment: 'dev', installationId: '11111111-1111-4111-8111-111111111111', pepper: randomBytes(32) };
const subject = '22222222-2222-4222-8222-222222222222';

test('PASSWORD_V1 preserves exact input, Unicode length and scrypt parameters', async () => {
  const hasher = createPasswordHasher(configuration);
  for (const value of ['1234567', '12345678', 'senha com espaços', '😀😀😀😀😀😀😀😀', 'x'.repeat(40), 'x'.repeat(41)]) {
    const valid = Array.from(value).length >= 8 && Array.from(value).length <= 40;
    assert.equal(hasher.valid(value), valid);
  }
  const record = await hasher.hash('  senha 123  ', subject);
  assert.equal(record.credentialType, 'PASSWORD_V1');
  assert.equal(record.algorithm, 'scrypt-N32768-r8-p1');
  assert.equal(await hasher.verify('  senha 123  ', subject, record), true);
  assert.equal(await hasher.verify('senha 123', subject, record), false);
  assert.equal(await hasher.verify('  senha 123  ', '33333333-3333-4333-8333-333333333333', record), false);
});
