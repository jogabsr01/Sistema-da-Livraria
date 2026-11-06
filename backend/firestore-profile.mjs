import { enqueueEmailDelivery } from './firestore-outbox.mjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { requirePermission } from './authorization.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { commandDocumentId, commandRetention, commitCommand, createCommandMetadata, createPendingCommand, inspectCommand } from './firestore-commands.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';
import { normalizeCpf } from './staff-model.mjs';

function invalid() { throw new ApiError(400, 'INVALID_PROFILE'); }
function unavailable() { throw new ApiError(503, 'PROFILE_UNAVAILABLE'); }
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
function profile(snapshot) {
  const value = snapshotValue(snapshot);
  if (!value) throw new ApiError(404, 'PROFILE_NOT_FOUND');
  const id = value.id || snapshot.id;
  if (!catalogUuid(id) || !['SUPER_ADMIN', 'ADMIN', 'ATENDENTE'].includes(value.role) || typeof value.owner !== 'boolean' ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.contact !== 'string' || typeof value.hasPhoto !== 'boolean') unavailable();
  return { id, role: value.role, owner: value.owner, revision: value.revision, contact: value.contact, email: value.email || '',
    hasPhoto: value.hasPhoto, lastAccess: date(value.lastAccess), cpfIndex: value.cpfIndex || '', emailIndex: value.emailIndex || '' };
}

function emailDto(value) {
  if (!value || !['EMAIL', 'IDLE', 'COMPLETE'].includes(value.stage)) unavailable();
  return { commandId: value.commandId ?? null, stage: value.stage, revision: value.revision ?? null, expiresAt: value.expiresAt ?? null };
}
function equalHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function photoDescriptor(photo) {
  if (!photo || typeof photo.bytes !== 'string' || photo.bytes.length > 65536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.bytes) || !/^[a-f0-9]{64}$/.test(photo.sha256 || '')) invalid();
  const bytes = Buffer.from(photo.bytes, 'base64');
  if (bytes.length < 4 || bytes.length > 49152 || bytes.toString('base64') !== photo.bytes || bytes[0] !== 255 || bytes[1] !== 216 || createHash('sha256').update(bytes).digest('hex') !== photo.sha256) invalid();
  return { bytes: photo.bytes, sha256: photo.sha256 };
}

