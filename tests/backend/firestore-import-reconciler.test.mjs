import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileImportSnapshot, reconcileEmulatorImport } from '../../scripts/firestore-import-reconciler.mjs';
import { createFirestoreEmulatorDb } from '../helpers/firestore-emulator.mjs';
import { loadSchema } from '../../scripts/inventory-sheet-metadata.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function input() {
  return { expectedCounts: { niches: 1, products: 1, customers: 1, stockMovements: 1, sales: 1 },
    openings: [{ id: 'p', stock: 5 }], snapshot: {
      niches: [{ id: 'n' }], products: [{ id: 'p', stock: 3 }], customers: [{ id: 'c' }],
      stockMovements: [{ id: 'm', productId: 'p', saleId: 's', type: 'SAIDA', quantity: 2 }],
      sales: [{ id: 's', customerId: 'c', items: [{ productId: 'p' }] }],
    } };
}

test('reconciliation compares counts, opening balances and relationships without writes', () => {
  assert.deepEqual(reconcileImportSnapshot(input()), { status: 'RECONCILED', divergences: [], writePerformed: false });
});

test('reconciliation reports aggregate stock, count and orphan divergences without identifiers', () => {
  const value = input();
  value.snapshot.products[0].stock = 9;
  value.snapshot.sales[0].customerId = 'private-customer';
  value.snapshot.sales[0].items[0].productId = 'private-product';
  value.expectedCounts.niches = 2;
  const result = reconcileImportSnapshot(value);
  assert.equal(result.status, 'DIVERGED');
  assert.deepEqual(result.divergences.map(d => d.code), ['COUNT_NICHES_MISMATCH', 'STOCK_MISMATCH', 'ORPHAN_SALE_CUSTOMERS', 'ORPHAN_SALE_PRODUCTS']);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('reconciliation rejects malformed inputs and emulator audit without quiescence', async () => {
  const value = input(); value.snapshot.products.push(value.snapshot.products[0]);
  assert.throws(() => reconcileImportSnapshot(value), /IMPORT_RECONCILIATION_INVALID/);
  await assert.rejects(reconcileEmulatorImport(), /IMPORT_RECONCILIATION_FAILED/);
});

const host = process.env.FIRESTORE_EMULATOR_HOST;
const emulatorConfigured = typeof host === 'string' && /^127\.0\.0\.1:\d{1,5}$/.test(host) &&
  Number(host.split(':')[1]) > 0 && Number(host.split(':')[1]) <= 65535;

test('official emulator read-only audit detects empty and orphaned destinations', { skip: !emulatorConfigured }, async t => {
  const db = createFirestoreEmulatorDb({ namespace: 'reconcile', demo: true });
  const dir = await mkdtemp(join(tmpdir(), 'reconcile-emulator-'));
  t.after(async () => { await db.terminate(); await rm(dir, { recursive: true, force: true }); });
  const backup = join(dir, 'backup');
  await writeFile(backup, 'synthetic backup');
  const env = { IMPORT_PREFLIGHT_MODE: 'emulator', IMPORT_PREFLIGHT_PROJECT_ID: db.projectId,
    IMPORT_PREFLIGHT_EXPECTED_PROJECT_ID: db.projectId, IMPORT_PREFLIGHT_CONFIRM_EMULATOR: 'YES',
    FIRESTORE_EMULATOR_HOST: host, IMPORT_PREFLIGHT_BACKUP_PATH: backup,
    IMPORT_PREFLIGHT_BACKUP_SHA256: createHash('sha256').update('synthetic backup').digest('hex') };
  const schema = await loadSchema();
  const fixture = { sheets: schema.map(s => ({ name: s.name, headers: [...s.columns], rows: [] })),
    operationalOpeningStocks: { completeHistory: true, products: [] } };
  const args = { env, schema, bytes: Buffer.from(JSON.stringify(fixture)), destinationQuiescent: true,
    context: { media: { niches: [], products: [] }, historicalSales: [], movementCommandIds: [] } };
  assert.equal((await reconcileEmulatorImport(args)).status, 'RECONCILED');
  await db.doc('sales/synthetic-sale').set({ customerId: 'missing-customer' });
  await db.doc('sales/synthetic-sale/items/synthetic-item').set({ productId: 'missing-product' });
  const result = await reconcileEmulatorImport(args);
  assert.equal(result.status, 'DIVERGED');
  for (const code of ['COUNT_SALES_MISMATCH', 'ORPHAN_SALE_CUSTOMERS', 'ORPHAN_SALE_PRODUCTS']) {
    assert.ok(result.divergences.some(item => item.code === code));
  }
  assert.equal(result.writePerformed, false);
});