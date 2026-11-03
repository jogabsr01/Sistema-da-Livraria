import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createFirestoreAccessService } from '../../backend/firestore-access.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const flowId = '22222222-2222-4222-8222-222222222222';
const tokenHash = 'a'.repeat(64);
const sessionTokenHash = 'b'.repeat(64);
const installationId = '33333333-3333-4333-8333-333333333333';
const email = 'owner@example.invalid';
const secret = 'ab'.repeat(32);
const emailIndex = createHmac('sha256', Buffer.from(secret, 'hex')).update(JSON.stringify(['identity.email.v1', 'dev', installationId, email])).digest('hex');
const config = { environment: 'dev', installationId, secret, firestore: { mode: 'firestore', emailDeliveryKey: randomBytes(32) } };

function fakeDb(initial = {}) {
  const values = new Map(Object.entries(initial));
  const ref = (collection, id) => ({ path: `${collection}/${id}`, id, collection: child => ({ kind: 'collection', collection: `${collection}/${id}/${child}`, doc: childId => ref(`${collection}/${id}/${child}`, childId) }) });
  const snapshot = target => { const value = values.get(target.path); return { exists: value !== undefined, id: target.id, ref: target, data: () => structuredClone(value) }; };
  const docsFor = target => [...values.entries()].filter(([path, value]) => path.startsWith(`${target.collection}/`) && path.split('/').length === target.collection.split('/').length + 1 && (!target.field || value?.[target.field] === target.value)).map(([path, value]) => ({ id: path.split('/').at(-1), ref: ref(target.collection, path.split('/').at(-1)), exists: true, data: () => structuredClone(value) }));
  const db = {
    values,
    collection(collection) { return { collection, doc: id => ref(collection, id), where: (field, operator, value) => ({ kind: 'query', collection, field, operator, value }) }; },
    async runTransaction(work) {
      const tx = {
        async get(target) { if (target.kind === 'query') return { docs: docsFor(target) }; if (target.kind === 'collection') return { docs: docsFor(target) }; return snapshot(target); },
        create(target, value) { if (values.has(target.path)) throw Object.assign(new Error('exists'), { code: 6 }); values.set(target.path, structuredClone(value)); },
        set(target, value) { values.set(target.path, structuredClone(value)); },
        update(target, value) { if (!values.has(target.path)) throw Error('missing'); values.set(target.path, { ...values.get(target.path), ...structuredClone(value) }); },
        delete(target) { values.delete(target.path); },
      };
      return work(tx);
    },
  };
  return db;
}
function baseDb() {
  return fakeDb({ [`users/${userId}`]: { id: userId, owner: true, emailIndex, role: 'SUPER_ADMIN', status: 'ATIVO', authorizationVersion: 1, activated: false, firstAccessCompleted: false } });
}
function passwordRecord() { return { version: 1, credentialType: 'PASSWORD_V1', algorithm: 'scrypt-N32768-r8-p1', salt: '11'.repeat(32), hash: '22'.repeat(32) }; }

test('Firestore access stores PASSWORD_V1 activation intent, encrypted delivery and one-use email proof', async () => {
  const db = baseDb(), service = createFirestoreAccessService({ db, config, now: () => Date.parse('2026-01-01T12:00:00.000Z') });
  const codeHash = 'c'.repeat(64);
  assert.deepEqual(await service.start({ email, flowId, tokenHash, codeHash, code: 'ABCDEFG' }), { accepted: true, outcome: 'SENT' });
  const outbox = db.values.get(`outbox/email:auth:${tokenHash}`);
  assert.ok(outbox);
  assert.equal(JSON.stringify(outbox).includes('ABCDEFG'), false);
  assert.deepEqual(await service.email({ tokenHash, codeHash }), { verified: true });
  await assert.rejects(service.email({ tokenHash, codeHash }), { code: 'ACCESS_REJECTED', status: 401 });
  assert.deepEqual(await service.password({ tokenHash, record: JSON.stringify(passwordRecord()) }), { stored: true });
  assert.equal((await service.read({ tokenHash })).state, 'PASSKEY');
});

test('Firestore access commits a passkey-backed activation exactly once with a 24-hour session', async () => {
  const db = baseDb(), service = createFirestoreAccessService({ db, config, now: () => Date.parse('2026-01-01T12:00:00.000Z') });
  const codeHash = 'd'.repeat(64);
  await service.start({ email, flowId, tokenHash, codeHash, code: 'BCDEFGH' });
  await service.email({ tokenHash, codeHash });
  await service.password({ tokenHash, record: JSON.stringify(passwordRecord()) });
  const options = await service.prepareOptions({ tokenHash, ceremonyId: '44444444-4444-4444-8444-444444444444', challenge: 'A'.repeat(43) });
  assert.equal(options.kind, 'create');
  await service.saveProof({ tokenHash, method: 'registerPasskey', command: {
    subjectId: userId, authorizationVersion: 1, ceremonyId: options.ceremonyId, credentialId: randomBytes(32).toString('base64url'), publicKey: randomBytes(32).toString('base64url'), counter: 0, transports: ['internal'],
  } });
  const principal = await service.commit({ tokenHash, sessionTokenHash });
  assert.equal(principal.assurance, 'passkey');
  assert.equal(principal.expiresAt - principal.authenticatedAt, 86400000);
  assert.equal(db.values.get(`users/${userId}/credentials/primary`).credentialType, 'PASSWORD_V1');
  assert.deepEqual(await service.commit({ tokenHash, sessionTokenHash }), principal);
});
