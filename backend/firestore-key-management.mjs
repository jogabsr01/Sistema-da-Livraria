import { createHash, createHmac } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{2,1400}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{20,4096}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
const ROLES = new Set(['ATENDENTE', 'ADMIN', 'SUPER_ADMIN']);
const STRONG_ASSURANCE = new Set(['mfa', 'passkey']);
const MAX_KEYS = 5;
const FLOW_TTL_MS = 300000;
const STRONG_SESSION_MAX_AGE_MS = 300000;

function invalid() { throw new ApiError(400, 'INVALID_KEY_MANAGEMENT'); }
function rejected() { throw new ApiError(401, 'KEY_MANAGEMENT_REJECTED'); }
function forbidden() { throw new ApiError(403, 'FORBIDDEN'); }
function conflict() { throw new ApiError(409, 'KEY_MANAGEMENT_CONFLICT'); }
function lastKey() { throw new ApiError(409, 'KEY_MANAGEMENT_LAST_KEY'); }
function capacity() { throw new ApiError(409, 'KEY_MANAGEMENT_CAPACITY'); }
function unavailable() { throw new ApiError(503, 'KEY_MANAGEMENT_UNAVAILABLE'); }

function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value;
}

function hash(value) {
  if (typeof value !== 'string' || !HASH.test(value)) invalid();
  return value;
}

function credential(value) {
  if (typeof value !== 'string' || !CREDENTIAL.test(value) ||
      Buffer.from(value, 'base64url').toString('base64url') !== value) invalid();
  return value;
}

function challenge(value) {
  if (typeof value !== 'string' || !CHALLENGE.test(value) ||
      Buffer.from(value, 'base64url').toString('base64url') !== value) invalid();
  return value;
}

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

function documentId(credentialId) {
  return createHash('sha256').update(credentialId, 'utf8').digest('hex');
}

function keyHandle(config, userId, credentialId) {
  if (!config || typeof config.secret !== 'string' || !/^[a-f0-9]{64}$/i.test(config.secret) ||
      typeof config.environment !== 'string' || typeof config.installationId !== 'string') unavailable();
  return createHmac('sha256', Buffer.from(config.secret, 'hex'))
    .update(JSON.stringify([config.environment, config.installationId, userId, credentialId]), 'utf8')
    .digest('hex');
}

function keyValue(snapshot) {
  const value = snapshotValue(snapshot);
  if (!value || typeof value.id !== 'string' || !CREDENTIAL.test(value.id) ||
      Buffer.from(value.id, 'base64url').toString('base64url') !== value.id ||
      typeof value.publicKey !== 'string' || !PUBLIC_KEY.test(value.publicKey) ||
      Buffer.from(value.publicKey, 'base64url').toString('base64url') !== value.publicKey ||
      !Number.isSafeInteger(value.counter) || value.counter < 0 || value.counter > 4294967295 ||
      !Array.isArray(value.transports) || value.transports.length > 7 ||
      value.transports.some(item => !TRANSPORTS.has(item)) ||
      !Number.isSafeInteger(value.authorizationVersion) || value.authorizationVersion < 1) unavailable();
  return value;
}

function validateNewKey(input) {
  const credentialId = credential(input?.credentialId);
  const publicKey = input?.publicKey;
  if (typeof publicKey !== 'string' || !PUBLIC_KEY.test(publicKey) ||
      Buffer.from(publicKey, 'base64url').toString('base64url') !== publicKey ||
      !Number.isSafeInteger(input.counter) || input.counter < 0 || input.counter > 4294967295 ||
      !Array.isArray(input.transports) || input.transports.length > 7 ||
      input.transports.some(item => !TRANSPORTS.has(item))) invalid();
  return { credentialId, publicKey, counter: input.counter, transports: [...new Set(input.transports)] };
}

