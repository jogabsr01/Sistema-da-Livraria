import { ApiError } from './errors.mjs';
import { createFirestoreRepositories } from './firestore-repositories.mjs';
import { runFirestoreTransaction } from './firestore-transactions.mjs';

// Firestore mirror of AuthControl.gs' authAttempt_: two independent, durable
// counters (account/origin) reserved together, 15-minute windows, doubling
// lockouts capped at one hour, and a 24h idle reset of the penalty level.
// Firestore transactions are atomic, so the GAS two-phase "durable intent"
// dance around a partial two-row write has no equivalent here: either both
// counters commit or neither does.
const HASH = /^[a-f0-9]{64}$/;
const WINDOW_MS = 900_000;
const DAY_MS = 86_400_000;
const MAX_BLOCK_AHEAD_MS = 3_600_000;
const MAX_PENALTY_LEVEL = 7;
const MAX_DOCUMENTS = 3000;
const POLICIES = [
  { kind: 'account', field: 'accountKey', maximum: 5 },
  { kind: 'origin', field: 'originKey', maximum: 30 },
];

function invalid() { throw new ApiError(400, 'CHALLENGE_REJECTED'); }
function unavailable() { throw new ApiError(503, 'IDENTITY_UNAVAILABLE'); }

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

function storedState(snapshot, maximum, currentTime) {
  const value = snapshotValue(snapshot);
  if (!value) return null;
  const windowStart = date(value.windowStart).getTime();
  const updatedAt = date(value.updatedAt).getTime();
  const blockedUntil = value.blockedUntil === null || value.blockedUntil === undefined ? 0 : date(value.blockedUntil).getTime();
  if (windowStart > currentTime || updatedAt > currentTime || updatedAt < windowStart ||
      !Number.isSafeInteger(value.attemptCount) || value.attemptCount < 0 || value.attemptCount > maximum + 1 ||
      !Number.isSafeInteger(value.penaltyLevel) || value.penaltyLevel < 0 || value.penaltyLevel > MAX_PENALTY_LEVEL ||
      blockedUntil > currentTime + MAX_BLOCK_AHEAD_MS) unavailable();
  return { windowStart, updatedAt, blockedUntil, attemptCount: value.attemptCount, penaltyLevel: value.penaltyLevel };
}

function payloadKeys(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 2 ||
      !Object.hasOwn(payload, 'accountKey') || !Object.hasOwn(payload, 'originKey')) invalid();
  if (![payload.accountKey, payload.originKey].every(value => typeof value === 'string' && HASH.test(value))) invalid();
  return { accountKey: payload.accountKey, originKey: payload.originKey };
}

export function createFirestoreRateLimitService({ db, now = () => Date.now(), transactionOptions } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  const repositories = createFirestoreRepositories(db);
  const options = { ...(transactionOptions || {}), maxAttempts: transactionOptions?.maxAttempts || 3 };

  async function reserveInTransaction(transaction, rawPayload, currentTime) {
    const keys = payloadKeys(rawPayload);
    const plans = [];
    let retry = 0;
    for (const policy of POLICIES) {
      const id = `${policy.kind}:${keys[policy.field]}`;
      const snapshot = await repositories.transaction.get(transaction, 'authRateLimits', id);
      const stored = storedState(snapshot, policy.maximum, currentTime);
      if (stored && stored.blockedUntil > currentTime) retry = Math.max(retry, Math.ceil((stored.blockedUntil - currentTime) / 1000));
      plans.push({
        id,
        maximum: policy.maximum,
        existed: stored !== null,
        state: stored || { windowStart: currentTime, updatedAt: currentTime, blockedUntil: 0, attemptCount: 0, penaltyLevel: 0 },
      });
    }
    // Querying during an active block never writes: it must not extend the
    // lockout, consume a slot, or race the window/penalty reset below.
    if (retry > 0) return { allowed: false, retryAfterSeconds: retry };

    const newDocuments = plans.filter(plan => !plan.existed).length;
    if (newDocuments > 0) {
      const collectionSnapshot = await transaction.get(repositories.collection('authRateLimits'));
      if (!collectionSnapshot || !Array.isArray(collectionSnapshot.docs) || collectionSnapshot.docs.length + newDocuments > MAX_DOCUMENTS) unavailable();
    }

    for (const plan of plans) {
      const state = { ...plan.state };
      if (currentTime - state.updatedAt >= DAY_MS) state.penaltyLevel = 0;
      if ((state.blockedUntil && state.blockedUntil <= currentTime) || currentTime - state.windowStart >= WINDOW_MS) {
        state.windowStart = currentTime; state.attemptCount = 0; state.blockedUntil = 0;
      }
      state.attemptCount += 1;
      state.updatedAt = currentTime;
      if (state.attemptCount > plan.maximum) {
        state.penaltyLevel = Math.min(MAX_PENALTY_LEVEL, state.penaltyLevel + 1);
        const delaySeconds = Math.min(3600, 60 * 2 ** (state.penaltyLevel - 1));
        state.blockedUntil = currentTime + delaySeconds * 1000;
        retry = Math.max(retry, delaySeconds);
      }
      plan.next = state;
    }

    for (const plan of plans) {
      repositories.transaction.set(transaction, 'authRateLimits', plan.id, {
        windowStart: new Date(plan.next.windowStart),
        attemptCount: plan.next.attemptCount,
        blockedUntil: plan.next.blockedUntil ? new Date(plan.next.blockedUntil) : null,
        penaltyLevel: plan.next.penaltyLevel,
        updatedAt: new Date(plan.next.updatedAt),
      });
    }
    return { allowed: retry === 0, retryAfterSeconds: retry };
  }

  async function reserve(payload) {
    return runFirestoreTransaction(db, transaction => reserveInTransaction(transaction, payload, now()), options);
  }

  return Object.freeze({ reserve });
}
