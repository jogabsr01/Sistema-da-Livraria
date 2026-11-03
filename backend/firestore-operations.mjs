import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid, normalizeProduct, productFields } from './catalog-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandFingerprint, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { enqueueStockAlertProjection } from './firestore-outbox.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const MAX_STOCK = 1_000_000;
const PAYMENT_METHODS = new Set(['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO']);

function invalid() { throw new ApiError(400, 'INVALID_OPERATION'); }
function corrupt() { throw new ApiError(503, 'JOURNAL_INVALID'); }
function snapshotValue(snapshot) {
  if (!snapshot || typeof snapshot.exists !== 'boolean') corrupt();
  if (!snapshot.exists) return null;
  const value = snapshot.data?.();
  if (!value || typeof value !== 'object' || Array.isArray(value)) corrupt();
  return value;
}
function date(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) corrupt();
  return result;
}
function product(snapshot) {
  const value = snapshotValue(snapshot);
  if (!value) return null;
  const id = snapshot.id;
  if (!catalogUuid(id) || !Number.isSafeInteger(value.stock) || value.stock < 0 || value.stock > MAX_STOCK ||
      !Number.isSafeInteger(value.version) || value.version < 1) corrupt();
  let record;
  try { record = normalizeProduct(Object.fromEntries(productFields.map(field => [field, value[field]])), id); } catch { corrupt(); }
  return { id, raw: value, ...record, stock: value.stock, version: value.version, updatedAt: date(value.updatedAt) };
}
function commandInput(operation, payload) {
  if (!payload || typeof payload !== 'object' || !catalogUuid(payload.commandId)) invalid();
  if (operation === 'adjust') {
    if (!catalogUuid(payload.id) || !Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 1 ||
        !Number.isSafeInteger(payload.newStock) || payload.newStock < 0 || payload.newStock > MAX_STOCK || typeof payload.reason !== 'string') invalid();
    return { commandId: payload.commandId, id: payload.id, expectedVersion: payload.expectedVersion, newStock: payload.newStock, reason: payload.reason };
  }
  if (operation === 'reverse') {
    if (!catalogUuid(payload.saleId) || typeof payload.reason !== 'string') invalid();
    return { commandId: payload.commandId, saleId: payload.saleId, reason: payload.reason };
  }
  invalid();
}

function operationSale(snapshot, items = []) {
  const value = snapshotValue(snapshot), saleId = value && (value.id || snapshot.id), actorId = value?.attendantId || value?.actorId;
  if (!value || !catalogUuid(saleId) || !catalogUuid(actorId) || value.customerId !== null && value.customerId !== undefined && !catalogUuid(value.customerId) ||
      !PAYMENT_METHODS.has(value.paymentMethod) || !Number.isSafeInteger(value.totalCents) || value.totalCents < 0 ||
      !['CONFIRMADA', 'CANCELADA'].includes(value.status)) corrupt();
  const createdAt = date(value.createdAt).toISOString();
  return { saleId, actorId, customerId: value.customerId ?? null, createdAt, totalCents: value.totalCents,
    paymentMethod: value.paymentMethod, state: value.status, items };
}

function operationItem(snapshot) {
  const value = snapshotValue(snapshot);
  if (!value || !catalogUuid(value.productId) || !Number.isSafeInteger(value.quantity) || value.quantity < 1 ||
      !Number.isSafeInteger(value.unitPriceCents) || value.unitPriceCents < 0 || !Number.isSafeInteger(value.subtotalCents) ||
      value.subtotalCents !== value.quantity * value.unitPriceCents || typeof value.title !== 'string' || value.title.length > 300) corrupt();
  return { productId: value.productId, title: value.title, quantity: value.quantity, unitPriceCents: value.unitPriceCents, subtotalCents: value.subtotalCents };
}

