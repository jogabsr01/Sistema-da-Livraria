import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreSalesService } from '../../backend/firestore-sales.mjs';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '33333333-3333-4333-8333-333333333333';
const productId = '66666666-6666-4666-8666-666666666666';
const customerId = '88888888-8888-4888-8888-888888888888';
const saleId = '99999999-9999-4999-8999-999999999999';
const tokenHash = 'a'.repeat(64);
const now = Date.parse('2026-01-01T12:00:00.000Z');

function product() {
  return { isbn: '', internalCode: 'INTBOOK123', title: 'Livro', author: 'Autor', publisher: 'Editora', edition: '', supplier: 'Fornecedor',
    priceCents: 1200, minimumStock: 1, category: 'Categoria', coverUrl: '', year: 2020, pages: 100, synopsis: 'Sinopse',
    nicheIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], active: true, stock: 2, version: 1,
    updatedAt: new Date('2026-01-01T11:00:00.000Z'), hasPhoto: false };
}

function fakeDb(values) {
  const store = new Map(Object.entries(values));
  const makeRef = (collection, id) => ({ path: id === undefined ? collection : `${collection}/${id}`, id, collection: child => ({ doc: childId => makeRef(id === undefined ? `${collection}/${child}` : `${collection}/${id}/${child}`, childId) }) });
  const db = {
    values: store,
    collection(collection) {
      return { kind: 'collection', collection, name: collection, doc: id => makeRef(collection, id), where: (field, operator, value) => ({ kind: 'query', collection, field, operator, value }) };
    },
    async runTransaction(work) {
      const tx = {
        async get(target) {
          if (target.kind === 'collection' || target.kind === 'query') {
            const docs = [...store.entries()].filter(([path, value]) => path.startsWith(`${target.collection}/`) &&
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
    [`sessions/${sessionId}`]: { sessionId, userId, assurance: 'passkey', authorizationVersion: 2, authenticatedAt: new Date('2026-01-01T11:00:00.000Z'), expiresAt: new Date('2026-01-02T11:00:00.000Z') },
    [`users/${userId}`]: { role: 'ATENDENTE', status: 'ATIVO', authorizationVersion: 2 },
    [`products/${productId}`]: product(),
    [`customers/${customerId}`]: { id: customerId, revision: 1, lastPurchaseAt: null },
    ...values,
  });
  const identity = createFirestoreIdentityService({ db, now: () => now });
  return { db, service: createFirestoreSalesService({ db, identityService: identity, config: { adminPinLogin: false }, now: () => now }) };
}

function command(customer = null, expectedTotalCents = 1200) {
  return { idempotencyKey: saleId, customerId: customer, expectedTotalCents, paymentMethod: 'PIX', items: [{ productId, quantity: 1 }] };
}

test('Firestore checkout atomically writes sale, item, stock movement, audit and command', async () => {
  const { db, service } = makeService();
  const receipt = await service.checkout({ sessionTokenHash: tokenHash }, command(customerId));
  assert.deepEqual(receipt, {
    saleId, totalCents: 1200, customerId, paymentMethod: 'PIX', createdAt: '2026-01-01T12:00:00.000Z', state: 'CONFIRMADA',
    items: [{ productId, quantity: 1, title: 'Livro', unitPriceCents: 1200, subtotalCents: 1200 }],
  });
  assert.equal(db.values.get(`products/${productId}`).stock, 1);
  assert.equal(db.values.get(`products/${productId}`).version, 2);
  assert.equal(db.values.get(`sales/${saleId}`).totalCents, 1200);
  assert.equal(db.values.get(`sales/${saleId}/items/${productId}`).subtotalCents, 1200);
  assert.equal(db.values.get(`stockMovements/${saleId}:${productId}`).type, 'SAIDA');
  assert.equal(db.values.get(`commands/sales:${saleId}`).state, 'COMMITTED');
  assert.equal(db.values.get(`auditEvents/sales:${saleId}`).operation, 'SALE_COMMITTED');
  assert.equal(db.values.get(`customers/${customerId}`).lastPurchase, '2026-01-01T12:00:00.000Z');
  assert.deepEqual(await service.checkout({ sessionTokenHash: tokenHash }, command(customerId)), receipt);
});

test('Firestore checkout rejects price changes and insufficient stock without changing the product', async () => {
  const price = makeService();
  await assert.rejects(price.service.checkout({ sessionTokenHash: tokenHash }, command(null, 1201)), { code: 'SALE_PRICE_CHANGED', status: 409 });
  assert.equal(price.db.values.get(`products/${productId}`).stock, 2);
  const stock = makeService();
  await assert.rejects(stock.service.checkout({ sessionTokenHash: tokenHash }, { ...command(), items: [{ productId, quantity: 3 }], expectedTotalCents: 3600 }), { code: 'INSUFFICIENT_STOCK', status: 409 });
  assert.equal(stock.db.values.get(`products/${productId}`).version, 1);
});

test('Firestore checkout keeps identified customer validation inside the transaction', async () => {
  const { service } = makeService();
  await assert.rejects(service.checkout({ sessionTokenHash: tokenHash }, command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')), { code: 'CUSTOMER_UNAVAILABLE', status: 409 });
});
