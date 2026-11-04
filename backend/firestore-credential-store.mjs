import { createHmac } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

const HASH = /^[a-f0-9]{64}$/;
function unavailable() { throw new ApiError(503, 'IDENTITY_UNAVAILABLE'); }
function rejected() { throw new ApiError(401, 'ACCESS_REJECTED'); }
function snapshotValue(snapshot) {
  if (!snapshot || typeof snapshot.exists !== 'boolean') unavailable();
  if (!snapshot.exists) return null;
  const value = snapshot.data?.();
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  return value;
}
function record(value) {
  if (!value || value.version !== 1 || !['PASSWORD_V1', 'PIN_LEGACY'].includes(value.credentialType) || value.algorithm !== 'scrypt-N32768-r8-p1' ||
      typeof value.salt !== 'string' || !HASH.test(value.salt) || typeof value.hash !== 'string' || !HASH.test(value.hash)) unavailable();
  return { version: 1, credentialType: value.credentialType, algorithm: value.algorithm, salt: value.salt, hash: value.hash };
}
function ownerEmailIndex(config, value) {
  if (typeof value !== 'string' || !config?.secret || !/^[a-f0-9]{64}$/i.test(config.secret) || typeof config.environment !== 'string' || typeof config.installationId !== 'string') unavailable();
  return createHmac('sha256', Buffer.from(config.secret, 'hex')).update(JSON.stringify(['identity.email.v1', config.environment, config.installationId, value.toLowerCase()])).digest('hex');
}

export function createFirestoreCredentialStore({ db, transactionOptions, config } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  async function getPrimary(transaction, subjectId) {
    if (!catalogUuid(subjectId)) unavailable();
    const snapshot = await transaction.get(repositories.subref('users', subjectId, 'credentials', 'primary'));
    return record(snapshotValue(snapshot));
  }
  async function lookup({ email = '', emailIndex = '', cpfIndex = '', staffLookup = false } = {}) {
    if (emailIndex && !HASH.test(emailIndex) || cpfIndex && !HASH.test(cpfIndex)) rejected();
    const resolvedEmailIndex = emailIndex || (email ? ownerEmailIndex(config, email) : '');
    return runFirestoreTransaction(db, async transaction => {
      const field = resolvedEmailIndex ? 'emailIndex' : 'cpfIndex', index = resolvedEmailIndex || cpfIndex;
      const result = await transaction.get(db.collection('users').where(field, '==', index));
      if (!result || !Array.isArray(result.docs) || result.docs.length > 1) unavailable();
      const snapshot = result.docs[0];
      if (!snapshot) return null;
      const value = snapshotValue(snapshot), subjectId = value.id || snapshot.id;
      if (!catalogUuid(subjectId)) unavailable();
      if (staffLookup ? value.owner === true : value.owner !== true) return null;
      const credential = staffLookup && value.activated !== true ? null : await getPrimary(transaction, subjectId);
      return { subjectId, authorizationVersion: value.authorizationVersion, record: credential,
        ...(staffLookup ? { activated: value.activated === true, contact: value.contact || '' } : {}) };
    }, { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 });
  }
  async function loginLookup(payload) {
    const staff = payload?.staffLookup === true;
    let account = staff ? await lookup({ emailIndex: payload?.emailIndex || '', cpfIndex: payload?.cpfIndex || '', staffLookup: true }) : null;
    if (account) return { allowed: true, kind: 'STAFF', account: account.activated ? account : null };
    account = await lookup({ email: payload?.email || '', cpfIndex: payload?.cpfIndex || '', staffLookup: false });
    return { allowed: true, kind: 'OWNER', account };
  }
  return Object.freeze({ getPrimary, lookup, loginLookup });
}