async function readOperations({ db, repositories, identityService, config, operation, actor, payload, now, transactionOptions }) {
  return runFirestoreTransaction(db, async transaction => {
    const currentTime = now();
    const principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
    const permission = principal.role === 'ATENDENTE' ? 'sales.self.read' : 'audit.read';
    requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, permission, { now: currentTime });
    if (operation === 'get') {
      if (!catalogUuid(payload?.id)) invalid();
      const saleRef = repositories.ref('sales', payload.id);
      const saleSnapshot = await transaction.get(saleRef);
      const sale = snapshotValue(saleSnapshot);
      if (!sale || principal.role === 'ATENDENTE' && (sale.attendantId || sale.actorId) !== principal.id) throw new ApiError(404, 'SALE_NOT_FOUND');
      const itemSnapshot = await transaction.get(saleRef.collection('items'));
      if (!itemSnapshot || !Array.isArray(itemSnapshot.docs) || itemSnapshot.docs.length > 100) corrupt();
      const items = itemSnapshot.docs.map(operationItem);
      return { sale: operationSale(saleSnapshot, items) };
    }
    if (operation !== 'list' || !payload || typeof payload.from !== 'string' || typeof payload.to !== 'string' ||
        !Number.isSafeInteger(payload.offset) || payload.offset < 0 || payload.offset > 2000) invalid();
    const from = Date.parse(payload.from), to = Date.parse(payload.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 366 * 86400000) invalid();
    const salesSnapshot = await transaction.get(db.collection('sales'));
    if (!salesSnapshot || !Array.isArray(salesSnapshot.docs) || salesSnapshot.docs.length > 2000) throw new ApiError(503, 'OPERATIONS_UNAVAILABLE');
    const sales = salesSnapshot.docs.map(snapshot => operationSale(snapshot)).filter(sale => {
      const at = Date.parse(sale.createdAt);
      return at >= from && at <= to && (principal.role !== 'ATENDENTE' || sale.actorId === principal.id);
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.saleId.localeCompare(b.saleId));
    const page = sales.slice(payload.offset, payload.offset + 20);
    return { sales: page, total: sales.length, nextOffset: payload.offset + page.length < sales.length ? payload.offset + page.length : null };
  }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
}

export async function reconcileFirestoreStock({ db, now = () => Date.now() } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  return runFirestoreTransaction(db, async transaction => {
    const productsSnapshot = await transaction.get(db.collection('products'));
    const movementsSnapshot = await transaction.get(db.collection('stockMovements'));
    if (!productsSnapshot || !Array.isArray(productsSnapshot.docs) || !movementsSnapshot || !Array.isArray(movementsSnapshot.docs)) corrupt();
    const products = new Map(), mismatches = [], movements = new Map();
    for (const snapshot of productsSnapshot.docs) {
      try { const value = product(snapshot); products.set(value.id, value); } catch { mismatches.push({ productId: snapshot.id, code: 'PROJECTION_CONFLICT' }); }
    }
    for (const snapshot of movementsSnapshot.docs) {
      try {
        const value = snapshotValue(snapshot);
        if (!catalogUuid(value.productId) || !['ENTRADA', 'SAIDA', 'AJUSTE', 'ESTORNO'].includes(value.type) ||
            !Number.isSafeInteger(value.quantity) || value.quantity < 1 || !Number.isSafeInteger(value.stockBefore) ||
            !Number.isSafeInteger(value.stockAfter) || !Number.isSafeInteger(value.versionBefore) || !Number.isSafeInteger(value.versionAfter) ||
            value.versionAfter !== value.versionBefore + 1 || value.stockBefore < 0 || value.stockAfter < 0 || value.stockAfter > MAX_STOCK) throw Error('invalid');
        if (!movements.has(value.productId)) movements.set(value.productId, []);
        movements.get(value.productId).push(value);
      } catch { mismatches.push({ movementId: snapshot.id, code: 'PROJECTION_CONFLICT' }); }
    }
    for (const [productId, list] of movements) {
      const current = products.get(productId);
      if (!current) { mismatches.push({ productId, code: 'PROJECTION_CONFLICT' }); continue; }
      list.sort((a, b) => a.versionBefore - b.versionBefore || String(a.id).localeCompare(String(b.id)));
      let stock = list[0].stockBefore, version = list[0].versionBefore;
      for (const movement of list) {
        const validDelta = movement.type === 'ENTRADA' || movement.type === 'ESTORNO' ? movement.stockAfter === movement.stockBefore + movement.quantity :
          movement.type === 'SAIDA' ? movement.stockAfter === movement.stockBefore - movement.quantity : movement.stockAfter !== movement.stockBefore &&
          Math.abs(movement.stockAfter - movement.stockBefore) === movement.quantity;
        if (movement.versionBefore < version || movement.stockBefore !== stock || !validDelta) mismatches.push({ movementId: movement.id, code: 'PROJECTION_CONFLICT' });
        stock = movement.stockAfter; version = movement.versionAfter;
      }
      if (current.stock !== stock || current.version < version) mismatches.push({ productId, code: 'PROJECTION_CONFLICT' });
    }
    return { checkedProducts: products.size, checkedMovements: [...movements.values()].reduce((count, list) => count + list.length, 0), mismatches, checkedAt: new Date(now()).toISOString() };
  }, { maxAttempts: 3 });
}

export function createFirestoreOperationsService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);

  async function execute(operation, actor, payload) {
    if (operation === 'list' || operation === 'get') return readOperations({ db, repositories, identityService, config, operation, actor, payload, now, transactionOptions });
    const input = commandInput(operation, payload);
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now();
      const principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, operation === 'adjust' ? 'stock.adjust' : 'sales.reverse', { now: currentTime });
      const metadata = createCommandMetadata({ domain: 'operations', commandId: input.commandId, operation, actor: principal.id,
        payloadHash: createCommandFingerprint(input), now: new Date(currentTime), retentionMs: commandRetention(365) });
      const commandRef = repositories.ref('commands', commandDocumentId('operations', input.commandId));
      const state = await inspectCommand(transaction, commandRef, metadata);
      if (state.status === 'COMMITTED') return state.result;
      const storedCommand = state.status === 'NEW' ? metadata : state.metadata;
      const createdAt = date(storedCommand.createdAt);
      if (operation === 'adjust') return adjust(transaction, { db, repositories, principal, input, state, metadata, commandRef, createdAt, currentTime });
      return reverse(transaction, { db, repositories, principal, input, state, metadata, commandRef, createdAt, currentTime });
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }

  return Object.freeze({ execute });
}

