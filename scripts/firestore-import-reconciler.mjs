import { preflight } from './firestore-import-preflight.mjs';
import { createFirestoreDb } from '../backend/firestore-client.mjs';
import { validateFirestoreBundle } from '../backend/firestore-bundle-validator.mjs';
import { projectOperationalFixture } from './inventory-operational-mapper.mjs';

const domains = ['niches', 'products', 'customers', 'stockMovements', 'sales'];
const integer = value => Number.isSafeInteger(value) && value >= 0;

// The caller must supply a consistent snapshot, not live reads interleaved with writes.
// No identifiers or personal information are emitted in the report.
export function reconcileImportSnapshot({ expectedCounts, openings, snapshot }) {
  try {
    if (!expectedCounts || !Array.isArray(openings) || !snapshot ||
        domains.some(name => !integer(expectedCounts[name]) || !Array.isArray(snapshot[name]))) throw Error();
    const divergences = [];
    const add = (code, count = 1) => { if (count) divergences.push({ code, count }); };
    for (const domain of domains) {
      if (snapshot[domain].length !== expectedCounts[domain]) add(`COUNT_${domain.toUpperCase()}_MISMATCH`);
    }
    const unique = records => {
      const map = new Map();
      for (const row of records) {
        if (!row || typeof row.id !== 'string' || !row.id || map.has(row.id)) throw Error();
        map.set(row.id, row);
      }
      return map;
    };
    const products = unique(snapshot.products), customers = unique(snapshot.customers), sales = unique(snapshot.sales);
    unique(snapshot.niches); unique(snapshot.stockMovements);
    const balances = new Map();
    for (const entry of openings) {
      if (!entry || typeof entry.id !== 'string' || balances.has(entry.id) || !integer(entry.stock)) throw Error();
      balances.set(entry.id, entry.stock);
    }
    let orphanMovements = 0, invalidMovements = 0;
    for (const movement of snapshot.stockMovements) {
      if (!products.has(movement.productId) || !balances.has(movement.productId) ||
          (movement.saleId !== null && !sales.has(movement.saleId))) { orphanMovements++; continue; }
      if (!integer(movement.quantity) || movement.quantity === 0 || !['ENTRADA', 'SAIDA'].includes(movement.type)) {
        invalidMovements++; continue;
      }
      const value = balances.get(movement.productId) + (movement.type === 'ENTRADA' ? movement.quantity : -movement.quantity);
      if (!Number.isSafeInteger(value)) { invalidMovements++; continue; }
      balances.set(movement.productId, value);
    }
    add('ORPHAN_MOVEMENTS', orphanMovements); add('INVALID_MOVEMENTS', invalidMovements);
    let stock = 0;
    for (const [id, product] of products) {
      if (!balances.has(id) || !integer(product.stock) || balances.get(id) !== product.stock) stock++;
    }
    for (const id of balances.keys()) if (!products.has(id)) stock++;
    add('STOCK_MISMATCH', stock);
    let orphanCustomers = 0, orphanProducts = 0, invalidItems = 0;
    for (const sale of snapshot.sales) {
      if (sale.customerId !== null && !customers.has(sale.customerId)) orphanCustomers++;
      if (!Array.isArray(sale.items) || !sale.items.length) { invalidItems++; continue; }
      for (const item of sale.items) if (!item || !products.has(item.productId)) orphanProducts++;
    }
    add('ORPHAN_SALE_CUSTOMERS', orphanCustomers); add('ORPHAN_SALE_PRODUCTS', orphanProducts);
    add('INVALID_SALE_ITEMS', invalidItems);
    return { status: divergences.length ? 'DIVERGED' : 'RECONCILED', divergences, writePerformed: false };
  } catch { throw Error('IMPORT_RECONCILIATION_INVALID'); }
}

// Read-only emulator audit. Quiescence is required: these reads are not one
// Firestore snapshot and concurrent writers could otherwise invalidate results.
export async function reconcileEmulatorImport({ env = process.env, bytes, schema, context, destinationQuiescent = false } = {}) {
  let db;
  try {
    if (destinationQuiescent !== true) throw Error();
    const inspection = await preflight(env);
    if (inspection.status !== 'INSPECTION_ONLY' || inspection.writePerformed !== false) throw Error();
    const bundle = validateFirestoreBundle(bytes, schema, context);
    const projection = projectOperationalFixture(bytes, schema, { syntheticActorId: context.syntheticActorId, allowSyntheticActor: true });
    const expectedCounts = Object.fromEntries(domains.map(domain => [domain, bundle.domains[domain].length]));
    const openings = projection.products.map(product => ({ id: product.id, stock: product.openingStock }));
    db = createFirestoreDb({ projectId: env.IMPORT_PREFLIGHT_PROJECT_ID, databaseId: '(default)', emulatorHost: env.FIRESTORE_EMULATOR_HOST });
    const collections = await Promise.all(domains.map(name => db.collection(name).get()));
    const snapshot = Object.fromEntries(domains.map((name, i) => [name, collections[i].docs.map(doc => ({ ...doc.data(), id: doc.id }))]));
    for (const sale of snapshot.sales) {
      const items = await db.collection('sales').doc(sale.id).collection('items').get();
      sale.items = items.docs.map(doc => doc.data());
    }
    return reconcileImportSnapshot({ expectedCounts, openings, snapshot });
  } catch { throw Error('IMPORT_RECONCILIATION_FAILED'); }
  finally { if (db) await db.terminate(); }
}