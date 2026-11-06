import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../backend/errors.mjs';
import { createFirestoreRepositories, MAX_FIRESTORE_DOCUMENT_BYTES } from '../../backend/firestore-repositories.mjs';
import { runFirestoreTransaction, classifyFirestoreError } from '../../backend/firestore-transactions.mjs';
import { beginCommand, commandDocumentId, commandRetention, commitCommand, createCommandFingerprint, createCommandMetadata } from '../../backend/firestore-commands.mjs';

function fakeDatabase() {
  const calls = [];
  const db = {
    calls,
    collection(name) {
      return {
        name,
        doc(id) {
          const ref = {
            path: `${name}/${id}`,
            create: async value => calls.push(['create', name, id, value]),
            set: async (value, options) => calls.push(['set', name, id, value, options]),
            update: async value => calls.push(['update', name, id, value]),
            delete: async () => calls.push(['delete', name, id]),
            get: async () => ({ exists: false, data: () => undefined }),
            collection: child => ({ doc: childId => ({ path: `${name}/${id}/${child}/${childId}` }) }),
          };
          return ref;
        },
      };
    },
  };
  return db;
}

function fakeTransactionStore() {
  const values = new Map();
  const operations = [];
  return {
    values,
    operations,
    get: async ref => {
      const value = values.get(ref.path);
      return { exists: value !== undefined, data: () => structuredClone(value) };
    },
    create: (ref, value) => {
      if (values.has(ref.path)) throw Object.assign(new Error('already exists'), { code: 6 });
      values.set(ref.path, structuredClone(value)); operations.push(['create', ref.path]);
    },
    update: (ref, value) => {
      if (!values.has(ref.path)) throw Error('missing');
      values.set(ref.path, { ...values.get(ref.path), ...structuredClone(value) }); operations.push(['update', ref.path]);
    },
  };
}

test('repositories validate document size and protect immutable collections', async () => {
  const db = fakeDatabase();
  const repositories = createFirestoreRepositories(db);
  await repositories.create('auditEvents', 'event-1', { id: 'event-1', result: 'SUCESSO' });
  await assert.rejects(repositories.set('auditEvents', 'event-1', { result: 'ALTERADO' }), { code: 'FIRESTORE_IMMUTABLE', status: 409 });
  await assert.rejects(repositories.delete('domainEvents', 'event-1'), { code: 'FIRESTORE_IMMUTABLE', status: 409 });
  await assert.rejects(repositories.create('products', 'p/invalid', {}), { code: 'INVALID_FIRESTORE_DOCUMENT', status: 400 });
  await assert.rejects(repositories.create('products', 'large', { body: 'x'.repeat(MAX_FIRESTORE_DOCUMENT_BYTES) }), { code: 'INVALID_FIRESTORE_DOCUMENT', status: 400 });
  assert.deepEqual(db.calls[0].slice(0, 3), ['create', 'auditEvents', 'event-1']);
});

test('transaction runner retries bounded transient conflicts with backoff and returns result', async () => {
  let calls = 0;
  const events = [];
  const result = await runFirestoreTransaction({
    runTransaction: async (work, options) => {
      assert.deepEqual(options, { maxAttempts: 1 });
      calls++;
      if (calls < 3) throw Object.assign(new Error('transaction conflict'), { code: 10 });
      return work({ name: 'transaction' });
    },
  }, async (_transaction, context) => ({ attempt: context.attempt }), {
    sleep: async delay => events.push(['sleep', delay]),
    random: () => 0,
    onAttempt: event => events.push(['attempt', event]),
  });
  assert.deepEqual(result, { attempt: 3 });
  assert.equal(calls, 3);
  assert.deepEqual(events.filter(event => event[0] === 'sleep').map(event => event[1]), [25, 75]);
  assert.equal(events.at(-1)[1].outcome, 'COMMITTED');
});

test('transaction runner does not retry application conflicts and maps exhausted failures safely', async () => {
  let calls = 0;
  await assert.rejects(runFirestoreTransaction({
    runTransaction: async work => { calls++; return work({}); },
  }, async () => { throw new ApiError(409, 'CATALOG_CONFLICT'); }), { code: 'CATALOG_CONFLICT', status: 409 });
  assert.equal(calls, 1);
  assert.equal(classifyFirestoreError(Object.assign(new Error(), { code: 10 })), 'conflict');
  assert.equal(classifyFirestoreError(Object.assign(new Error(), { code: 14 })), 'unavailable');
  await assert.rejects(runFirestoreTransaction({
    runTransaction: async () => { throw Object.assign(new Error('aborted'), { code: 10 }); },
  }, async () => {}, { maxAttempts: 2, sleep: async () => {} }), { code: 'FIRESTORE_TRANSACTION_CONFLICT', status: 409 });
});

test('command metadata uses stable fingerprints and durable idempotency states', async () => {
  assert.equal(createCommandFingerprint({ b: 2, a: 1 }), createCommandFingerprint({ a: 1, b: 2 }));
  assert.equal(commandDocumentId('catalog', 'command-1'), 'catalog:command-1');
  assert.equal(commandRetention(90), 90 * 24 * 60 * 60 * 1000);
  const tx = fakeTransactionStore();
  const ref = { path: 'commands/catalog:command-1' };
  const metadata = createCommandMetadata({
    domain: 'catalog', commandId: 'command-1', operation: 'save', actor: 'user-1',
    payloadHash: createCommandFingerprint({ id: 'product-1', version: 2 }), now: new Date('2026-01-01T00:00:00.000Z'), retentionMs: commandRetention(90),
  });
  assert.equal((await beginCommand(tx, ref, metadata)).status, 'NEW');
  const output = { id: 'product-1', version: 3 };
  commitCommand(tx, ref, output, new Date('2026-01-01T00:00:01.000Z'));
  assert.deepEqual((await beginCommand(tx, ref, metadata)).result, output);
  await assert.rejects(beginCommand(tx, ref, { ...metadata, payloadHash: 'f'.repeat(64) }), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
});

test('pending commands remain visible for domain recovery instead of being overwritten', async () => {
  const tx = fakeTransactionStore();
  const ref = { path: 'commands/stock:command-1' };
  const metadata = createCommandMetadata({ domain: 'stock', commandId: 'command-1', operation: 'receive', actor: 'user-1', payloadHash: 'a'.repeat(64) });
  await beginCommand(tx, ref, metadata);
  const pending = await beginCommand(tx, ref, metadata);
  assert.equal(pending.status, 'PENDING');
  assert.equal(tx.operations.length, 1);
});
