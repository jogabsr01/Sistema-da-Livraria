import { createHash } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid, normalizeProduct, productFields } from './catalog-model.mjs';
import { assertFirestoreDocumentSize, createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandFingerprint, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { enqueueStockAlertProjection } from './firestore-outbox.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const PRODUCT_LIMIT = 5000;
const NICHE_LIMIT = 200;
const PAGE_SIZE = 10;
const SEARCH_FIELDS = ['title', 'author', 'isbn', 'internalCode', 'sku'];

function unavailable() {
  throw new ApiError(503, 'CATALOG_UNAVAILABLE');
}

function notReady() {
  throw new ApiError(503, 'FIRESTORE_OPERATION_NOT_READY');
}

// The cover never lives inline in the product document (every list/bootstrap
// read would then drag ~64KB of base64 per row for every page), nor in
// Drive (a service account has no Drive storage quota of its own, and
// Workspace-only workarounds like Shared Drives/domain delegation don't
// apply to a personal Google account). It lives in its own small Firestore
// document, fetched only when the `cover` operation is actually requested.
function photoDescriptor(photo) {
  if (!photo || typeof photo !== 'object' || typeof photo.bytes !== 'string' || photo.bytes.length > 65536 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.bytes) || typeof photo.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(photo.sha256)) {
    throw new ApiError(400, 'INVALID_COVER_PHOTO');
  }
  const bytes = Buffer.from(photo.bytes, 'base64');
  if (bytes.length < 4 || bytes.length > 49152 || bytes.toString('base64') !== photo.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== photo.sha256) {
    throw new ApiError(400, 'INVALID_COVER_PHOTO');
  }
  return { bytes: photo.bytes, sha256: photo.sha256 };
}

function date(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  unavailable();
}

function data(snapshot) {
  if (!snapshot || snapshot.exists !== true || typeof snapshot.data !== 'function') unavailable();
  const value = snapshot.data();
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  return value;
}

