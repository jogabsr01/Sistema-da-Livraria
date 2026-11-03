import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { nicheInvalid, normalizeNiche } from './niche-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandFingerprint, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const MAX_NICHES = 200;
const MAX_PRODUCTS = 5000;

function corrupt() { throw new ApiError(503, 'NICHES_UNAVAILABLE'); }
function conflict() { throw new ApiError(409, 'NICHE_CONFLICT'); }
function duplicate() { throw new ApiError(409, 'NICHE_DUPLICATE'); }
function imageUnavailable() { throw new ApiError(503, 'NICHE_IMAGE_UNAVAILABLE'); }

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
  const value = snapshot.data?.();
  if (!value || typeof value !== 'object' || Array.isArray(value)) corrupt();
  return value;
}

function nicheStored(snapshot) {
  const value = snapshotValue(snapshot);
  if (!value) return null;
  const id = snapshot.id;
  if (!catalogUuid(id) || !Number.isSafeInteger(value.version) || value.version < 1 || typeof value.hasImage !== 'boolean') corrupt();
  let record;
  try { record = normalizeNiche({ name: value.name, description: value.description, color: value.color, order: value.order, active: value.active }); }
  catch { corrupt(); }
  return { id, ...record, version: value.version, hasImage: value.hasImage, createdAt: value.createdAt, createdBy: value.createdBy };
}

function uniquenessKey(name) {
  return `niche-name:${name.trim().toLowerCase()}`;
}

function nicheSavePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !['commandId', 'id', 'expectedRevision', 'record', 'image', 'fingerprint'].includes(key)) ||
      !catalogUuid(payload.commandId) || !catalogUuid(payload.id) ||
      !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0 || payload.expectedRevision > 1_000_000) nicheInvalid();
  // No asset adapter exists yet (capas/imagens continuam só referência, fora do
  // documento). A niche background image is explicitly unavailable, the same
  // way firestore-catalog.mjs blocks a non-null product cover today.
  if (Object.hasOwn(payload, 'image') && payload.image !== null) imageUnavailable();
  const record = normalizeNiche(payload.record);
  return { commandId: payload.commandId, id: payload.id, expectedRevision: payload.expectedRevision, record };
}

