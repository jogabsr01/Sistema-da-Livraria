import { createHmac } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid, normalizeProduct, productFields } from './catalog-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const MAX_PRODUCTS = 5000, MAX_SALES = 2000, MAX_MOVEMENTS = 5000, MAX_PEOPLE = 5000, MAX_CUSTOMERS = 2000, MAX_NICHES = 200;
function invalid() { throw new ApiError(400, 'INVALID_REPORT'); }
function unavailable() { throw new ApiError(503, 'REPORT_UNAVAILABLE'); }
function snapshotValue(snapshot) {
  if (!snapshot || typeof snapshot.exists !== 'boolean') unavailable();
  if (!snapshot.exists) return null;
  const value = snapshot.data?.();
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  return value;
}
function date(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  unavailable();
}
function product(snapshot) {
  const value = snapshotValue(snapshot), id = value && (value.id || snapshot.id);
  if (!value || !catalogUuid(id) || !Number.isSafeInteger(value.stock) || !Number.isSafeInteger(value.minimumStock) || !Number.isSafeInteger(value.priceCents) || typeof value.active !== 'boolean') unavailable();
  let record; try { record = normalizeProduct(Object.fromEntries(productFields.map(field => [field, value[field]])), id); } catch { unavailable(); }
  return { id, title: record.title, isbn: record.isbn, author: record.author, publisher: record.publisher, supplier: record.supplier,
    category: record.category, stock: value.stock, minimumStock: record.minimumStock, priceCents: record.priceCents, active: record.active, nicheIds: record.nicheIds };
}
function person(snapshot) {
  const value = snapshotValue(snapshot), id = value && (value.id || snapshot.id);
  if (!value || !catalogUuid(id)) unavailable();
  return { id, owner: value.owner === true, missing: false, contact: typeof value.contact === 'string' ? value.contact : '' };
}
function customer(snapshot) {
  const value = snapshotValue(snapshot), id = value && (value.id || snapshot.id);
  if (!value || !catalogUuid(id) || typeof value.contact !== 'string') unavailable();
  return { id, contact: value.contact };
}
function niche(snapshot) {
  const value = snapshotValue(snapshot), id = value && (value.id || snapshot.id);
  if (!value || !catalogUuid(id) || typeof value.name !== 'string') unavailable();
  return { id, name: value.name };
}
function sourceSnapshot(config, filters, payload) {
  if (!config?.secret || !/^[a-f0-9]{64}$/i.test(config.secret)) throw new ApiError(503, 'FIRESTORE_CONFIGURATION_UNAVAILABLE');
  return createHmac('sha256', Buffer.from(config.secret, 'hex')).update('reports.source.v1.' + JSON.stringify([config.environment, config.installationId, filters, payload])).digest('hex');
}

