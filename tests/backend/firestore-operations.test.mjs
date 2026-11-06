import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreOperationsService } from '../../backend/firestore-operations.mjs';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '33333333-3333-4333-8333-333333333333';
const productId = '66666666-6666-4666-8666-666666666666';
const saleId = '77777777-7777-4777-8777-777777777777';
const adjustId = '88888888-8888-4888-8888-888888888888';
const reverseId = '99999999-9999-4999-8999-999999999999';
const tokenHash = 'a'.repeat(64);
const now = Date.parse('2026-01-01T12:00:00.000Z');

function product(stock = 1) {
  return { isbn: '', internalCode: 'INTBOOK123', title: 'Livro', author: 'Autor', publisher: 'Editora', edition: '', supplier: 'Fornecedor',
    priceCents: 1200, minimumStock: 1, category: 'Categoria', coverUrl: '', year: 2020, pages: 100, synopsis: 'Sinopse',
    nicheIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], active: true, stock, version: 1,
    updatedAt: new Date('2026-01-01T11:00:00.000Z'), hasPhoto: false };
}
function fakeDb(values) {
  const store = new Map(Object.entries(values));
  const makeRef = (collection, id) => ({ path: id === undefined ? collection : `${collection}/${id}`, id,
    collection: child => { const path = id === undefined ? `${collection}/${child}` : `${collection}/${id}/${child}`; return { kind: 'collection', collection: path, doc: childId => makeRef(path, childId) }; } });
  const db = {
    values: store,
    collection(collection) { return { kind: 'collection', collection, doc: id => makeRef(collection, id), where: (field, operator, value) => ({ kind: 'query', collection, field, operator, value }) }; },
    async runTransaction(work) {
      const tx = {
        async get(target) {
          if (target.kind === 'collection' || target.kind === 'query') {
            const docs = [...store.entries()].filter(([path, value]) => path.startsWith(`${target.collection}/`) && path.split('/').length === target.collection.split('/').length + 1 &&
              (target.kind === 'collection' || value?.[target.field] === target.value)).map(([path, value]) => ({
              id: path.split('/').at(-1), ref: { path, id: path.split('/').at(-1) }, exists: true, data: () => structuredClone(value),
            }));
            return { docs };
          }
          const value = store.get(target.path);
          return { exists: value !== undefined, id: target.id, ref: target, data: () => structuredClone(value) };
        },
        set(target, value) { store.set(target.path, structuredClone(value)); },
        create(target, value) { if (store.has(target.path)) throw Object.assign(new Error('exists'), { code: 6 }); store.set(target.path, structuredClone(value)); },
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
    [`users/${userId}`]: { role: 'ADMIN', status: 'ATIVO', authorizationVersion: 2 },
    [`products/${productId}`]: product(),
    ...values,
  });
  const identity = createFirestoreIdentityService({ db, now: () => now });
  return { db, service: createFirestoreOperationsService({ db, identityService: identity, config: { adminPinLogin: false }, now: () => now }) };
}

test('Firestore adjustment atomically changes stock, movement, event, audit and command', async () => {
  const { db, service } = makeService();
  const payload = { commandId: adjustId, id: productId, expectedVersion: 1, newStock: 5, reason: 'Contagem física' };
  const result = await service.execute('adjust', { sessionTokenHash: tokenHash }, payload);
  assert.equal(result.stockBefore, 1);
  assert.equal(result.stockAfter, 5);
  assert.equal(result.version, 2);
  assert.equal(db.values.get(`stockMovements/${adjustId}:${productId}`).type, 'AJUSTE');
  assert.equal(db.values.get(`commands/operations:${adjustId}`).state, 'COMMITTED');
  assert.deepEqual(await service.execute('adjust', { sessionTokenHash: tokenHash }, payload), result);
});

test('Firestore sale reversal restores stock, cancels sale and records the reversal atomically', async () => {
  const { db, service } = makeService({
    [`sales/${saleId}`]: { id: saleId, idempotencyKey: saleId, status: 'CONFIRMADA', totalCents: 1200, paymentMethod: 'PIX', customerId: null, attendantId: userId },
    [`sales/${saleId}/items/${productId}`]: { productId, quantity: 1, title: 'Livro', unitPriceCents: 1200, subtotalCents: 1200 },
  });
  const result = await service.execute('reverse', { sessionTokenHash: tokenHash }, { commandId: reverseId, saleId, reason: 'Cancelamento' });
  assert.deepEqual(result, { commandId: reverseId, saleId, state: 'CANCELADA', totalCents: 1200, paymentMethod: 'PIX', createdAt: '2026-01-01T12:00:00.000Z' });
  assert.equal(db.values.get(`products/${productId}`).stock, 2);
  assert.equal(db.values.get(`products/${productId}`).version, 2);
  assert.equal(db.values.get(`sales/${saleId}`).status, 'CANCELADA');
  assert.equal(db.values.get(`stockMovements/${reverseId}:${productId}`).type, 'ESTORNO');
  assert.equal(db.values.get(`domainEvents/operations:${reverseId}`).type, 'SALE_REVERSED');
});

test('Firestore operations reject stale versions and already cancelled sales', async () => {
  const stale = makeService();
  await assert.rejects(stale.service.execute('adjust', { sessionTokenHash: tokenHash }, { commandId: adjustId, id: productId, expectedVersion: 2, newStock: 5, reason: 'Contagem' }), { code: 'OPERATION_CONFLICT', status: 409 });
  const cancelled = makeService({ [`sales/${saleId}`]: { id: saleId, status: 'CANCELADA', totalCents: 1200, paymentMethod: 'PIX' } });
  await assert.rejects(cancelled.service.execute('reverse', { sessionTokenHash: tokenHash }, { commandId: reverseId, saleId, reason: 'Cancelamento' }), { code: 'OPERATION_CONFLICT', status: 409 });
});

test('Firestore operations lists sales and returns item details with current state', async () => {
  const { service } = makeService({
    [`sales/${saleId}`]: { id: saleId, idempotencyKey: saleId, status: 'CONFIRMADA', totalCents: 1200, paymentMethod: 'PIX', customerId: null, attendantId: userId, createdAt: new Date('2026-01-01T11:30:00.000Z') },
    [`sales/${saleId}/items/${productId}`]: { productId, quantity: 1, title: 'Livro', unitPriceCents: 1200, subtotalCents: 1200 },
  });
  const list = await service.execute('list', { sessionTokenHash: tokenHash }, { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T23:59:59.000Z', offset: 0 });
  assert.equal(list.total, 1);
  assert.equal(list.sales[0].saleId, saleId);
  assert.deepEqual((await service.execute('get', { sessionTokenHash: tokenHash }, { id: saleId })).sale.items[0], { productId, title: 'Livro', quantity: 1, unitPriceCents: 1200, subtotalCents: 1200 });
});

test('Firestore stock reconciliation detects a broken movement chain', async () => {
  const changed = product(2); changed.version = 2;
  const { db } = makeService({
    [`products/${productId}`]: changed,
    [`stockMovements/movement-1`]: { id: 'movement-1', productId, type: 'ENTRADA', quantity: 1, stockBefore: 1, stockAfter: 2, versionBefore: 1, versionAfter: 2 },
  });
  const { reconcileFirestoreStock } = await import('../../backend/firestore-operations.mjs');
  const ok = await reconcileFirestoreStock({ db, now: () => now });
  assert.deepEqual(ok.mismatches, []);
  db.values.set('products/' + productId, { ...changed, stock: 1 });
  const broken = await reconcileFirestoreStock({ db, now: () => now });
  assert.equal(broken.mismatches[0].code, 'PROJECTION_CONFLICT');
});
