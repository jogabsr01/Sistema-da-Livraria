import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreRateLimitService } from '../../backend/firestore-rate-limits.mjs';

const accountKey = 'a'.repeat(64);
const originKey = 'b'.repeat(64);
const otherAccountKey = 'c'.repeat(64);
const start = Date.parse('2026-01-01T12:00:00.000Z');

function ref(path) {
  return { path, collection: path.split('/').at(-1) };
}

function fakeDb(initial = {}) {
  const values = new Map(Object.entries(initial));
  const db = {
    values,
    collection(collection) {
      return { kind: 'collection', collection, doc: id => ref(`${collection}/${id}`) };
    },
    async runTransaction(work) {
      const tx = {
        async get(target) {
          if (target.kind === 'collection') {
            const docs = [...values.entries()]
              .filter(([path]) => path.startsWith(`${target.collection}/`) && path.split('/').length === 2)
              .map(([path, value]) => ({ id: path.split('/').at(-1), exists: true, data: () => structuredClone(value) }));
            return { docs };
          }
          const value = values.get(target.path);
          return { exists: value !== undefined, id: target.path.split('/').at(-1), ref: target, data: () => structuredClone(value) };
        },
        create(target, value) {
          if (values.has(target.path)) throw Object.assign(new Error('exists'), { code: 6 });
          values.set(target.path, structuredClone(value));
        },
        set(target, value) { values.set(target.path, structuredClone(value)); },
        update(target, value) {
          if (!values.has(target.path)) throw Error(`missing:${target.path}`);
          values.set(target.path, { ...values.get(target.path), ...structuredClone(value) });
        },
        delete(target) { values.delete(target.path); },
      };
      return work(tx);
    },
  };
  return db;
}

function service(db, clock) {
  return createFirestoreRateLimitService({ db, now: () => clock.now, transactionOptions: { maxAttempts: 1 } });
}

test('rejects a payload that is not exactly accountKey/originKey', async () => {
  const svc = service(fakeDb(), { now: start });
  await assert.rejects(svc.reserve({ accountKey }), error => error.status === 400 && error.code === 'CHALLENGE_REJECTED');
  await assert.rejects(svc.reserve({ accountKey, originKey, extra: 1 }), error => error.code === 'CHALLENGE_REJECTED');
  await assert.rejects(svc.reserve({ accountKey: 'nothex', originKey }), error => error.code === 'CHALLENGE_REJECTED');
});

test('allows the first five attempts for an account and blocks the sixth with a 60s cooldown', async () => {
  const svc = service(fakeDb(), { now: start });
  for (let i = 0; i < 5; i++) {
    const result = await svc.reserve({ accountKey, originKey: `${i}`.repeat(64).slice(0, 64) });
    assert.equal(result.allowed, true);
    assert.equal(result.retryAfterSeconds, 0);
  }
  const blocked = await svc.reserve({ accountKey, originKey: 'f'.repeat(64) });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
});

test('allows thirty attempts from one origin across distinct accounts, then blocks', async () => {
  const svc = service(fakeDb(), { now: start });
  for (let i = 0; i < 30; i++) {
    const result = await svc.reserve({ accountKey: i.toString(16).padStart(64, '0'), originKey });
    assert.equal(result.allowed, true);
  }
  const blocked = await svc.reserve({ accountKey: 'ff'.padStart(64, '0'), originKey });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
});

test('repeated queries during a cooldown do not extend it or spend another slot', async () => {
  const db = fakeDb(), clock = { now: start }, svc = service(db, clock);
  for (let i = 0; i < 6; i++) await svc.reserve({ accountKey, originKey });
  const first = await svc.reserve({ accountKey, originKey });
  assert.equal(first.allowed, false);
  clock.now += 30_000;
  const second = await svc.reserve({ accountKey, originKey });
  assert.equal(second.allowed, false);
  assert.equal(second.retryAfterSeconds, 30);
  const stored = db.values.get(`authRateLimits/account:${accountKey}`);
  assert.equal(stored.attemptCount, 6);
});

test('a fresh window opens once the cooldown expires, restoring the full budget', async () => {
  const db = fakeDb(), clock = { now: start }, svc = service(db, clock);
  for (let i = 0; i < 6; i++) await svc.reserve({ accountKey, originKey });
  clock.now += 61_000;
  for (let i = 0; i < 5; i++) {
    const result = await svc.reserve({ accountKey, originKey: `${i}`.repeat(64).slice(0, 64) });
    assert.equal(result.allowed, true, `attempt ${i} after cooldown expiry should be allowed`);
  }
});

test('penalty doubles on a second lockout within 24h and resets after 24h idle', async () => {
  const db = fakeDb(), clock = { now: start }, svc = service(db, clock);
  for (let i = 0; i < 6; i++) await svc.reserve({ accountKey, originKey });
  clock.now += 61_000;
  for (let i = 0; i < 5; i++) await svc.reserve({ accountKey, originKey: `${i}`.repeat(64).slice(0, 64) });
  const secondBlock = await svc.reserve({ accountKey, originKey: 'e'.repeat(64) });
  assert.equal(secondBlock.allowed, false);
  assert.equal(secondBlock.retryAfterSeconds, 120);

  clock.now += 86_400_000;
  for (let i = 0; i < 5; i++) await svc.reserve({ accountKey: otherAccountKey, originKey: `${i}`.repeat(64).slice(0, 64) });
  const afterIdleReset = await svc.reserve({ accountKey: otherAccountKey, originKey: 'd'.repeat(64) });
  assert.equal(afterIdleReset.allowed, false);
  assert.equal(afterIdleReset.retryAfterSeconds, 60, 'penalty level should restart at 1 after 24h of inactivity');
});

test('fails closed when a stored counter is corrupted', async () => {
  const db = fakeDb({ [`authRateLimits/account:${accountKey}`]: { windowStart: new Date(start), updatedAt: new Date(start), blockedUntil: null, attemptCount: -1, penaltyLevel: 0 } });
  const svc = service(db, { now: start });
  await assert.rejects(svc.reserve({ accountKey, originKey }), error => error.status === 503 && error.code === 'IDENTITY_UNAVAILABLE');
});

test('fails closed instead of creating new counters past the 3000-document cap', async () => {
  const seed = {};
  for (let i = 0; i < 3000; i++) seed[`authRateLimits/filler:${i}`] = { windowStart: new Date(start), updatedAt: new Date(start), blockedUntil: null, attemptCount: 0, penaltyLevel: 0 };
  const db = fakeDb(seed);
  const svc = service(db, { now: start });
  await assert.rejects(svc.reserve({ accountKey, originKey }), error => error.status === 503 && error.code === 'IDENTITY_UNAVAILABLE');
});