function flowDto(flow) {
  if (!flow) return { commandId: null, stage: 'IDLE' };
  return {
    commandId: flow.commandId,
    stage: flow.state,
    mode: flow.mode,
    target: flow.target,
    targetCredentialId: flow.targetCredentialId || '',
    authId: flow.authId,
    authChallenge: flow.authChallenge,
    regId: flow.regId,
    regChallenge: flow.regChallenge,
    count: Number.isSafeInteger(flow.count) ? flow.count : 0,
    expiresAt: date(flow.expiresAt).toISOString(),
  };
}

function flowBinding(flow, principal, actorHash) {
  if (!flow || flow.userId !== principal.id || flow.sessionId !== principal.sessionId ||
      flow.authorizationVersion !== principal.authorizationVersion || flow.role !== principal.role ||
      flow.sessionHash !== actorHash) rejected();
}

function flowValue(value) {
  if (!value || typeof value !== 'object' || !UUID.test(value.commandId || '') ||
      !UUID.test(value.userId || '') || !UUID.test(value.sessionId || '') ||
      !HASH.test(value.sessionHash || '') || !ROLES.has(value.role) ||
      !Number.isSafeInteger(value.authorizationVersion) || value.authorizationVersion < 1 ||
      !['ADD', 'REMOVE', 'CODES'].includes(value.mode) ||
      !['AUTH', 'REGISTER', 'COMPLETE', 'CANCELLED'].includes(value.state) ||
      !UUID.test(value.authId || '') || !UUID.test(value.regId || '') ||
      !CHALLENGE.test(value.authChallenge || '') || !CHALLENGE.test(value.regChallenge || '') ||
      typeof value.target !== 'string' || typeof value.targetCredentialId !== 'string' ||
      !Number.isSafeInteger(value.count) || value.count < 0 || value.count > 6 ||
      !value.createdAt || !value.expiresAt) unavailable();
  if (['ADD', 'CODES'].includes(value.mode) && value.target !== '') unavailable();
  if (value.mode === 'REMOVE' && (!HASH.test(value.target) || !CREDENTIAL.test(value.targetCredentialId))) unavailable();
  if (date(value.expiresAt).getTime() - date(value.createdAt).getTime() !== FLOW_TTL_MS) unavailable();
  return value;
}

function activeKeyList(documents, authorizationVersion) {
  if (!documents || !Array.isArray(documents.docs) || documents.docs.length > 3000) unavailable();
  return documents.docs.map(snapshot => keyValue(snapshot)).filter(value =>
    value.authorizationVersion === authorizationVersion && value.revokedAt === null);
}

function recoveryStatus(value, authorizationVersion) {
  if (!value) return { active: false, remaining: 0 };
  if (value.version !== 1 || value.state !== 'ACTIVE' || value.authorizationVersion !== authorizationVersion ||
      !Array.isArray(value.entries) || value.entries.length !== 6 ||
      new Set(value.entries.map(entry => entry?.hash)).size !== 6 ||
      value.entries.some(entry => !entry || !HASH.test(entry.hash) ||
        entry.usedAt !== null && !(entry.usedAt instanceof Date) && typeof entry.usedAt !== 'string')) unavailable();
  return { active: true, remaining: value.entries.filter(entry => entry.usedAt === null).length };
}

