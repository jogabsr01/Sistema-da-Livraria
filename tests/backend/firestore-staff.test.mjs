import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreStaffService } from '../../backend/firestore-staff.mjs';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';

const adminId = '11111111-1111-4111-8111-111111111111';
const employeeId = '66666666-6666-4666-8666-666666666666';
const sessionId = '33333333-3333-4333-8333-333333333333';
const commandId = '77777777-7777-4777-8777-777777777777';
const tokenHash = 'a'.repeat(64);
const emailIndex = 'b'.repeat(64), cpfIndex = 'c'.repeat(64);
const now = Date.parse('2026-01-01T12:00:00.000Z');
function fakeDb(values) {
  const store = new Map(Object.entries(values));
  const ref = (collection, id) => ({ path: `${collection}/${id}`, id, collection: child => ({ kind: 'collection', collection: `${collection}/${id}/${child}`, doc: childId => ref(`${collection}/${id}/${child}`, childId) }) });
  return { values: store, collection(collection) { return { kind: 'collection', collection, doc: id => ref(collection, id), where: (field, operator, value) => ({ kind: 'query', collection, field, operator, value }) }; }, async runTransaction(work) {
    const tx = { async get(target) { if (target.kind === 'collection' || target.kind === 'query') { const depth = target.collection.split('/').length; return { docs: [...store.entries()].filter(([path, value]) => path.startsWith(`${target.collection}/`) && path.split('/').length === depth + 1 && (target.kind === 'collection' || value?.[target.field] === target.value)).map(([path, value]) => ({ id: path.split('/').at(-1), ref: { path, id: path.split('/').at(-1) }, exists: true, data: () => structuredClone(value) })) }; } const value = store.get(target.path); return { exists: value !== undefined, id: target.id, ref: target, data: () => structuredClone(value) }; }, set(target, value) { store.set(target.path, structuredClone(value)); }, create(target, value) { if (store.has(target.path)) throw Error('exists'); store.set(target.path, structuredClone(value)); }, update(target, value) { store.set(target.path, { ...store.get(target.path), ...structuredClone(value) }); }, delete(target) { store.delete(target.path); } }; return work(tx);
  }};
}
function makeService(values = {}) { const db = fakeDb({ [`sessionTokenIndex/${tokenHash}`]: { sessionId, userId: adminId }, [`sessions/${sessionId}`]: { sessionId, userId: adminId, assurance: 'passkey', authorizationVersion: 2, authenticatedAt: new Date('2026-01-01T11:59:00.000Z'), expiresAt: new Date('2026-01-02T11:00:00.000Z') }, [`users/${adminId}`]: { id: adminId, role: 'ADMIN', status: 'ATIVO', owner: true, authorizationVersion: 2 }, ...values }); const identity = createFirestoreIdentityService({ db, now: () => now }); return { db, service: createFirestoreStaffService({ db, identityService: identity, config: {}, now: () => now }) }; }

test('staff bootstrap returns an empty page for an owner without employees', async () => {
  const { service } = makeService();
  const result = await service.execute('bootstrap', { sessionTokenHash: tokenHash }, { offset: 0 });
  assert.equal(result.principal.id, adminId);
  assert.deepEqual({ users: result.users, total: result.total, nextOffset: result.nextOffset }, { users: [], total: 0, nextOffset: null });
});

test('password-authenticated super admin can read another administrator for CPF preservation', async () => {
  const { db } = makeService({ [`users/${employeeId}`]: { id: employeeId, role: 'ADMIN', status: 'ATIVO', revision: 1, activated: true, contact: 'ciphertext', authorizationVersion: 1 } });
  db.values.get(`users/${adminId}`).role = 'SUPER_ADMIN';
  db.values.get(`sessions/${sessionId}`).assurance = 'password';
  const identity = createFirestoreIdentityService({ db, now: () => now });
  const service = createFirestoreStaffService({ db, identityService: identity, config: { adminPasswordLogin: true }, now: () => now });
  assert.equal((await service.execute('get', { sessionTokenHash: tokenHash }, { id: employeeId })).user.id, employeeId);
  db.values.get(`users/${adminId}`).role = 'ADMIN';
  await assert.rejects(service.execute('get', { sessionTokenHash: tokenHash }, { id: employeeId }), { code: 'FORBIDDEN' });
});

test('Firestore staff lists and saves versioned encrypted contact metadata', async () => {
  const { db, service } = makeService();
  const payload = { commandId, id: employeeId, expectedRevision: 0, role: 'ATENDENTE', status: 'ATIVO', contact: 'ciphertext', emailIndex, cpfIndex, fingerprint: 'd'.repeat(64), reason: 'Cadastro' };
  const result = await service.execute('save', { sessionTokenHash: tokenHash }, payload);
  assert.deepEqual(result, { id: employeeId, revision: 1, reenrollmentRequired: true });
  const list = await service.execute('list', { sessionTokenHash: tokenHash }, { offset: 0 });
  assert.equal(list.total, 1);
  assert.equal(list.users[0].contact, 'ciphertext');
  assert.deepEqual(await service.execute('save', { sessionTokenHash: tokenHash }, payload), result);
  assert.equal(db.values.get(`commands/staff:${commandId}`).state, 'COMMITTED');
});

