import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const otherSessionId = '44444444-4444-4444-8444-444444444444';
const tokenHash = 'a'.repeat(64);
const now = Date.parse('2026-01-01T12:00:00.000Z');

function fakeDb(initial) {
  const values = new Map(Object.entries(initial));
  const ref = (collection, id) => ({ path: `${collection}/${id}`, id, collection });
  const snapshot = target => {
    const value = values.get(target.path);
    return { exists: value !== undefined, id: target.id, ref: target, data: () => structuredClone(value) };
  };
  const db = {
    values,
    collection(collection) {
      return {
        doc(id) { return ref(collection, id); },
        where(field, operator, value) { return { kind: 'query', collection, field, operator, value }; },
      };
    },
    async runTransaction(work) {
      const tx = {
        async get(target) {
          if (target.kind === 'query') {
            const docs = [...values.entries()]
              .filter(([path, value]) => path.startsWith(`${target.collection}/`) && value?.[target.field] === target.value)
              .map(([path, value]) => ({ id: path.split('/').at(-1), ref: { path, id: path.split('/').at(-1) }, data: () => structuredClone(value) }));
            return { docs };
          }
          return snapshot(target);
        },
        update(target, patch) {
          const current = values.get(target.path);
          if (current === undefined) throw Error('missing');
          values.set(target.path, { ...current, ...structuredClone(patch) });
        },
      };
      return work(tx);
    },
  };
  return db;
}

function documents({ stale = false, revoked = false } = {}) {
  return {
    [`sessionTokenIndex/${tokenHash}`]: { sessionId, userId },
    [`sessions/${sessionId}`]: {
      sessionId, userId, assurance: 'passkey', authorizationVersion: stale ? 1 : 2,
      authenticatedAt: new Date('2026-01-01T11:00:00.000Z'), expiresAt: new Date('2026-01-02T11:00:00.000Z'),
      ...(revoked ? { revokedAt: new Date('2026-01-01T11:30:00.000Z') } : {}),
    },
    [`users/${userId}`]: { role: 'ADMIN', status: 'ATIVO', authorizationVersion: 2 },
  };
}

test('Firestore identity resolves session only from token index, session and current user epoch', async () => {
  const service = createFirestoreIdentityService({ db: fakeDb(documents()), now: () => now });
  assert.deepEqual(await service.readSession(tokenHash), {
    id: userId, sessionId, role: 'ADMIN', assurance: 'passkey', authenticatedAt: Date.parse('2026-01-01T11:00:00.000Z'),
    expiresAt: Date.parse('2026-01-02T11:00:00.000Z'), authorizationVersion: 2,
  });
});

test('Firestore identity fails closed for malformed, expired, revoked or stale sessions', async () => {
  await assert.rejects(createFirestoreIdentityService({ db: fakeDb(documents()), now: () => now }).readSession('bad'), { code: 'UNAUTHENTICATED', status: 401 });
  await assert.rejects(createFirestoreIdentityService({ db: fakeDb(documents({ stale: true })), now: () => now }).readSession(tokenHash), { code: 'UNAUTHENTICATED', status: 401 });
  await assert.rejects(createFirestoreIdentityService({ db: fakeDb(documents({ revoked: true })), now: () => now }).readSession(tokenHash), { code: 'UNAUTHENTICATED', status: 401 });
});

test('Firestore identity revocation is idempotent and does not revoke another user', async () => {
  const db = fakeDb({
    ...documents(),
    [`sessions/${otherSessionId}`]: { sessionId: otherSessionId, userId, assurance: 'passkey', authorizationVersion: 2, authenticatedAt: new Date('2026-01-01T10:00:00.000Z'), expiresAt: new Date('2026-01-02T10:00:00.000Z') },
    [`sessions/${otherUserId}`]: { sessionId: otherUserId, userId: otherUserId, assurance: 'passkey', authorizationVersion: 2, authenticatedAt: new Date('2026-01-01T10:00:00.000Z'), expiresAt: new Date('2026-01-02T10:00:00.000Z') },
  });
  const service = createFirestoreIdentityService({ db, now: () => now });
  assert.deepEqual(await service.revokeSession(tokenHash), { revoked: true });
  assert.ok(db.values.get(`sessions/${sessionId}`).revokedAt);
  assert.deepEqual(await service.revokeSession(tokenHash), { revoked: true });
  const result = await service.revokeOtherSessions(tokenHash);
  assert.equal(result.revoked, true);
  assert.equal(result.revokedSessions, 1);
  assert.ok(db.values.get(`sessions/${otherSessionId}`).revokedAt);
  assert.equal(db.values.get(`sessions/${otherUserId}`).revokedAt, undefined);
});