export function createFirestoreKeyManagementService({ db, identityService, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || !identityService?.readSessionInTransaction) {
    throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  }
  const repositories = createFirestoreRepositories(db);
  const options = { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 };
  const flowRef = userId => repositories.ref('keyManagement', userId);
  const passkeyRef = (userId, credentialId) => repositories.ref('users', userId).collection('passkeys').doc(documentId(credentialId));
  const ceremonyRef = ceremonyId => repositories.ref('authChallenges', `passkey:${ceremonyId}`);
  const auditRef = commandId => repositories.ref('auditEvents', `key-management:${commandId}`);

  async function principalInTransaction(transaction, actor, currentTime, requireStrong = true) {
    if (!actor || !HASH.test(actor.sessionTokenHash || '')) rejected();
    const principal = await identityService.readSessionInTransaction(transaction, actor.sessionTokenHash, currentTime);
    if (!ROLES.has(principal.role)) forbidden();
    if (requireStrong && (!STRONG_ASSURANCE.has(principal.assurance) || currentTime - principal.authenticatedAt > STRONG_SESSION_MAX_AGE_MS)) forbidden();
    return principal;
  }

  async function readKeys(transaction, userId) {
    const collection = db.collection('users').doc(userId).collection('passkeys');
    return transaction.get(collection);
  }

  async function readFlow(transaction, principal) {
    const snapshot = await transaction.get(flowRef(principal.id));
    const value = snapshotValue(snapshot);
    return value ? flowValue(value) : null;
  }

  function writeAudit(transaction, principal, flow, operation, after, currentTime, prior) {
    const reference = auditRef(flow.commandId);
    const value = {
      id: `key-management:${flow.commandId}`,
      at: new Date(currentTime),
      commandId: flow.commandId,
      actorId: principal.id,
      role: principal.role,
      operation,
      entity: 'users',
      entityId: principal.id,
      result: 'SUCESSO',
      requestId: flow.commandId,
      before: null,
      after,
      detailsOmitted: false,
    };
    if (prior?.exists) {
      const existing = snapshotValue(prior);
      if (!existing || existing.commandId !== value.commandId || existing.operation !== value.operation ||
          existing.entityId !== value.entityId || JSON.stringify(existing.after) !== JSON.stringify(value.after)) unavailable();
      return;
    }
    transaction.create(reference, value);
  }

  async function createCeremony(transaction, flow, purpose, currentTime) {
    const ceremonyId = purpose === 'AUTHENTICATE' ? flow.authId : flow.regId;
    const challengeValue = purpose === 'AUTHENTICATE' ? flow.authChallenge : flow.regChallenge;
    const reference = ceremonyRef(ceremonyId), prior = await transaction.get(reference);
    if (prior.exists) {
      const existing = snapshotValue(prior);
      if (!existing || existing.subjectId !== flow.userId || existing.authorizationVersion !== flow.authorizationVersion ||
          existing.purpose !== purpose || existing.challenge !== challengeValue ||
          date(existing.expiresAt).getTime() !== date(flow.expiresAt).getTime()) unavailable();
      return false;
    }
    transaction.create(reference, { id: ceremonyId, subjectId: flow.userId, authorizationVersion: flow.authorizationVersion,
      purpose, challenge: challengeValue, createdAt: new Date(currentTime), expiresAt: date(flow.expiresAt),
      consumedAt: null, completedAt: null, credentialId: '', expectedCounter: null });
    return true;
  }

  async function start(transaction, actor, payload, currentTime) {
    if (!payload || !UUID.test(payload.commandId || '') || !['ADD', 'REMOVE', 'CODES'].includes(payload.mode) ||
        typeof payload.target !== 'string' || !UUID.test(payload.authId || '') || !UUID.test(payload.regId || '') ||
        !CHALLENGE.test(payload.authChallenge || '') || !CHALLENGE.test(payload.regChallenge || '') ||
        payload.authId === payload.regId || payload.authChallenge === payload.regChallenge ||
        ['ADD', 'CODES'].includes(payload.mode) && payload.target !== '' ||
        payload.mode === 'REMOVE' && !HASH.test(payload.target)) invalid();
    const principal = await principalInTransaction(transaction, actor, currentTime);
    const reference = flowRef(principal.id), priorSnapshot = await transaction.get(reference);
    const prior = priorSnapshot.exists ? flowValue(snapshotValue(priorSnapshot)) : null;
    if (prior && prior.commandId === payload.commandId) {
      flowBinding(prior, principal, actor.sessionTokenHash);
      if (prior.mode !== payload.mode || prior.target !== payload.target) conflict();
      if (['AUTH', 'REGISTER'].includes(prior.state) && date(prior.expiresAt).getTime() <= currentTime) return flowDto({ ...prior, state: 'CANCELLED' });
      await createCeremony(transaction, prior, 'AUTHENTICATE', currentTime);
      return flowDto(prior);
    }
    if (prior && ['AUTH', 'REGISTER'].includes(prior.state) && date(prior.expiresAt).getTime() > currentTime) conflict();
    const keysSnapshot = await readKeys(transaction, principal.id), active = activeKeyList(keysSnapshot, principal.authorizationVersion);
    if (!active.length || payload.mode === 'ADD' && active.length >= MAX_KEYS ||
        payload.mode === 'REMOVE' && (active.length < 2 || !active.some(key => keyHandle(config, principal.id, key.id) === payload.target))) lastKey();
    const sameWindow = prior && currentTime - date(prior.window || prior.createdAt).getTime() < FLOW_TTL_MS;
    const starts = sameWindow ? (prior.starts || 0) + 1 : 1;
    if (starts > 10) throw new ApiError(429, 'KEY_MANAGEMENT_RATE_LIMITED');
    const target = payload.mode === 'REMOVE' ? active.find(key => keyHandle(config, principal.id, key.id) === payload.target) : null;
    if (payload.mode === 'REMOVE' && !target) lastKey();
    const flow = {
      version: 1,
      commandId: payload.commandId,
      userId: principal.id,
      sessionId: principal.sessionId,
      sessionHash: actor.sessionTokenHash,
      authorizationVersion: principal.authorizationVersion,
      role: principal.role,
      mode: payload.mode,
      target: payload.target,
      targetCredentialId: target?.id || '',
      authId: payload.authId,
      authChallenge: payload.authChallenge,
      regId: payload.regId,
      regChallenge: payload.regChallenge,
      createdAt: new Date(currentTime),
      expiresAt: new Date(currentTime + FLOW_TTL_MS),
      state: 'AUTH',
      count: 0,
      starts,
      window: sameWindow ? date(prior.window || prior.createdAt) : new Date(currentTime),
    };
    await createCeremony(transaction, flow, 'AUTHENTICATE', currentTime);
    transaction.set(reference, flow);
    return flowDto(flow);
  }

  async function authorize(transaction, actor, payload, currentTime) {
    if (!payload || !UUID.test(payload.commandId || '') || !UUID.test(payload.ceremonyId || '') ||
        !CREDENTIAL.test(payload.credentialId || '') || !Number.isSafeInteger(payload.expectedCounter) || payload.expectedCounter < 0 ||
        !Number.isSafeInteger(payload.newCounter) || payload.newCounter < payload.expectedCounter || payload.newCounter > 4294967295) invalid();
    const principal = await principalInTransaction(transaction, actor, currentTime), flow = await readFlow(transaction, principal);
    if (!flow) conflict();
    flowBinding(flow, principal, actor.sessionTokenHash);
    if (flow.commandId !== payload.commandId || flow.authId !== payload.ceremonyId) conflict();
    if (flow.state === 'COMPLETE' || flow.state === 'REGISTER') return flowDto(flow);
    if (flow.state !== 'AUTH' || date(flow.expiresAt).getTime() <= currentTime) conflict();
    const ceremonySnapshot = await transaction.get(ceremonyRef(flow.authId)), ceremony = snapshotValue(ceremonySnapshot);
    if (!ceremony || ceremony.subjectId !== principal.id || ceremony.purpose !== 'AUTHENTICATE' ||
        ceremony.authorizationVersion !== principal.authorizationVersion || ceremony.consumedAt || ceremony.completedAt ||
        date(ceremony.expiresAt).getTime() <= currentTime) rejected();
    const keySnapshot = await transaction.get(passkeyRef(principal.id, payload.credentialId));
    if (!keySnapshot.exists) rejected();
    const key = keyValue(keySnapshot);
    if (key.id !== payload.credentialId || key.authorizationVersion !== principal.authorizationVersion || key.revokedAt !== null ||
        flow.mode === 'REMOVE' && key.id === flow.targetCredentialId || key.counter !== payload.expectedCounter) rejected();

    const keysSnapshot = flow.mode === 'REMOVE' ? await readKeys(transaction, principal.id) : null;
    const activeBefore = keysSnapshot ? activeKeyList(keysSnapshot, principal.authorizationVersion) : null;
    let target, sessions, auditSnapshot, registrationSnapshot;
    if (flow.mode === 'REMOVE') {
      const targetSnapshot = await transaction.get(passkeyRef(principal.id, flow.targetCredentialId));
      if (!targetSnapshot.exists) rejected();
      target = keyValue(targetSnapshot);
      if (target.id !== flow.targetCredentialId || target.authorizationVersion !== principal.authorizationVersion || target.revokedAt !== null) rejected();
      sessions = await transaction.get(db.collection('sessions').where('userId', '==', principal.id));
      if (!sessions || !Array.isArray(sessions.docs)) unavailable();
      auditSnapshot = await transaction.get(auditRef(flow.commandId));
    } else if (flow.mode === 'ADD') {
      registrationSnapshot = await transaction.get(ceremonyRef(flow.regId));
      if (registrationSnapshot.exists) {
        const registration = snapshotValue(registrationSnapshot);
        if (!registration || registration.subjectId !== principal.id || registration.authorizationVersion !== principal.authorizationVersion ||
            registration.purpose !== 'REGISTER' || registration.challenge !== flow.regChallenge ||
            date(registration.expiresAt).getTime() !== date(flow.expiresAt).getTime()) unavailable();
      }
    }

    if (flow.mode === 'ADD' && !registrationSnapshot.exists) await createCeremony(transaction, flow, 'REGISTER', currentTime);
    transaction.update(passkeyRef(principal.id, key.id), { counter: payload.newCounter, updatedAt: new Date(currentTime) });
    transaction.update(ceremonyRef(flow.authId), { consumedAt: new Date(currentTime), completedAt: new Date(currentTime), credentialId: key.id, expectedCounter: payload.expectedCounter });
    if (flow.mode === 'REMOVE') {
      transaction.update(passkeyRef(principal.id, target.id), { revokedAt: new Date(currentTime), updatedAt: new Date(currentTime) });
      let revokedSessions = 0;
      for (const sessionSnapshot of sessions.docs) {
        if (!sessionSnapshot?.id || sessionSnapshot.id === principal.sessionId) continue;
        const session = snapshotValue(sessionSnapshot);
        if (session && session.revokedAt === null) {
          transaction.update(sessionSnapshot.ref, { revokedAt: new Date(currentTime) });
          revokedSessions++;
        }
      }
      const count = activeBefore.length - 1;
      writeAudit(transaction, principal, flow, 'IDENTITY_PASSKEY_REMOVED', { count, otherSessionsRevoked: true, revokedSessions }, currentTime, auditSnapshot);
      transaction.update(flowRef(principal.id), { state: 'COMPLETE', count, completedAt: new Date(currentTime), updatedAt: new Date(currentTime) });
      return flowDto({ ...flow, state: 'COMPLETE', count });
    }
    const next = { ...flow, state: 'REGISTER' };
    transaction.update(flowRef(principal.id), { state: 'REGISTER', updatedAt: new Date(currentTime) });
    return flowDto(next);
  }

  async function register(transaction, actor, payload, currentTime) {
    if (!payload || !UUID.test(payload.commandId || '') || !UUID.test(payload.ceremonyId || '')) invalid();
    const input = validateNewKey(payload), principal = await principalInTransaction(transaction, actor, currentTime), flow = await readFlow(transaction, principal);
    if (!flow) conflict();
    flowBinding(flow, principal, actor.sessionTokenHash);
    if (flow.commandId !== payload.commandId) conflict();
    if (flow.state === 'COMPLETE') return flowDto(flow);
    if (flow.state !== 'REGISTER' || flow.mode !== 'ADD' || flow.regId !== payload.ceremonyId || date(flow.expiresAt).getTime() <= currentTime) conflict();
    const ceremonySnapshot = await transaction.get(ceremonyRef(flow.regId)), ceremony = snapshotValue(ceremonySnapshot);
    if (!ceremony || ceremony.subjectId !== principal.id || ceremony.authorizationVersion !== principal.authorizationVersion ||
        ceremony.purpose !== 'REGISTER' || ceremony.consumedAt || ceremony.completedAt ||
        date(ceremony.expiresAt).getTime() <= currentTime) rejected();
    const allSnapshot = await readKeys(transaction, principal.id), all = allSnapshot?.docs || [];
    if (all.length > 3000) capacity();
    if (all.some(snapshot => keyValue(snapshot).id === input.credentialId)) rejected();
    const active = activeKeyList(allSnapshot, principal.authorizationVersion);
    if (active.length >= MAX_KEYS) capacity();
    const target = passkeyRef(principal.id, input.credentialId), targetSnapshot = await transaction.get(target), auditSnapshot = await transaction.get(auditRef(flow.commandId));
    if (targetSnapshot.exists) rejected();
    transaction.create(target, { id: input.credentialId, publicKey: input.publicKey, counter: input.counter, transports: input.transports,
      createdAt: new Date(currentTime), updatedAt: new Date(currentTime), revokedAt: null, authorizationVersion: principal.authorizationVersion });
    transaction.update(ceremonyRef(flow.regId), { consumedAt: new Date(currentTime), completedAt: new Date(currentTime), credentialId: input.credentialId });
    const count = active.length + 1;
    writeAudit(transaction, principal, flow, 'IDENTITY_PASSKEY_ADDED', { count, otherSessionsRevoked: false, revokedSessions: 0 }, currentTime, auditSnapshot);
    transaction.update(flowRef(principal.id), { state: 'COMPLETE', count, completedAt: new Date(currentTime), updatedAt: new Date(currentTime) });
    return flowDto({ ...flow, state: 'COMPLETE', count });
  }

  async function issueCodes(transaction, actor, payload, currentTime) {
    if (!payload || !UUID.test(payload.commandId || '') || !Array.isArray(payload.hashes) || payload.hashes.length !== 6 ||
        payload.hashes.some(value => !HASH.test(value)) || new Set(payload.hashes).size !== 6) invalid();
    const principal = await principalInTransaction(transaction, actor, currentTime);
    if (config?.emergencyRecoveryEnabled !== true) throw new ApiError(503, 'EMERGENCY_RECOVERY_NOT_ACTIVATED');
    const flow = await readFlow(transaction, principal);
    if (!flow) conflict();
    flowBinding(flow, principal, actor.sessionTokenHash);
    if (flow.commandId !== payload.commandId || flow.mode !== 'CODES' || !['REGISTER', 'COMPLETE'].includes(flow.state)) conflict();
    if (flow.state === 'COMPLETE') return flowDto(flow);
    const reference = repositories.ref('emergencyRecovery', principal.id), priorSnapshot = await transaction.get(reference), prior = snapshotValue(priorSnapshot), auditSnapshot = await transaction.get(auditRef(flow.commandId));
    if (prior && prior.state === 'ACTIVE' && prior.authorizationVersion === principal.authorizationVersion && prior.id !== flow.commandId) {
      // Issuing a new kit deliberately invalidates the previous active kit.
      // Recovery consumes entries atomically in the same Firestore transaction.
    }
    const entries = payload.hashes.map(value => ({ hash: value, flowId: '', tokenHash: '', usedAt: null }));
    transaction.set(reference, { version: 1, id: flow.commandId, userId: principal.id, authorizationVersion: principal.authorizationVersion,
      state: 'ACTIVE', recoveredBy: '', entries, createdAt: new Date(currentTime), updatedAt: new Date(currentTime) });
    writeAudit(transaction, principal, flow, 'IDENTITY_RECOVERY_CODES_ISSUED', { count: 6, otherSessionsRevoked: false, revokedSessions: 0 }, currentTime, auditSnapshot);
    transaction.update(flowRef(principal.id), { state: 'COMPLETE', count: 6, completedAt: new Date(currentTime), updatedAt: new Date(currentTime) });
    return flowDto({ ...flow, state: 'COMPLETE', count: 6 });
  }

  async function cancel(transaction, actor, payload, currentTime) {
    if (!payload || !UUID.test(payload.commandId || '')) invalid();
    const principal = await principalInTransaction(transaction, actor, currentTime), flow = await readFlow(transaction, principal);
    if (!flow || flow.commandId !== payload.commandId) conflict();
    flowBinding(flow, principal, actor.sessionTokenHash);
    if (['AUTH', 'REGISTER'].includes(flow.state)) transaction.update(flowRef(principal.id), { state: 'CANCELLED', updatedAt: new Date(currentTime) });
    return flowDto({ ...flow, state: ['AUTH', 'REGISTER'].includes(flow.state) ? 'CANCELLED' : flow.state });
  }

  async function list(transaction, actor, currentTime) {
    const principal = await principalInTransaction(transaction, actor, currentTime, false), snapshot = await readKeys(transaction, principal.id);
    const active = activeKeyList(snapshot, principal.authorizationVersion);
    const recoverySnapshot = await transaction.get(repositories.ref('emergencyRecovery', principal.id));
    const recoveryKit = config?.emergencyRecoveryEnabled === true ? recoveryStatus(snapshotValue(recoverySnapshot), principal.authorizationVersion) : null;
    return { keys: active.map(value => ({ id: keyHandle(config, principal.id, value.id), createdAt: date(value.createdAt).toISOString(), updatedAt: date(value.updatedAt).toISOString(), transports: value.transports })), maximum: MAX_KEYS, recoveryKit };
  }

  async function state(transaction, actor, currentTime) {
    const principal = await principalInTransaction(transaction, actor, currentTime), flow = await readFlow(transaction, principal);
    if (!flow || flow.userId !== principal.id || flow.sessionId !== principal.sessionId || flow.authorizationVersion !== principal.authorizationVersion || flow.sessionHash !== actor.sessionTokenHash) {
      return flowDto(null);
    }
    if (['AUTH', 'REGISTER'].includes(flow.state) && date(flow.expiresAt).getTime() <= currentTime) {
      transaction.update(flowRef(principal.id), { state: 'CANCELLED', updatedAt: new Date(currentTime) });
      return flowDto({ ...flow, state: 'CANCELLED' });
    }
    return flowDto(flow);
  }

  async function execute(operation, actor, payload = {}) {
    if (!['list', 'state', 'start', 'authorize', 'register', 'cancel', 'codes'].includes(operation)) invalid();
    return runFirestoreTransaction(db, async transaction => {
      const currentTime = now();
      if (operation === 'list') return list(transaction, actor, currentTime);
      if (operation === 'state') return state(transaction, actor, currentTime);
      if (operation === 'start') return start(transaction, actor, payload, currentTime);
      if (operation === 'authorize') return authorize(transaction, actor, payload, currentTime);
      if (operation === 'register') return register(transaction, actor, payload, currentTime);
      if (operation === 'cancel') return cancel(transaction, actor, payload, currentTime);
      return issueCodes(transaction, actor, payload, currentTime);
    }, options);
  }

  return Object.freeze({ execute });
}