export function createFirestoreNicheService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  const options = { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 };

  async function principal(transaction, actor, currentTime) {
    const value = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
    requirePermission({ ...value, ...(config?.adminPasswordLogin === true ? { adminPasswordLogin: true } : {}) }, 'niches.write', { now: currentTime });
    return value;
  }

  async function list(transaction, actor, currentTime) {
    await principal(transaction, actor, currentTime);
    const nichesSnapshot = await transaction.get(db.collection('niches'));
    if (!nichesSnapshot || !Array.isArray(nichesSnapshot.docs) || nichesSnapshot.docs.length > MAX_NICHES) corrupt();
    const niches = nichesSnapshot.docs.map(snapshot => nicheStored(snapshot));
    const productsSnapshot = await transaction.get(db.collection('products'));
    if (!productsSnapshot || !Array.isArray(productsSnapshot.docs) || productsSnapshot.docs.length > MAX_PRODUCTS) corrupt();
    const counts = new Map();
    for (const snapshot of productsSnapshot.docs) {
      const value = snapshot.data?.();
      if (!Array.isArray(value?.nicheIds)) continue;
      for (const nicheId of value.nicheIds) counts.set(nicheId, (counts.get(nicheId) || 0) + 1);
    }
    return { niches: niches.map(niche => ({ ...niche, productCount: Math.min(counts.get(niche.id) || 0, MAX_PRODUCTS) })) };
  }

  async function save(transaction, actor, rawPayload, currentTime) {
    const payload = nicheSavePayload(rawPayload);
    const actingPrincipal = await principal(transaction, actor, currentTime);

    const metadata = createCommandMetadata({ domain: 'niches', commandId: payload.commandId, operation: 'save', actor: actingPrincipal.id,
      payloadHash: createCommandFingerprint({ id: payload.id, expectedRevision: payload.expectedRevision, record: payload.record }),
      now: new Date(currentTime), retentionMs: commandRetention(90) });
    const commandRef = repositories.ref('commands', commandDocumentId('niches', payload.commandId));
    const state = await inspectCommand(transaction, commandRef, metadata);
    if (state.status === 'COMMITTED') return state.result;
    const storedCommand = state.status === 'NEW' ? metadata : state.metadata;
    const createdAt = date(storedCommand.createdAt);

    const nicheRef = repositories.ref('niches', payload.id);
    const nicheSnapshot = await transaction.get(nicheRef);
    const current = nicheSnapshot.exists ? nicheStored(nicheSnapshot) : null;
    if ((current && current.version !== payload.expectedRevision) || (!current && payload.expectedRevision !== 0)) conflict();

    const uniqueRef = repositories.ref('uniqueness', uniquenessKey(payload.record.name));
    const uniqueSnapshot = await transaction.get(uniqueRef);
    const uniqueOwner = snapshotValue(uniqueSnapshot);
    if (uniqueOwner && uniqueOwner.nicheId !== payload.id) duplicate();
    const renaming = current && uniquenessKey(current.name) !== uniquenessKey(payload.record.name);
    const oldUniqueRef = renaming ? repositories.ref('uniqueness', uniquenessKey(current.name)) : null;
    if (oldUniqueRef) await transaction.get(oldUniqueRef);

    const eventRef = repositories.ref('domainEvents', `niches:${payload.commandId}`);
    const auditRef = repositories.ref('auditEvents', `niches:${payload.commandId}`);
    const eventSnapshot = await transaction.get(eventRef);
    const auditSnapshot = await transaction.get(auditRef);
    if (snapshotValue(eventSnapshot) || snapshotValue(auditSnapshot)) corrupt();

    const nextVersion = payload.expectedRevision + 1;
    const stored = { id: payload.id, ...payload.record, version: nextVersion, hasImage: current?.hasImage === true,
      createdAt: current?.createdAt || createdAt, createdBy: current?.createdBy || actingPrincipal.id, updatedAt: createdAt, updatedBy: actingPrincipal.id };
    const result = { id: payload.id, ...payload.record, version: nextVersion, hasImage: stored.hasImage };

    if (state.status === 'NEW') createPendingCommand(transaction, commandRef, metadata);
    if (current) repositories.transaction.update(transaction, 'niches', payload.id, stored);
    else repositories.transaction.create(transaction, 'niches', payload.id, stored);
    repositories.transaction.set(transaction, 'uniqueness', uniquenessKey(payload.record.name), { nicheId: payload.id });
    if (oldUniqueRef) repositories.transaction.delete(transaction, 'uniqueness', uniquenessKey(current.name));

    const summary = value => ({ name: value.name, description: value.description, color: value.color, order: value.order, active: value.active, version: value.version });
    const before = current ? summary(current) : null;
    const after = { ...summary(stored), descriptionChanged: !current || current.description !== payload.record.description };
    transaction.create(eventRef, { schemaVersion: 1, type: current ? 'NICHE_UPDATED' : 'NICHE_CREATED', idempotencyKey: payload.commandId,
      commandHash: storedCommand.payloadHash, actorId: actingPrincipal.id, actorRole: actingPrincipal.role, createdAt: createdAt.toISOString(), before, after });
    transaction.create(auditRef, { id: `niches:${payload.commandId}`, at: createdAt.toISOString(), commandId: payload.commandId, actorId: actingPrincipal.id,
      role: actingPrincipal.role, operation: current ? 'NICHE_UPDATE' : 'NICHE_CREATE', entity: 'Nichos', entityId: payload.id, result: 'SUCESSO',
      requestId: payload.commandId, before, after, detailsOmitted: false });

    commitCommand(transaction, commandRef, result, createdAt);
    return result;
  }

  async function execute(operation, actor, payload) {
    if (operation === 'image') imageUnavailable();
    if (!['list', 'save'].includes(operation)) nicheInvalid();
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now();
      if (operation === 'list') return list(transaction, actor, currentTime);
      return save(transaction, actor, payload, currentTime);
    }, options);
  }

  return Object.freeze({ execute });
}
