import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapOwner, ownerEmailIndex, logBootstrapPreflight } from '../../scripts/firestore-bootstrap-owner.mjs';

const identity = { environment: 'dev', installationId: '44444444-4444-4444-8444-444444444444', secret: 'ab'.repeat(32) };

test('preflight logs presence only, never secret values', () => {
  const lines = [];
  logBootstrapPreflight({ WORKSPACE_HMAC_SECRET: 'secret-test-value' }, line => lines.push(line));
  assert.ok(lines.includes('[DEBUG] WORKSPACE_HMAC_SECRET presente: true'));
  assert.ok(lines.includes('[DEBUG] WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON presente: false'));
  assert.ok(!lines.join('\n').includes('secret-test-value'));
});

test('preflight reports account parse and project mismatch without values', () => {
  const account = JSON.stringify({ project_id: 'private-project', private_key: 'private-key' });
  for (const [value, reason] of [[account, 'MISMATCHED_PROJECT_ID'], ['not-json-secret', 'MALFORMED_JSON']]) {
    const lines = [];
    logBootstrapPreflight({ WORKSPACE_FIRESTORE_PROJECT_ID: 'other-project', WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: value }, line => lines.push(line));
    assert.ok(lines.includes(`[DEBUG] CONFIG_REJECTED_REASON: ${reason}`));
    assert.ok(!lines.join('\n').includes('private-project'));
    assert.ok(!lines.join('\n').includes('private-key'));
    assert.ok(!lines.join('\n').includes('not-json-secret'));
  }
});

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
        update(target, value) {
          if (!values.has(target.path)) throw new Error('missing');
          values.set(target.path, { ...values.get(target.path), ...structuredClone(value) });
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
  assert.equal(stored.email, 'owner@example.invalid');
  assert.equal(stored.revision, 0);
  assert.equal(stored.contact, '');
  assert.equal(stored.hasPhoto, false);

  const second = await bootstrapOwner({ db, email: 'owner@example.invalid', ...identity });
  assert.deepEqual(second, { id: first.id, created: false });
  assert.equal(db.values.size, 1); // no duplicate document was created
});

test('refuses to create a second SUPER_ADMIN under a different e-mail', async () => {
  const db = fakeDb({});
  await bootstrapOwner({ db, email: 'owner@example.invalid', ...identity });
  await assert.rejects(bootstrapOwner({ db, email: 'other@example.invalid', ...identity }), /já existe um SUPER_ADMIN/);
});

test('repairs missing profile fields without changing an activated account', async () => {
  const email = 'owner@example.invalid';
  const index = ownerEmailIndex(identity, email);
  const path = 'users/11111111-1111-4111-8111-111111111111';
  const db = fakeDb({ [path]: { role: 'SUPER_ADMIN', owner: true, status: 'ATIVO', activated: true, firstAccessCompleted: true, emailIndex: index, authorizationVersion: 4 } });
  await bootstrapOwner({ db, email, ...identity });
  assert.deepEqual(db.values.get(path), { role: 'SUPER_ADMIN', owner: true, status: 'ATIVO', activated: true, firstAccessCompleted: true, emailIndex: index, authorizationVersion: 4, email, revision: 0, contact: '', hasPhoto: false });
  await bootstrapOwner({ db, email, ...identity });
  assert.equal(db.values.get(path).authorizationVersion, 4);
});

test('refuses to overwrite a conflicting stored email', async () => {
  const email = 'owner@example.invalid';
  const db = fakeDb({ 'users/11111111-1111-4111-8111-111111111111': { role: 'SUPER_ADMIN', owner: true, status: 'ATIVO', emailIndex: ownerEmailIndex(identity, email), email: 'other@example.invalid' } });
  await assert.rejects(bootstrapOwner({ db, email, ...identity }), /não corresponde/);
});

test('rejects a malformed e-mail before touching the database', async () => {
  const db = fakeDb({});
  await assert.rejects(bootstrapOwner({ db, email: 'not-an-email', ...identity }), /e-mail inválido/);
  assert.equal(db.values.size, 0);
});
