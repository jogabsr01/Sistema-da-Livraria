import test from 'node:test';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { enqueueStockAlertProjection, enqueueEmailDelivery, processPendingFirestoreOutbox } from '../../backend/firestore-outbox.mjs';
import { createFirestoreRepositories } from '../../backend/firestore-repositories.mjs';

const productId = '66666666-6666-4666-8666-666666666666';
const now = Date.parse('2026-01-01T12:00:00.000Z');

function fakeDb(values) {
  const store = new Map(Object.entries(values));
  const ref = (collection, id) => ({ path: `${collection}/${id}`, id, collection: child => ({ kind: 'collection', collection: `${collection}/${id}/${child}`, doc: childId => ref(`${collection}/${id}/${child}`, childId) }) });
  const db = {
    values: store,
    collection(collection) { return { kind: 'collection', collection, doc: id => ref(collection, id), where: (field, operator, value) => ({ kind: 'query', collection, field, operator, value }) }; },
    async runTransaction(work) {
      const tx = {
        async get(target) {
          if (target.kind === 'collection' || target.kind === 'query') {
            const depth = target.collection.split('/').length;
            const docs = [...store.entries()].filter(([path, value]) => path.startsWith(`${target.collection}/`) && path.split('/').length === depth + 1 &&
              (target.kind === 'collection' || value?.[target.field] === target.value)).map(([path, value]) => ({ id: path.split('/').at(-1), ref: { path, id: path.split('/').at(-1) }, exists: true, data: () => structuredClone(value) }));
            return { docs };
          }
          const value = store.get(target.path);
          return { exists: value !== undefined, id: target.id, ref: target, data: () => structuredClone(value) };
        },
        set(target, value) { store.set(target.path, structuredClone(value)); },
        create(target, value) { if (store.has(target.path)) throw Error('exists'); store.set(target.path, structuredClone(value)); },
        update(target, value) { store.set(target.path, { ...store.get(target.path), ...structuredClone(value) }); },
        delete(target) { store.delete(target.path); },
      };
      return work(tx);
    },
  };
  return db;
}

test('stock outbox opens and resolves deterministic alert episodes', async () => {
  const db = fakeDb({ [`products/${productId}`]: { title: 'Livro', active: true, stock: 0, minimumStock: 2, version: 1 } });
  const repositories = createFirestoreRepositories(db);
  await db.runTransaction(async transaction => { enqueueStockAlertProjection(transaction, repositories, { productId, version: 1, now: new Date(now) }); });
  const config = { installationId: '11111111-1111-4111-8111-111111111111', secret: 'ab'.repeat(32) };
  const opened = await processPendingFirestoreOutbox({ db, config, now: () => now });
  assert.equal(opened.processed, true);
  const notifications = [...db.values.entries()].filter(([path]) => path.startsWith('notifications/'));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][1].type, 'STOCK_ZERO');
  assert.equal(db.values.get('outbox:missing'), undefined);
  db.values.set(`products/${productId}`, { title: 'Livro', active: true, stock: 2, minimumStock: 2, version: 2 });
  await db.runTransaction(async transaction => { enqueueStockAlertProjection(transaction, repositories, { productId, version: 2, now: new Date(now + 1000) }); });
  const resolved = await processPendingFirestoreOutbox({ db, config, now: () => now + 1000 });
  assert.equal(resolved.processed, true);
  assert.equal(notifications[0][1].state, 'ABERTA');
  const latest = [...db.values.entries()].find(([path]) => path.startsWith('notifications/'))[1];
  assert.equal(latest.state, 'RESOLVIDA');
});

