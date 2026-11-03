import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const MAX_USERS = 5000;
const PAGE_SIZE = 25;
const HASH = /^[a-f0-9]{64}$/;
function invalid() { throw new ApiError(400, 'INVALID_STAFF'); }
function unavailable() { throw new ApiError(503, 'STAFF_UNAVAILABLE'); }
function date(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value);
  unavailable();
}
function snapshotValue(snapshot) {
  if (!snapshot || typeof snapshot.exists !== 'boolean') unavailable();
  if (!snapshot.exists) return null;
  const value = snapshot.data?.();
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  return value;
}
function user(snapshot) {
  const value = snapshotValue(snapshot);
  if (!value) return null;
  const id = value.id || snapshot.id;
  if (!catalogUuid(id) || !['ATENDENTE', 'ADMIN', 'SUPER_ADMIN'].includes(value.role) || !['ATIVO', 'INATIVO'].includes(value.status) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.activated !== 'boolean' || typeof value.contact !== 'string' ||
      !Number.isSafeInteger(value.authorizationVersion) || value.authorizationVersion < 1) unavailable();
  return { id, ...value, createdAt: value.createdAt ? date(value.createdAt).toISOString() : '', lastAccess: value.lastAccess ? date(value.lastAccess).toISOString() : '' };
}
function dto(value) {
  return { id: value.id, role: value.role, status: value.status, revision: value.revision, activated: value.activated,
    createdAt: value.createdAt, lastAccess: value.lastAccess, contact: value.contact, owner: value.owner === true };
}

