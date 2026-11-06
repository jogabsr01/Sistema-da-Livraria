import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid, normalizeProduct, productFields } from './catalog-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandFingerprint, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { enqueueStockAlertProjection } from './firestore-outbox.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const PAYMENT_METHODS = new Set(['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO']);
const MAX_ITEMS = 100;

function invalid() {
  throw new ApiError(400, 'INVALID_SALE');
}

function unavailable() {
  throw new ApiError(503, 'CHECKOUT_UNAVAILABLE');
}

function corrupt() {
  throw new ApiError(503, 'JOURNAL_INVALID');
}

function date(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) corrupt();
  return result;
}

function snapshotValue(snapshot) {
  if (!snapshot || typeof snapshot.exists !== 'boolean') corrupt();
  if (!snapshot.exists) return null;
  if (typeof snapshot.data !== 'function') corrupt();
  const value = snapshot.data();
  if (!value || typeof value !== 'object' || Array.isArray(value)) corrupt();
  return value;
}

function normalizeCommand(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      !catalogUuid(payload.idempotencyKey) || payload.customerId !== null && !catalogUuid(payload.customerId) ||
      !PAYMENT_METHODS.has(payload.paymentMethod) || !Number.isSafeInteger(payload.expectedTotalCents) || payload.expectedTotalCents < 0 ||
      !Array.isArray(payload.items) || !payload.items.length || payload.items.length > MAX_ITEMS) invalid();
  const quantities = new Map();
  for (const item of payload.items) {
    if (!item || !catalogUuid(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) invalid();
    const quantity = (quantities.get(item.productId) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) invalid();
    quantities.set(item.productId, quantity);
  }
  return { idempotencyKey: payload.idempotencyKey, customerId: payload.customerId,
    paymentMethod: payload.paymentMethod, expectedTotalCents: payload.expectedTotalCents,
    items: [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => ({ productId, quantity })) };
}

function storedProduct(snapshot) {
  const value = snapshotValue(snapshot);
  if (!value) return null;
  const id = snapshot.id;
  if (!catalogUuid(id) || !Number.isSafeInteger(value.stock) || value.stock < 0 || value.stock > 1_000_000 ||
      !Number.isSafeInteger(value.version) || value.version < 1 || typeof value.hasPhoto !== 'boolean') corrupt();
  const record = Object.fromEntries(productFields.map(field => [field, value[field]]));
  let normalized;
  try { normalized = normalizeProduct(record, id); } catch { corrupt(); }
  return { id, raw: value, ...normalized, stock: value.stock, version: value.version, updatedAt: date(value.updatedAt), hasPhoto: value.hasPhoto };
}

function existingOrNull(snapshot) {
  return snapshot?.exists ? snapshotValue(snapshot) : null;
}

