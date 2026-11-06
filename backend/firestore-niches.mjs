import { createHash } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { nicheInvalid, normalizeNiche } from './niche-model.mjs';
import { assertFirestoreDocumentSize, createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandFingerprint, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const MAX_NICHES = 200;
const MAX_PRODUCTS = 5000;

function corrupt() { throw new ApiError(503, 'NICHES_UNAVAILABLE'); }
function conflict() { throw new ApiError(409, 'NICHE_CONFLICT'); }
function duplicate() { throw new ApiError(409, 'NICHE_DUPLICATE'); }
function invalidImage() { throw new ApiError(400, 'INVALID_NICHE_IMAGE'); }

// Same reasoning as photoDescriptor() in firestore-catalog.mjs: the image
// lives in its own small Firestore document (not inline in the niche
// document, not in Drive), fetched only when the `image` operation is
// actually requested.
function imageDescriptor(photo) {
  if (!photo || typeof photo !== 'object' || typeof photo.bytes !== 'string' || photo.bytes.length > 65536 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.bytes) || typeof photo.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(photo.sha256)) invalidImage();
  const bytes = Buffer.from(photo.bytes, 'base64');
  if (bytes.length < 4 || bytes.length > 49152 || bytes.toString('base64') !== photo.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== photo.sha256) invalidImage();
  return { bytes: photo.bytes, sha256: photo.sha256 };
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
  const record = normalizeNiche(payload.record);
  const result = { commandId: payload.commandId, id: payload.id, expectedRevision: payload.expectedRevision, record };
  // null clears the image explicitly; a non-null image is validated here and
  // written to its own Firestore document by save() below.
  if (Object.hasOwn(payload, 'image')) result.image = payload.image === null ? null : imageDescriptor(payload.image);
  return result;
}

export function createFirestoreNicheService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  const options = { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 };

  async function principal(transaction, actor, currentTime, permission = 'niches.write') {
    const value = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
    requirePermission({ ...value, ...(config?.adminPasswordLogin === true ? { adminPasswordLogin: true } : {}) }, permission, { now: currentTime });
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
    const hasImage = Object.hasOwn(payload, 'image') ? payload.image !== null : current?.hasImage === true;
    const stored = { id: payload.id, ...payload.record, version: nextVersion, hasImage,
      createdAt: current?.createdAt || createdAt, createdBy: current?.createdBy || actingPrincipal.id, updatedAt: createdAt, updatedBy: actingPrincipal.id };
    const result = { id: payload.id, ...payload.record, version: nextVersion, hasImage: stored.hasImage };

    if (state.status === 'NEW') createPendingCommand(transaction, commandRef, metadata);
    if (current) repositories.transaction.update(transaction, 'niches', payload.id, stored);
    else repositories.transaction.create(transaction, 'niches', payload.id, stored);
    if (Object.hasOwn(payload, 'image')) {
      const mediaRef = repositories.subref('niches', payload.id, 'media', 'image');
      if (payload.image) { assertFirestoreDocumentSize(payload.image); transaction.set(mediaRef, { bytes: payload.image.bytes, sha256: payload.image.sha256, updatedAt: createdAt }); }
      else transaction.delete(mediaRef);
    }
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
    if (operation === 'image') {
      if (!payload || !catalogUuid(payload.id)) nicheInvalid();
      // Viewing the rendered image only needs read access, same split
      // niche-handler.mjs already enforces (products.read vs niches.write).
      return runFirestoreTransaction(db, async transaction => {
        const currentTime = now();
        await principal(transaction, actor, currentTime, 'products.read');
        const snapshot = await transaction.get(repositories.subref('niches', payload.id, 'media', 'image'));
        if (!snapshot.exists) throw new ApiError(404, 'NICHE_NOT_FOUND');
        const value = snapshot.data();
        if (typeof value?.bytes !== 'string' || typeof value?.sha256 !== 'string') corrupt();
        return { bytes: value.bytes, sha256: value.sha256 };
      }, options);
    }
    if (!['list', 'save'].includes(operation)) nicheInvalid();
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now();
      if (operation === 'list') return list(transaction, actor, currentTime);
      return save(transaction, actor, payload, currentTime);
    }, options);
  }

  return Object.freeze({ execute });
}