async function adjust(transaction, { db, repositories, principal, input, state, metadata, commandRef, createdAt }) {
  const productRef = repositories.ref('products', input.id);
  const productSnapshot = await transaction.get(productRef);
  const current = product(productSnapshot);
  if (!current) throw new ApiError(409, 'PRODUCT_UNAVAILABLE');
  if (current.version !== input.expectedVersion) throw new ApiError(409, 'OPERATION_CONFLICT');
  if (current.stock === input.newStock) throw new ApiError(409, 'STOCK_NO_CHANGE');
  const eventRef = repositories.ref('domainEvents', `operations:${input.commandId}`);
  const auditRef = repositories.ref('auditEvents', `operations:${input.commandId}`);
  const movementRef = repositories.ref('stockMovements', `${input.commandId}:${input.id}`);
  const eventSnapshot = await transaction.get(eventRef), auditSnapshot = await transaction.get(auditRef), movementSnapshot = await transaction.get(movementRef);
  if (snapshotValue(eventSnapshot) || snapshotValue(auditSnapshot) || snapshotValue(movementSnapshot)) corrupt();
  const result = { commandId: input.commandId, id: input.id, version: input.expectedVersion + 1,
    stockBefore: current.stock, stockAfter: input.newStock, createdAt: createdAt.toISOString() };
  const event = { schemaVersion: 1, type: 'STOCK_ADJUSTED', idempotencyKey: input.commandId, commandHash: metadata.payloadHash,
    actorId: principal.id, actorRole: principal.role, createdAt: createdAt.toISOString(), command: input, receipt: result,
    lines: [{ id: input.id, expectedVersion: input.expectedVersion, before: current.stock, after: input.newStock }] };
  if (state.status === 'NEW') createPendingCommand(transaction, commandRef, metadata);
  repositories.transaction.set(transaction, 'products', input.id, { ...current.raw, stock: input.newStock, version: input.expectedVersion + 1,
    updatedAt: createdAt, updatedBy: principal.id });
  enqueueStockAlertProjection(transaction, repositories, { productId: input.id, version: input.expectedVersion + 1, now: createdAt });
  repositories.transaction.set(transaction, 'productSearch', input.id, { productId: input.id, active: current.active, nicheIds: current.nicheIds,
    tokens: [], updatedAt: createdAt, version: input.expectedVersion + 1 });
  transaction.create(movementRef, { id: `${input.commandId}:${input.id}`, commandId: input.commandId, at: createdAt.toISOString(), productId: input.id,
    type: 'AJUSTE', quantity: Math.abs(input.newStock - current.stock), stockBefore: current.stock, stockAfter: input.newStock,
    versionBefore: input.expectedVersion, versionAfter: input.expectedVersion + 1, reason: input.reason, saleId: null, operatorId: principal.id });
  transaction.create(eventRef, event);
  transaction.create(auditRef, { id: `operations:${input.commandId}`, at: createdAt.toISOString(), commandId: input.commandId, actorId: principal.id,
    role: principal.role, operation: 'STOCK_ADJUSTED', entity: 'Produtos', entityId: input.id, result: 'SUCESSO', requestId: input.commandId,
    before: { version: input.expectedVersion, stock: current.stock }, after: { version: input.expectedVersion + 1, stock: input.newStock, reason: input.reason }, detailsOmitted: false });
  commitCommand(transaction, commandRef, result, createdAt);
  return result;
}

