import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePendingOwnerEmail } from '../../scripts/update-owner-email.mjs';
import { ownerEmailIndex } from '../../scripts/firestore-bootstrap-owner.mjs';

const id = '2d3c6d3c-4024-498e-97d2-ab9da231bd3d';
const identity = { environment: 'prod', installationId: '44444444-4444-4444-8444-444444444444', secret: 'ab'.repeat(32) };
const owner = () => ({ id, owner: true, role: 'SUPER_ADMIN', status: 'ATIVO', activated: false, firstAccessCompleted: false, authorizationVersion: 1, email: 'old@example.invalid', emailIndex: 'a'.repeat(64), contact: '' });
function fixture(initial = {}) {
  const values = new Map(Object.entries({ [`users/${id}`]: owner(), ...initial }));
  const ref = path => ({ path, id: path.split('/').at(-1), collection: name => ({ doc: key => ref(`${path}/${name}/${key}`) }) });
  return { values, collection: name => ({ doc: key => ref(`${name}/${key}`), where: (field, _, value) => ({ name, field, value }) }),
    runTransaction: fn => fn({ get: async target => {
      if (target.field) return { docs: [...values.entries()].filter(([path, value]) => path.startsWith(`${target.name}/`) && path.split('/').length === 2 && value[target.field] === target.value).map(([path]) => ref(path)) };
      const value = values.get(target.path); return { exists: value !== undefined, data: () => value };
    }, update: (target, patch) => values.set(target.path, { ...values.get(target.path), ...patch }) }) };
}
test('owner email update defaults to dry run and applies only email and index', async () => {
  const db = fixture();
  assert.deepEqual(await updatePendingOwnerEmail({ db, identity }), { changed: true, applied: false });
  assert.equal(db.values.get(`users/${id}`).email, 'old@example.invalid');
  assert.deepEqual(await updatePendingOwnerEmail({ db, identity, apply: true }), { changed: true, applied: true });
  assert.deepEqual(db.values.get(`users/${id}`), { ...owner(), email: 'jogabsr@gmail.com', emailIndex: ownerEmailIndex(identity, 'jogabsr@gmail.com') });
  assert.deepEqual(await updatePendingOwnerEmail({ db, identity, apply: true }), { changed: false, applied: false });
});
test('owner email update refuses credentials, active identities, conflicts and incomplete profile safety', async () => {
  for (const change of [
    { [`users/${id}`]: { ...owner(), activated: true } },
    { [`users/${id}/credentials/primary`]: {} },
    { [`users/${id}`]: { ...owner(), status: 'INATIVO' } },
    { [`users/${id}`]: { ...owner(), contact: 'encrypted-contact' } },
    { [`authFlows/email-change:${id}`]: {} },
    { 'users/another': { role: 'ADMIN', email: 'jogabsr@gmail.com' } },
  ]) {
    const db = fixture(change), before = structuredClone([...db.values]);
    await assert.rejects(updatePendingOwnerEmail({ db, identity, apply: true }));
    assert.deepEqual([...db.values], before);
  }
});