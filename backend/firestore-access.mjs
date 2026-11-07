import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { createFirestorePasskeyService } from './firestore-passkeys.mjs';
import { enqueueEmailDelivery } from './firestore-outbox.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';
import { createFirestoreRateLimitService } from './firestore-rate-limits.mjs';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'ATENDENTE']);
const CREDENTIAL_ALGORITHM = 'scrypt-N32768-r8-p1';
const FLOW_TTL_MS = 900_000;
const EMAIL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function rejected() { throw new ApiError(401, 'ACCESS_REJECTED'); }
function unavailable() { throw new ApiError(503, 'IDENTITY_UNAVAILABLE'); }
function invalid() { throw new ApiError(400, 'INVALID_AUTH_REQUEST'); }
function conflict() { throw new ApiError(409, 'IDEMPOTENCY_CONFLICT'); }
function tokenHash(value) { if (typeof value !== 'string' || !HASH.test(value)) rejected(); return value; }
function id(value) { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value; }
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
function userValue(snapshot, userId) {
  const value = snapshotValue(snapshot);
  if (!value || (value.id || userId) !== userId || !ROLES.has(value.role) || value.status !== 'ATIVO' ||
      !Number.isSafeInteger(value.authorizationVersion) || value.authorizationVersion < 1) unavailable();
  return { ...value, id: userId };
}
function credentialRecord(value) {
  if (!value || value.version !== 1 || value.credentialType !== 'PASSWORD_V1' && value.credentialType !== 'PIN_LEGACY' ||
      value.algorithm !== CREDENTIAL_ALGORITHM || typeof value.salt !== 'string' || !HASH.test(value.salt) ||
      typeof value.hash !== 'string' || !HASH.test(value.hash)) unavailable();
  return { version: 1, credentialType: value.credentialType, algorithm: value.algorithm, salt: value.salt, hash: value.hash };
}
function ownerEmailIndex(config, value) {
  if (typeof value !== 'string' || !config?.secret || !/^[a-f0-9]{64}$/i.test(config.secret) ||
      typeof config.environment !== 'string' || typeof config.installationId !== 'string') unavailable();
  return createHmac('sha256', Buffer.from(config.secret, 'hex')).update(JSON.stringify(['identity.email.v1', config.environment, config.installationId, value.toLowerCase()])).digest('hex');
}
function equalHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !HASH.test(a) || !HASH.test(b)) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function flowPublic(flow) {
  return { flowId: flow.flowId, subjectId: flow.subjectId, authorizationVersion: flow.authorizationVersion,
    purpose: flow.purpose, state: flow.state, ceremonyId: flow.ceremonyId || '', proofReady: flow.proofReady === true,
    replacementAllowed: flow.replacementAllowed === true };
}
function validatePasswordRecord(value) {
  let record;
  try { record = typeof value === 'string' ? JSON.parse(value) : value; } catch { invalid(); }
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(['algorithm', 'credentialType', 'hash', 'salt', 'version'])) invalid();
  if (record.version !== 1 || record.credentialType !== 'PASSWORD_V1' || record.algorithm !== CREDENTIAL_ALGORITHM ||
      !HASH.test(record.salt || '') || !HASH.test(record.hash || '')) invalid();
  return credentialRecord(record);
}
function flowDocument(value) {
  if (!value || !UUID.test(value.flowId) || !UUID.test(value.subjectId) || !['ACTIVATE', 'LOGIN', 'RECOVER', 'PASSWORD_LOGIN'].includes(value.purpose) ||
      !['EMAIL', 'PASSWORD', 'PASSKEY', 'COMMITTING', 'COMPLETE', 'REVOKED'].includes(value.state) ||
      !Number.isSafeInteger(value.authorizationVersion) || value.authorizationVersion < 0 ||
      typeof value.tokenHash !== 'string' || !HASH.test(value.tokenHash)) unavailable();
  return value;
}

