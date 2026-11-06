import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createFirestoreNicheService } from '../../backend/firestore-niches.mjs';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const attendantSessionId = '33333333-3333-4333-8333-333333333333';
const attendantId = '44444444-4444-4444-8444-444444444444';
const productId = '55555555-5555-4555-8555-555555555555';
const tokenHash = 'a'.repeat(64);
const attendantTokenHash = 'b'.repeat(64);
const now = Date.parse('2026-01-01T12:00:00.000Z');

function fakeDb(values) {
  const store = new Map(Object.entries(values));
  const makeRef = (collection, id) => ({ path: `${collection}/${id}`, id,
    collection: child => { const path = `${collection}/${id}/${child}`; return { kind: 'collection', collection: path, doc: childId => makeRef(path, childId) }; } });
  return {
    values: store,
    collection(collection) {
      return { kind: 'collection', collection, doc: id => makeRef(collection, id), where: (field, operator, value) => ({ kind: 'query', collection, field, operator, value }) };
    },
    async runTransaction(work) {
      const tx = {
        async get(target) {
          if (target.kind === 'collection' || target.kind === 'query') {
            const docs = [...store.entries()].filter(([path, value]) => path.startsWith(`${target.collection}/`) && path.split('/').length === target.collection.split('/').length + 1 &&
              (target.kind === 'collection' || value?.[target.field] === target.value)).map(([path, value]) => ({
              id: path.split('/').at(-1), ref: { path, id: path.split('/').at(-1) }, exists: true, data: () => structuredClone(value),
            }));
            return { docs };
          }
          const value = store.get(target.path);
          return { exists: value !== undefined, id: target.id, ref: target, data: () => structuredClone(value) };
        },
        set(target, value) { store.set(target.path, structuredClone(value)); },
        create(target, value) { if (store.has(target.path)) throw Object.assign(new Error('exists'), { code: 6 }); store.set(target.path, structuredClone(value)); },
        update(target, value) { if (!store.has(target.path)) throw Error('missing'); store.set(target.path, { ...store.get(target.path), ...structuredClone(value) }); },
        delete(target) { store.delete(target.path); },
      };
      return work(tx);
    },
  };
}

function makeService(extra = {}) {
  const db = fakeDb({
    [`sessionTokenIndex/${tokenHash}`]: { sessionId, userId },
    [`sessions/${sessionId}`]: { sessionId, userId, assurance: 'passkey', authorizationVersion: 1, authenticatedAt: new Date(now - 1000), expiresAt: new Date(now + 86400000 - 1000), revokedAt: null },
    [`users/${userId}`]: { role: 'ADMIN', status: 'ATIVO', authorizationVersion: 1 },
    [`sessionTokenIndex/${attendantTokenHash}`]: { sessionId: attendantSessionId, userId: attendantId },
    [`sessions/${attendantSessionId}`]: { sessionId: attendantSessionId, userId: attendantId, assurance: 'passkey', authorizationVersion: 1, authenticatedAt: new Date(now - 1000), expiresAt: new Date(now + 86400000 - 1000), revokedAt: null },
    [`users/${attendantId}`]: { role: 'ATENDENTE', status: 'ATIVO', authorizationVersion: 1 },
    ...extra,
  });
  const identity = createFirestoreIdentityService({ db, now: () => now });
  return { db, service: createFirestoreNicheService({ db, identityService: identity, config: { adminPasswordLogin: false }, now: () => now }) };
}