test('email outbox confirms a provider result found after an uncertain send without sending twice', async () => {
  const db = fakeDb({});
  const repositories = createFirestoreRepositories(db);
  const settings = { mode: 'firestore', emailDeliveryKey: randomBytes(32), emailProvider: 'resend', emailProviderKey: 'provider-key', emailFrom: 'Livraria <dev@example.invalid>' };
  await db.runTransaction(async transaction => {
    enqueueEmailDelivery(transaction, repositories, { settings, idempotencyKey: 'auth:uncertain', to: 'owner@example.invalid', subject: 'Código', text: 'Código secreto', now: new Date(now) });
  });
  db.values.set('outbox/email:auth:uncertain', { ...db.values.get('outbox/email:auth:uncertain'), providerId: '11111111-1111-4111-8111-111111111111' });
  let sends = 0, lookups = 0;
  const result = await processPendingFirestoreOutbox({ db, config: { firestore: settings }, now: () => now,
    provider: {
      send: async () => { sends++; throw Object.assign(new Error('network'), { code: 'EMAIL_DELIVERY_RESULT_UNKNOWN' }); },
      lookup: async input => { lookups++; assert.equal(input.providerId, '11111111-1111-4111-8111-111111111111'); return { status: 'FOUND', id: input.providerId }; },
    },
  });
  assert.deepEqual(result, { processed: true, emailSent: true });
  assert.equal(sends, 1);
  assert.equal(lookups, 1);
  assert.equal(db.values.get('outbox/email:auth:uncertain').state, 'SUCCEEDED');
  assert.equal(db.values.get('outbox/email:auth:uncertain').providerId, '11111111-1111-4111-8111-111111111111');
  assert.equal(JSON.stringify(db.values.get('outbox/email:auth:uncertain')).includes('Código secreto'), false);
});

test('email outbox retries with the same idempotency key only after a definitive provider miss', async () => {
  const db = fakeDb({});
  const repositories = createFirestoreRepositories(db);
  const settings = { mode: 'firestore', emailDeliveryKey: randomBytes(32), emailProvider: 'resend', emailProviderKey: 'provider-key', emailFrom: 'Livraria <dev@example.invalid>' };
  await db.runTransaction(async transaction => {
    enqueueEmailDelivery(transaction, repositories, { settings, idempotencyKey: 'auth:miss', to: 'owner@example.invalid', subject: 'Código', text: 'Código secreto', now: new Date(now) });
  });
  db.values.set('outbox/email:auth:miss', { ...db.values.get('outbox/email:auth:miss'), providerId: '22222222-2222-4222-8222-222222222222' });
  let sends = 0;
  const result = await processPendingFirestoreOutbox({ db, config: { firestore: settings }, now: () => now,
    provider: {
      send: async input => { sends++; assert.equal(input.idempotencyKey, 'email:auth:miss'); if (sends === 1) throw Object.assign(new Error('network'), { code: 'EMAIL_DELIVERY_RESULT_UNKNOWN' }); return { id: '33333333-3333-4333-8333-333333333333' }; },
      lookup: async () => ({ status: 'NOT_FOUND' }),
    },
  });
  assert.deepEqual(result, { processed: true, emailSent: true });
  assert.equal(sends, 2);
  assert.equal(db.values.get('outbox/email:auth:miss').providerId, '33333333-3333-4333-8333-333333333333');
});

test('email outbox keeps an unresolved provider result out of automatic resend', async () => {
  const db = fakeDb({});
  const repositories = createFirestoreRepositories(db);
  const settings = { mode: 'firestore', emailDeliveryKey: randomBytes(32), emailProvider: 'resend', emailProviderKey: 'provider-key', emailFrom: 'Livraria <dev@example.invalid>' };
  await db.runTransaction(async transaction => {
    enqueueEmailDelivery(transaction, repositories, { settings, idempotencyKey: 'auth:unknown', to: 'owner@example.invalid', subject: 'Código', text: 'Código secreto', now: new Date(now) });
  });
  db.values.set('outbox/email:auth:unknown', { ...db.values.get('outbox/email:auth:unknown'), providerId: '44444444-4444-4444-8444-444444444444' });
  let sends = 0;
  const result = await processPendingFirestoreOutbox({ db, config: { firestore: settings }, now: () => now,
    provider: {
      send: async () => { sends++; throw Object.assign(new Error('network'), { code: 'EMAIL_DELIVERY_RESULT_UNKNOWN' }); },
      lookup: async () => { throw Object.assign(new Error('network'), { code: 'EMAIL_DELIVERY_RESULT_UNKNOWN' }); },
    },
  });
  assert.equal(result.uncertain, true);
  assert.equal(sends, 1);
  const entry = db.values.get('outbox/email:auth:unknown');
  assert.equal(entry.state, 'UNCERTAIN');
  assert.equal(entry.errorCode, 'EMAIL_DELIVERY_RESULT_UNKNOWN');
});