function normalizeSearch(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function product(snapshot, detailed = false) {
  const value = data(snapshot), id = snapshot.id;
  if (!catalogUuid(id) || !Number.isSafeInteger(value.stock) || value.stock < 0 || value.stock > 1_000_000 ||
      !Number.isSafeInteger(value.version) || value.version < 1 || typeof value.hasPhoto !== 'boolean') unavailable();
  const record = Object.fromEntries(productFields.map(field => [field, value[field]]));
  let normalized;
  try { normalized = normalizeProduct(record, id); } catch { unavailable(); }
  const result = {
    id,
    ...normalized,
    stock: value.stock,
    version: value.version,
    updatedAt: date(value.updatedAt),
    hasPhoto: value.hasPhoto,
  };
  if (!detailed) {
    delete result.supplier;
    delete result.synopsis;
  }
  return result;
}

function niche(snapshot) {
  const value = data(snapshot), id = snapshot.id;
  if (!catalogUuid(id) || typeof value.name !== 'string' || !value.name || value.name.length > 100 ||
      typeof value.description !== 'string' || value.description.length > 1000 ||
      !/^#[a-fA-F0-9]{6}$/.test(value.color) || !Number.isSafeInteger(value.order) || value.order < 0 ||
      typeof value.active !== 'boolean' || !Number.isSafeInteger(value.version) || value.version < 0 ||
      typeof value.hasImage !== 'boolean') unavailable();
  return { id, name: value.name, description: value.description, color: value.color, order: value.order,
    active: value.active, version: value.version, hasImage: value.hasImage };
}

function page(products, payload) {
  const needle = normalizeSearch(payload.search);
  const filtered = products.filter(value =>
    (payload.includeInactive || value.active) &&
    (!payload.nicheId || value.nicheIds.includes(payload.nicheId)) &&
    (!needle || SEARCH_FIELDS.some(field => normalizeSearch(value[field]).includes(needle)))
  ).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const values = filtered.slice(payload.offset, payload.offset + PAGE_SIZE);
  return { products: values, total: filtered.length,
    nextOffset: payload.offset + values.length < filtered.length ? payload.offset + values.length : null };
}

function permissionFor(operation, payload) {
  if (operation === 'bootstrap') return payload.create ? 'products.write' : 'products.read';
  if (operation === 'save') return 'products.write';
  if (operation === 'receive') return 'stock.receive';
  if (operation === 'remove') return 'products.delete';
  return 'products.read';
}

function snapshotValue(snapshot) {
  if (!snapshot || typeof snapshot.exists !== 'boolean') unavailable();
  if (!snapshot.exists) return null;
  if (typeof snapshot.data !== 'function') unavailable();
  const value = snapshot.data();
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  return value;
}

function storedProduct(snapshot) {
  if (!snapshot || snapshot.exists !== true) return null;
  const value = data(snapshot);
  const current = product(snapshot, true);
  return { raw: value, ...current };
}

function productSummary(record, version, stock, hasPhoto) {
  return { version, stock, isbn: record.isbn, internalCode: record.internalCode, title: record.title,
    author: record.author, publisher: record.publisher, edition: record.edition, supplier: record.supplier,
    priceCents: record.priceCents, minimumStock: record.minimumStock, category: record.category,
    ...(record.productType !== undefined ? { productType: record.productType } : {}), ...(record.subtitle !== undefined ? { subtitle: record.subtitle } : {}), ...(record.costCents !== undefined ? { costCents: record.costCents } : {}), ...(record.sku !== undefined ? { sku: record.sku } : {}),
    year: record.year, pages: record.pages, active: record.active, nicheIds: record.nicheIds, hasPhoto };
}

function reservationKeys(record) {
  const result = [];
  if (record.active && record.isbn) result.push({ id: `active-isbn:${record.isbn}`, kind: 'ISBN', value: record.isbn });
  if (record.active && record.internalCode) result.push({ id: `active-code:${record.internalCode}`, kind: 'CODE', value: record.internalCode });
  if (record.active && record.sku) result.push({ id: `active-sku:${record.sku.toUpperCase()}`, kind: 'SKU', value: record.sku.toUpperCase() });
  return result;
}

function searchTokens(record) {
  const tokens = new Set();
  for (const field of SEARCH_FIELDS) {
    const value = normalizeSearch(record[field]);
    for (let size = 1; size <= 3; size++) {
      for (let index = 0; index + size <= value.length; index++) tokens.add(value.slice(index, index + size));
    }
  }
  return [...tokens].sort();
}

function commandDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) unavailable();
  return result;
}

