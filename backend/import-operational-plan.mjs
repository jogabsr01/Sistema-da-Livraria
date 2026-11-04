import { normalizeCustomer } from './customer-model.mjs';

const fail = code => { throw new Error(code); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const object = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const pair = (a, b) => JSON.stringify([a, b]);
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Pure validation contract for an already transformed, complete, ordered snapshot.
// No index or normalized personal data leaves this function.
export function validateOperationalImport(input) {
  if (!object(input, ['environment', 'schemaVersion', 'products', 'customers', 'sales', 'movements']) ||
      input.environment !== 'dev' || input.schemaVersion !== 1 ||
      !['products', 'customers', 'sales', 'movements'].every(key => Array.isArray(input[key]) && input[key].length <= 10000)) fail('OPERATIONAL_IMPORT_INVALID');

  const products = new Map(), customers = new Set(), cpfs = new Set(), sales = new Map(), saleKeys = new Set();
  for (const product of input.products) {
    if (!object(product, ['id', 'openingStock', 'closingStock']) || !id(product.id) || products.has(product.id) ||
        !integer(product.openingStock) || !integer(product.closingStock)) fail('OPERATIONAL_PRODUCTS_INVALID');
    products.set(product.id, { stock: product.openingStock, closingStock: product.closingStock });
  }
  for (const customer of input.customers) {
    if (!object(customer, ['id', 'record', 'consentAt']) || !id(customer.id) || customers.has(customer.id)) fail('OPERATIONAL_CUSTOMERS_INVALID');
    let normalized;
    try { normalized = normalizeCustomer(customer.record); } catch { fail('OPERATIONAL_CUSTOMERS_INVALID'); }
    if (cpfs.has(normalized.cpf)) fail('OPERATIONAL_CUSTOMER_CPF_DUPLICATE');
    if (!(customer.consentAt === null || iso(customer.consentAt)) || (normalized.marketingConsent && customer.consentAt === null)) fail('OPERATIONAL_CONSENT_INVALID');
    cpfs.add(normalized.cpf); customers.add(customer.id);
  }
  const expected = new Map();
  for (const sale of input.sales) {
    if (!object(sale, ['id', 'idempotencyKey', 'customerId', 'totalCents', 'items']) || !id(sale.id) || sales.has(sale.id) ||
        !id(sale.idempotencyKey) || saleKeys.has(sale.idempotencyKey) ||
        !(sale.customerId === null || (id(sale.customerId) && customers.has(sale.customerId))) ||
        !integer(sale.totalCents) || !Array.isArray(sale.items) || !sale.items.length || sale.items.length > 100) fail('OPERATIONAL_SALES_INVALID');
    let total = 0; const seen = new Set();
    for (const item of sale.items) {
      if (!object(item, ['productId', 'quantity', 'unitPriceCents', 'subtotalCents']) || !products.has(item.productId) || seen.has(item.productId) ||
          !integer(item.quantity) || item.quantity < 1 || !integer(item.unitPriceCents) || !integer(item.subtotalCents)) fail('OPERATIONAL_SALE_ITEMS_INVALID');
      const subtotal = item.quantity * item.unitPriceCents;
      if (!Number.isSafeInteger(subtotal) || subtotal !== item.subtotalCents || !Number.isSafeInteger(total + subtotal)) fail('OPERATIONAL_SALE_TOTAL_INVALID');
      total += subtotal; seen.add(item.productId);
      expected.set(pair(sale.id, item.productId), item.quantity);
    }
    if (total !== sale.totalCents) fail('OPERATIONAL_SALE_TOTAL_INVALID');
    sales.set(sale.id, sale); saleKeys.add(sale.idempotencyKey);
  }
  const movementIds = new Set(), matched = new Set();
  for (const movement of input.movements) {
    if (!object(movement, ['id', 'productId', 'type', 'quantity', 'stockBefore', 'stockAfter', 'saleId']) ||
        !id(movement.id) || movementIds.has(movement.id) || !products.has(movement.productId) ||
        !['ENTRADA', 'SAIDA'].includes(movement.type) || !integer(movement.quantity) || movement.quantity < 1 ||
        !integer(movement.stockBefore) || !integer(movement.stockAfter) || !(movement.saleId === null || id(movement.saleId))) fail('OPERATIONAL_MOVEMENT_INVALID');
    movementIds.add(movement.id);
    const product = products.get(movement.productId);
    const after = movement.stockBefore + (movement.type === 'ENTRADA' ? movement.quantity : -movement.quantity);
    if (!integer(after) || movement.stockBefore !== product.stock || after !== movement.stockAfter) fail('OPERATIONAL_STOCK_CHAIN_INVALID');
    if (movement.saleId !== null) {
      const key = pair(movement.saleId, movement.productId);
      if (movement.type !== 'SAIDA' || !expected.has(key) || expected.get(key) !== movement.quantity || matched.has(key)) fail('OPERATIONAL_SALE_MOVEMENT_INVALID');
      matched.add(key);
    }
    product.stock = movement.stockAfter;
  }
  if (matched.size !== expected.size) fail('OPERATIONAL_SALE_MOVEMENT_INVALID');
  for (const product of products.values()) if (product.stock !== product.closingStock) fail('OPERATIONAL_STOCK_CLOSING_INVALID');
  return { environment: 'dev', schemaVersion: 1, customers: customers.size, products: products.size,
    sales: sales.size, movements: movementIds.size, writePerformed: false };
}