import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandFingerprint, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const PAGE_SIZE = 25;
const MAX_NOTIFICATIONS = 5000;
const TYPES = new Set(['STOCK_ZERO', 'STOCK_LOW', 'SCHEDULE_PUBLISHED', 'SCHEDULE_CHANGED', 'SCHEDULE_CANCELLED', 'MAINTENANCE_COMPLETED']);
const STATES = new Set(['ABERTA', 'EM_ATENDIMENTO', 'RESOLVIDA']);
const PRIORITIES = new Set(['ALTA', 'MEDIA']);

function invalid() { throw new ApiError(400, 'INVALID_NOTIFICATION'); }
function unavailable() { throw new ApiError(503, 'NOTIFICATIONS_UNAVAILABLE'); }
function snapshotValue(snapshot) {
  if (!snapshot || typeof snapshot.exists !== 'boolean') unavailable();
  if (!snapshot.exists) return null;
  const value = snapshot.data?.();
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  return value;
}
function date(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) unavailable();
  return result;
}
function notification(snapshot) {
  const value = snapshotValue(snapshot);
  if (!value) return null;
  const id = value.id || snapshot.id;
  if (!catalogUuid(id) || !TYPES.has(value.type) || !PRIORITIES.has(value.priority) ||
      typeof value.title !== 'string' || !value.title || value.title.length > 300 || typeof value.message !== 'string' || !value.message || value.message.length > 300 ||
      !catalogUuid(value.referenceId) || !STATES.has(value.state) || !date(value.createdAt) ||
      value.resolvedAt !== null && value.resolvedAt !== undefined && !date(value.resolvedAt)) unavailable();
  if (value.type === 'STOCK_ZERO' && value.priority !== 'ALTA' || value.type === 'STOCK_LOW' && value.priority !== 'MEDIA') unavailable();
  if (value.type.startsWith('SCHEDULE_') && (value.priority !== 'MEDIA' || value.state !== 'ABERTA' || !catalogUuid(value.recipientId) ||
      !catalogUuid(value.scheduleId) || !/^20\d\d-\d\d-\d\d$/.test(value.date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.end || '') || value.end <= value.start)) unavailable();
  if (value.type === 'MAINTENANCE_COMPLETED' && (value.priority !== 'MEDIA' || value.state !== 'ABERTA')) unavailable();
  return { id, ...value, createdAt: date(value.createdAt).toISOString(), resolvedAt: value.resolvedAt ? date(value.resolvedAt).toISOString() : null };
}
function visible(value, principal) {
  const audience = value.audience || (value.type.startsWith('SCHEDULE_') ? 'USER' : value.type === 'MAINTENANCE_COMPLETED' ? 'ADMINS' : 'ALL_STAFF');
  if (audience === 'ALL_STAFF') return true;
  if (audience === 'ADMINS') return ['ADMIN', 'SUPER_ADMIN'].includes(principal.role);
  if (audience === 'USER') return value.recipientId === principal.id;
  unavailable();
}
function pending(value, read, history) {
  if (history) return true;
  return value.type.startsWith('STOCK_') ? value.state !== 'RESOLVIDA' : !read;
}
function dto(value, read, productValue) {
  if (value.type.startsWith('STOCK_')) {
    if (!productValue || !Number.isSafeInteger(productValue.stock) || !Number.isSafeInteger(productValue.minimumStock)) unavailable();
    return { id: value.id, productId: value.referenceId, type: value.type, priority: value.priority, title: value.title, state: value.state,
      createdAt: value.createdAt, resolvedAt: value.resolvedAt, read, stock: productValue.stock, minimumStock: productValue.minimumStock };
  }
  if (value.type.startsWith('SCHEDULE_')) return { recipientId: value.recipientId, id: value.id, scheduleId: value.scheduleId, type: value.type,
    priority: value.priority, title: value.title, message: value.message, state: value.state, createdAt: value.createdAt, resolvedAt: null,
    read, date: value.date, start: value.start, end: value.end };
  return { id: value.id, referenceId: value.referenceId, type: value.type, priority: value.priority, title: value.title,
    message: value.message, state: value.state, createdAt: value.createdAt, resolvedAt: null, read };
}

