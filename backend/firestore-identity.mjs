import { ApiError } from './errors.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'ATENDENTE']);
const ASSURANCES = new Set(['password', 'pin', 'mfa', 'passkey']);
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

function denied() {
  throw new ApiError(401, 'UNAUTHENTICATED');
}

function unavailable() {
  throw new ApiError(503, 'IDENTITY_UNAVAILABLE');
}

function validUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function validHash(value) {
  return typeof value === 'string' && HASH.test(value);
}

function milliseconds(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

function date(value) {
  const millis = milliseconds(value);
  if (!Number.isFinite(millis)) unavailable();
  return new Date(millis);
}

function requiredData(snapshot) {
  if (!snapshot || snapshot.exists !== true || typeof snapshot.data !== 'function') denied();
  const value = snapshot.data();
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  return value;
}

function sessionPrincipal(session, user, now) {
  if (!validUuid(session.userId) || !validUuid(session.sessionId || session.id) ||
      !validUuid(user.id) || session.userId !== user.id || !ROLES.has(user.role) ||
      !ASSURANCES.has(session.assurance) || user.status !== 'ATIVO' ||
      !Number.isSafeInteger(user.authorizationVersion) || user.authorizationVersion < 1) unavailable();
  if (session.authorizationVersion !== user.authorizationVersion) denied();
  const createdAt = milliseconds(session.authenticatedAt ?? session.createdAt);
  const expiresAt = milliseconds(session.expiresAt);
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt) || createdAt > now ||
      expiresAt <= now || expiresAt <= createdAt || expiresAt - createdAt > MAX_SESSION_MS || session.revokedAt) denied();
  return {
    id: user.id,
    sessionId: session.sessionId || session.id,
    role: user.role,
    assurance: session.assurance,
    authenticatedAt: createdAt,
    expiresAt,
    authorizationVersion: user.authorizationVersion,
  };
}

export function createFirestoreIdentityService({ db, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);

  async function readSessionInTransaction(transaction, tokenHash, current = now()) {
    if (!validHash(tokenHash)) denied();
    const index = requiredData(await repositories.transaction.get(transaction, 'sessionTokenIndex', tokenHash));
    if (!validUuid(index.sessionId) || !validUuid(index.userId)) unavailable();
    const session = requiredData(await repositories.transaction.get(transaction, 'sessions', index.sessionId));
    const user = requiredData(await repositories.transaction.get(transaction, 'users', index.userId));
    if (session.sessionId === undefined) session.sessionId = index.sessionId;
    return sessionPrincipal(session, { ...user, id: index.userId }, current);
  }

  async function readSession(tokenHash) {
    const current = now();
    return runFirestoreTransaction(db, transaction => readSessionInTransaction(transaction, tokenHash, current), {
      ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3,
    });
  }

  async function revokeSession(tokenHash) {
    if (!validHash(tokenHash)) denied();
    const revokedAt = new Date(now());
    return runFirestoreTransaction(db, async transaction => {
      const index = requiredData(await repositories.transaction.get(transaction, 'sessionTokenIndex', tokenHash));
      if (!validUuid(index.sessionId)) unavailable();
      const sessionSnapshot = await repositories.transaction.get(transaction, 'sessions', index.sessionId);
      const session = requiredData(sessionSnapshot);
      if (session.revokedAt === undefined || session.revokedAt === null) {
        repositories.transaction.update(transaction, 'sessions', index.sessionId, { revokedAt });
      }
      return { revoked: true };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }

  async function revokeOtherSessions(tokenHash) {
    if (!validHash(tokenHash)) denied();
    const revokedAt = new Date(now());
    return runFirestoreTransaction(db, async transaction => {
      const index = requiredData(await repositories.transaction.get(transaction, 'sessionTokenIndex', tokenHash));
      if (!validUuid(index.sessionId) || !validUuid(index.userId)) unavailable();
      const currentSnapshot = await repositories.transaction.get(transaction, 'sessions', index.sessionId);
      requiredData(currentSnapshot);
      const query = db.collection('sessions').where('userId', '==', index.userId);
      const sessions = await transaction.get(query);
      if (!sessions || !Array.isArray(sessions.docs)) unavailable();
      let revoked = 0;
      for (const snapshot of sessions.docs) {
        if (!snapshot?.id || snapshot.id === index.sessionId || typeof snapshot.data !== 'function') continue;
        const session = snapshot.data();
        if (session?.revokedAt === undefined || session?.revokedAt === null) {
          transaction.update(snapshot.ref, { revokedAt });
          revoked++;
        }
      }
      return { revoked: true, revokedSessions: revoked };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }

  return Object.freeze({ readSession, readSessionInTransaction, revokeSession, revokeOtherSessions });
}
