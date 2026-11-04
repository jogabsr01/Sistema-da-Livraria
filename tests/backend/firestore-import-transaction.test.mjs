import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { commitImportBundle } from '../../backend/firestore-import-transaction.mjs';
import { mapNicheDocuments, mapProductDocuments, mapCustomerDocuments } from '../../backend/firestore-document-mapper.mjs';
import { createTransactionStub } from '../helpers/firestore-transaction-stub.mjs';
import { reconcileImportSnapshot } from '../../scripts/firestore-import-reconciler.mjs';

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', product = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  niche = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', customer = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const vaultSettings = { config: { installationId: actor, environment: 'dev' }, dataKey: Buffer.alloc(32, 1), indexKey: Buffer.alloc(32, 2) };
const runId = 'a'.repeat(64), timestamp = '2026-01-01T00:00:00.000Z';
function bundle() {
  const b = Buffer.from('synthetic-photo'), photo = { bytes: b.toString('base64'), sha256: createHash('sha256').update(b).digest('hex') };
  const customerMap = mapCustomerDocuments({ id: customer, timestamp, consentAt: '', lastPurchase: '', vaultSettings,
    record: { name: 'Pessoa', cpf: '52998224725', email: '', phone: '', contactPreference: 'NONE', marketingConsent: false } });
  return { writePerformed: false, domains: {
    niches: [{ id: niche, documents: mapNicheDocuments({ id: niche, actorId: actor, timestamp, version: 1,
      record: { name: 'Livros', description: '', color: '#abcdef', order: 1, active: true }, image: null }) }],
    products: [{ id: product, documents: mapProductDocuments({ id: product, actorId: actor, timestamp, version: 1, stock: 3, cover: photo,
      record: { isbn: '9780140328721', title: 'Livro', priceCents: 100, nicheIds: [niche], active: true } }) }],
    customers: [{ id: customer, ...customerMap }], stockMovements: [], sales: [],
  } };
}
const execute = (db, value = bundle()) => commitImportBundle(db, value, { runId, vaultSettings });

test('atomic checkpoints enable replay without changing encrypted customer or cover', async () => {
  const db = createTransactionStub();
  const first = await execute(db); assert.equal(first.status, 'COMPLETED'); assert.equal(first.committedBatches, 3);
  const before = structuredClone([...db.values]);
  const second = await execute(db); assert.equal(second.writePerformed, false); assert.equal(second.committedBatches, 0);
  assert.deepEqual([...db.values], before);
  assert.ok(db.writes.every(paths => paths.length <= 100));
  assert.deepEqual(db.writes.map(paths => paths.at(-1).split('/').at(-1)), ['niches', 'products', 'customers']);
});

test('failed transaction rolls back writes and can resume from checkpoint', async () => {
  const db = createTransactionStub(); db.failNextCommit();
  assert.equal((await execute(db)).status, 'FAILED'); assert.equal(db.values.size, 0);
  assert.equal((await execute(db)).status, 'COMPLETED');
});

test('existing customer and media are resolved without overwriting conflicts', async () => {
  const db = createTransactionStub(), initial = bundle();
  const customerDoc = initial.domains.customers[0].documents[0];
  const productDocs = initial.domains.products[0].documents;
  db.values.set(customerDoc.path, structuredClone(customerDoc.data));
  for (const doc of productDocs) db.values.set(doc.path, structuredClone(doc.data));
  const cipher = customerDoc.data.contact, cover = structuredClone(db.values.get(`products/${product}/media/cover`));
  assert.equal((await execute(db)).status, 'COMPLETED');
  assert.equal(db.values.get(customerDoc.path).contact, cipher);
  assert.deepEqual(db.values.get(`products/${product}/media/cover`), cover);
  const conflict = createTransactionStub(); conflict.values.set(`niches/${niche}`, { wrong: true });
  assert.equal((await execute(conflict)).status, 'FAILED');
  assert.equal(conflict.values.size, 1);
});

test('checkpoint mismatches reject a different logical bundle', async () => {
  const db = createTransactionStub(), input = bundle(); await execute(db, input);
  input.domains.niches[0].documents[0].data.name = 'Alterado';
  assert.equal((await execute(db, input)).status, 'FAILED');
});

test('stub simulates all domains and validates snapshot reconciliation', async () => {
  const db = createTransactionStub(), input = bundle();
  input.domains.stockMovements.push({ id: 'm', documents: [{ path: 'stockMovements/m', data: {
    productId: product, saleId: 's', type: 'SAIDA', quantity: 2 } }] });
  input.domains.sales.push({ id: 's', documents: [{ path: 'sales/s', data: { customerId: customer } },
    { path: `sales/s/items/${product}`, data: { productId: product } }] });
  assert.equal((await execute(db, input)).status, 'COMPLETED');
  const rows = name => [...db.values].filter(([path]) => path.split('/').length === 2 && path.startsWith(`${name}/`))
    .map(([path, data]) => ({ ...data, id: path.split('/')[1] }));
  const snapshot = Object.fromEntries(['niches', 'products', 'customers', 'stockMovements', 'sales'].map(name => [name, rows(name)]));
  snapshot.sales[0].items = [db.values.get(`sales/s/items/${product}`)];
  assert.equal(reconcileImportSnapshot({ expectedCounts: { niches: 1, products: 1, customers: 1, stockMovements: 1, sales: 1 },
    openings: [{ id: product, stock: 5 }], snapshot }).status, 'RECONCILED');
  assert.equal((await execute(db, input)).committedBatches, 0);
});

test('oversized group cannot commit', async () => {
  const db = createTransactionStub(), input = bundle();
  input.domains.niches[0].documents = Array.from({ length: 100 }, (_, i) => ({ path: `niches/${i}`, data: {} }));
  assert.equal((await execute(db, input)).status, 'FAILED');
  assert.equal(db.values.size, 0);
});