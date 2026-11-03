import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';
import { createFirestoreKeyManagementService } from '../../backend/firestore-key-management.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const otherSessionId = '33333333-3333-4333-8333-333333333333';
const tokenHash = 'a'.repeat(64);
const now = Date.parse('2026-01-01T12:00:00.000Z');
const installationId = '44444444-4444-4444-8444-444444444444';
const secret = 'ab'.repeat(32);
const config = { environment: 'dev', installationId, secret, emergencyRecoveryEnabled: true };

function ref(path, id = path.split('/').at(-1)) {
  return { path, id, collection: child => ({ kind: 'collection', collection: `${path}/${child}`, doc: childId => ref(`${path}/${child}/${childId}`, childId) }) };
}

function fakeDb(initial = {}) {
  const values = new Map(Object.entries(initial));
  const docsFor = target => [...values.entries()]
    .filter(([path, value]) => path.startsWith(`${target.collection}/`) && path.split('/').length === target.collection.split('/').length + 1 &&
      (!target.field || value?.[target.field] === target.value))
    .map(([path, value]) => ({ id: path.split('/').at(-1), ref: ref(path), exists: true, data: () => structuredClone(value) }));
  const db = {
    values,
    collection(collection) {
      return { kind: 'collection', collection, doc: id => ref(`${collection}/${id}`, id), where: (field, operator, value) => ({ kind: 'query', collection, field, operator, value }) };
    },
    async runTransaction(work) {
      const tx = {
        async get(target) {
          if (target.kind === 'collection' || target.kind === 'query') return { docs: docsFor(target) };
          const value = values.get(target.path);
          return { exists: value !== undefined, id: target.id, ref: target, data: () => structuredClone(value) };
        },
        create(target, value) {
          if (values.has(target.path)) throw Object.assign(new Error('exists'), { code: 6 });
          values.set(target.path, structuredClone(value));
        },
        set(target, value) { values.set(target.path, structuredClone(value)); },
        update(target, value) {
          if (!values.has(target.path)) throw Error(`missing:${target.path}`);
          values.set(target.path, { ...values.get(target.path), ...structuredClone(value) });
        },
        delete(target) { values.delete(target.path); },
      };
      return work(tx);
    },
  };
  return db;
}

function key(id = randomBytes(32).toString('base64url'), counter = 0) {
  return { id, publicKey: randomBytes(32).toString('base64url'), counter, transports: ['internal'], createdAt: new Date(now), updatedAt: new Date(now), revokedAt: null, authorizationVersion: 1 };
}
function keyPath(value) { return `users/${userId}/passkeys/${createHash('sha256').update(value.id).digest('hex')}`; }
function actor() { return { sessionTokenHash: tokenHash }; }
function challenge() { return randomBytes(32).toString('base64url'); }
function startPayload(mode, target = '') { return { commandId: randomUUID(), mode, target, authId: randomUUID(), authChallenge: challenge(), regId: randomUUID(), regChallenge: challenge() }; }
function handle(credentialId) {
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(JSON.stringify(['dev', installationId, userId, credentialId])).digest('hex');
}
function makeService(extra = {}) {
  const first = key('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 0);
  const db = fakeDb({
    [`sessionTokenIndex/${tokenHash}`]: { sessionId, userId },
    [`sessions/${sessionId}`]: { sessionId, userId, assurance: 'passkey', authorizationVersion: 1, authenticatedAt: new Date(now - 1000), expiresAt: new Date(now + 86400000 - 1000), revokedAt: null },
    [`sessions/${otherSessionId}`]: { sessionId: otherSessionId, userId, assurance: 'passkey', authorizationVersion: 1, authenticatedAt: new Date(now - 2000), expiresAt: new Date(now + 86400000 - 2000), revokedAt: null },
    [`users/${userId}`]: { role: 'SUPER_ADMIN', status: 'ATIVO', authorizationVersion: 1 },
    [keyPath(first)]: first,
    ...extra,
  });
  const identity = createFirestoreIdentityService({ db, now: () => now });
  const service = createFirestoreKeyManagementService({ db, identityService: identity, config, now: () => now });
  return { db, service, first };
}

test('Firestore key management issues a recovery kit atomically and exposes only opaque handles', async () => {
  const { db, service, first } = makeService();
  const listed = await service.execute('list', actor());
  assert.equal(listed.keys.length, 1);
  assert.equal(listed.keys[0].id, handle(first.id));
  assert.equal(JSON.stringify(listed).includes(first.id), false);
  const start = startPayload('CODES');
  const auth = await service.execute('start', actor(), start);
  assert.equal(auth.stage, 'AUTH');
  assert.ok(db.values.has(`authChallenges/passkey:${start.authId}`));
  const complete = await service.execute('authorize', actor(), { commandId: start.commandId, ceremonyId: start.authId, credentialId: first.id, expectedCounter: 0, newCounter: 1 });
  assert.equal(complete.stage, 'REGISTER');
  const hashes = Array.from({ length: 6 }, (_, index) => `${String(index + 1).repeat(64)}`);
  const issued = await service.execute('codes', actor(), { commandId: start.commandId, hashes });
  assert.equal(issued.stage, 'COMPLETE');
  assert.equal(issued.count, 6);
  assert.deepEqual(db.values.get(`emergencyRecovery/${userId}`).entries.map(entry => entry.hash), hashes);
  assert.equal(db.values.get(`auditEvents/key-management:${start.commandId}`).operation, 'IDENTITY_RECOVERY_CODES_ISSUED');
  assert.deepEqual((await service.execute('list', actor())).recoveryKit, { active: true, remaining: 6 });
});

test('Firestore key management adds a passkey after proof and removes it with session revocation', async () => {
  const { db, service, first } = makeService();
  const add = startPayload('ADD');
  await service.execute('start', actor(), add);
  const registration = await service.execute('authorize', actor(), { commandId: add.commandId, ceremonyId: add.authId, credentialId: first.id, expectedCounter: 0, newCounter: 1 });
  assert.equal(registration.stage, 'REGISTER');
  const added = key();
  const done = await service.execute('register', actor(), { commandId: add.commandId, ceremonyId: add.regId, credentialId: added.id, publicKey: added.publicKey, counter: added.counter, transports: added.transports });
  assert.equal(done.stage, 'COMPLETE');
  assert.equal(done.count, 2);
  assert.equal(db.values.get(`users/${userId}/passkeys/${createHash('sha256').update(added.id).digest('hex')}`).id, added.id);

  const removal = startPayload('REMOVE', handle(first.id));
  await service.execute('start', actor(), removal);
  const removed = await service.execute('authorize', actor(), { commandId: removal.commandId, ceremonyId: removal.authId, credentialId: added.id, expectedCounter: 0, newCounter: 1 });
  assert.equal(removed.stage, 'COMPLETE');
  assert.equal(removed.count, 1);
  assert.ok(db.values.get(keyPath(first)).revokedAt instanceof Date);
  assert.ok(db.values.get(`sessions/${otherSessionId}`).revokedAt instanceof Date);
  assert.equal(db.values.get(`sessions/${sessionId}`).revokedAt, null);
  assert.equal(db.values.get(`auditEvents/key-management:${removal.commandId}`).operation, 'IDENTITY_PASSKEY_REMOVED');
});