export function createFirestoreSalesService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) {
    throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  }
  const repositories = createFirestoreRepositories(db);

  async function checkout(actor, payload) {
    const commandInput = normalizeCommand(payload);
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now();
      const principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'sales.create', { now: currentTime });
      const command = createCommandMetadata({ domain: 'sales', commandId: commandInput.idempotencyKey, operation: 'checkout', actor: principal.id,
        payloadHash: createCommandFingerprint(commandInput), now: new Date(currentTime), retentionMs: commandRetention(365) });
      const commandRef = repositories.ref('commands', commandDocumentId('sales', commandInput.idempotencyKey));
      const state = await inspectCommand(transaction, commandRef, command);
      if (state.status === 'COMMITTED') return state.result;
      const storedCommand = state.status === 'NEW' ? command : state.metadata;
      const createdAt = date(storedCommand.createdAt);
      const customerRef = commandInput.customerId ? repositories.ref('customers', commandInput.customerId) : null;
      const customerSnapshot = customerRef ? await transaction.get(customerRef) : null;
      if (customerRef && !customerSnapshot.exists) throw new ApiError(409, 'CUSTOMER_UNAVAILABLE');
      if (customerRef) snapshotValue(customerSnapshot);
      const products = [];
      for (const item of commandInput.items) {
        const snapshot = await repositories.transaction.get(transaction, 'products', item.productId);
        const value = storedProduct(snapshot);
        if (!value || value.active !== true) throw new ApiError(409, 'PRODUCT_UNAVAILABLE');
        products.push({ item, value });
      }
      const saleRef = repositories.ref('sales', commandInput.idempotencyKey);
      const eventRef = repositories.ref('domainEvents', `sales:${commandInput.idempotencyKey}`);
      const auditRef = repositories.ref('auditEvents', `sales:${commandInput.idempotencyKey}`);
      const saleSnapshot = await transaction.get(saleRef);
      const eventSnapshot = await transaction.get(eventRef);
      const auditSnapshot = await transaction.get(auditRef);
      const priorSale = existingOrNull(saleSnapshot), priorEvent = existingOrNull(eventSnapshot), priorAudit = existingOrNull(auditSnapshot);
      if (priorSale && priorSale.idempotencyKey !== commandInput.idempotencyKey ||
          priorEvent && (priorEvent.idempotencyKey !== commandInput.idempotencyKey || priorEvent.commandHash !== storedCommand.payloadHash) ||
          priorAudit && (priorAudit.commandId !== commandInput.idempotencyKey || priorAudit.entityId !== commandInput.idempotencyKey)) corrupt();
      const lines = [];
      let totalCents = 0;
      for (const { item, value } of products) {
        if (value.stock < item.quantity) throw new ApiError(409, 'INSUFFICIENT_STOCK');
        if (value.priceCents > 100_000_000) invalid();
        const subtotalCents = value.priceCents * item.quantity;
        totalCents += subtotalCents;
        if (!Number.isSafeInteger(subtotalCents) || !Number.isSafeInteger(totalCents)) invalid();
        lines.push({ productId: item.productId, quantity: item.quantity, title: value.title, unitPriceCents: value.priceCents,
          subtotalCents, expectedVersion: value.version, stockBefore: value.stock, stockAfter: value.stock - item.quantity });
      }
      if (totalCents !== commandInput.expectedTotalCents) throw new ApiError(409, 'SALE_PRICE_CHANGED');
      const receipt = { saleId: commandInput.idempotencyKey, totalCents, customerId: commandInput.customerId,
        paymentMethod: commandInput.paymentMethod, createdAt: createdAt.toISOString(), state: 'CONFIRMADA',
        items: lines.map(line => ({ productId: line.productId, quantity: line.quantity, title: line.title,
          unitPriceCents: line.unitPriceCents, subtotalCents: line.subtotalCents })) };
      const event = { schemaVersion: 2, type: 'SALE_COMMITTED', idempotencyKey: commandInput.idempotencyKey,
        commandHash: storedCommand.payloadHash, actorId: principal.id, actorRole: principal.role, createdAt: receipt.createdAt, lines, receipt };
      const sale = { id: commandInput.idempotencyKey, idempotencyKey: commandInput.idempotencyKey, createdAt,
        customerId: commandInput.customerId, attendantId: principal.id, totalCents, paymentMethod: commandInput.paymentMethod,
        status: 'CONFIRMADA', origin: 'CAIXA_DEV' };
      const audit = { id: `sales:${commandInput.idempotencyKey}`, at: receipt.createdAt, commandId: commandInput.idempotencyKey,
        actorId: principal.id, role: principal.role, operation: 'SALE_COMMITTED', entity: 'Vendas', entityId: commandInput.idempotencyKey,
        result: 'SUCESSO', requestId: commandInput.idempotencyKey, before: null, after: { totalCents, customerId: commandInput.customerId,
          paymentMethod: commandInput.paymentMethod, items: receipt.items }, detailsOmitted: false };
      const movements = lines.map(line => ({ id: `${commandInput.idempotencyKey}:${line.productId}`, commandId: commandInput.idempotencyKey,
        at: receipt.createdAt, productId: line.productId, type: 'SAIDA', quantity: line.quantity, stockBefore: line.stockBefore,
        stockAfter: line.stockAfter, versionBefore: line.expectedVersion, versionAfter: line.expectedVersion + 1,
        reason: 'VENDA', saleId: commandInput.idempotencyKey, operatorId: principal.id }));
      if (state.status === 'NEW') createPendingCommand(transaction, commandRef, command);
      for (const { value, item } of products) {
        repositories.transaction.set(transaction, 'products', item.productId, { ...value.raw, stock: value.stock - item.quantity,
          version: value.version + 1, updatedAt: createdAt, updatedBy: principal.id });
        enqueueStockAlertProjection(transaction, repositories, { productId: item.productId, version: value.version + 1, now: createdAt });
      }
      repositories.transaction.set(transaction, 'sales', commandInput.idempotencyKey, sale);
      for (const line of lines) {
        const itemRef = repositories.subref('sales', commandInput.idempotencyKey, 'items', line.productId);
        transaction.create(itemRef, { productId: line.productId, quantity: line.quantity, title: line.title,
          unitPriceCents: line.unitPriceCents, subtotalCents: line.subtotalCents });
      }
      for (const movement of movements) transaction.create(repositories.ref('stockMovements', movement.id), movement);
      if (!priorEvent) transaction.create(eventRef, event);
      if (!priorAudit) transaction.create(auditRef, audit);
      if (customerRef) transaction.update(customerRef, { lastPurchase: createdAt.toISOString() });
      commitCommand(transaction, commandRef, receipt, createdAt);
      return receipt;
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }

  async function receipt(actor, payload) {
    if (payload?.customerId !== null) throw new ApiError(409, 'CUSTOMER_UNAVAILABLE');
    throw new ApiError(503, 'FIRESTORE_OPERATION_NOT_READY');
  }

  return Object.freeze({ checkout, receipt });
}
