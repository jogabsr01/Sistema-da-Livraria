import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreCatalogService } from '../../backend/firestore-catalog.mjs';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '33333333-3333-4333-8333-333333333333';
const nicheId = '55555555-5555-4555-8555-555555555555';
const productA = '66666666-6666-4666-8666-666666666666';
const productB = '77777777-7777-4777-8777-777777777777';
const tokenHash = 'a'.repeat(64);
const now = Date.parse('2026-01-01T12:00:00.000Z');

function product(id, title, active = true) {
  return {
    isbn: '', internalCode: `INT${id.slice(0, 8).toUpperCase()}`, title, author: 'Autor', publisher: 'Editora', edition: '',
    supplier: 'Fornecedor', priceCents: 1200, minimumStock: 2, category: 'Categoria', coverUrl: '', year: 2020,
    pages: 100, synopsis: 'Sinopse', nicheIds: [nicheId], active, stock: 4, version: 1,
    updatedAt: new Date('2026-01-01T11:00:00.000Z'), hasPhoto: false,
  };
}

function fakeDb(values) {
  const store = new Map(Object.entries(values));
  const ref = (collection, id) => ({ path: `${collection}/${id}`, id, collection });
  const db = {
    values: store,
    collection(collection) {
      return {
        kind: 'collection', name: collection, collection,
        doc: id => ref(collection, id),
        where: (field, operator, value) => ({ kind: 'query', collection, field, operator, value }),
      };
    },
    async runTransaction(work) {
      const tx = {
        async get(target) {
          if (target.kind === 'collection' || target.kind === 'query') {
            const docs = [...store.entries()]
              .filter(([path, value]) => path.startsWith(`${target.collection}/`) &&
                (target.kind === 'collection' || value?.[target.field] === target.value))
              .map(([path, value]) => ({ id: path.split('/').at(-1), ref: { path, id: path.split('/').at(-1) }, exists: true, data: () => structuredClone(value) }));
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
    [`users/${userId}`]: { role: 'ADMIN', status: 'ATIVO', authorizationVersion: 2 },
    [`niches/${nicheId}`]: { name: 'Geral', description: '', color: '#205B43', order: 0, active: true, version: 1, hasImage: false },
    [`products/${productA}`]: product(productA, 'A Bíblia de Estudo'),
    [`products/${productB}`]: product(productB, 'B História da Igreja', false),
    ...values,
  });
  const identity = createFirestoreIdentityService({ db, now: () => now });
  return { db, service: createFirestoreCatalogService({ db, identityService: identity, config: { adminPinLogin: false }, now: () => now }) };
}

test('Firestore catalog lists and gets products with current filters and DTO shape', async () => {
  const { service } = makeService();
  const list = await service.execute('list', { sessionTokenHash: tokenHash }, { search: 'biblia', offset: 0, nicheId: '', includeInactive: false });
  assert.equal(list.total, 1);
  assert.equal(list.products[0].id, productA);
  assert.equal(list.products[0].hasPhoto, false);
  assert.equal(Object.hasOwn(list.products[0], 'supplier'), false);
  const detailed = await service.execute('get', { sessionTokenHash: tokenHash }, { id: productA });
  assert.equal(detailed.product.supplier, 'Fornecedor');
  assert.equal(detailed.product.synopsis, 'Sinopse');
});

test('Firestore catalog bootstrap supports creation mode and returns principal/niches', async () => {
  const { service } = makeService();
  const result = await service.execute('bootstrap', { sessionTokenHash: tokenHash }, { search: '', offset: 0, nicheId: '', includeInactive: false, create: true });
  assert.equal(result.principal.id, userId);
  assert.equal(result.niches[0].id, nicheId);
  assert.deepEqual(result.products, []);
  assert.equal(result.nextOffset, null);
});

test('Firestore catalog refuses malformed stored data and applies atomic save, receipt and removal commands', async () => {
  const malformed = product(productA, 'A Bíblia de Estudo'); malformed.stock = -1;
  const malformedService = makeService({ [`products/${productA}`]: malformed });
  await assert.rejects(malformedService.service.execute('get', { sessionTokenHash: tokenHash }, { id: productA }), { code: 'CATALOG_UNAVAILABLE', status: 503 });
  const ready = makeService();
  const record = product(productA, 'A Bíblia de Estudo');
  for (const key of ['stock', 'version', 'updatedAt', 'hasPhoto']) delete record[key];
  const saved = await ready.service.execute('save', { sessionTokenHash: tokenHash }, { commandId: productA, id: productA, expectedVersion: 1, record });
  assert.deepEqual(saved, { id: productA, version: 2 });
  assert.deepEqual(await ready.service.execute('save', { sessionTokenHash: tokenHash }, { commandId: productA, id: productA, expectedVersion: 1, record }), saved);
  const duplicateRecord = product(productB, 'B História da Igreja');
  duplicateRecord.internalCode = record.internalCode;
  for (const key of ['stock', 'version', 'updatedAt', 'hasPhoto']) delete duplicateRecord[key];
  await assert.rejects(ready.service.execute('save', { sessionTokenHash: tokenHash }, { commandId: productB, id: productB, expectedVersion: 1, record: duplicateRecord }), { code: 'CATALOG_DUPLICATE', status: 409 });
  assert.equal(ready.db.values.get(`products/${productA}`).version, 2);
  assert.equal(ready.db.values.get(`commands/catalog:${productA}`).state, 'COMMITTED');
  const receipt = await ready.service.execute('receive', { sessionTokenHash: tokenHash }, { commandId: productB, id: productA, expectedVersion: 2, quantity: 1, reason: 'Reposição' });
  assert.equal(receipt.stockAfter, 5);
  assert.equal(receipt.version, 3);
  const removed = await ready.service.execute('remove', { sessionTokenHash: tokenHash }, { commandId: nicheId, id: productA, expectedVersion: 3 });
  assert.deepEqual(removed, { id: productA, version: 4 });
  assert.equal(ready.db.values.get(`products/${productA}`).active, false);
});
