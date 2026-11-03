import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreScheduleService } from '../../backend/firestore-schedules.mjs';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';
import { processPendingFirestoreOutbox } from '../../backend/firestore-outbox.mjs';

const adminId = '11111111-1111-4111-8111-111111111111';
const employeeId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const scheduleId = '66666666-6666-4666-8666-666666666666';
const commandId = '77777777-7777-4777-8777-777777777777';
const tokenHash = 'a'.repeat(64);
const now = Date.parse('2026-01-01T12:00:00.000Z');
const config = { installationId: adminId, secret: 'ab'.repeat(32), adminPinLogin: false };

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
        update(target, value) { if (!store.has(target.path)) throw Error('missing'); store.set(target.path, { ...store.get(target.path), ...structuredClone(value) }); },
        delete(target) { store.delete(target.path); },
      };
      return work(tx);
    },
  };
  return db;
}
function makeService(values = {}) {
  const db = fakeDb({
    [`sessionTokenIndex/${tokenHash}`]: { sessionId, userId: adminId },
    [`sessions/${sessionId}`]: { sessionId, userId: adminId, assurance: 'passkey', authorizationVersion: 2, authenticatedAt: new Date('2026-01-01T11:59:00.000Z'), expiresAt: new Date('2026-01-02T11:00:00.000Z') },
    [`users/${adminId}`]: { role: 'ADMIN', status: 'ATIVO', owner: true, contact: '', authorizationVersion: 2 },
    [`users/${employeeId}`]: { role: 'ATENDENTE', status: 'ATIVO', owner: false, contact: 'ciphertext', authorizationVersion: 1 },
    ...values,
  });
  const identity = createFirestoreIdentityService({ db, now: () => now });
  return { db, service: createFirestoreScheduleService({ db, identityService: identity, config, now: () => now }) };
}
function savePayload(id = scheduleId, command = commandId, status = 'PUBLICADA', employee = employeeId) {
  return { commandId: command, id, expectedRevision: 0, fingerprint: 'f'.repeat(64), notesHash: 'e'.repeat(64),
    record: { employeeId: employee, date: '2026-01-10', start: '09:00', end: '12:00', notes: 'sealed-notes', status } };
}

test('Firestore schedules saves, lists, reads and projects publication notification', async () => {
  const { db, service } = makeService();
  const result = await service.execute('save', { sessionTokenHash: tokenHash }, savePayload());
  assert.deepEqual(result, { id: scheduleId, version: 1, status: 'PUBLICADA' });
  const list = await service.execute('list', { sessionTokenHash: tokenHash }, { from: '2026-01-01', to: '2026-01-31', employeeId: '', offset: 0 });
  assert.equal(list.items[0].id, scheduleId);
  assert.equal(list.people.length, 2);
  const detail = await service.execute('get', { sessionTokenHash: tokenHash }, { id: scheduleId });
  assert.equal(detail.items[0].notes, 'sealed-notes');
  assert.ok(db.values.get(`outbox/schedule-notification:${commandId}`));
  await processPendingFirestoreOutbox({ db, config, now: () => now });
  assert.equal([...db.values.values()].some(value => value.type === 'SCHEDULE_PUBLISHED'), true);
});

test('Firestore schedules rejects overlapping assignments and supports idempotent cancel', async () => {
  const { service } = makeService();
  await service.execute('save', { sessionTokenHash: tokenHash }, savePayload());
  await assert.rejects(service.execute('save', { sessionTokenHash: tokenHash }, savePayload('88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999')), { code: 'SCHEDULE_OVERLAP', status: 409 });
  const cancel = await service.execute('cancel', { sessionTokenHash: tokenHash }, { commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id: scheduleId, expectedRevision: 1, fingerprint: 'a'.repeat(64) });
  assert.deepEqual(cancel, { id: scheduleId, version: 2, status: 'CANCELADA' });
  assert.deepEqual(await service.execute('cancel', { sessionTokenHash: tokenHash }, { commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id: scheduleId, expectedRevision: 1, fingerprint: 'a'.repeat(64) }), cancel);
});
