import { createHash } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{2,1400}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{20,4096}$/;
const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
function rejected() { throw new ApiError(401, 'PASSKEY_REJECTED'); }
function unavailable() { throw new ApiError(503, 'IDENTITY_UNAVAILABLE'); }
function invalid() { throw new ApiError(400, 'INVALID_AUTH_REQUEST'); }
function id(value) { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value; }
function credential(value) { if (typeof value !== 'string' || !CREDENTIAL.test(value) || Buffer.from(value, 'base64url').toString('base64url') !== value) invalid(); return value; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
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
function validSubject(value) {
  if (!value || !catalogUuid(value.subjectId) || !Number.isSafeInteger(value.authorizationVersion) || value.authorizationVersion < 1) invalid();
  return value;
}
function validateKey(input) {
  const credentialId = credential(input.credentialId);
  if (typeof input.publicKey !== 'string' || !PUBLIC_KEY.test(input.publicKey) || Buffer.from(input.publicKey, 'base64url').toString('base64url') !== input.publicKey ||
      !Number.isSafeInteger(input.counter) || input.counter < 0 || input.counter > 4294967295 || !Array.isArray(input.transports) || input.transports.length > 7 ||
      input.transports.some(value => !TRANSPORTS.has(value))) invalid();
  return { credentialId, publicKey: input.publicKey, counter: input.counter, transports: [...new Set(input.transports)] };
}

export function createFirestorePasskeyService({ db, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  const passkeyRef = (subjectId, credentialId) => repositories.subref('users', subjectId, 'passkeys', hash(credentialId));
  const ceremonyRef = ceremonyId => repositories.ref('authChallenges', `passkey:${ceremonyId}`);
  async function readUser(transaction, subject) {
    validSubject(subject);
    const snapshot = await repositories.transaction.get(transaction, 'users', subject.subjectId);
    const user = snapshotValue(snapshot);
    if (!user || user.authorizationVersion !== subject.authorizationVersion || user.status !== 'ATIVO') rejected();
    return user;
  }
  async function listPasskeys(subject) {
    return runFirestoreTransaction(db, async transaction => {
      await readUser(transaction, subject);
      const result = await transaction.get(db.collection('users').doc(subject.subjectId).collection('passkeys'));
      if (!result || !Array.isArray(result.docs) || result.docs.length > 5) unavailable();
      return { credentials: result.docs.map(snapshot => { const value = snapshotValue(snapshot); if (!value || !CREDENTIAL.test(value.id) || !Array.isArray(value.transports)) unavailable(); return { id: value.id, transports: value.transports }; }) };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  async function beginPasskey(input) {
    validSubject(input); id(input.ceremonyId);
    if (!['REGISTER', 'AUTHENTICATE'].includes(input.purpose) || typeof input.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.challenge)) invalid();
    return runFirestoreTransaction(db, async transaction => {
      await readUser(transaction, input);
      const ref = ceremonyRef(input.ceremonyId), prior = await transaction.get(ref);
      if (prior.exists) throw new ApiError(409, 'CHALLENGE_REJECTED');
      transaction.create(ref, { id: input.ceremonyId, subjectId: input.subjectId, authorizationVersion: input.authorizationVersion,
        purpose: input.purpose, challenge: input.challenge, createdAt: new Date(now()), expiresAt: new Date(now() + 300000), consumedAt: null, completedAt: null });
      return { ceremonyId: input.ceremonyId };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  async function takePasskey(input) {
    validSubject(input); id(input.ceremonyId);
    return runFirestoreTransaction(db, async transaction => {
      const ceremony = snapshotValue(await transaction.get(ceremonyRef(input.ceremonyId)));
      if (!ceremony || ceremony.subjectId !== input.subjectId || ceremony.authorizationVersion !== input.authorizationVersion || ceremony.consumedAt || date(ceremony.expiresAt).getTime() <= now()) rejected();
      if (input.credentialId === '') return { challenge: ceremony.challenge, purpose: ceremony.purpose, credential: null };
      const keyId = credential(input.credentialId), key = snapshotValue(await transaction.get(passkeyRef(input.subjectId, keyId)));
      if (!key || key.id !== keyId || key.revokedAt) rejected();
      return { challenge: ceremony.challenge, purpose: ceremony.purpose, credential: { id: key.id, publicKey: key.publicKey, counter: key.counter, transports: key.transports } };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  async function registerPasskey(input) {
    validSubject(input); id(input.ceremonyId);
    const key = validateKey(input);
    return runFirestoreTransaction(db, async transaction => {
      await readUser(transaction, input);
      const ceremonyRefValue = ceremonyRef(input.ceremonyId), ceremony = snapshotValue(await transaction.get(ceremonyRefValue));
      if (!ceremony || ceremony.subjectId !== input.subjectId || ceremony.authorizationVersion !== input.authorizationVersion || ceremony.purpose !== 'REGISTER' || ceremony.consumedAt || date(ceremony.expiresAt).getTime() <= now()) rejected();
      const target = passkeyRef(input.subjectId, key.credentialId), existing = await transaction.get(target), all = await transaction.get(db.collection('users').doc(input.subjectId).collection('passkeys'));
      if (existing.exists || !all || !Array.isArray(all.docs) || all.docs.length >= 5) throw new ApiError(409, all?.docs?.length >= 5 ? 'KEY_MANAGEMENT_CAPACITY' : 'PASSKEY_REJECTED');
      transaction.create(target, { id: key.credentialId, publicKey: key.publicKey, counter: key.counter, transports: key.transports, createdAt: new Date(now()), updatedAt: new Date(now()), revokedAt: null,
        authorizationVersion: input.authorizationVersion });
      transaction.update(ceremonyRefValue, { consumedAt: new Date(now()), completedAt: new Date(now()) });
      return { stored: true };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  async function advanceCounter(input) {
    validSubject(input); id(input.ceremonyId);
    const keyId = credential(input.credentialId);
    if (!Number.isSafeInteger(input.expectedCounter) || input.expectedCounter < 0 || !Number.isSafeInteger(input.newCounter) || input.newCounter < input.expectedCounter) invalid();
    return runFirestoreTransaction(db, async transaction => {
      await readUser(transaction, input);
      const ceremonyRefValue = ceremonyRef(input.ceremonyId), ceremony = snapshotValue(await transaction.get(ceremonyRefValue));
      const keyRef = passkeyRef(input.subjectId, keyId), key = snapshotValue(await transaction.get(keyRef));
      if (!ceremony || ceremony.subjectId !== input.subjectId || ceremony.authorizationVersion !== input.authorizationVersion || ceremony.purpose !== 'AUTHENTICATE' || ceremony.consumedAt || date(ceremony.expiresAt).getTime() <= now() ||
          !key || key.id !== keyId || key.revokedAt || key.counter !== input.expectedCounter) rejected();
      transaction.update(keyRef, { counter: input.newCounter, updatedAt: new Date(now()) });
      transaction.update(ceremonyRefValue, { consumedAt: new Date(now()), completedAt: new Date(now()) });
      return { stored: true };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  return Object.freeze({ listPasskeys, beginPasskey, takePasskey, registerPasskey, advanceCounter });
}