export function createFirestoreAccessService({ db, config, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  const passkeys = createFirestorePasskeyService({ db, now, transactionOptions });
  const limits = createFirestoreRateLimitService({ db, now, transactionOptions });
  const flowRef = token => repositories.ref('authFlows', token);
  const credentialRef = subjectId => repositories.subref('users', subjectId, 'credentials', 'primary');
  const passkeyRef = (subjectId, credentialId) => repositories.subref('users', subjectId, 'passkeys', createHash('sha256').update(credentialId).digest('hex'));
  const ceremonyRef = ceremonyId => repositories.ref('authChallenges', `passkey:${ceremonyId}`);
  const authOptions = { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 };

  async function readUser(transaction, subjectId) {
    return userValue(await repositories.transaction.get(transaction, 'users', subjectId), subjectId);
  }
  async function findUser(transaction, email) {
    const index = ownerEmailIndex(config, email), result = await transaction.get(db.collection('users').where('emailIndex', '==', index));
    if (!result || !Array.isArray(result.docs) || result.docs.length > 1) unavailable();
    // Owner e-mail changes may have written a personal-data index instead of
    // the bootstrap index. Only the authoritative owner record may fall back
    // to its stored normalized address; never grant ownership based on input.
    const byEmail = await transaction.get(db.collection('users').where('email', '==', email.toLowerCase()));
    if (!byEmail || !Array.isArray(byEmail.docs) || byEmail.docs.length > 1) unavailable();
    if (result.docs[0] && byEmail.docs[0] && result.docs[0].id !== byEmail.docs[0].id) unavailable();
    const snapshot = result.docs[0] || byEmail.docs[0];
    if (!snapshot) return null;
    const user = userValue(snapshot, snapshot.id);
    if (user.owner !== true || user.role !== 'SUPER_ADMIN' || (user.email !== undefined && user.email !== email.toLowerCase())) unavailable();
    return user;
  }
  async function readFlow(transaction, hash) {
    const value = flowDocument(snapshotValue(await transaction.get(flowRef(hash))));
    if (!value || value.state === 'REVOKED' || date(value.flowExpiresAt || value.expiresAt).getTime() <= now()) rejected();
    return value;
  }
  function flowTimes(at) {
    const createdAt = new Date(at), expiresAt = new Date(at + FLOW_TTL_MS);
    return { createdAt, expiresAt, flowExpiresAt: expiresAt, codeExpiresAt: expiresAt };
  }
  async function start(payload, purpose = 'ACTIVATE') {
    const token = tokenHash(payload?.tokenHash); id(payload?.flowId);
    if (config.environment === 'prod' && (config.firestore?.emailProvider !== 'resend' || !config.firestore?.emailProviderKey || !config.firestore?.emailFrom)) {
      console.error(JSON.stringify({ event: 'access_email_configuration_unavailable',
        missing: [
          ...(config.firestore?.emailProvider !== 'resend' ? ['WORKSPACE_EMAIL_PROVIDER'] : []),
          ...(!config.firestore?.emailProviderKey ? ['WORKSPACE_EMAIL_PROVIDER_KEY'] : []),
          ...(!config.firestore?.emailFrom ? ['WORKSPACE_EMAIL_FROM'] : []),
        ] }));
      throw new ApiError(503, 'ACCESS_EMAIL_DELIVERY_UNAVAILABLE');
    }
    const staff = payload.staff === true;
    const delivery = staff ? payload.delivery : payload.email;
    if (!['ACTIVATE', 'RECOVER'].includes(purpose) || typeof delivery !== 'string' || delivery.length > 254 ||
        typeof payload.code !== 'string' || !payload.code || !HASH.test(payload.codeHash || '')) invalid();
    return runFirestoreTransaction(db, async transaction => {
      const reference = flowRef(token), prior = snapshotValue(await transaction.get(reference));
      if (prior) {
        if (prior.flowId !== payload.flowId || prior.purpose !== purpose || prior.tokenHash !== token) rejected();
        return { accepted: true, outcome: 'SENT' };
      }
      const subject = staff ? await readUser(transaction, id(payload.subjectId)) : await findUser(transaction, delivery);
      if (staff && (subject.owner !== false || typeof subject.contact !== 'string' || createHash('sha256').update(subject.contact).digest('hex') !== payload.contactHash)) rejected();
      if (!subject) return { accepted: true, outcome: purpose === 'ACTIVATE' ? 'NOT_FOUND' : undefined };
      if (purpose === 'ACTIVATE' && (subject.activated === true || subject.firstAccessCompleted === true)) return { accepted: true, outcome: 'ALREADY_ACTIVE' };
      if (purpose === 'RECOVER' && subject.firstAccessCompleted === false) return { accepted: true };
      const at = now(), times = flowTimes(at), flow = { flowId: payload.flowId, tokenHash: token, subjectId: subject.id,
        purpose, state: 'EMAIL', authorizationVersion: subject.authorizationVersion, codeHash: payload.codeHash, attempts: 0,
        codeExpiresAt: times.codeExpiresAt, flowExpiresAt: times.flowExpiresAt, expiresAt: times.expiresAt, ceremonyId: '',
        sessionTokenHash: '', passwordRecord: null, proofReady: false, replacementAllowed: false, createdAt: times.createdAt };
      transaction.create(reference, flow);
      enqueueEmailDelivery(transaction, repositories, { settings: config.firestore, idempotencyKey: `auth:${token}`, to: delivery,
        subject: purpose === 'RECOVER' ? 'Livraria IPB — recuperar acesso' : 'Livraria IPB — criar senha',
        text: `${purpose === 'RECOVER' ? 'Foi solicitada a recuperação do acesso.' : 'Foi solicitado o primeiro acesso.'}\n\nCódigo de uso único (válido por 15 minutos):\n${payload.code}\n\nNão compartilhe o código.`, now: times.createdAt });
      return { accepted: true, outcome: 'SENT' };
    }, authOptions);
  }
  async function verifyEmail(payload) {
    const token = tokenHash(payload?.tokenHash);
    if (!HASH.test(payload?.codeHash || '')) rejected();
    return runFirestoreTransaction(db, async transaction => {
      const reference = flowRef(token), flow = await readFlow(transaction, token);
      if (flow.state !== 'EMAIL' || date(flow.codeExpiresAt || flow.expiresAt).getTime() <= now()) rejected();
      const attempts = (flow.attempts || 0) + 1, verified = attempts <= 5 && equalHash(flow.codeHash, payload.codeHash);
      if (verified) transaction.update(reference, { state: 'PASSWORD', codeHash: null, attempts: 0, verifiedAt: new Date(now()) });
      else transaction.update(reference, { attempts, state: attempts >= 5 ? 'REVOKED' : 'EMAIL' });
      return { verified };
    }, authOptions);
  }
  async function savePassword(payload) {
    const token = tokenHash(payload?.tokenHash), record = validatePasswordRecord(payload?.record);
    return runFirestoreTransaction(db, async transaction => {
      const reference = flowRef(token), flow = await readFlow(transaction, token);
      if (!['ACTIVATE', 'RECOVER'].includes(flow.purpose) || flow.state !== 'PASSWORD') rejected();
      transaction.update(reference, { state: 'PASSKEY', passwordRecord: record });
      return { stored: true };
    }, authOptions);
  }
  async function login(payload) {
    const token = tokenHash(payload?.tokenHash); id(payload?.flowId); id(payload?.subjectId);
    if (!Number.isSafeInteger(payload.authorizationVersion) || payload.authorizationVersion < 1) invalid();
    return runFirestoreTransaction(db, async transaction => {
      const subject = await readUser(transaction, payload.subjectId);
      if (subject.authorizationVersion !== payload.authorizationVersion) rejected();
      const reference = flowRef(token), prior = snapshotValue(await transaction.get(reference));
      if (prior) {
        if (prior.flowId !== payload.flowId || prior.subjectId !== payload.subjectId || prior.authorizationVersion !== payload.authorizationVersion || prior.purpose !== 'LOGIN') rejected();
        return { accepted: true };
      }
      const times = flowTimes(now());
      transaction.create(reference, { flowId: payload.flowId, tokenHash: token, subjectId: payload.subjectId, purpose: 'LOGIN', state: 'PASSKEY',
        authorizationVersion: payload.authorizationVersion, ceremonyId: '', sessionTokenHash: '', passwordRecord: null, proofReady: false,
        replacementAllowed: false, codeHash: null, attempts: 0, codeExpiresAt: null, flowExpiresAt: times.flowExpiresAt, expiresAt: times.expiresAt,
        createdAt: times.createdAt });
      return { accepted: true };
    }, authOptions);
  }
  async function passwordLogin(payload) {
    const token = tokenHash(payload?.tokenHash); id(payload?.flowId); id(payload?.subjectId);
    if (!Number.isSafeInteger(payload.authorizationVersion) || payload.authorizationVersion < 1 || !HASH.test(payload.verifierHash || '')) invalid();
    return runFirestoreTransaction(db, async transaction => {
      const subject = await readUser(transaction, payload.subjectId);
      if (subject.authorizationVersion !== payload.authorizationVersion) rejected();
      const credential = credentialRecord(snapshotValue(await transaction.get(credentialRef(payload.subjectId))));
      if (credential.credentialType !== 'PASSWORD_V1' || createHash('sha256').update(JSON.stringify(credential)).digest('hex') !== payload.verifierHash) rejected();
      const reference = flowRef(token), prior = snapshotValue(await transaction.get(reference));
      if (prior) {
        if (prior.flowId !== payload.flowId || prior.subjectId !== payload.subjectId || prior.purpose !== 'PASSWORD_LOGIN' || prior.sessionTokenHash !== payload.sessionTokenHash) rejected();
      } else {
        const times = flowTimes(now());
        transaction.create(reference, { flowId: payload.flowId, tokenHash: token, subjectId: payload.subjectId, purpose: 'PASSWORD_LOGIN', state: 'COMMITTING',
          authorizationVersion: payload.authorizationVersion, ceremonyId: '', sessionTokenHash: payload.sessionTokenHash, passwordRecord: null,
          proofReady: true, replacementAllowed: false, codeHash: null, attempts: 0, codeExpiresAt: null, flowExpiresAt: times.flowExpiresAt,
          expiresAt: times.expiresAt, createdAt: times.createdAt, verifierHash: payload.verifierHash });
      }
      return { accepted: true };
    }, authOptions).then(() => commit({ tokenHash: token, sessionTokenHash: payload.sessionTokenHash }));
  }
  async function read(payload) {
    const token = tokenHash(payload?.tokenHash);
    return runFirestoreTransaction(db, async transaction => flowPublic(await readFlow(transaction, token)), authOptions);
  }
  async function prepareOptions(payload) {
    const token = tokenHash(payload?.tokenHash); id(payload?.ceremonyId);
    if (typeof payload.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.challenge)) invalid();
    return runFirestoreTransaction(db, async transaction => {
      const reference = flowRef(token), flow = await readFlow(transaction, token);
      if (flow.state !== 'PASSKEY') rejected();
      const subject = await readUser(transaction, flow.subjectId), keys = await transaction.get(db.collection('users').doc(flow.subjectId).collection('passkeys'));
      if (!keys || !Array.isArray(keys.docs) || keys.docs.length > 5) unavailable();
      const credentials = keys.docs.map(snapshot => { const value = snapshotValue(snapshot); if (!value || typeof value.id !== 'string' || value.revokedAt) return null; return { id: value.id, transports: value.transports || [] }; }).filter(Boolean);
      const kind = flow.purpose === 'ACTIVATE' || flow.replacementAllowed || credentials.length === 0 ? 'create' : 'get';
      const ceremony = ceremonyRef(payload.ceremonyId), prior = await transaction.get(ceremony);
      if (prior.exists) throw new ApiError(409, 'CHALLENGE_REJECTED');
      transaction.create(ceremony, { id: payload.ceremonyId, subjectId: subject.id, authorizationVersion: subject.authorizationVersion,
        purpose: kind === 'create' ? 'REGISTER' : 'AUTHENTICATE', challenge: payload.challenge, createdAt: new Date(now()), expiresAt: new Date(now() + 300000), consumedAt: null, completedAt: null });
      transaction.update(reference, { ceremonyId: payload.ceremonyId, proofReady: false });
      return { subjectId: subject.id, authorizationVersion: subject.authorizationVersion, kind, credentials, ceremonyId: payload.ceremonyId, challenge: payload.challenge, replacementAllowed: flow.replacementAllowed === true };
    }, authOptions);
  }
  async function prepareLoginPasskey(payload, device) {
    const token = tokenHash(payload?.tokenHash); id(payload?.flowId); id(payload?.subjectId); id(payload?.ceremonyId);
    if (typeof payload.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.challenge) ||
        device && (typeof payload.staffAllowed !== 'boolean' || typeof payload.credentialId !== 'string' ||
          !/^[A-Za-z0-9_-]{2,1400}$/.test(payload.credentialId) || Buffer.from(payload.credentialId, 'base64url').toString('base64url') !== payload.credentialId) ||
        !device && (!Number.isSafeInteger(payload.authorizationVersion) || payload.authorizationVersion < 1)) invalid();
    // Reserve separately so failed identity checks cannot roll back the guess budget.
    const attempt = await limits.reserve({ accountKey: payload.accountKey, originKey: payload.originKey });
    if (!attempt.allowed) { const error = new ApiError(429, 'AUTH_RATE_LIMITED'); error.retryAfterSeconds = attempt.retryAfterSeconds; throw error; }
    return runFirestoreTransaction(db, async transaction => {
      const subject = await readUser(transaction, payload.subjectId);
      if (subject.activated !== true || subject.firstAccessCompleted !== true || device && subject.owner !== true && !payload.staffAllowed ||
          !device && subject.authorizationVersion !== payload.authorizationVersion) rejected();
      const reference = flowRef(token), prior = snapshotValue(await transaction.get(reference));
      const ceremony = ceremonyRef(payload.ceremonyId), existingCeremony = await transaction.get(ceremony);
      const keys = await transaction.get(db.collection('users').doc(subject.id).collection('passkeys'));
      if (prior || existingCeremony.exists || !keys || !Array.isArray(keys.docs) || keys.docs.length > 5) rejected();
      const active = keys.docs.map(snapshotValue).filter(key => key && !key.revokedAt && key.authorizationVersion === subject.authorizationVersion);
      if (!active.length) rejected();
      const key = device ? active.find(item => item.id === payload.credentialId) : null;
      if (device && !key) rejected();
      const times = flowTimes(now()), flow = { flowId: payload.flowId, tokenHash: token, subjectId: subject.id, purpose: 'LOGIN', state: 'PASSKEY',
        authorizationVersion: subject.authorizationVersion, ceremonyId: payload.ceremonyId, sessionTokenHash: '', passwordRecord: null, proofReady: false,
        replacementAllowed: false, codeHash: null, attempts: 0, codeExpiresAt: null, flowExpiresAt: times.flowExpiresAt, expiresAt: times.expiresAt, createdAt: times.createdAt };
      transaction.create(reference, flow);
      transaction.create(ceremony, { id: payload.ceremonyId, subjectId: subject.id, authorizationVersion: subject.authorizationVersion,
        purpose: 'AUTHENTICATE', challenge: payload.challenge, createdAt: new Date(now()), expiresAt: new Date(now() + 300000), consumedAt: null, completedAt: null });
      if (device) return { allowed: true, done: false, flow: flowPublic(flow), ceremony: { challenge: payload.challenge, purpose: 'AUTHENTICATE',
        credential: { id: key.id, publicKey: key.publicKey, counter: key.counter, transports: key.transports || [] } } };
      return { allowed: true, subjectId: subject.id, authorizationVersion: subject.authorizationVersion, kind: 'get',
        credentials: active.map(key => ({ id: key.id, transports: key.transports || [] })), ceremonyId: payload.ceremonyId, challenge: payload.challenge, replacementAllowed: false };
    }, authOptions);
  }
  async function prepareCompletion(payload) {
    const token = tokenHash(payload?.tokenHash), sessionHash = tokenHash(payload?.sessionTokenHash);
    const result = await runFirestoreTransaction(db, async transaction => {
      const reference = flowRef(token), flow = await readFlow(transaction, token);
      if (flow.sessionTokenHash && flow.sessionTokenHash !== sessionHash) rejected();
      if (flow.state === 'COMPLETE') return { completed: true, flow, principal: flow.principal };
      if (flow.proofReady) return { proofReady: true, flow: flowPublic(flow) };
      const ceremony = flow.ceremonyId ? snapshotValue(await transaction.get(ceremonyRef(flow.ceremonyId))) : null;
      if (!ceremony || ceremony.consumedAt || date(ceremony.expiresAt).getTime() <= now()) rejected();
      if (!flow.sessionTokenHash) transaction.update(reference, { sessionTokenHash: sessionHash, commitStartedAt: new Date(now()) });
      const key = ceremony.purpose === 'AUTHENTICATE' && payload.credentialId ? snapshotValue(await transaction.get(passkeyRef(flow.subjectId, payload.credentialId))) : null;
      return { completed: false, flow: flowPublic(flow), ceremony: { challenge: ceremony.challenge, purpose: ceremony.purpose,
        credential: key ? { id: key.id, publicKey: key.publicKey, counter: key.counter, transports: key.transports || [] } : null } };
    }, authOptions);
    if (result.proofReady) return { done: true, flow: result.flow, principal: await commit({ tokenHash: token, sessionTokenHash: sessionHash }) };
    if (result.completed) return { done: true, flow: flowPublic(result.flow), principal: result.principal };
    return { done: false, flow: result.flow, ceremony: result.ceremony };
  }
  async function rescue(payload) {
    const token = tokenHash(payload?.tokenHash), codeHash = payload?.codeHash;
    if (!HASH.test(codeHash || '')) rejected();
    return runFirestoreTransaction(db, async transaction => {
      const reference = flowRef(token), flow = await readFlow(transaction, token);
      if (flow.purpose !== 'RECOVER' || flow.state !== 'PASSWORD') rejected();
      const recoveryRef = repositories.ref('emergencyRecovery', flow.subjectId), snapshot = await transaction.get(recoveryRef), kit = snapshotValue(snapshot);
      if (!kit || kit.state !== 'ACTIVE' || kit.authorizationVersion !== flow.authorizationVersion || !Array.isArray(kit.entries)) rejected();
      const entry = kit.entries.find(item => item && item.hash === codeHash);
      if (!entry || entry.usedAt) {
        const attempts = (flow.attempts || 0) + 1;
        transaction.update(reference, { attempts, state: attempts >= 5 ? 'REVOKED' : 'PASSWORD' });
        return { authorized: false };
      }
      entry.usedAt = new Date(now()); entry.flowId = flow.flowId; entry.tokenHash = token;
      transaction.update(recoveryRef, { entries: kit.entries });
      transaction.update(reference, { replacementAllowed: true, emergencyCodeUsed: true });
      return { authorized: true };
    }, authOptions);
  }
  async function rescueBegin(payload) {
    const token = tokenHash(payload?.tokenHash); id(payload?.ceremonyId);
    if (typeof payload.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.challenge)) invalid();
    return runFirestoreTransaction(db, async transaction => {
      const flow = await readFlow(transaction, token);
      if (!flow.replacementAllowed || flow.state !== 'PASSKEY') rejected();
      const reference = ceremonyRef(payload.ceremonyId), prior = await transaction.get(reference);
      if (prior.exists) throw new ApiError(409, 'CHALLENGE_REJECTED');
      transaction.create(reference, { id: payload.ceremonyId, subjectId: flow.subjectId, authorizationVersion: flow.authorizationVersion, purpose: 'REGISTER', challenge: payload.challenge, createdAt: new Date(now()), expiresAt: new Date(now() + 300000), consumedAt: null, completedAt: null });
      transaction.update(flowRef(token), { ceremonyId: payload.ceremonyId });
      return { ceremonyId: payload.ceremonyId };
    }, authOptions);
  }
  async function rescueKey(payload) {
    const token = tokenHash(payload?.tokenHash); id(payload?.ceremonyId);
    if (typeof payload.credentialId !== 'string' || !/^[A-Za-z0-9_-]{2,1400}$/.test(payload.credentialId) ||
        typeof payload.publicKey !== 'string' || !/^[A-Za-z0-9_-]{20,4096}$/.test(payload.publicKey) ||
        !Number.isSafeInteger(payload.counter) || payload.counter < 0 || payload.counter > 4294967295 || !Array.isArray(payload.transports)) invalid();
    return runFirestoreTransaction(db, async transaction => {
      const reference = flowRef(token), flow = await readFlow(transaction, token), ceremony = snapshotValue(await transaction.get(ceremonyRef(payload.ceremonyId)));
      if (flow.replacementAllowed && flow.state === 'COMMITTING' && flow.replacementKey) return { stored: true };
      if (!flow.replacementAllowed || flow.state !== 'PASSKEY' || !ceremony || ceremony.subjectId !== flow.subjectId || ceremony.purpose !== 'REGISTER' || ceremony.consumedAt || date(ceremony.expiresAt).getTime() <= now()) rejected();
      transaction.update(ceremonyRef(payload.ceremonyId), { consumedAt: new Date(now()), completedAt: new Date(now()) });
      transaction.update(reference, { proofReady: true, state: 'COMMITTING', replacementKey: { id: payload.credentialId, publicKey: payload.publicKey, counter: payload.counter, transports: [...new Set(payload.transports)] } });
      return { stored: true };
    }, authOptions);
  }
  async function saveProof(payload) {
    const token = tokenHash(payload?.tokenHash), flow = await read({ tokenHash: token }), command = payload?.command;
    if (!command || typeof command !== 'object' || !UUID.test(command.ceremonyId) || command.ceremonyId !== flow.ceremonyId) rejected();
    if (flow.proofReady) return { stored: true };
    if (payload.method === 'registerPasskey') await passkeys.registerPasskey(command);
    else if (payload.method === 'advancePasskeyCounter') await passkeys.advanceCounter(command);
    else if (payload.method === 'rescueKey') return rescueKey({ ...command, tokenHash: token });
    else rejected();
    await runFirestoreTransaction(db, async transaction => {
      const reference = flowRef(token), current = await readFlow(transaction, token);
      if (!current.proofReady) transaction.update(reference, { proofReady: true, state: 'COMMITTING', sessionTokenHash: command.sessionTokenHash || current.sessionTokenHash });
      return true;
    }, authOptions);
    return { stored: true };
  }
  async function commit(payload) {
    const token = tokenHash(payload?.tokenHash), sessionHash = tokenHash(payload?.sessionTokenHash);
    return runFirestoreTransaction(db, async transaction => {
      const reference = flowRef(token), flow = await readFlow(transaction, token);
      if (flow.sessionTokenHash && flow.sessionTokenHash !== sessionHash) rejected();
      if (flow.state === 'COMPLETE') return flow.principal;
      const subject = await readUser(transaction, flow.subjectId), credential = flow.passwordRecord ? credentialRecord(flow.passwordRecord) : null;
      if (flow.authorizationVersion !== subject.authorizationVersion) rejected();
      const direct = flow.purpose === 'PASSWORD_LOGIN';
      if (direct && (!flow.proofReady || flow.authorizationVersion !== subject.authorizationVersion)) rejected();
      if (!direct && (!flow.ceremonyId || !['ACTIVATE', 'RECOVER', 'LOGIN'].includes(flow.purpose))) rejected();
      const ceremony = !direct ? snapshotValue(await transaction.get(ceremonyRef(flow.ceremonyId))) : null;
      if (!direct && (!ceremony || !ceremony.consumedAt || !ceremony.completedAt || ceremony.subjectId !== subject.id || ceremony.authorizationVersion !== flow.authorizationVersion)) rejected();
      if (flow.purpose === 'LOGIN' || flow.purpose === 'RECOVER' && !flow.replacementAllowed) {
        if (typeof ceremony.credentialId !== 'string') rejected();
        const verifiedKey = snapshotValue(await transaction.get(passkeyRef(subject.id, ceremony.credentialId)));
        if (!verifiedKey || verifiedKey.id !== ceremony.credentialId || verifiedKey.revokedAt || verifiedKey.authorizationVersion !== subject.authorizationVersion) rejected();
      }
      const currentTime = new Date(now()), targetVersion = flow.purpose === 'RECOVER' ? flow.authorizationVersion + 1 : subject.authorizationVersion;
      const sessionId = flow.flowId, expiresAt = new Date(now() + 86400000), indexRef = repositories.ref('sessionTokenIndex', sessionHash), sessionRef = repositories.ref('sessions', sessionId);
      const existing = await transaction.get(indexRef);
      const auditRef = repositories.ref('auditEvents', `identity:${flow.flowId}`), audit = await transaction.get(auditRef);
      const keys = flow.purpose === 'RECOVER' ? await transaction.get(db.collection('users').doc(subject.id).collection('passkeys')) : null;
      const sessions = flow.purpose === 'RECOVER' ? await transaction.get(db.collection('sessions').where('userId', '==', subject.id)) : null;
      if (!direct && !flow.proofReady) transaction.update(reference, { proofReady: true, state: 'COMMITTING' });
      if (!flow.sessionTokenHash) transaction.update(reference, { sessionTokenHash: sessionHash });
      if (flow.purpose === 'ACTIVATE') {
        if (!credential || credential.credentialType !== 'PASSWORD_V1') rejected();
        transaction.set(credentialRef(subject.id), { ...credential, updatedAt: currentTime });
        transaction.update(repositories.ref('users', subject.id), { activated: true, firstAccessCompleted: true, authorizationVersion: subject.authorizationVersion, updatedAt: currentTime });
      } else if (flow.purpose === 'RECOVER') {
        if (!credential || credential.credentialType !== 'PASSWORD_V1') rejected();
        transaction.set(credentialRef(subject.id), { ...credential, updatedAt: currentTime });
        transaction.update(repositories.ref('users', subject.id), { authorizationVersion: targetVersion, updatedAt: currentTime });
        if (flow.replacementKey) {
          for (const snapshot of keys.docs || []) { const key = snapshotValue(snapshot); if (key && !key.revokedAt) transaction.update(snapshot.ref, { revokedAt: currentTime, updatedAt: currentTime }); }
          transaction.create(passkeyRef(subject.id, flow.replacementKey.id), { id: flow.replacementKey.id, publicKey: flow.replacementKey.publicKey, counter: flow.replacementKey.counter,
            transports: flow.replacementKey.transports, createdAt: currentTime, updatedAt: currentTime, revokedAt: null, authorizationVersion: targetVersion });
        } else {
          for (const snapshot of keys.docs || []) { const key = snapshotValue(snapshot); if (key && !key.revokedAt) transaction.update(snapshot.ref, { authorizationVersion: targetVersion, updatedAt: currentTime }); }
        }
        for (const snapshot of sessions.docs || []) { const session = snapshotValue(snapshot); if (session && !session.revokedAt) transaction.update(snapshot.ref, { revokedAt: currentTime }); }
      }
      if (existing.exists) {
        const index = snapshotValue(existing); if (index.sessionId !== sessionId || index.userId !== subject.id) conflict();
      } else {
        transaction.create(indexRef, { sessionId, userId: subject.id, expiresAt });
        transaction.create(sessionRef, { sessionId, userId: subject.id, createdAt: currentTime, authenticatedAt: currentTime, expiresAt, revokedAt: null,
          assurance: direct ? 'password' : 'passkey', authorizationVersion: targetVersion });
      }
      const principal = { id: subject.id, sessionId, role: subject.role, assurance: direct ? 'password' : 'passkey', authenticatedAt: currentTime.getTime(), expiresAt: expiresAt.getTime(), authorizationVersion: targetVersion };
      if (!audit.exists) transaction.create(auditRef, { id: `identity:${flow.flowId}`, at: currentTime, actorId: subject.id, role: subject.role,
        operation: flow.purpose === 'RECOVER' ? 'IDENTITY_PASSWORD_RECOVER' : flow.purpose === 'ACTIVATE' ? 'IDENTITY_ACTIVATE' : 'IDENTITY_LOGIN', entity: 'users', entityId: subject.id,
        result: 'SUCESSO', requestId: flow.flowId, before: null, after: { authorizationVersion: targetVersion }, detailsOmitted: true });
      transaction.update(reference, { state: 'COMPLETE', proofReady: true, completedAt: currentTime, principal, authorizationVersion: flow.authorizationVersion });
      return principal;
    }, authOptions);
  }
  return Object.freeze({ start: payload => start(payload, 'ACTIVATE'), recover: payload => start(payload, 'RECOVER'), staffStart: payload => start({ ...payload, staff: true }, 'ACTIVATE'), staffRecover: payload => start({ ...payload, staff: true }, 'RECOVER'), login, passwordLogin,
    read, email: verifyEmail, password: savePassword, rescue, rescueBegin, rescueKey, prepareOptions, prepareCompletion, saveProof, commit,
    prepareBiometricOptions: payload => prepareLoginPasskey(payload, false), prepareDeviceAccess: payload => prepareLoginPasskey(payload, true) });
}
