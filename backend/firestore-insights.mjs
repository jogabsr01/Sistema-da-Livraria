import { createHmac } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid, normalizeProduct, productFields } from './catalog-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';
function invalid() { throw new ApiError(400, 'INVALID_REPORT'); }
function unavailable() { throw new ApiError(503, 'REPORT_UNAVAILABLE'); }
function snapshotValue(snapshot) { if (!snapshot || typeof snapshot.exists !== 'boolean') unavailable(); if (!snapshot.exists) return null; const value = snapshot.data?.(); if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable(); return value; }
function date(value) { if (value instanceof Date) return value.toISOString(); if (value && typeof value.toDate === 'function') return value.toDate().toISOString(); if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString(); unavailable(); }
function product(snapshot) { const value = snapshotValue(snapshot), id = value && (value.id || snapshot.id); if (!value || !catalogUuid(id)) unavailable(); let record; try { record = normalizeProduct(Object.fromEntries(productFields.map(field => [field, value[field]])), id); } catch { unavailable(); } return { id, title: record.title, isbn: record.isbn, author: record.author, publisher: record.publisher, supplier: record.supplier, category: record.category, stock: value.stock, minimumStock: record.minimumStock, priceCents: record.priceCents, active: record.active, nicheIds: record.nicheIds }; }
function customer(snapshot) { const value = snapshotValue(snapshot), id = value && (value.id || snapshot.id); if (!value || !catalogUuid(id) || typeof value.contact !== 'string') unavailable(); return { id, contact: value.contact, lastPurchase: value.lastPurchase || '', marketingConsent: value.marketingConsent === true, contactPreference: value.contactPreference, consentAt: value.consentAt || '' }; }
function niche(snapshot) { const value = snapshotValue(snapshot), id = value && (value.id || snapshot.id); if (!value || !catalogUuid(id) || typeof value.name !== 'string') unavailable(); return { id, name: value.name }; }
function sourceHash(config, customerId, payload) { if (!config?.secret || !/^[a-f0-9]{64}$/i.test(config.secret)) throw new ApiError(503, 'FIRESTORE_CONFIGURATION_UNAVAILABLE'); return createHmac('sha256', Buffer.from(config.secret, 'hex')).update('insights.source.v1.' + JSON.stringify([config.environment, config.installationId, customerId, payload])).digest('hex'); }

export function createFirestoreInsightsService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  async function execute(operation, actor, payload) {
    if (!['source', 'record'].includes(operation)) throw new ApiError(400, 'INVALID_REPORT');
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now(), principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'reports.read', { now: currentTime });
      if (operation === 'record') return record(transaction, { repositories, principal, payload, currentTime });
      if (!catalogUuid(payload?.customerId)) invalid();
      const productsSnapshot = await transaction.get(db.collection('products')), salesSnapshot = await transaction.get(db.collection('sales')),
        customerSnapshot = await repositories.transaction.get(transaction, 'customers', payload.customerId), nichesSnapshot = await transaction.get(db.collection('niches'));
      const target = customer(customerSnapshot);
      if (!target) throw new ApiError(404, 'CUSTOMER_NOT_FOUND');
      const products = productsSnapshot.docs.map(product), niches = nichesSnapshot.docs.map(niche), sales = [];
      for (const snapshot of salesSnapshot.docs) {
        const value = snapshotValue(snapshot), id = value && (value.id || snapshot.id);
        if (!value || value.customerId !== payload.customerId) continue;
        const itemsSnapshot = await transaction.get(snapshot.ref.collection('items'));
        const items = itemsSnapshot.docs.map(itemSnapshot => { const item = snapshotValue(itemSnapshot); if (!item || !catalogUuid(item.productId) || !Number.isSafeInteger(item.quantity) || !Number.isSafeInteger(item.unitPriceCents) || !Number.isSafeInteger(item.subtotalCents)) unavailable(); return { productId: item.productId, title: item.title, quantity: item.quantity, unitPriceCents: item.unitPriceCents, subtotalCents: item.subtotalCents }; });
        sales.push({ id, at: date(value.createdAt), operatorId: value.attendantId, customerId: payload.customerId, totalCents: value.totalCents, paymentMethod: value.paymentMethod,
          state: value.status, reversedAt: value.status === 'CANCELADA' ? date(value.updatedAt || value.createdAt) : null, items });
      }
      const history = { products, sales, movements: [], people: [], customers: [target], niches, legacyExcluded: 0 }, eligibleNicheIds = niches.map(item => item.id);
      const sourcePayload = { history, customer: target, eligibleNicheIds }, snapshot = sourceHash(config, payload.customerId, sourcePayload);
      return { history, customer: target, eligibleNicheIds, generatedAt: new Date(currentTime).toISOString(), snapshot };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  return Object.freeze({ execute });
}
function record(transaction, { repositories, principal, payload, currentTime }) {
  if (!payload || !catalogUuid(payload.commandId) || typeof payload.sourceSnapshot !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sourceSnapshot) || typeof payload.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(payload.fingerprint)) invalid();
  const command = createCommandMetadata({ domain: 'insights', commandId: payload.commandId, operation: payload.mode === 'MESSAGE' ? 'message' : 'view', actor: principal.id, payloadHash: payload.fingerprint, now: new Date(currentTime), retentionMs: commandRetention(90) });
  const commandRef = repositories.ref('commands', commandDocumentId('insights', payload.commandId));
  return inspectCommand(transaction, commandRef, command).then(state => { if (state.status === 'COMMITTED') return state.result; const result = { recorded: true, commandId: payload.commandId }; if (state.status === 'NEW') createPendingCommand(transaction, commandRef, command); const auditRef = repositories.ref('auditEvents', `insights:${payload.commandId}`); transaction.create(auditRef, { id: `insights:${payload.commandId}`, at: new Date(currentTime).toISOString(), commandId: payload.commandId, actorId: principal.id, role: principal.role, operation: payload.mode === 'MESSAGE' ? 'CUSTOMER_MESSAGE' : 'CUSTOMER_INSIGHTS_VIEW', entity: 'Clientes', entityId: payload.customerId, result: 'SUCESSO', requestId: payload.commandId, before: null, after: { sourceSnapshot: payload.sourceSnapshot, count: payload.count }, detailsOmitted: true }); commitCommand(transaction, commandRef, result, new Date(currentTime)); return result; });
}