export function createFirestoreReportService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  async function execute(operation, actor, payload) {
    if (!['source', 'record'].includes(operation)) throw new ApiError(400, 'INVALID_REPORT');
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now(), principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'reports.read', { now: currentTime });
      if (operation === 'record') return record(transaction, { repositories, principal, config, payload, currentTime });
      const productsSnapshot = await transaction.get(db.collection('products')), salesSnapshot = await transaction.get(db.collection('sales')),
        movementsSnapshot = await transaction.get(db.collection('stockMovements')), peopleSnapshot = await transaction.get(db.collection('users')),
        customersSnapshot = await transaction.get(db.collection('customers')), nichesSnapshot = await transaction.get(db.collection('niches'));
      if (!productsSnapshot || productsSnapshot.docs.length > MAX_PRODUCTS || !salesSnapshot || salesSnapshot.docs.length > MAX_SALES ||
          !movementsSnapshot || movementsSnapshot.docs.length > MAX_MOVEMENTS || !peopleSnapshot || peopleSnapshot.docs.length > MAX_PEOPLE ||
          !customersSnapshot || customersSnapshot.docs.length > MAX_CUSTOMERS || !nichesSnapshot || nichesSnapshot.docs.length > MAX_NICHES) unavailable();
      const products = productsSnapshot.docs.map(product), people = peopleSnapshot.docs.map(person), customers = customersSnapshot.docs.map(customer), niches = nichesSnapshot.docs.map(niche);
      const sales = [];
      for (const snapshot of salesSnapshot.docs) {
        const value = snapshotValue(snapshot), id = value && (value.id || snapshot.id);
        if (!value || !catalogUuid(id) || !catalogUuid(value.attendantId) || value.customerId !== null && value.customerId !== undefined && !catalogUuid(value.customerId) ||
            !Number.isSafeInteger(value.totalCents) || !['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'].includes(value.paymentMethod) || !['CONFIRMADA', 'CANCELADA'].includes(value.status)) unavailable();
        const itemsSnapshot = await transaction.get(snapshot.ref.collection('items'));
        if (!itemsSnapshot || !Array.isArray(itemsSnapshot.docs) || !itemsSnapshot.docs.length || itemsSnapshot.docs.length > 100) unavailable();
        const items = itemsSnapshot.docs.map(itemSnapshot => { const item = snapshotValue(itemSnapshot); if (!item || !catalogUuid(item.productId) || !Number.isSafeInteger(item.quantity) || !Number.isSafeInteger(item.unitPriceCents) || !Number.isSafeInteger(item.subtotalCents) || item.subtotalCents !== item.quantity * item.unitPriceCents || typeof item.title !== 'string') unavailable(); return { productId: item.productId, title: item.title, quantity: item.quantity, unitPriceCents: item.unitPriceCents, subtotalCents: item.subtotalCents }; });
        sales.push({ id, at: date(value.createdAt), operatorId: value.attendantId, customerId: value.customerId ?? null, totalCents: value.totalCents,
          paymentMethod: value.paymentMethod, state: value.status, reversedAt: value.status === 'CANCELADA' ? date(value.updatedAt || value.createdAt) : null, items });
      }
      const movements = movementsSnapshot.docs.map(snapshot => { const value = snapshotValue(snapshot), id = value && (value.id || snapshot.id); if (!value || !id || !date(value.at) || !catalogUuid(value.productId) || !catalogUuid(value.operatorId) || !['ENTRADA', 'SAIDA', 'AJUSTE', 'ESTORNO'].includes(value.type) || !Number.isSafeInteger(value.quantity) || !Number.isSafeInteger(value.stockBefore) || !Number.isSafeInteger(value.stockAfter)) unavailable(); return { id, at: date(value.at), operatorId: value.operatorId, productId: value.productId, type: value.type, quantity: value.quantity, before: value.stockBefore, after: value.stockAfter, saleId: value.saleId || '' }; });
      const sourcePayload = { products, sales, movements, people, customers, niches, legacyExcluded: 0 }, snapshot = sourceSnapshot(config, payload.filters, sourcePayload);
      return { generatedAt: new Date(currentTime).toISOString(), snapshot, legacyExcluded: 0, ...sourcePayload };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  return Object.freeze({ execute });
}

function record(transaction, { repositories, principal, config, payload, currentTime }) {
  if (!payload || !catalogUuid(payload.commandId) || typeof payload.sourceSnapshot !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sourceSnapshot) || typeof payload.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(payload.fingerprint)) invalid();
  const command = createCommandMetadata({ domain: 'reports', commandId: payload.commandId, operation: payload.mode === 'EXPORT' ? 'export' : 'view', actor: principal.id,
    payloadHash: payload.fingerprint, now: new Date(currentTime), retentionMs: commandRetention(90) });
  const commandRef = repositories.ref('commands', commandDocumentId('reports', payload.commandId));
  return inspectCommand(transaction, commandRef, command).then(state => {
    if (state.status === 'COMMITTED') return state.result;
    const eventRef = repositories.ref('auditEvents', `reports:${payload.commandId}`), result = { recorded: true, commandId: payload.commandId };
    if (state.status === 'NEW') createPendingCommand(transaction, commandRef, command);
    transaction.create(eventRef, { id: `reports:${payload.commandId}`, at: new Date(currentTime).toISOString(), commandId: payload.commandId, actorId: principal.id,
      role: principal.role, operation: payload.mode === 'EXPORT' ? 'REPORT_EXPORT' : 'REPORT_VIEW', entity: 'Relatorios', entityId: payload.commandId,
      result: 'SUCESSO', requestId: payload.commandId, before: null, after: { sourceSnapshot: payload.sourceSnapshot, count: payload.count }, detailsOmitted: true });
    commitCommand(transaction, commandRef, result, new Date(currentTime));
    return result;
  });
}
