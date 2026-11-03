import { createHmac } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { scheduleDate, scheduleTime } from './schedule-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { enqueueScheduleNotificationProjection } from './firestore-outbox.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const MAX_SCHEDULES = 500;
const MAX_PEOPLE = 500;

function invalid() { throw new ApiError(400, 'INVALID_SCHEDULE'); }
function unavailable() { throw new ApiError(503, 'SCHEDULE_UNAVAILABLE'); }
function date(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) unavailable();
  return result;
}
function snapshotValue(snapshot) {
  if (!snapshot || typeof snapshot.exists !== 'boolean') unavailable();
  if (!snapshot.exists) return null;
  const value = snapshot.data?.();
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  return value;
}
function schedule(snapshot) {
  const value = snapshotValue(snapshot);
  if (!value) return null;
  const id = value.id || snapshot.id;
  if (!catalogUuid(id) || !catalogUuid(value.employeeId) || !catalogUuid(value.createdBy) || !catalogUuid(value.updatedBy) ||
      !['RASCUNHO', 'PUBLICADA', 'CANCELADA'].includes(value.status) || !Number.isSafeInteger(value.version) || value.version < 1 ||
      typeof value.notes !== 'string' || !/^[a-f0-9]{64}$/.test(value.notesHash || '') || !catalogUuid(value.publishedBy) && value.publishedBy !== null ||
      value.publishedAt !== null && value.publishedAt !== undefined && !date(value.publishedAt)) unavailable();
  try { scheduleDate(value.date); scheduleTime(value.start); scheduleTime(value.end, 'end'); } catch { unavailable(); }
  if (value.end <= value.start || value.status === 'PUBLICADA' && value.publishedBy === null) unavailable();
  return { id, ...value, updatedAt: date(value.updatedAt).toISOString(), publishedAt: value.publishedAt ? date(value.publishedAt).toISOString() : null };
}
function notificationId(config, commandId, userId, type) {
  if (!config?.secret || !/^[a-f0-9]{64}$/i.test(config.secret)) throw new ApiError(503, 'FIRESTORE_CONFIGURATION_UNAVAILABLE');
  const digest = createHmac('sha256', Buffer.from(config.secret, 'hex')).update(JSON.stringify(['schedule.notification.v1', config.installationId, commandId, userId, type])).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
function peopleDto(snapshot, allowed = null) {
  const value = snapshotValue(snapshot), id = snapshot.id;
  if (!value || !catalogUuid(id) || !['ADMIN', 'SUPER_ADMIN', 'ATENDENTE'].includes(value.role) || typeof value.owner !== 'boolean' || typeof value.status !== 'string') unavailable();
  if (allowed && !allowed.has(id)) return null;
  return { id, role: value.role, owner: value.owner, active: value.status === 'ATIVO', contact: value.contact || '' };
}
function summary(value, revision) {
  return value ? { revision, employeeId: value.employeeId, date: value.date, start: value.start, end: value.end, status: value.status } : null;
}

export function createFirestoreScheduleService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);

  async function execute(operation, actor, payload = {}) {
    if (operation === 'list' || operation === 'get' || operation === 'people') return read(operation, actor, payload);
    if (!['save', 'cancel'].includes(operation)) throw new ApiError(400, 'INVALID_SCHEDULE');
    return mutate(operation, actor, payload);
  }

  async function read(operation, actor, payload) {
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now();
      const principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      const admin = ['ADMIN', 'SUPER_ADMIN'].includes(principal.role);
      if (operation === 'people') {
        requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'schedule.write', { now: currentTime });
        const peopleSnapshot = await transaction.get(db.collection('users'));
        if (!peopleSnapshot || !Array.isArray(peopleSnapshot.docs) || peopleSnapshot.docs.length > MAX_PEOPLE) unavailable();
        const people = peopleSnapshot.docs.map(snapshot => peopleDto(snapshot)).filter(Boolean).filter(person => person.active);
        return { people };
      }
      const permission = admin ? 'schedule.all.read' : 'schedule.self.read';
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, permission, { now: currentTime });
      if (operation === 'get') {
        if (!catalogUuid(payload?.id)) invalid();
        const snapshot = await repositories.transaction.get(transaction, 'schedules', payload.id);
        const value = schedule(snapshot);
        if (!value || !admin && (value.employeeId !== principal.id || value.status === 'RASCUNHO' || !value.publishedBy)) throw new ApiError(404, 'SCHEDULE_NOT_FOUND');
        const allowed = new Set([value.employeeId, value.createdBy, value.updatedBy, value.publishedBy].filter(Boolean));
        const peopleSnapshot = await transaction.get(db.collection('users'));
        const people = peopleSnapshot.docs.map(item => peopleDto(item, allowed)).filter(Boolean);
        return { items: [value], people };
      }
      if (!payload || typeof payload.from !== 'string' || typeof payload.to !== 'string' || !Number.isSafeInteger(payload.offset) || payload.offset < 0) invalid();
      try { scheduleDate(payload.from); scheduleDate(payload.to); } catch { invalid(); }
      if (payload.to < payload.from || (Date.parse(payload.to + 'T12:00Z') - Date.parse(payload.from + 'T12:00Z')) / 86400000 > 41 || payload.employeeId !== '' && !catalogUuid(payload.employeeId)) invalid();
      const schedulesSnapshot = await transaction.get(db.collection('schedules'));
      if (!schedulesSnapshot || !Array.isArray(schedulesSnapshot.docs) || schedulesSnapshot.docs.length > MAX_SCHEDULES) unavailable();
      const values = schedulesSnapshot.docs.map(schedule).filter(value => value && value.date >= payload.from && value.date <= payload.to &&
        (!payload.employeeId || value.employeeId === payload.employeeId) && (admin || value.employeeId === principal.id && value.status !== 'RASCUNHO' && value.publishedBy));
      values.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
      const allowed = new Set(values.flatMap(value => [value.employeeId, value.createdBy, value.updatedBy, value.publishedBy].filter(Boolean)));
      const peopleSnapshot = await transaction.get(db.collection('users'));
      const people = peopleSnapshot.docs.map(item => peopleDto(item, allowed)).filter(Boolean);
      if (people.length !== allowed.size) unavailable();
      return { items: values, people };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }

  async function mutate(operation, actor, payload) {
    if (!payload || !catalogUuid(payload.commandId) || !catalogUuid(payload.id) || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0 ||
        typeof payload.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(payload.fingerprint)) invalid();
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now(), principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'schedule.write', { now: currentTime });
      const metadata = createCommandMetadata({ domain: 'schedules', commandId: payload.commandId, operation, actor: principal.id,
        payloadHash: payload.fingerprint, now: new Date(currentTime), retentionMs: commandRetention(90) });
      const commandRef = repositories.ref('commands', commandDocumentId('schedules', payload.commandId));
      const state = await inspectCommand(transaction, commandRef, metadata);
      if (state.status === 'COMMITTED') return state.result;
      const stored = state.status === 'NEW' ? metadata : state.metadata;
      const at = date(stored.createdAt), currentSnapshot = await repositories.transaction.get(transaction, 'schedules', payload.id);
      const current = schedule(currentSnapshot);
      if (operation === 'cancel' && (!current || current.status === 'CANCELADA')) throw new ApiError(409, 'SCHEDULE_CONFLICT');
      if (current ? current.version !== payload.expectedRevision : payload.expectedRevision !== 0) throw new ApiError(409, 'SCHEDULE_CONFLICT');
      if (current && current.status === 'CANCELADA') throw new ApiError(409, 'SCHEDULE_CONFLICT');
      const allSnapshot = await transaction.get(db.collection('schedules'));
      if (!allSnapshot || !Array.isArray(allSnapshot.docs) || allSnapshot.docs.length > MAX_SCHEDULES) unavailable();
      const all = allSnapshot.docs.map(schedule).filter(Boolean);
      let next;
      if (operation === 'cancel') {
        next = { ...current, status: 'CANCELADA', version: payload.expectedRevision + 1, updatedAt: at.toISOString(), updatedBy: principal.id };
      } else {
        const record = payload.record;
        if (!record || !catalogUuid(record.employeeId) || !['RASCUNHO', 'PUBLICADA'].includes(record.status) || typeof record.date !== 'string' ||
            typeof record.start !== 'string' || typeof record.end !== 'string' || typeof record.notes !== 'string' || !/^[a-f0-9]{64}$/.test(payload.notesHash || '')) invalid();
        try { scheduleDate(record.date); scheduleTime(record.start); scheduleTime(record.end, 'end'); } catch { invalid(); }
        if (record.end <= record.start || current?.status === 'PUBLICADA' && record.status === 'RASCUNHO') throw new ApiError(409, 'SCHEDULE_CONFLICT');
        const employeeSnapshot = await repositories.transaction.get(transaction, 'users', record.employeeId), employee = peopleDto(employeeSnapshot);
        if (!employee || !employee.active) throw new ApiError(409, 'SCHEDULE_EMPLOYEE_UNAVAILABLE');
        if (current && current.employeeId === record.employeeId && current.date === record.date && current.start === record.start && current.end === record.end && current.status === record.status && current.notesHash === payload.notesHash) throw new ApiError(409, 'SCHEDULE_NO_CHANGE');
        if (all.some(item => item.id !== payload.id && item.status !== 'CANCELADA' && item.employeeId === record.employeeId && item.date === record.date && record.start < item.end && record.end > item.start)) throw new ApiError(409, 'SCHEDULE_OVERLAP');
        const published = record.status === 'PUBLICADA';
        next = { id: payload.id, employeeId: record.employeeId, date: record.date, start: record.start, end: record.end, notes: record.notes, notesHash: payload.notesHash,
          status: record.status, createdBy: current?.createdBy || principal.id, updatedAt: at.toISOString(), updatedBy: principal.id, version: payload.expectedRevision + 1,
          publishedBy: published ? current?.publishedBy || principal.id : null, publishedAt: published ? current?.publishedAt || at.toISOString() : null };
      }
      const plan = [];
      if (current?.status === 'PUBLICADA' && (operation === 'cancel' || current.employeeId !== next.employeeId)) plan.push({ id: notificationId(config, payload.commandId, current.employeeId, 'SCHEDULE_CANCELLED'), type: 'SCHEDULE_CANCELLED', recipientId: current.employeeId, scheduleId: payload.id, version: next.version, date: current.date, start: current.start, end: current.end });
      if (next.status === 'PUBLICADA') plan.push({ id: notificationId(config, payload.commandId, next.employeeId, current?.status === 'PUBLICADA' && current.employeeId === next.employeeId ? 'SCHEDULE_CHANGED' : 'SCHEDULE_PUBLISHED'), type: current?.status === 'PUBLICADA' && current.employeeId === next.employeeId ? 'SCHEDULE_CHANGED' : 'SCHEDULE_PUBLISHED', recipientId: next.employeeId, scheduleId: payload.id, version: next.version, date: next.date, start: next.start, end: next.end });
      const eventRef = repositories.ref('domainEvents', `schedules:${payload.commandId}`), auditRef = repositories.ref('auditEvents', `schedules:${payload.commandId}`);
      const eventSnapshot = await transaction.get(eventRef), auditSnapshot = await transaction.get(auditRef);
      if (snapshotValue(eventSnapshot) || snapshotValue(auditSnapshot)) unavailable();
      const before = current ? summary(current, current.version) : null;
      const after = summary(next, next.version);
      const event = { schemaVersion: 1, type: operation === 'cancel' ? 'SCHEDULE_CANCELLED' : 'SCHEDULE_SAVED', commandId: payload.commandId, commandHash: metadata.payloadHash,
        actorId: principal.id, actorRole: principal.role, createdAt: at.toISOString(), entityId: payload.id, before, after, notifications: plan.length };
      const result = { id: payload.id, version: next.version, status: next.status };
      if (state.status === 'NEW') createPendingCommand(transaction, commandRef, metadata);
      repositories.transaction.set(transaction, 'schedules', payload.id, next);
      transaction.create(eventRef, event);
      transaction.create(auditRef, { id: `schedules:${payload.commandId}`, at: at.toISOString(), commandId: payload.commandId, actorId: principal.id, role: principal.role,
        operation: next.status === 'CANCELADA' ? 'SCHEDULE_CANCEL' : !current ? 'SCHEDULE_CREATE' : current.status !== 'PUBLICADA' && next.status === 'PUBLICADA' ? 'SCHEDULE_PUBLISH' : 'SCHEDULE_UPDATE',
        entity: 'Escalas', entityId: payload.id, result: 'SUCESSO', requestId: payload.commandId, before, after: { ...after, notifications: plan.length, notesChanged: !current || current.notesHash !== next.notesHash }, detailsOmitted: true });
      if (plan.length) enqueueScheduleNotificationProjection(transaction, repositories, { commandId: payload.commandId, scheduleId: payload.id, version: next.version, plan, now: at });
      commitCommand(transaction, commandRef, result, at);
      return result;
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }

  return Object.freeze({ execute });
}