function record(overrides = {}) {
  return { name: 'Vida cristã', description: 'Leituras para o dia a dia', color: '#205b43', order: 2, active: true, ...overrides };
}
function command(overrides = {}) {
  return { commandId: randomUUID(), id: randomUUID(), expectedRevision: 0, record: record(), ...overrides };
}
function image(bytes = Buffer.from('fake-niche-image')) {
  return { bytes: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
}

test('creates a niche, counts linked products and is idempotent for the same command', async () => {
  const { db, service } = makeService();
  const payload = command();
  const created = await service.execute('save', { sessionTokenHash: tokenHash }, payload);
  assert.deepEqual(created, { id: payload.id, ...record(), version: 1, hasImage: false });
  assert.equal(db.values.get(`commands/niches:${payload.commandId}`).state, 'COMMITTED');
  assert.equal(db.values.get(`auditEvents/niches:${payload.commandId}`).operation, 'NICHE_CREATE');
  assert.equal(db.values.get(`uniqueness/niche-name:vida cristã`).nicheId, payload.id);

  db.values.set(`products/${productId}`, { nicheIds: [payload.id] });
  const listed = await service.execute('list', { sessionTokenHash: tokenHash }, {});
  assert.deepEqual(listed.niches, [{ ...record(), id: payload.id, version: 1, hasImage: false, productCount: 1, createdAt: new Date(now), createdBy: userId }]);

  assert.deepEqual(await service.execute('save', { sessionTokenHash: tokenHash }, payload), created);
  assert.equal([...db.values.keys()].filter(key => key.startsWith('auditEvents/')).length, 1);
});

test('rejects a stale revision, a duplicate normalized name and a payload mismatch on the same command', async () => {
  const { service } = makeService();
  const first = command();
  await service.execute('save', { sessionTokenHash: tokenHash }, first);

  await assert.rejects(
    service.execute('save', { sessionTokenHash: tokenHash }, { ...first, commandId: randomUUID(), record: record({ order: 5 }) }),
    { code: 'NICHE_CONFLICT', status: 409 },
  );
  await assert.rejects(
    service.execute('save', { sessionTokenHash: tokenHash }, command({ record: record({ name: 'VIDA CRISTÃ' }) })),
    { code: 'NICHE_DUPLICATE', status: 409 },
  );
  await assert.rejects(
    service.execute('save', { sessionTokenHash: tokenHash }, { ...first, record: record({ name: 'Outro nome' }) }),
    { code: 'IDEMPOTENCY_CONFLICT', status: 409 },
  );
});

test('renaming an existing niche moves the uniqueness reservation and keeps history', async () => {
  const { db, service } = makeService();
  const first = command();
  await service.execute('save', { sessionTokenHash: tokenHash }, first);
  const renamed = await service.execute('save', { sessionTokenHash: tokenHash },
    { commandId: randomUUID(), id: first.id, expectedRevision: 1, record: record({ name: 'Crescimento cristão' }) });
  assert.equal(renamed.version, 2);
  assert.equal(db.values.get('uniqueness/niche-name:vida cristã'), undefined);
  assert.equal(db.values.get('uniqueness/niche-name:crescimento cristão').nicheId, first.id);
  assert.equal(db.values.get(`niches/${first.id}`).createdBy, db.values.get(`niches/${first.id}`).updatedBy);
});

test('attendants cannot manage niches, but can still read an existing image', async () => {
  const { service } = makeService();
  await assert.rejects(service.execute('save', { sessionTokenHash: attendantTokenHash }, command()), { status: 403 });
  await assert.rejects(service.execute('list', { sessionTokenHash: attendantTokenHash }, {}), { status: 403 });
  const payload = { ...command(), image: image() };
  await service.execute('save', { sessionTokenHash: tokenHash }, payload);
  assert.deepEqual(await service.execute('image', { sessionTokenHash: attendantTokenHash }, { id: payload.id }), image());
});

test('removing an image explicitly (null) clears hasImage and deletes the stored bytes', async () => {
  const { db, service } = makeService();
  const payload = { ...command(), image: image() };
  await service.execute('save', { sessionTokenHash: tokenHash }, payload);
  const updated = await service.execute('save', { sessionTokenHash: tokenHash },
    { commandId: randomUUID(), id: payload.id, expectedRevision: 1, record: record(), image: null });
  assert.equal(updated.hasImage, false);
  assert.equal(db.values.has(`niches/${payload.id}/media/image`), false);
  await assert.rejects(service.execute('image', { sessionTokenHash: tokenHash }, { id: payload.id }), { code: 'NICHE_NOT_FOUND', status: 404 });
});

test('saving an image stores it in its own document, separate from the niche document', async () => {
  const { db, service } = makeService();
  const payload = { ...command(), image: image() };
  const created = await service.execute('save', { sessionTokenHash: tokenHash }, payload);
  assert.deepEqual(created, { id: payload.id, ...record(), version: 1, hasImage: true });
  assert.equal(Object.hasOwn(db.values.get(`niches/${payload.id}`), 'image'), false);
  assert.deepEqual(db.values.get(`niches/${payload.id}/media/image`), { ...image(), updatedAt: db.values.get(`niches/${payload.id}/media/image`).updatedAt });
});

test('reading an image returns exactly what was saved, and a niche without one is a 404', async () => {
  const { service } = makeService();
  const payload = command();
  await service.execute('save', { sessionTokenHash: tokenHash }, payload);
  await assert.rejects(service.execute('image', { sessionTokenHash: tokenHash }, { id: payload.id }), { code: 'NICHE_NOT_FOUND', status: 404 });
  const withImage = { ...command({ record: record({ name: 'Crescimento cristão' }) }), image: image() };
  await service.execute('save', { sessionTokenHash: tokenHash }, withImage);
  assert.deepEqual(await service.execute('image', { sessionTokenHash: tokenHash }, { id: withImage.id }), image());
});

test('a tampered image is rejected before anything is written', async () => {
  const { db, service } = makeService();
  const payload = { ...command(), image: { bytes: image().bytes, sha256: 'a'.repeat(64) } };
  await assert.rejects(service.execute('save', { sessionTokenHash: tokenHash }, payload), { code: 'INVALID_NICHE_IMAGE', status: 400 });
  assert.equal(db.values.has(`niches/${payload.id}`), false);
});