export function createFirestoreProfileService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  const emailFlowRef = userId => repositories.ref('authFlows', `email-change:${userId}`);
  async function emailChange(operation, actor, payload) {
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now(), principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPasswordLogin === true ? { adminPasswordLogin: true } : {}) }, operation === 'emailState' ? 'profile.self.read' : 'profile.self.write', { targetUserId: principal.id, now: currentTime });
      const reference = emailFlowRef(principal.id), flowSnapshot = await transaction.get(reference), flow = snapshotValue(flowSnapshot);
      if (operation === 'emailState') {
        if (!flow || flow.sessionId !== principal.sessionId || flow.authorizationVersion !== principal.authorizationVersion) return emailDto({ stage: 'IDLE' });
        return emailDto({ commandId: flow.commandId, stage: flow.state === 'COMPLETE' ? 'COMPLETE' : flow.state === 'EMAIL' && new Date(flow.expiresAt).getTime() > currentTime ? 'EMAIL' : 'IDLE', revision: flow.state === 'COMPLETE' ? flow.revision : null, expiresAt: flow.state === 'EMAIL' ? new Date(flow.expiresAt).toISOString() : null });
      }
      if (operation === 'emailCancel') {
        if (!flow || flow.commandId !== payload.commandId || flow.sessionId !== principal.sessionId) throw new ApiError(409, 'EMAIL_CHANGE_CONFLICT');
        if (flow.state === 'EMAIL') repositories.transaction.update(transaction, 'authFlows', `email-change:${principal.id}`, { state: 'REVOKED', updatedAt: new Date(currentTime) });
        return emailDto({ commandId: flow.commandId, stage: 'IDLE', revision: null, expiresAt: null });
      }
      if (operation === 'emailStart') {
        if (!payload || !catalogUuid(payload.commandId) || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0 ||
            typeof payload.delivery !== 'string' || typeof payload.emailIndex !== 'string' || !/^[a-f0-9]{64}$/.test(payload.emailIndex) ||
            !/^[a-f0-9]{64}$/.test(payload.codeHash || '') || !/^[A-Za-z0-9_-]{43}$/.test(payload.code || '') || typeof payload.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(payload.fingerprint)) invalid();
        if (flow && flow.commandId === payload.commandId) {
          if (flow.fingerprint !== payload.fingerprint || flow.sessionId !== principal.sessionId) throw new ApiError(409, 'EMAIL_CHANGE_CONFLICT');
          return emailDto({ commandId: flow.commandId, stage: flow.state === 'EMAIL' ? 'EMAIL' : 'COMPLETE', revision: flow.state === 'COMPLETE' ? flow.revision : null, expiresAt: flow.state === 'EMAIL' ? new Date(flow.expiresAt).toISOString() : null });
        }
        const userSnapshot = await repositories.transaction.get(transaction, 'users', principal.id), user = profile(userSnapshot);
        if (user.revision !== payload.expectedRevision || user.emailIndex === payload.emailIndex) throw new ApiError(409, 'EMAIL_CHANGE_CONFLICT');
        const duplicate = await transaction.get(db.collection('users').where('emailIndex', '==', payload.emailIndex));
        if (duplicate?.docs?.some(snapshot => snapshot.id !== principal.id)) throw new ApiError(409, 'EMAIL_CHANGE_CONFLICT');
        const createdAt = new Date(currentTime), expiresAt = new Date(currentTime + 900000), next = { version: 1, commandId: payload.commandId, userId: principal.id,
          sessionId: principal.sessionId, authorizationVersion: principal.authorizationVersion, role: principal.role, revision: user.revision,
          fingerprint: payload.fingerprint, sourceHash: payload.sourceHash, target: payload.delivery, emailIndex: payload.emailIndex,
          contact: payload.contact, codeHash: payload.codeHash, codeExpiresAt: expiresAt, attempts: 0, state: 'EMAIL', createdAt, expiresAt, sendWindow: createdAt, sendCount: 1 };
        transaction.create(reference, next);
        enqueueEmailDelivery(transaction, repositories, { settings: config.firestore, idempotencyKey: `email-change:${payload.commandId}`, to: payload.delivery,
          subject: 'Livraria IPB — confirmar novo e-mail', text: `Código de uso único (válido por 15 minutos):\n${payload.code}\n\nNão compartilhe o código.`, now: createdAt });
        return emailDto({ commandId: payload.commandId, stage: 'EMAIL', revision: null, expiresAt: expiresAt.toISOString() });
      }
      if (operation === 'emailConfirm') {
        if (!flow || flow.commandId !== payload.commandId || flow.sessionId !== principal.sessionId || flow.state !== 'EMAIL' ||
            new Date(flow.codeExpiresAt || flow.expiresAt).getTime() <= currentTime || !/^[a-f0-9]{64}$/.test(payload.codeHash || '')) throw new ApiError(409, 'EMAIL_CHANGE_CONFLICT');
        const attempts = (flow.attempts || 0) + 1;
        if (!equalHash(flow.codeHash, payload.codeHash)) {
          repositories.transaction.update(transaction, 'authFlows', `email-change:${principal.id}`, { attempts, state: attempts >= 5 ? 'REVOKED' : 'EMAIL', updatedAt: new Date(currentTime) });
          throw new ApiError(401, 'EMAIL_CHANGE_REJECTED');
        }
        const userSnapshot = await repositories.transaction.get(transaction, 'users', principal.id), user = profile(userSnapshot);
        if (user.revision !== flow.revision) throw new ApiError(409, 'EMAIL_CHANGE_CONFLICT');
        const targetVersion = principal.authorizationVersion + 1, currentUser = userSnapshot.data();
        repositories.transaction.set(transaction, 'users', principal.id, { ...currentUser, email: flow.target, emailIndex: flow.emailIndex, contact: flow.contact,
          revision: user.revision + 1, authorizationVersion: targetVersion, updatedAt: new Date(currentTime) });
        const sessions = await transaction.get(db.collection('sessions').where('userId', '==', principal.id));
        for (const sessionSnapshot of sessions.docs || []) {
          const session = snapshotValue(sessionSnapshot);
          if (!session || session.sessionId === principal.sessionId || session.revokedAt) continue;
          transaction.update(sessionSnapshot.ref, { revokedAt: new Date(currentTime) });
        }
        const currentSession = repositories.ref('sessions', principal.sessionId);
        transaction.update(currentSession, { authorizationVersion: targetVersion });
        const keys = await transaction.get(db.collection('users').doc(principal.id).collection('passkeys'));
        for (const keySnapshot of keys.docs || []) { const key = snapshotValue(keySnapshot); if (key && !key.revokedAt) transaction.update(keySnapshot.ref, { authorizationVersion: targetVersion, updatedAt: new Date(currentTime) }); }
        const auditRef = repositories.ref('auditEvents', `email-change:${flow.commandId}`), audit = await transaction.get(auditRef);
        if (!audit.exists) transaction.create(auditRef, { id: `email-change:${flow.commandId}`, at: new Date(currentTime), actorId: principal.id, role: principal.role, operation: 'IDENTITY_EMAIL_CHANGE', entity: 'users', entityId: principal.id, result: 'SUCESSO', requestId: flow.commandId, before: { revision: user.revision }, after: { revision: user.revision + 1, authorizationVersion: targetVersion }, detailsOmitted: true });
        repositories.transaction.update(transaction, 'authFlows', `email-change:${principal.id}`, { state: 'COMPLETE', revision: user.revision + 1, authorizationVersion: targetVersion, codeHash: null, contact: '', completedAt: new Date(currentTime), updatedAt: new Date(currentTime) });
        return emailDto({ commandId: flow.commandId, stage: 'COMPLETE', revision: user.revision + 1, expiresAt: null });
      }
      invalid();
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  async function execute(operation, actor, payload = {}) {
    if (!['bootstrap', 'get', 'save', 'photo', 'emailState', 'emailStart', 'emailConfirm', 'emailCancel'].includes(operation)) invalid();
    if (operation.startsWith('email')) return emailChange(operation, actor, payload);
    if (operation === 'save') return save(actor, payload);
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now(), principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPasswordLogin === true ? { adminPasswordLogin: true } : {}), ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'profile.self.read', { targetUserId: principal.id, now: currentTime });
      const current = profile(await repositories.transaction.get(transaction, 'users', principal.id));
      if (operation === 'photo') {
        if (!current.hasPhoto) throw new ApiError(404, 'PHOTO_NOT_FOUND');
        const media = snapshotValue(await transaction.get(repositories.subref('users', principal.id, 'media', 'profile')));
        if (!media) unavailable();
        try { return photoDescriptor(media); } catch { unavailable(); }
      }
      return operation === 'bootstrap' ? { profile: current, principal } : current;
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  async function save(actor, payload) {
    if (!payload || !catalogUuid(payload.commandId) || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0 || typeof payload.contact !== 'string' || typeof payload.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(payload.fingerprint)) invalid();
    const photo = Object.hasOwn(payload, 'photo') && payload.photo !== null ? photoDescriptor(payload.photo) : null;
    if (payload.ownerCpfIndex !== undefined && !/^[a-f0-9]{64}$/.test(payload.ownerCpfIndex)) invalid();
    if (payload.ownerCpfIndex !== undefined) normalizeCpf(payload.cpf);
    else if (payload.cpf !== undefined) invalid();
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now(), principal = await identityService.readSessionInTransaction(transaction, actor?.sessionTokenHash, currentTime);
      requirePermission({ ...principal, ...(config?.adminPasswordLogin === true ? { adminPasswordLogin: true } : {}), ...(config?.adminPinLogin === true ? { adminPinLogin: true } : {}) }, 'profile.self.write', { targetUserId: principal.id, now: currentTime, localProfileWrite: config?.localLab === true });
      if (config?.localLab !== true && payload.ownerCpfIndex && !['passkey', 'mfa'].includes(principal.assurance)) throw new ApiError(401, 'REAUTHENTICATION_REQUIRED');
      const command = createCommandMetadata({ domain: 'profile', commandId: payload.commandId, operation: 'save', actor: principal.id, payloadHash: payload.fingerprint,
        now: new Date(currentTime), retentionMs: commandRetention(90) });
      const commandRef = repositories.ref('commands', commandDocumentId('profile', payload.commandId));
      const state = await inspectCommand(transaction, commandRef, command);
      if (state.status === 'COMMITTED') return state.result;
      const currentSnapshot = await repositories.transaction.get(transaction, 'users', principal.id), current = profile(currentSnapshot);
      if (current.revision !== payload.expectedRevision) throw new ApiError(409, 'PROFILE_CONFLICT');
      if (payload.ownerCpfIndex && !current.owner && config?.localLab !== true) invalid();
      let cpfRef, oldCpfRef, oldCpf;
      if (payload.ownerCpfIndex) {
        if (config?.localLab !== true && current.owner && current.cpfIndex && current.cpfIndex !== payload.ownerCpfIndex) throw new ApiError(409, 'PROFILE_CPF_LOCKED');
        if (current.cpfIndex && current.cpfIndex !== payload.ownerCpfIndex) {
          oldCpfRef = repositories.ref('uniqueness', `staff-cpf:${current.cpfIndex}`);
          oldCpf = snapshotValue(await transaction.get(oldCpfRef));
          if (oldCpf && oldCpf.ownerId !== principal.id) unavailable();
        }
        cpfRef = repositories.ref('uniqueness', `staff-cpf:${payload.ownerCpfIndex}`);
        const reservation = snapshotValue(await transaction.get(cpfRef));
        const matches = await transaction.get(db.collection('users').where('cpfIndex', '==', payload.ownerCpfIndex));
        if (reservation && reservation.ownerId !== principal.id || matches.docs.some(doc => doc.id !== principal.id)) throw new ApiError(409, 'STAFF_CPF_DUPLICATE');
      }
      const eventRef = repositories.ref('domainEvents', `profile:${payload.commandId}`), auditRef = repositories.ref('auditEvents', `profile:${payload.commandId}`);
      const eventSnapshot = await transaction.get(eventRef), auditSnapshot = await transaction.get(auditRef);
      if (snapshotValue(eventSnapshot) || snapshotValue(auditSnapshot)) unavailable();
      const at = new Date(state.status === 'NEW' ? currentTime : new Date(command.createdAt).getTime()), result = { revision: current.revision + 1 };
      const next = { ...currentSnapshot.data(), id: principal.id, revision: result.revision, contact: payload.contact,
        hasPhoto: Object.hasOwn(payload, 'photo') ? payload.photo !== null : current.hasPhoto, updatedAt: at, updatedBy: principal.id,
        ...(payload.ownerCpfIndex ? { cpfIndex: payload.ownerCpfIndex } : {}) };
      if (state.status === 'NEW') createPendingCommand(transaction, commandRef, command);
      repositories.transaction.set(transaction, 'users', principal.id, next);
      if (cpfRef) transaction.set(cpfRef, { ownerId: principal.id, kind: 'STAFF_CPF', value: payload.ownerCpfIndex, active: true, version: result.revision });
      if (oldCpf) transaction.delete(oldCpfRef);
      if (Object.hasOwn(payload, 'photo')) {
        const mediaRef = repositories.subref('users', principal.id, 'media', 'profile');
        if (photo) transaction.set(mediaRef, { ...photo, updatedAt: at });
        else transaction.delete(mediaRef);
      }
      transaction.create(eventRef, { schemaVersion: 1, type: 'PROFILE_UPDATED', commandId: payload.commandId, commandHash: command.payloadHash, actorId: principal.id, createdAt: at.toISOString(), entityId: principal.id });
      transaction.create(auditRef, { id: `profile:${payload.commandId}`, at: at.toISOString(), commandId: payload.commandId, actorId: principal.id, role: principal.role,
        operation: 'PROFILE_UPDATE', entity: 'Usuarios', entityId: principal.id, result: 'SUCESSO', requestId: payload.commandId, before: { revision: current.revision }, after: { revision: result.revision }, detailsOmitted: true });
      commitCommand(transaction, commandRef, result, at);
      return result;
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  return Object.freeze({ execute });
}
