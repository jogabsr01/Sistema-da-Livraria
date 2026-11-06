import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const HASH = /^[a-f0-9]{64}$/;
function invalid() { throw new ApiError(400, 'INVALID_CUSTOMER'); }
function unavailable() { throw new ApiError(503, 'CUSTOMER_UNAVAILABLE'); }
function date(value) {
  if (value === '' || value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  unavailable();
}
function snapshotValue(snapshot) {
  if (!snapshot || typeof snapshot.exists !== 'boolean') unavailable();
  if (!snapshot.exists) return null;
  const value = snapshot.data?.();
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  return value;
}
function customer(snapshot) {
  const value = snapshotValue(snapshot);
  if (!value) return null;
  const id = value.id || snapshot.id;
  if (!catalogUuid(id) || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.contact !== 'string' ||
      !HASH.test(value.cpfIndex || '') || !['NONE', 'WHATSAPP', 'EMAIL'].includes(value.contactPreference) || typeof value.marketingConsent !== 'boolean') unavailable();
  return { id, ...value, createdAt: date(value.createdAt), lastPurchase: date(value.lastPurchase), consentAt: date(value.consentAt) };
}

export function createFirestoreCustomerService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  async function execute(operation, actor, payload = {}) {
    if (!['find', 'get', 'save'].includes(operation)) throw new ApiError(400, 'INVALID_CUSTOMER');
    if (operation === 'save') return save(actor, payload);
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now(), principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'customers.read', { now: currentTime });
      let snapshot;
      if (operation === 'get') {
        if (!catalogUuid(payload?.id)) invalid();
        snapshot = await repositories.transaction.get(transaction, 'customers', payload.id);
      } else {
        if (!HASH.test(payload?.cpfIndex || '')) invalid();
        const query = db.collection('customers').where('cpfIndex', '==', payload.cpfIndex);
        const result = await transaction.get(query);
        if (!result || !Array.isArray(result.docs)) unavailable();
        if (result.docs.length > 1) unavailable();
        return { customer: result.docs.length ? customer(result.docs[0]) : null };
      }
      return { customer: customer(snapshot) };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  async function save(actor, payload) {
    if (!payload || !catalogUuid(payload.commandId) || !catalogUuid(payload.id) || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0 ||
        typeof payload.contact !== 'string' || !HASH.test(payload.cpfIndex || '') || !HASH.test(payload.fingerprint || '') ||
        !['NONE', 'WHATSAPP', 'EMAIL'].includes(payload.contactPreference) || typeof payload.marketingConsent !== 'boolean') invalid();
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now(), principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'customers.write', { now: currentTime });
      const command = createCommandMetadata({ domain: 'customers', commandId: payload.commandId, operation: 'save', actor: principal.id,
        payloadHash: payload.fingerprint, now: new Date(currentTime), retentionMs: commandRetention(90) });
      const commandRef = repositories.ref('commands', commandDocumentId('customers', payload.commandId));
      const state = await inspectCommand(transaction, commandRef, command);
      if (state.status === 'COMMITTED') return state.result;
      const stored = state.status === 'NEW' ? command : state.metadata, at = new Date(stored.createdAt);
      const currentSnapshot = await repositories.transaction.get(transaction, 'customers', payload.id), current = customer(currentSnapshot);
      if (current ? current.revision !== payload.expectedRevision : payload.expectedRevision !== 0) throw new ApiError(409, 'CUSTOMER_CONFLICT');
      const uniqueRef = repositories.ref('uniqueness', `customer-cpf:${payload.cpfIndex}`);
      const uniqueSnapshot = await transaction.get(uniqueRef), unique = snapshotValue(uniqueSnapshot);
      if (unique && unique.ownerId !== payload.id) throw new ApiError(409, 'CUSTOMER_DUPLICATE');
      const oldUniqueRef = current?.cpfIndex && current.cpfIndex !== payload.cpfIndex ? repositories.ref('uniqueness', `customer-cpf:${current.cpfIndex}`) : null;
      const oldUniqueSnapshot = oldUniqueRef ? await transaction.get(oldUniqueRef) : null;
      const eventRef = repositories.ref('domainEvents', `customers:${payload.commandId}`), auditRef = repositories.ref('auditEvents', `customers:${payload.commandId}`);
      const eventSnapshot = await transaction.get(eventRef), auditSnapshot = await transaction.get(auditRef);
      if (snapshotValue(eventSnapshot) || snapshotValue(auditSnapshot)) unavailable();
      const result = { id: payload.id, revision: payload.expectedRevision + 1 };
      const next = { id: payload.id, revision: result.revision, contact: payload.contact, cpfIndex: payload.cpfIndex,
        contactPreference: payload.contactPreference, marketingConsent: payload.marketingConsent, createdAt: current?.createdAt || at.toISOString(),
        lastPurchase: current?.lastPurchase || '', consentAt: current && current.marketingConsent === payload.marketingConsent ? current.consentAt : payload.marketingConsent ? at.toISOString() : current?.consentAt || '' };
      const event = { schemaVersion: 1, type: current ? 'CUSTOMER_UPDATED' : 'CUSTOMER_CREATED', commandId: payload.commandId, commandHash: command.payloadHash,
        actorId: principal.id, actorRole: principal.role, createdAt: at.toISOString(), entityId: payload.id, before: current ? { revision: current.revision } : null, after: { revision: result.revision } };
      if (state.status === 'NEW') createPendingCommand(transaction, commandRef, command);
      repositories.transaction.set(transaction, 'customers', payload.id, next);
      transaction.set(uniqueRef, { ownerId: payload.id, kind: 'CUSTOMER_CPF', value: payload.cpfIndex, version: result.revision, active: true });
      if (oldUniqueRef && oldUniqueSnapshot?.exists) transaction.delete(oldUniqueRef);
      transaction.create(eventRef, event);
      transaction.create(auditRef, { id: `customers:${payload.commandId}`, at: at.toISOString(), commandId: payload.commandId, actorId: principal.id, role: principal.role,
        operation: event.type, entity: 'Clientes', entityId: payload.id, result: 'SUCESSO', requestId: payload.commandId,
        before: event.before, after: event.after, detailsOmitted: true });
      commitCommand(transaction, commandRef, result, at);
      return result;
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  return Object.freeze({ execute });
}
