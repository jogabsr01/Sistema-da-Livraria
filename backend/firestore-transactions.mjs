import { ApiError } from './errors.mjs';

export const FIRESTORE_TRANSACTION_MAX_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 2_000;

function numericCode(error) {
  return typeof error?.code === 'number' ? error.code : null;
}

function symbolicCode(error) {
  if (typeof error?.code === 'string') return error.code.toUpperCase();
  if (typeof error?.name === 'string') return error.name.toUpperCase();
  return '';
}

export function classifyFirestoreError(error) {
  if (error instanceof ApiError) return 'application';
  const numeric = numericCode(error);
  const symbolic = symbolicCode(error);
  if (numeric === 10 || symbolic === 'ABORTED') return 'conflict';
  if (numeric === 4 || symbolic === 'DEADLINE_EXCEEDED' || symbolic === 'TIMEOUT') return 'timeout';
  if (numeric === 14 || symbolic === 'UNAVAILABLE' || symbolic === 'INTERNAL') return 'unavailable';
  return 'permanent';
}

export function isRetryableFirestoreError(error) {
  return ['conflict', 'timeout', 'unavailable'].includes(classifyFirestoreError(error));
}

function publicTransactionError(kind, cause) {
  const error = kind === 'conflict' ? new ApiError(409, 'FIRESTORE_TRANSACTION_CONFLICT') : kind === 'timeout' ? new ApiError(503, 'FIRESTORE_TIMEOUT') : new ApiError(503, 'FIRESTORE_UNAVAILABLE');
  error.cause = cause;
  return error;
}

function delayFor(attempt, random) {
  const base = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 3 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.max(0, Math.min(1, random())) * Math.max(1, base / 2));
  return base + jitter;
}

export async function runFirestoreTransaction(db, work, {
  maxAttempts = FIRESTORE_TRANSACTION_MAX_ATTEMPTS,
  deadlineAt = Infinity,
  now = () => performance.now(),
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  random = Math.random,
  onAttempt = () => {},
} = {}) {
  if (!db || typeof db.runTransaction !== 'function' || typeof work !== 'function' ||
      !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > FIRESTORE_TRANSACTION_MAX_ATTEMPTS) {
    throw new ApiError(503, 'FIRESTORE_CONFIGURATION_UNAVAILABLE');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Number.isFinite(deadlineAt) && now() >= deadlineAt) throw new ApiError(503, 'FIRESTORE_TIMEOUT');
    try {
      const result = await db.runTransaction(
        transaction => work(transaction, { attempt, maxAttempts }),
        // Retry is controlled here so the application can measure and bound it.
        { maxAttempts: 1 },
      );
      onAttempt({ attempt, outcome: 'COMMITTED' });
      return result;
    } catch (error) {
      const kind = classifyFirestoreError(error);
      if (kind === 'application') throw error;
      if (!isRetryableFirestoreError(error) || attempt === maxAttempts) {
        onAttempt({ attempt, outcome: kind === 'permanent' ? 'ERROR' : kind.toUpperCase() });
        throw publicTransactionError(kind === 'permanent' ? 'unavailable' : kind, error);
      }
      const delayMs = delayFor(attempt, random);
      onAttempt({ attempt, outcome: kind.toUpperCase(), retry: true, delayMs });
      if (Number.isFinite(deadlineAt) && now() + delayMs >= deadlineAt) throw publicTransactionError('timeout');
      await sleep(delayMs);
    }
  }
  throw new ApiError(503, 'FIRESTORE_UNAVAILABLE');
}
