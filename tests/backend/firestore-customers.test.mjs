import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreCustomerService } from '../../backend/firestore-customers.mjs';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '33333333-3333-4333-8333-333333333333';
const customerId = '66666666-6666-4666-8666-666666666666';
const duplicateId = '77777777-7777-4777-8777-777777777777';
const commandId = '88888888-8888-4888-8888-888888888888';
const tokenHash = 'a'.repeat(64);
const cpfIndex = 'b'.repeat(64);
const now = Date.parse('2026-01-01T12:00:00.000Z');

function fakeDb(values) {
  const store = new Map(Object.entries(values));
  const ref = (collection, id) => ({ path: `${collection}/${id}`, id, collection: child => ({ kind: 'collection', collection: `${collection}/${id}/${child}`, doc: childId => ref(`${collection}/${id}/${child}`, childId) }) });
  const db = {
    values: store,
    collection(collection) { return { kind: 'collection', collection, doc: id => ref(collection, id), where: (field, operator, value) => ({ kind: 'query', collection, field, operator, value }) }; },
    async runTransaction(work) {
      const tx = {
        async get(target) {
          if (target.kind === 'collection' || target.kind === 'query') {
            const depth = target.collection.split('/').length;
            const docs = [...store.entries()].filter(([path, value]) => path.startsWith(`${target.collection}/`) && path.split('/').length === depth + 1 && (target.kind === 'collection' || value?.[target.field] === target.value)).map(([path, value]) => ({ id: path.split('/').at(-1), ref: { path, id: path.split('/').at(-1) }, exists: true, data: () => structuredClone(value) }));
            return { docs };
          }
          const value = store.get(target.path);
          return { exists: value !== undefined, id: target.id, ref: target, data: () => structuredClone(value) };
        },
        set(target, value) { store.set(target.path, structuredClone(value)); },
        create(target, value) { if (store.has(target.path)) throw Error('exists'); store.set(target.path, structuredClone(value)); },
        update(target, value) { if (!store.has(target.path)) throw Error('missing'); store.set(target.path, { ...store.get(target.path), ...structuredClone(value) }); },
        delete(target) { store.delete(target.path); },
      };
      return work(tx);
    },
  };
  return db;
}
function makeService(values = {}) {
  const db = fakeDb({
    [`sessionTokenIndex/${tokenHash}`]: { sessionId, userId },
    [`sessions/${sessionId}`]: { sessionId, userId, assurance: 'passkey', authorizationVersion: 2, authenticatedAt: new Date('2026-01-01T11:59:00.000Z'), expiresAt: new Date('2026-01-02T11:00:00.000Z') },
    [`users/${userId}`]: { role: 'ATENDENTE', status: 'ATIVO', authorizationVersion: 2 },
    [`customers/${customerId}`]: { id: customerId, revision: 1, contact: 'ciphertext', cpfIndex, contactPreference: 'NONE', marketingConsent: false, createdAt: '2026-01-01T10:00:00.000Z', lastPurchase: '', consentAt: '' },
    ...values,
  });
  const identity = createFirestoreIdentityService({ db, now: () => now });
  return { db, service: createFirestoreCustomerService({ db, identityService: identity, config: {}, now: () => now }) };
}

test('Firestore customers finds and saves encrypted contacts with CPF reservation', async () => {
  const { db, service } = makeService();
  assert.equal((await service.execute('find', { sessionTokenHash: tokenHash }, { cpfIndex })).customer.id, customerId);
  const result = await service.execute('save', { sessionTokenHash: tokenHash }, { commandId, id: customerId, expectedRevision: 1, contact: 'new-ciphertext', cpfIndex, fingerprint: 'c'.repeat(64), contactPreference: 'EMAIL', marketingConsent: true });
  assert.deepEqual(result, { id: customerId, revision: 2 });
  assert.equal(db.values.get(`customers/${customerId}`).revision, 2);
  assert.equal(db.values.get(`commands/customers:${commandId}`).state, 'COMMITTED');
  assert.deepEqual(await service.execute('save', { sessionTokenHash: tokenHash }, { commandId, id: customerId, expectedRevision: 1, contact: 'new-ciphertext', cpfIndex, fingerprint: 'c'.repeat(64), contactPreference: 'EMAIL', marketingConsent: true }), result);
});

test('Firestore customers rejects duplicate CPF indexes and stale revisions', async () => {
  const duplicate = makeService({ [`customers/${duplicateId}`]: { id: duplicateId, revision: 1, contact: 'ciphertext', cpfIndex: 'd'.repeat(64), contactPreference: 'NONE', marketingConsent: false, createdAt: '2026-01-01T10:00:00.000Z', lastPurchase: '', consentAt: '' }, [`uniqueness/customer-cpf:${'b'.repeat(64)}`]: { ownerId: duplicateId } });
  await assert.rejects(duplicate.service.execute('save', { sessionTokenHash: tokenHash }, { commandId, id: customerId, expectedRevision: 1, contact: 'x', cpfIndex, fingerprint: 'c'.repeat(64), contactPreference: 'NONE', marketingConsent: false }), { code: 'CUSTOMER_DUPLICATE', status: 409 });
  const stale = makeService();
  await assert.rejects(stale.service.execute('save', { sessionTokenHash: tokenHash }, { commandId, id: customerId, expectedRevision: 2, contact: 'x', cpfIndex, fingerprint: 'c'.repeat(64), contactPreference: 'NONE', marketingConsent: false }), { code: 'CUSTOMER_CONFLICT', status: 409 });
});