async function executeCatalogMutation({ db, repositories, identityService, config, operation, actor, payload, now, transactionOptions }) {
  if (!['save', 'receive', 'remove'].includes(operation)) notReady();
  const tokenHash = actor?.sessionTokenHash;
  return runFirestoreTransaction(db, async transaction => {
    const currentTime = now();
    const principal = await identityService.readSessionInTransaction(transaction, tokenHash, currentTime);
    requirePermission({ ...principal, ...(config?.adminPasswordLogin === true ? { adminPasswordLogin: true } : {}), ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, permissionFor(operation, payload), { now: currentTime });
    if (operation === 'save' && payload?.initialStock > 0) requirePermission({ ...principal, ...(config?.adminPasswordLogin === true ? { adminPasswordLogin: true } : {}), ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'stock.receive', { now: currentTime });
    if (!payload || !catalogUuid(payload.commandId) || !catalogUuid(payload.id)) throw new ApiError(400, 'INVALID_PRODUCT');
    const photo = Object.hasOwn(payload, 'photo') && payload.photo !== null ? photoDescriptor(payload.photo) : null;
    const commandPayload = { ...payload, ...(Object.hasOwn(payload, 'photo') ? { photo: payload.photo === null ? null : { sha256: photo.sha256 } } : {}) };
    const payloadHash = createCommandFingerprint(commandPayload);
    const metadata = createCommandMetadata({ domain: 'catalog', commandId: payload.commandId, operation, actor: principal.id,
      payloadHash, now: new Date(currentTime), retentionMs: commandRetention(90) });
    const commandRef = repositories.ref('commands', commandDocumentId('catalog', payload.commandId));
    const state = await inspectCommand(transaction, commandRef, metadata);
    if (state.status === 'COMMITTED') return state.result;
    const command = state.status === 'NEW' ? metadata : state.metadata;
    const commandCreatedAt = commandDate(command.createdAt);
    const productSnapshot = await repositories.transaction.get(transaction, 'products', payload.id);
    const existing = storedProduct(productSnapshot);
    const existingRecord = existing ? Object.fromEntries(productFields.map(field => [field, existing[field]])) : null;
    if (operation === 'receive' && !existing) throw new ApiError(409, 'PRODUCT_UNAVAILABLE');
    if (operation === 'remove' && !existing) throw new ApiError(404, 'CATALOG_NOT_FOUND');
    if (operation === 'remove' && existing.active !== true) throw new ApiError(409, 'CATALOG_CONFLICT');
    if (existing ? existing.version !== payload.expectedVersion : payload.expectedVersion !== 0) throw new ApiError(409, 'CATALOG_CONFLICT');
    if ((!existing && payload.record?.active === false) || existing && Object.hasOwn(payload, 'record') && payload.record.active !== existing.active) {
      if (!['ADMIN', 'SUPER_ADMIN'].includes(principal.role)) throw new ApiError(403, 'FORBIDDEN');
    }
    if (Object.hasOwn(payload, 'initialStock') && (operation !== 'save' || existing || !Number.isSafeInteger(payload.initialStock) || payload.initialStock < 0 || payload.initialStock > 1_000_000)) throw new ApiError(400, 'INVALID_PRODUCT');
    let record = payload.record;
    if (operation === 'remove') {
      record = { ...existingRecord, active: false };
    }
    if (operation === 'receive') record = existingRecord;
    if (!record || typeof record !== 'object') throw new ApiError(400, 'INVALID_PRODUCT');
    try { record = normalizeProduct(record, payload.id); } catch { throw new ApiError(400, 'INVALID_PRODUCT'); }
    if (existing?.hasPhoto && record.coverUrl && !Object.hasOwn(payload, 'photo')) throw new ApiError(400, 'INVALID_COVER_PHOTO');
    const nicheSnapshot = operation === 'receive' ? null : await transaction.get(db.collection('niches'));
    const nicheMap = new Map();
    if (nicheSnapshot) {
      if (!Array.isArray(nicheSnapshot.docs) || nicheSnapshot.docs.length > NICHE_LIMIT) unavailable();
      nicheSnapshot.docs.map(item => niche(item)).forEach(item => nicheMap.set(item.id, item));
      const oldNiches = existing?.nicheIds || [];
      if (record.nicheIds.some(id => !nicheMap.has(id) || !nicheMap.get(id).active && !oldNiches.includes(id))) throw new ApiError(400, 'CATALOG_INVALID');
    }
    if (!existing) {
      const products = await transaction.get(db.collection('products'));
      if (!products || !Array.isArray(products.docs) || products.docs.length >= PRODUCT_LIMIT) unavailable();
    }
    const oldKeys = existing ? reservationKeys(existing) : [];
    const newKeys = operation === 'receive' ? oldKeys : reservationKeys(record);
    const allKeys = new Map([...oldKeys, ...newKeys].map(item => [item.id, item]));
    const reservations = new Map();
    for (const item of allKeys.values()) {
      const snapshot = await repositories.transaction.get(transaction, 'uniqueness', item.id);
      reservations.set(item.id, { ref: repositories.ref('uniqueness', item.id), value: snapshotValue(snapshot) });
    }
    const nextVersion = payload.expectedVersion + 1;
    const stockBefore = existing?.stock ?? 0;
    const stockAfter = operation === 'receive' ? stockBefore + payload.quantity : !existing ? payload.initialStock ?? 0 : stockBefore;
    if (operation === 'receive' && (!Number.isSafeInteger(payload.quantity) || payload.quantity < 1 || stockAfter > 1_000_000)) throw new ApiError(409, 'STOCK_LIMIT');
    const hasPhoto = Object.hasOwn(payload, 'photo') ? payload.photo !== null : existing?.hasPhoto === true;
    const nextProduct = {
      ...record, stock: stockAfter, version: nextVersion, createdAt: existing?.raw.createdAt || commandCreatedAt,
      createdBy: existing?.raw.createdBy || principal.id, updatedAt: commandCreatedAt, updatedBy: principal.id, hasPhoto,
    };
    const before = existing ? productSummary(existing, existing.version, existing.stock, existing.hasPhoto) : null;
    const after = productSummary(record, nextVersion, stockAfter, hasPhoto);
    const result = operation === 'receive'
      ? { commandId: payload.commandId, id: payload.id, quantity: payload.quantity, version: nextVersion, stockBefore, stockAfter, createdAt: commandCreatedAt.toISOString() }
      : { id: payload.id, version: nextVersion };
    const event = { schemaVersion: 1, type: operation === 'receive' ? 'STOCK_RECEIVED' : 'PRODUCT_SAVED', commandId: payload.commandId,
      commandHash: command.payloadHash, actorId: principal.id, actorRole: principal.role, entityId: payload.id,
      createdAt: commandCreatedAt.toISOString(), before, after, result };
    const eventRef = repositories.ref('domainEvents', `catalog:${payload.commandId}`);
    const auditRef = repositories.ref('auditEvents', `catalog:${payload.commandId}`);
    const eventSnapshot = await transaction.get(eventRef), auditSnapshot = await transaction.get(auditRef);
    const priorEvent = snapshotValue(eventSnapshot), priorAudit = snapshotValue(auditSnapshot);
    if (priorEvent && (priorEvent.commandId !== event.commandId || priorEvent.commandHash !== event.commandHash)) throw new ApiError(503, 'FIRESTORE_COMMAND_CORRUPT');
    if (priorAudit && (priorAudit.commandId !== payload.commandId || priorAudit.entityId !== payload.id)) throw new ApiError(503, 'FIRESTORE_COMMAND_CORRUPT');
    const hasMovement = operation === 'receive' || !existing && stockAfter > 0;
    const movementRef = hasMovement ? repositories.ref('stockMovements', `${payload.commandId}:${payload.id}`) : null;
    const movementSnapshot = movementRef ? await transaction.get(movementRef) : null;
    const movement = hasMovement ? { id: `${payload.commandId}:${payload.id}`, at: event.createdAt, productId: payload.id,
      type: 'ENTRADA', quantity: operation === 'receive' ? payload.quantity : stockAfter, stockBefore, stockAfter, versionBefore: payload.expectedVersion,
      versionAfter: nextVersion, reason: operation === 'receive' ? payload.reason : 'ESTOQUE_INICIAL', saleId: null, operatorId: principal.id } : null;
    if (movementSnapshot && snapshotValue(movementSnapshot) && snapshotValue(movementSnapshot).commandId !== payload.commandId) throw new ApiError(503, 'FIRESTORE_COMMAND_CORRUPT');
    for (const item of newKeys) {
      const reservation = reservations.get(item.id);
      if (reservation.value && reservation.value.ownerId !== payload.id) throw new ApiError(409, 'CATALOG_DUPLICATE');
    }
    for (const item of oldKeys) {
      if (!newKeys.some(next => next.id === item.id)) {
        const reservation = reservations.get(item.id);
        if (reservation.value && reservation.value.ownerId !== payload.id) throw new ApiError(503, 'CATALOG_UNAVAILABLE');
      }
    }
    if (state.status === 'NEW') createPendingCommand(transaction, commandRef, metadata);
    repositories.transaction.set(transaction, 'products', payload.id, nextProduct);
    if (Object.hasOwn(payload, 'photo')) {
      const mediaRef = repositories.subref('products', payload.id, 'media', 'cover');
      if (photo) { assertFirestoreDocumentSize(photo); transaction.set(mediaRef, { bytes: photo.bytes, sha256: photo.sha256, updatedAt: commandCreatedAt }); }
      else transaction.delete(mediaRef);
    }
    repositories.transaction.set(transaction, 'productSearch', payload.id, { productId: payload.id, active: record.active,
      nicheIds: record.nicheIds, tokens: searchTokens(record), updatedAt: commandCreatedAt, version: nextVersion });
    enqueueStockAlertProjection(transaction, repositories, { productId: payload.id, version: nextVersion, now: commandCreatedAt });
    for (const item of newKeys) {
      const reservation = reservations.get(item.id);
      if (reservation.value && reservation.value.ownerId !== payload.id) throw new ApiError(409, 'CATALOG_DUPLICATE');
      repositories.transaction.set(transaction, 'uniqueness', item.id, { ownerId: payload.id, kind: item.kind, value: item.value, version: nextVersion, active: true });
    }
    for (const item of oldKeys) {
      if (!newKeys.some(next => next.id === item.id)) {
        const reservation = reservations.get(item.id);
        if (reservation.value && reservation.value.ownerId !== payload.id) throw new ApiError(503, 'CATALOG_UNAVAILABLE');
        if (reservation.value) repositories.transaction.delete(transaction, 'uniqueness', item.id);
      }
    }
    if (!priorEvent) transaction.create(eventRef, event);
    if (!priorAudit) transaction.create(auditRef, { id: `catalog:${payload.commandId}`, at: event.createdAt, commandId: payload.commandId,
      actorId: principal.id, role: principal.role, operation: operation === 'receive' ? 'STOCK_RECEIVED' : existing ? 'PRODUCT_UPDATE' : 'PRODUCT_CREATE',
      entity: 'Produtos', entityId: payload.id, result: 'SUCESSO', requestId: payload.commandId, before, after, detailsOmitted: false });
    if (movement && !movementSnapshot?.exists) transaction.create(movementRef, { ...movement, commandId: payload.commandId });
    commitCommand(transaction, commandRef, result, commandCreatedAt);
    return result;
  }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
}

export function createFirestoreCatalogService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) {
    throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  }
  const repositories = createFirestoreRepositories(db);

  async function execute(operation, actor, payload = {}) {
    if (!['bootstrap', 'list', 'get', 'niches', 'cover', 'save', 'receive', 'remove'].includes(operation)) notReady();
    const tokenHash = actor?.sessionTokenHash;
    if (['save', 'receive', 'remove'].includes(operation)) {
      return executeCatalogMutation({ db, repositories, identityService, config, operation, actor, payload, now, transactionOptions });
    }
    return runFirestoreTransaction(db, async transaction => {
      const current = now();
      const principal = await identityService.readSessionInTransaction(transaction, tokenHash, current);
      requirePermission({ ...principal, ...(config?.adminPasswordLogin === true ? { adminPasswordLogin: true } : {}), ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, permissionFor(operation, payload), { now: current });
      if (operation === 'get') {
        const snapshot = await repositories.transaction.get(transaction, 'products', payload.id);
        return { product: product(snapshot, true) };
      }
      if (operation === 'cover') {
        const snapshot = await transaction.get(repositories.subref('products', payload.id, 'media', 'cover'));
        if (!snapshot.exists) throw new ApiError(404, 'CATALOG_NOT_FOUND');
        const value = snapshot.data();
        if (typeof value?.bytes !== 'string' || typeof value?.sha256 !== 'string') unavailable();
        return { bytes: value.bytes, sha256: value.sha256 };
      }
      const nicheSnapshot = await transaction.get(db.collection('niches'));
      if (!nicheSnapshot || !Array.isArray(nicheSnapshot.docs) || nicheSnapshot.docs.length > NICHE_LIMIT) unavailable();
      const niches = nicheSnapshot.docs.map(item => niche(item)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      if (operation === 'niches') return { niches };
      if (operation === 'bootstrap' && payload.create === true) return { principal, niches, products: [], total: 0, nextOffset: null };
      const productSnapshot = await transaction.get(db.collection('products'));
      if (!productSnapshot || !Array.isArray(productSnapshot.docs) || productSnapshot.docs.length > PRODUCT_LIMIT) unavailable();
      const products = productSnapshot.docs.map(item => product(item, false));
      const result = page(products, payload);
      if (operation === 'bootstrap') return { principal, niches, ...result };
      return result;
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }

  return Object.freeze({ execute });
}