async function reverse(transaction, { db, repositories, principal, input, state, metadata, commandRef, createdAt }) {
  const saleRef = repositories.ref('sales', input.saleId);
  const saleSnapshot = await transaction.get(saleRef);
  const sale = snapshotValue(saleSnapshot);
  if (!sale) throw new ApiError(404, 'SALE_NOT_FOUND');
  if (sale.status !== 'CONFIRMADA' || !PAYMENT_METHODS.has(sale.paymentMethod) || !Number.isSafeInteger(sale.totalCents)) throw new ApiError(409, 'OPERATION_CONFLICT');
  const itemSnapshot = await transaction.get(saleRef.collection('items'));
  if (!itemSnapshot || !Array.isArray(itemSnapshot.docs) || !itemSnapshot.docs.length || itemSnapshot.docs.length > 100) corrupt();
  const items = itemSnapshot.docs.map(snapshot => {
    const value = snapshotValue(snapshot);
    if (!catalogUuid(value.productId) || !Number.isSafeInteger(value.quantity) || value.quantity < 1 ||
        !Number.isSafeInteger(value.unitPriceCents) || !Number.isSafeInteger(value.subtotalCents) || value.subtotalCents !== value.quantity * value.unitPriceCents) corrupt();
    return value;
  });
  const products = [];
  for (const item of items) {
    const snapshot = await repositories.transaction.get(transaction, 'products', item.productId);
    const current = product(snapshot);
    if (!current || current.stock + item.quantity > MAX_STOCK) throw new ApiError(409, 'STOCK_LIMIT');
    products.push({ item, current });
  }
  const eventRef = repositories.ref('domainEvents', `operations:${input.commandId}`);
  const auditRef = repositories.ref('auditEvents', `operations:${input.commandId}`);
  const eventSnapshot = await transaction.get(eventRef), auditSnapshot = await transaction.get(auditRef);
  if (snapshotValue(eventSnapshot) || snapshotValue(auditSnapshot)) corrupt();
  const lines = products.map(({ item, current }) => ({ id: item.productId, expectedVersion: current.version,
    before: current.stock, after: current.stock + item.quantity }));
  const result = { commandId: input.commandId, saleId: input.saleId, state: 'CANCELADA', totalCents: sale.totalCents,
    paymentMethod: sale.paymentMethod, createdAt: createdAt.toISOString() };
  const event = { schemaVersion: 1, type: 'SALE_REVERSED', idempotencyKey: input.commandId, commandHash: metadata.payloadHash,
    actorId: principal.id, actorRole: principal.role, createdAt: createdAt.toISOString(), command: input, receipt: result, lines };
  if (state.status === 'NEW') createPendingCommand(transaction, commandRef, metadata);
  for (const { item, current } of products) {
    repositories.transaction.set(transaction, 'products', item.productId, { ...current.raw, stock: current.stock + item.quantity,
      version: current.version + 1, updatedAt: createdAt, updatedBy: principal.id });
    enqueueStockAlertProjection(transaction, repositories, { productId: item.productId, version: current.version + 1, now: createdAt });
    transaction.create(repositories.ref('stockMovements', `${input.commandId}:${item.productId}`), { id: `${input.commandId}:${item.productId}`,
      commandId: input.commandId, at: createdAt.toISOString(), productId: item.productId, type: 'ESTORNO', quantity: item.quantity,
      stockBefore: current.stock, stockAfter: current.stock + item.quantity, versionBefore: current.version, versionAfter: current.version + 1,
      reason: input.reason, saleId: input.saleId, operatorId: principal.id });
  }
  repositories.transaction.update(transaction, 'sales', input.saleId, { status: 'CANCELADA', updatedAt: createdAt, updatedBy: principal.id });
  transaction.create(eventRef, event);
  transaction.create(auditRef, { id: `operations:${input.commandId}`, at: createdAt.toISOString(), commandId: input.commandId, actorId: principal.id,
    role: principal.role, operation: 'SALE_REVERSED', entity: 'Vendas', entityId: input.saleId, result: 'SUCESSO', requestId: input.commandId,
    before: { state: 'CONFIRMADA' }, after: { state: 'CANCELADA', totalCents: sale.totalCents, paymentMethod: sale.paymentMethod }, detailsOmitted: false });
  commitCommand(transaction, commandRef, result, createdAt);
  return result;
}