export function createFirestoreStaffService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  async function execute(operation, actor, payload = {}) {
    if (!['bootstrap', 'list', 'save'].includes(operation)) throw new ApiError(400, 'INVALID_STAFF');
    if (operation === 'save') return save(actor, payload);
    return read(operation, actor, payload);
  }
  async function read(operation, actor, payload) {
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now(), principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'users.attendant.manage', { targetRole: 'ATENDENTE', now: currentTime });
      if (!Number.isSafeInteger(payload.offset) || payload.offset < 0 || payload.offset > 5000) invalid();
      const snapshot = await transaction.get(db.collection('users'));
      if (!snapshot || !Array.isArray(snapshot.docs) || snapshot.docs.length > MAX_USERS) unavailable();
      const users = snapshot.docs.map(snapshot => {
        const raw = snapshot.data?.();
        return raw?.owner === true ? null : user(snapshot);
      }).filter(value => value && ['ATENDENTE', 'ADMIN'].includes(value.role)).sort((a, b) => a.id.localeCompare(b.id));
      const page = users.slice(payload.offset, payload.offset + PAGE_SIZE).map(dto);
      const result = { total: users.length, nextOffset: payload.offset + page.length < users.length ? payload.offset + page.length : null, users: page };
      if (operation === 'bootstrap') result.principal = principal;
      return result;
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  async function save(actor, payload) {
    if (!payload || !catalogUuid(payload.commandId) || !catalogUuid(payload.id) || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0 ||
        !['ATENDENTE', 'ADMIN'].includes(payload.role) || !['ATIVO', 'INATIVO'].includes(payload.status) || typeof payload.contact !== 'string' ||
        !HASH.test(payload.emailIndex || '') || !HASH.test(payload.cpfIndex || '') || !HASH.test(payload.fingerprint || '') || typeof payload.reason !== 'string') invalid();
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now(), principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, payload.role === 'ADMIN' ? 'users.admin.manage' : 'users.attendant.manage', { targetRole: payload.role, now: currentTime });
      const command = createCommandMetadata({ domain: 'staff', commandId: payload.commandId, operation: 'save', actor: principal.id,
        payloadHash: payload.fingerprint, now: new Date(currentTime), retentionMs: commandRetention(90) });
      const commandRef = repositories.ref('commands', commandDocumentId('staff', payload.commandId));
      const state = await inspectCommand(transaction, commandRef, command);
      if (state.status === 'COMMITTED') return state.result;
      const stored = state.status === 'NEW' ? command : state.metadata, at = date(stored.createdAt);
      const targetRef = repositories.ref('users', payload.id), targetSnapshot = await transaction.get(targetRef), current = user(targetSnapshot);
      if (current ? current.revision !== payload.expectedRevision : payload.expectedRevision !== 0) throw new ApiError(409, 'STAFF_CONFLICT');
      if (current?.owner || current?.id === principal.id && (!current || current.role !== payload.role || current.status !== payload.status)) throw new ApiError(403, 'FORBIDDEN');
      const emailRef = repositories.ref('uniqueness', `staff-email:${payload.emailIndex}`), cpfRef = repositories.ref('uniqueness', `staff-cpf:${payload.cpfIndex}`);
      const emailSnapshot = await transaction.get(emailRef), cpfSnapshot = await transaction.get(cpfRef);
      const emailOwner = snapshotValue(emailSnapshot), cpfOwner = snapshotValue(cpfSnapshot);
      if (emailOwner && emailOwner.ownerId !== payload.id) throw new ApiError(409, 'STAFF_EMAIL_DUPLICATE');
      if (cpfOwner && cpfOwner.ownerId !== payload.id) throw new ApiError(409, 'STAFF_CPF_DUPLICATE');
      const oldEmailRef = current?.emailIndex && current.emailIndex !== payload.emailIndex ? repositories.ref('uniqueness', `staff-email:${current.emailIndex}`) : null;
      const oldCpfRef = current?.cpfIndex && current.cpfIndex !== payload.cpfIndex ? repositories.ref('uniqueness', `staff-cpf:${current.cpfIndex}`) : null;
      const oldEmailSnapshot = oldEmailRef ? await transaction.get(oldEmailRef) : null, oldCpfSnapshot = oldCpfRef ? await transaction.get(oldCpfRef) : null;
      const eventRef = repositories.ref('domainEvents', `staff:${payload.commandId}`), auditRef = repositories.ref('auditEvents', `staff:${payload.commandId}`);
      const eventSnapshot = await transaction.get(eventRef), auditSnapshot = await transaction.get(auditRef);
      if (snapshotValue(eventSnapshot) || snapshotValue(auditSnapshot)) unavailable();
      const revision = payload.expectedRevision + 1, changedAuthorization = !current || current.role !== payload.role || current.status !== payload.status;
      const result = { id: payload.id, revision, reenrollmentRequired: changedAuthorization || !current?.activated };
      const next = { id: payload.id, role: payload.role, status: payload.status, revision, activated: current?.activated === true && !changedAuthorization,
        createdAt: current?.createdAt || at.toISOString(), lastAccess: current?.lastAccess || '', contact: payload.contact, emailIndex: payload.emailIndex,
        cpfIndex: payload.cpfIndex, owner: false, authorizationVersion: changedAuthorization ? (current?.authorizationVersion || 1) + 1 : current?.authorizationVersion || 1,
        updatedAt: at, updatedBy: principal.id, reason: payload.reason };
      const event = { schemaVersion: 1, type: current ? 'STAFF_UPDATED' : 'STAFF_CREATED', commandId: payload.commandId, commandHash: command.payloadHash,
        actorId: principal.id, actorRole: principal.role, createdAt: at.toISOString(), entityId: payload.id, before: current ? { revision: current.revision, role: current.role, status: current.status } : null,
        after: { revision, role: payload.role, status: payload.status } };
      if (state.status === 'NEW') createPendingCommand(transaction, commandRef, command);
      repositories.transaction.set(transaction, 'users', payload.id, next);
      transaction.set(emailRef, { ownerId: payload.id, kind: 'STAFF_EMAIL', value: payload.emailIndex, active: true, version: revision });
      transaction.set(cpfRef, { ownerId: payload.id, kind: 'STAFF_CPF', value: payload.cpfIndex, active: true, version: revision });
      if (oldEmailRef && oldEmailSnapshot?.exists) transaction.delete(oldEmailRef);
      if (oldCpfRef && oldCpfSnapshot?.exists) transaction.delete(oldCpfRef);
      transaction.create(eventRef, event);
      transaction.create(auditRef, { id: `staff:${payload.commandId}`, at: at.toISOString(), commandId: payload.commandId, actorId: principal.id, role: principal.role,
        operation: event.type, entity: 'Usuarios', entityId: payload.id, result: 'SUCESSO', requestId: payload.commandId, before: event.before, after: event.after, detailsOmitted: true });
      commitCommand(transaction, commandRef, result, at);
      return result;
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  return Object.freeze({ execute });
}
