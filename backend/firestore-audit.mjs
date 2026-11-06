import { createHmac } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { auditSafeDetail, matchesAudit } from './audit-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const MAX_AUDIT = 5000;
const PAGE_SIZE = 25;
function invalid() { throw new ApiError(400, 'INVALID_AUDIT'); }
function unavailable() { throw new ApiError(503, 'AUDIT_UNAVAILABLE'); }
function date(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  unavailable();
}
function value(snapshot) {
  if (!snapshot || snapshot.exists !== true || typeof snapshot.data !== 'function') unavailable();
  const data = snapshot.data();
  if (!data || typeof data !== 'object' || Array.isArray(data)) unavailable();
  return data;
}
function dto(snapshot) {
  const raw = value(snapshot), id = raw.id || snapshot.id;
  if (!id || typeof raw.actorId !== 'string' || typeof raw.role !== 'string' || typeof raw.operation !== 'string' ||
      typeof raw.entity !== 'string' || typeof raw.entityId !== 'string' || typeof raw.result !== 'string' || typeof raw.requestId !== 'string') unavailable();
  return { id, at: date(raw.at), actorId: raw.actorId, role: raw.role, operation: raw.operation, entity: raw.entity, entityId: raw.entityId,
    result: raw.result, requestId: raw.requestId, before: auditSafeDetail(raw.before, raw.operation), after: auditSafeDetail(raw.after, raw.operation), detailsOmitted: raw.detailsOmitted === true };
}
function snapshotHash(config, filters, rows) {
  if (!config?.secret || !/^[a-f0-9]{64}$/i.test(config.secret)) throw new ApiError(503, 'FIRESTORE_CONFIGURATION_UNAVAILABLE');
  return createHmac('sha256', Buffer.from(config.secret, 'hex')).update('audit.snapshot.v1.' + JSON.stringify([config.environment, config.installationId, filters, rows])).digest('hex');
}

export function createFirestoreAuditService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  async function execute(operation, actor, payload) {
    if (!['list', 'export'].includes(operation)) throw new ApiError(400, 'INVALID_AUDIT');
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now();
      const principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'audit.read', { now: currentTime });
      if (!payload?.filters) invalid();
      const offset = operation === 'export' ? 0 : payload.offset;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 5000) invalid();
      const sourceSnapshot = await transaction.get(db.collection('auditEvents'));
      if (!sourceSnapshot || !Array.isArray(sourceSnapshot.docs) || sourceSnapshot.docs.length > MAX_AUDIT) unavailable();
      const rows = sourceSnapshot.docs.map(dto), snapshot = snapshotHash(config, payload.filters, rows.map(row => [row.id, row.at, row.actorId, row.operation, row.entity, row.entityId, row.result]));
      if (payload.snapshot && payload.snapshot !== snapshot) throw new ApiError(409, 'AUDIT_CHANGED');
      const filtered = rows.filter(row => matchesAudit(row, payload.filters)).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
      if (operation === 'export' && (filtered.length > 500 || filtered.length > 30000)) throw new ApiError(413, 'AUDIT_EXPORT_LIMIT');
      const items = operation === 'export' ? filtered : filtered.slice(offset, offset + PAGE_SIZE);
      const actorIds = new Set(rows.map(row => row.actorId));
      const peopleSnapshot = await transaction.get(db.collection('users'));
      const peopleById = new Map();
      if (!peopleSnapshot || !Array.isArray(peopleSnapshot.docs)) unavailable();
      for (const person of peopleSnapshot.docs) {
        const p = value(person), id = p.id || person.id;
        if (id) peopleById.set(id, { id, owner: p.owner === true, contact: typeof p.contact === 'string' ? p.contact : '', missing: false });
      }
      const people = [...actorIds].map(id => peopleById.get(id) || { id, owner: false, contact: '', missing: true });
      return { items, total: filtered.length, nextOffset: operation === 'export' ? null : offset + items.length < filtered.length ? offset + items.length : null,
        snapshot, sourceCount: rows.length, generatedAt: new Date(currentTime).toISOString(), people,
        operations: [...new Set(rows.map(row => row.operation))].sort(), results: [...new Set(rows.map(row => row.result))].sort() };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  return Object.freeze({ execute });
}
