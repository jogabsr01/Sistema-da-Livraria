import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreAuditService } from '../../backend/firestore-audit.mjs';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';

const adminId = '11111111-1111-4111-8111-111111111111';
const sessionId = '33333333-3333-4333-8333-333333333333';
const productId = '66666666-6666-4666-8666-666666666666';
const tokenHash = 'a'.repeat(64);
const now = Date.parse('2026-01-01T12:00:00.000Z');
const config = { environment: 'dev', installationId: adminId, secret: 'ab'.repeat(32), adminPinLogin: false };
const filters = { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T23:59:59.000Z', employeeId: '', operation: '', productId: '', saleId: '', result: '' };

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
      };
      return work(tx);
    },
  };
  return db;
}

test('Firestore audit lists sanitized events and exports the same snapshot', async () => {
  const eventId = 'audit-event-1';
  const db = fakeDb({
    [`sessionTokenIndex/${tokenHash}`]: { sessionId, userId: adminId },
    [`sessions/${sessionId}`]: { sessionId, userId: adminId, assurance: 'passkey', authorizationVersion: 2, authenticatedAt: new Date('2026-01-01T11:59:00.000Z'), expiresAt: new Date('2026-01-02T11:00:00.000Z') },
    [`users/${adminId}`]: { id: adminId, role: 'ADMIN', status: 'ATIVO', owner: true, contact: '', authorizationVersion: 2 },
    [`auditEvents/${eventId}`]: { id: eventId, at: '2026-01-01T10:00:00.000Z', actorId: adminId, role: 'ADMIN', operation: 'PRODUCT_UPDATE', entity: 'Produtos', entityId: productId,
      result: 'SUCESSO', requestId: eventId, before: { version: 1, secret: 'omit' }, after: { version: 2, stock: 1 }, detailsOmitted: true },
  });
  const identity = createFirestoreIdentityService({ db, now: () => now });
  const service = createFirestoreAuditService({ db, identityService: identity, config, now: () => now });
  const list = await service.execute('list', { sessionTokenHash: tokenHash }, { filters, offset: 0, snapshot: '' });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].after.stock, 1);
  assert.equal(list.items[0].before.secret, undefined);
  const exported = await service.execute('export', { sessionTokenHash: tokenHash }, { commandId: eventId, filters, snapshot: list.snapshot });
  assert.equal(exported.items.length, 1);
  assert.equal(exported.snapshot, list.snapshot);
});
