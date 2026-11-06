import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreNotificationService } from '../../backend/firestore-notifications.mjs';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const adminId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const productId = '66666666-6666-4666-8666-666666666666';
const notificationId = '77777777-7777-4777-8777-777777777777';
const commandId = '88888888-8888-4888-8888-888888888888';
const tokenHash = 'a'.repeat(64);
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
            const docs = [...store.entries()].filter(([path, value]) => path.startsWith(`${target.collection}/`) && path.split('/').length === depth + 1 &&
              (target.kind === 'collection' || value?.[target.field] === target.value)).map(([path, value]) => ({ id: path.split('/').at(-1), ref: { path, id: path.split('/').at(-1) }, exists: true, data: () => structuredClone(value) }));
            return { docs };
          }
          const value = store.get(target.path);
          return { exists: value !== undefined, id: target.id, ref: target, data: () => structuredClone(value) };
        },
        create(target, value) { if (store.has(target.path)) throw Object.assign(new Error('exists'), { code: 6 }); store.set(target.path, structuredClone(value)); },
        update(target, value) { if (!store.has(target.path)) throw Error('missing'); store.set(target.path, { ...store.get(target.path), ...structuredClone(value) }); },
        set(target, value) { store.set(target.path, structuredClone(value)); },
        delete(target) { store.delete(target.path); },
      };
      return work(tx);
    },
  };
  return db;
}

function makeService(role = 'ATENDENTE') {
  const subject = role === 'ADMIN' ? adminId : userId;
  const db = fakeDb({
    [`sessionTokenIndex/${tokenHash}`]: { sessionId, userId: subject },
    [`sessions/${sessionId}`]: { sessionId, userId: subject, assurance: 'passkey', authorizationVersion: 2, authenticatedAt: new Date('2026-01-01T11:59:00.000Z'), expiresAt: new Date('2026-01-02T11:00:00.000Z') },
    [`users/${subject}`]: { role, status: 'ATIVO', authorizationVersion: 2 },
    [`products/${productId}`]: { stock: 0, minimumStock: 2 },
    [`notifications/${notificationId}`]: { id: notificationId, type: 'STOCK_ZERO', priority: 'ALTA', title: 'Livro', message: 'Estoque atual: 0. Estoque mínimo: 2.', referenceId: productId, state: 'ABERTA', createdAt: new Date('2026-01-01T10:00:00.000Z'), resolvedAt: null, audience: 'ALL_STAFF' },
  });
  const identity = createFirestoreIdentityService({ db, now: () => now });
  return { db, service: createFirestoreNotificationService({ db, identityService: identity, config: { adminPinLogin: false }, now: () => now }) };
}

test('Firestore notifications lists stock alerts, summary and personal read overlay', async () => {
  const { db, service } = makeService();
  const result = await service.execute('bootstrap', { sessionTokenHash: tokenHash }, { offset: 0, history: false });
  assert.equal(result.total, 1);
  assert.equal(result.summary.unread, 1);
  assert.equal(result.items[0].stock, 0);
  assert.equal(result.items[0].minimumStock, 2);
  assert.equal(result.principal.id, userId);
  assert.deepEqual(await service.execute('read', { sessionTokenHash: tokenHash }, { id: notificationId }), { read: true });
  assert.ok(db.values.get(`notificationRecipients/${notificationId}:${userId}`).readAt);
  const after = await service.execute('summary', { sessionTokenHash: tokenHash }, {});
  assert.deepEqual(after, { total: 1, unread: 0 });
});

test('Firestore notification state is an idempotent administrative transaction', async () => {
  const { db, service } = makeService('ADMIN');
  const payload = { commandId, id: notificationId, state: 'EM_ATENDIMENTO' };
  assert.deepEqual(await service.execute('state', { sessionTokenHash: tokenHash }, payload), { accepted: true });
  assert.equal(db.values.get(`notifications/${notificationId}`).state, 'EM_ATENDIMENTO');
  assert.deepEqual(await service.execute('state', { sessionTokenHash: tokenHash }, payload), { accepted: true });
});

test('Firestore notification visibility blocks maintenance from attendants', async () => {
  const { db, service } = makeService();
  db.values.set('notifications/99999999-9999-4999-8999-999999999999', { id: '99999999-9999-4999-8999-999999999999', type: 'MAINTENANCE_COMPLETED', priority: 'MEDIA', title: 'Manutenção', message: 'Concluída', referenceId: productId, state: 'ABERTA', createdAt: new Date(), resolvedAt: null, audience: 'ADMINS' });
  const result = await service.execute('list', { sessionTokenHash: tokenHash }, { offset: 0, history: true });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].type, 'STOCK_ZERO');
});