test('Firestore staff distinguishes duplicate email and CPF reservations', async () => {
  const { service } = makeService({ [`uniqueness/staff-email:${emailIndex}`]: { ownerId: '88888888-8888-4888-8888-888888888888' } });
  await assert.rejects(service.execute('save', { sessionTokenHash: tokenHash }, { commandId, id: employeeId, expectedRevision: 0, role: 'ATENDENTE', status: 'ATIVO', contact: 'ciphertext', emailIndex, cpfIndex, fingerprint: 'd'.repeat(64), reason: 'Cadastro' }), { code: 'STAFF_EMAIL_DUPLICATE', status: 409 });
});

test('editing inactive staff replaces its email index and removes stale plaintext and its old reservation', async () => {
  const oldIndex = 'e'.repeat(64);
  const { db, service } = makeService({
    [`users/${employeeId}`]: { id: employeeId, role: 'ATENDENTE', status: 'INATIVO', revision: 1, activated: false, contact: 'old', email: 'old@example.invalid', emailIndex: oldIndex, cpfIndex, authorizationVersion: 1 },
    [`uniqueness/staff-email:${oldIndex}`]: { ownerId: employeeId },
    [`uniqueness/staff-cpf:${cpfIndex}`]: { ownerId: employeeId },
  });
  await service.execute('save', { sessionTokenHash: tokenHash }, { commandId, id: employeeId, expectedRevision: 1, role: 'ATENDENTE', status: 'INATIVO', contact: 'new', emailIndex, cpfIndex, fingerprint: 'd'.repeat(64), reason: 'Correção' });
  assert.equal(db.values.get(`users/${employeeId}`).emailIndex, emailIndex);
  assert.equal(Object.hasOwn(db.values.get(`users/${employeeId}`), 'email'), false);
  assert.equal(db.values.has(`uniqueness/staff-email:${oldIndex}`), false);
  assert.equal(db.values.get(`uniqueness/staff-email:${emailIndex}`).ownerId, employeeId);
});

test('editing staff never deletes an old reservation owned by someone else', async () => {
  const oldIndex = 'e'.repeat(64), otherId = '88888888-8888-4888-8888-888888888888';
  const { db, service } = makeService({
    [`users/${employeeId}`]: { id: employeeId, role: 'ATENDENTE', status: 'INATIVO', revision: 1, activated: false, contact: 'old', emailIndex: oldIndex, cpfIndex, authorizationVersion: 1 },
    [`uniqueness/staff-email:${oldIndex}`]: { ownerId: otherId },
  });
  await service.execute('save', { sessionTokenHash: tokenHash }, { commandId, id: employeeId, expectedRevision: 1, role: 'ATENDENTE', status: 'INATIVO', contact: 'new', emailIndex, cpfIndex, fingerprint: 'd'.repeat(64), reason: 'Correção' });
  assert.equal(db.values.get(`uniqueness/staff-email:${oldIndex}`).ownerId, otherId);
});

test('an active older administrator session can manage staff without another login', async () => {
  const { db, service } = makeService();
  db.values.get(`sessions/${sessionId}`).authenticatedAt = new Date(now - 600000);
  assert.equal((await service.execute('bootstrap', { sessionTokenHash: tokenHash }, { offset: 0 })).principal.id, adminId);
  const result = await service.execute('save', { sessionTokenHash: tokenHash }, { commandId, id: employeeId, expectedRevision: 0, role: 'ATENDENTE', status: 'ATIVO', contact: 'ciphertext', emailIndex, cpfIndex, fingerprint: 'd'.repeat(64), reason: 'Cadastro' });
  assert.equal(result.revision, 1);
});

test('local laboratory permits older administrator session to manage staff without granting admin privileges to attendants', async () => {
  const { db } = makeService();
  db.values.get(`sessions/${sessionId}`).authenticatedAt = new Date(now - 600000);
  const identity = createFirestoreIdentityService({ db, now: () => now });
  const service = createFirestoreStaffService({ db, identityService: identity, config: { localLab: true }, now: () => now });
  const payload = { commandId, id: employeeId, expectedRevision: 0, role: 'ATENDENTE', status: 'ATIVO', contact: 'ciphertext', emailIndex, cpfIndex, fingerprint: 'd'.repeat(64), reason: 'Cadastro' };
  assert.equal((await service.execute('save', { sessionTokenHash: tokenHash }, payload)).revision, 1);
  db.values.get(`users/${adminId}`).role = 'ATENDENTE';
  await assert.rejects(service.execute('save', { sessionTokenHash: tokenHash }, { ...payload, commandId: '88888888-8888-4888-8888-888888888888', expectedRevision: 1 }), { code: 'FORBIDDEN' });
});