export function createFirestoreNotificationService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);

  async function list(operation, actor, payload = {}) {
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now();
      const principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'notifications.self.read', { now: currentTime });
      if (!Number.isSafeInteger(payload.offset) || payload.offset < 0 || payload.offset > 5000 || typeof payload.history !== 'boolean') invalid();
      const notificationsSnapshot = await transaction.get(db.collection('notifications'));
      const recipientQuery = db.collection('notificationRecipients').where('userId', '==', principal.id);
      const recipientsSnapshot = await transaction.get(recipientQuery);
      if (!notificationsSnapshot || !Array.isArray(notificationsSnapshot.docs) || notificationsSnapshot.docs.length > MAX_NOTIFICATIONS ||
          !recipientsSnapshot || !Array.isArray(recipientsSnapshot.docs)) unavailable();
      const reads = new Map();
      for (const item of recipientsSnapshot.docs) {
        const value = snapshotValue(item);
        if (value && value.notificationId && value.userId === principal.id) reads.set(value.notificationId, Boolean(value.readAt));
      }
      const all = notificationsSnapshot.docs.map(notification).filter(value => visible(value, principal));
      const filtered = all.filter(value => pending(value, reads.get(value.id) === true, payload.history));
      filtered.sort((a, b) => Number(a.state === 'RESOLVIDA') - Number(b.state === 'RESOLVIDA') ||
        Number(b.priority === 'ALTA') - Number(a.priority === 'ALTA') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const page = filtered.slice(payload.offset, payload.offset + PAGE_SIZE);
      const productIds = [...new Set(page.filter(value => value.type.startsWith('STOCK_')).map(value => value.referenceId))];
      const products = new Map();
      for (const id of productIds) {
        const productSnapshot = await repositories.transaction.get(transaction, 'products', id);
        const value = snapshotValue(productSnapshot);
        if (value) products.set(id, value);
      }
      const items = page.map(value => dto(value, reads.get(value.id) === true, products.get(value.referenceId)));
      const active = all.filter(value => pending(value, reads.get(value.id) === true, false));
      const result = { items, total: filtered.length, nextOffset: payload.offset + items.length < filtered.length ? payload.offset + items.length : null };
      if (operation === 'bootstrap') result.principal = principal;
      result.summary = { total: active.length, unread: active.filter(value => !reads.get(value.id)).length };
      return result;
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }

  async function summary(actor) {
    const result = await list('summary', actor, { offset: 0, history: false });
    return result.summary;
  }

  async function read(actor, payload) {
    if (!catalogUuid(payload?.id)) invalid();
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now();
      const principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'notifications.self.read', { now: currentTime });
      const notificationSnapshot = await repositories.transaction.get(transaction, 'notifications', payload.id);
      const value = notification(notificationSnapshot);
      if (!value || !visible(value, principal)) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND');
      const ref = repositories.ref('notificationRecipients', `${value.id}:${principal.id}`);
      const prior = await transaction.get(ref);
      if (!prior.exists) transaction.create(ref, { notificationId: value.id, userId: principal.id, readAt: new Date(currentTime), confirmedAt: null, createdAt: new Date(currentTime) });
      return { read: true };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }

  async function state(actor, payload) {
    if (!catalogUuid(payload?.commandId) || !catalogUuid(payload?.id) || !['ABERTA', 'EM_ATENDIMENTO'].includes(payload?.state)) invalid();
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now();
      const principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'notifications.manage', { now: currentTime });
      const command = createCommandMetadata({ domain: 'notifications', commandId: payload.commandId, operation: 'state', actor: principal.id,
        payloadHash: createCommandFingerprint({ id: payload.id, state: payload.state }), now: new Date(currentTime), retentionMs: commandRetention(90) });
      const commandRef = repositories.ref('commands', commandDocumentId('notifications', payload.commandId));
      const commandState = await inspectCommand(transaction, commandRef, command);
      if (commandState.status === 'COMMITTED') return commandState.result;
      const targetRef = repositories.ref('notifications', payload.id);
      const targetSnapshot = await transaction.get(targetRef);
      const target = notification(targetSnapshot);
      if (!target || !target.type.startsWith('STOCK_')) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND');
      if (target.state === 'RESOLVIDA') throw new ApiError(409, 'NOTIFICATION_CONFLICT');
      const auditRef = repositories.ref('auditEvents', `notifications:${payload.commandId}`);
      const auditSnapshot = await transaction.get(auditRef);
      if (snapshotValue(auditSnapshot)) throw new ApiError(503, 'NOTIFICATIONS_UNAVAILABLE');
      const result = { accepted: true };
      if (commandState.status === 'NEW') createPendingCommand(transaction, commandRef, command);
      repositories.transaction.update(transaction, 'notifications', payload.id, { state: payload.state, resolvedAt: null, resolvedBy: null, updatedAt: new Date(currentTime), updatedBy: principal.id });
      transaction.create(auditRef, { id: `notifications:${payload.commandId}`, at: new Date(currentTime).toISOString(), commandId: payload.commandId,
        actorId: principal.id, role: principal.role, operation: 'STOCK_ALERT_STATE', entity: 'Notificacoes', entityId: payload.id,
        result: 'ACEITO', requestId: payload.commandId, before: { state: target.state }, after: { id: payload.id, state: payload.state }, detailsOmitted: false });
      commitCommand(transaction, commandRef, result, new Date(currentTime));
      return result;
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }

  async function execute(operation, actor, payload = {}) {
    if (operation === 'bootstrap' || operation === 'list') return list(operation, actor, payload);
    if (operation === 'summary') return summary(actor);
    if (operation === 'read') return read(actor, payload);
    if (operation === 'state') return state(actor, payload);
    if (operation === 'report') throw new ApiError(503, 'FIRESTORE_OPERATION_NOT_READY');
    throw new ApiError(400, 'INVALID_NOTIFICATION');
  }

  return Object.freeze({ execute });
}
