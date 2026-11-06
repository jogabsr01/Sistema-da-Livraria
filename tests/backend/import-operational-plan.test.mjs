import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperationalImport } from '../../backend/import-operational-plan.mjs';

const customer = () => ({ id: 'c1', record: { name: 'Pessoa Teste', cpf: '529.982.247-25', email: 'pessoa@example.test', phone: '11999999999', contactPreference: 'EMAIL', marketingConsent: true }, consentAt: '2026-01-01T00:00:00.000Z' });
const valid = () => ({ environment: 'dev', schemaVersion: 1, products: [{ id: 'p1', openingStock: 5, closingStock: 3 }], customers: [customer()],
  sales: [{ id: 's1', idempotencyKey: 'k1', customerId: 'c1', totalCents: 600, items: [{ productId: 'p1', quantity: 2, unitPriceCents: 300, subtotalCents: 600 }] }],
  movements: [{ id: 'm1', productId: 'p1', type: 'SAIDA', quantity: 2, stockBefore: 5, stockAfter: 3, saleId: 's1' }] });
const rejects = (mutate, code) => { const value = valid(); mutate(value); assert.throws(() => validateOperationalImport(value), error => error.message === code); };

test('validates complete ordered snapshot without mutation, PII or writes', () => {
  const value = valid(), before = structuredClone(value), result = validateOperationalImport(value);
  assert.deepEqual(value, before); assert.equal(result.writePerformed, false);
  assert.deepEqual([result.products, result.customers, result.sales, result.movements], [1, 1, 1, 1]);
  assert.doesNotMatch(JSON.stringify(result), /529|pessoa|119999/);
});

test('customer schema, canonical CPF uniqueness and consent are enforced without PII in errors', () => {
  rejects(v => { const c = customer(); c.id = 'c2'; c.record.cpf = '52998224725'; v.customers.push(c); }, 'OPERATIONAL_CUSTOMER_CPF_DUPLICATE');
  rejects(v => { v.customers[0].record.cpf = 'bad-private'; }, 'OPERATIONAL_CUSTOMERS_INVALID');
  rejects(v => { v.customers[0].record.extra = 'private'; }, 'OPERATIONAL_CUSTOMERS_INVALID');
  rejects(v => { v.customers[0].consentAt = null; }, 'OPERATIONAL_CONSENT_INVALID');
  rejects(v => { v.customers[0].record.contactPreference = 'NONE'; }, 'OPERATIONAL_CUSTOMERS_INVALID');
});

test('sales validate customer/product references, duplicate keys and integer financial totals', () => {
  rejects(v => { v.sales[0].customerId = 'missing'; }, 'OPERATIONAL_SALES_INVALID');
  rejects(v => { v.sales[0].items[0].productId = 'missing'; }, 'OPERATIONAL_SALE_ITEMS_INVALID');
  rejects(v => { v.sales[0].totalCents++; }, 'OPERATIONAL_SALE_TOTAL_INVALID');
  rejects(v => { v.sales[0].items[0].unitPriceCents = Number.MAX_SAFE_INTEGER; }, 'OPERATIONAL_SALE_TOTAL_INVALID');
  rejects(v => { const s = structuredClone(v.sales[0]); s.id = 's2'; v.sales.push(s); }, 'OPERATIONAL_SALES_INVALID');
  rejects(v => { v.sales[0].items.push(structuredClone(v.sales[0].items[0])); }, 'OPERATIONAL_SALE_ITEMS_INVALID');
});

test('stock chain and one-to-one sale movements prevent double deduction and missing movements', () => {
  rejects(v => { v.movements.push({ ...v.movements[0], id: 'm2', stockBefore: 3, stockAfter: 1 }); }, 'OPERATIONAL_SALE_MOVEMENT_INVALID');
  rejects(v => { v.movements = []; }, 'OPERATIONAL_SALE_MOVEMENT_INVALID');
  rejects(v => { v.movements[0].stockBefore = 6; }, 'OPERATIONAL_STOCK_CHAIN_INVALID');
  rejects(v => { v.products[0].closingStock = 1; }, 'OPERATIONAL_STOCK_CLOSING_INVALID');
  rejects(v => { v.movements[0].saleId = 'missing'; }, 'OPERATIONAL_SALE_MOVEMENT_INVALID');
});

test('rejects non-dev, extra fields, malformed and oversized inputs', () => {
  rejects(v => { v.environment = 'prod'; }, 'OPERATIONAL_IMPORT_INVALID');
  rejects(v => { v.extra = true; }, 'OPERATIONAL_IMPORT_INVALID');
  rejects(v => { v.products[0].openingStock = -1; }, 'OPERATIONAL_PRODUCTS_INVALID');
  rejects(v => { v.sales = Array(10001).fill(null); }, 'OPERATIONAL_IMPORT_INVALID');
});