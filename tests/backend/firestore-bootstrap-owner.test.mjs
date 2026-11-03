import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapOwner, ownerEmailIndex } from '../../scripts/firestore-bootstrap-owner.mjs';

const identity = { environment: 'dev', installationId: '44444444-4444-4444-8444-444444444444', secret: 'ab'.repeat(32) };

function fakeDb(initial = {}) {
  const values = new Map(Object.entries(initial));
  const ref = (collection, id) => ({ path: `${collection}/${id}`, id });
  const docsFor = target => [...values.entries()]
    .filter(([path, value]) => path.startsWith(`${target.collection}/`) && path.split('/').length === target.collection.split('/').length + 1 &&
      (!target.field || value?.[target.field] === target.value))
    .map(([path, value]) => ({ id: path.split('/').at(-1), exists: true, data: () => structuredClone(value) }));
  return {
    values,
    collection(collection) {
      return { kind: 'collection', collection, doc: id => ref(collection, id), where: (field, operator, value) => ({ kind: 'query', collection, field, operator, value }) };
    },
    async runTransaction(work) {
      const tx = {
        async get(target) {
          if (target.kind === 'query') return { docs: docsFor(target) };
          const value = values.get(target.path);
          return { exists: value !== undefined, id: target.id, data: () => structuredClone(value) };
        },
        create(target, value) {
          if (values.has(target.path)) throw Object.assign(new Error('exists'), { code: 6 });
          values.set(target.path, structuredClone(value));
        },
      };
      return work(tx);
    },
  };
}

test('ownerEmailIndex is stable and lowercases the e-mail before hashing', () => {
  const lower = ownerEmailIndex(identity, 'owner@example.invalid');
  const upper = ownerEmailIndex(identity, 'owner@example.invalid'.toUpperCase());
  assert.notEqual(lower, upper); // caller is expected to lowercase first, as bootstrapOwner() does
  assert.equal(lower, ownerEmailIndex(identity, 'owner@example.invalid'));
});

test('creates the first SUPER_ADMIN placeholder and is idempotent for the same e-mail', async () => {
  const db = fakeDb({});
  const first = await bootstrapOwner({ db, email: 'Owner@Example.invalid', ...identity });
  assert.equal(first.created, true);
  const stored = db.values.get(`users/${first.id}`);
  assert.equal(stored.role, 'SUPER_ADMIN');
  assert.equal(stored.status, 'ATIVO');
  assert.equal(stored.activated, false);
  assert.equal(stored.firstAccessCompleted, false);
  assert.equal(stored.authorizationVersion, 1);
  assert.equal(stored.emailIndex, ownerEmailIndex(identity, 'owner@example.invalid'));

  const second = await bootstrapOwner({ db, email: 'owner@example.invalid', ...identity });
  assert.deepEqual(second, { id: first.id, created: false });
  assert.equal(db.values.size, 1); // no duplicate document was created
});

test('refuses to create a second SUPER_ADMIN under a different e-mail', async () => {
  const db = fakeDb({});
  await bootstrapOwner({ db, email: 'owner@example.invalid', ...identity });
  await assert.rejects(bootstrapOwner({ db, email: 'other@example.invalid', ...identity }), /já existe um SUPER_ADMIN/);
});

test('refuses to touch an account that already completed activation', async () => {
  const email = 'owner@example.invalid';
  const index = ownerEmailIndex(identity, email);
  const db = fakeDb({ 'users/11111111-1111-4111-8111-111111111111': { role: 'SUPER_ADMIN', status: 'ATIVO', activated: true, firstAccessCompleted: true, emailIndex: index } });
  await assert.rejects(bootstrapOwner({ db, email, ...identity }), /placeholder seguro/);
});

test('rejects a malformed e-mail before touching the database', async () => {
  const db = fakeDb({});
  await assert.rejects(bootstrapOwner({ db, email: 'not-an-email', ...identity }), /e-mail inválido/);
  assert.equal(db.values.size, 0);
});
