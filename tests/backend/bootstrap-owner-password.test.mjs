import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapOwnerPassword, parseArguments, readPassword } from '../../scripts/bootstrap-owner-password.mjs';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';

const id = '2d3c6d3c-4024-498e-97d2-ab9da231bd3d';

test('CLI accepts explicit remote and apply flags, help works without configuration, invalid arguments fail', () => {
  assert.deepEqual(parseArguments(['--apply', '--allow-remote']), { help: false, apply: true, allowRemote: true });
  assert.deepEqual(parseArguments(['--help']), { help: true, apply: false, allowRemote: false });
  for (const args of [['--unknown'], ['--apply', '--apply'], ['--help', '--apply']]) assert.throws(() => parseArguments(args), /INVALID_ARGUMENTS/);
  const help = spawnSync(process.execPath, ['scripts/bootstrap-owner-password.mjs', '--help'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(help.status, 0); assert.match(help.stdout, /--allow-remote/);
  const denied = spawnSync(process.execPath, ['scripts/bootstrap-owner-password.mjs', '--apply'], { cwd: new URL('../../', import.meta.url), input: 'unused-password', encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.match(denied.stderr, /REMOTE_ACCESS_NOT_ALLOWED/);
});

test('password is read from noninteractive stdin without stripping intentional whitespace', async () => {
  assert.equal(await readPassword(Readable.from(['  secret ', '\n'])), '  secret ');
  await assert.rejects(readPassword(Readable.from(['x'.repeat(1025)])), /PASSWORD_INPUT_TOO_LONG/);
  await assert.rejects(readPassword({ isTTY: true }), /PASSWORD_STDIN_REQUIRED/);
});
function fixture(change = {}) {
  const owner = { id, email: 'jogabsr@gmail.com', role: 'SUPER_ADMIN', owner: true, status: 'ATIVO', activated: false, firstAccessCompleted: false, authorizationVersion: 1, ...change };
  const writes = [];
  const ref = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`) });
  const collection = name => ({ doc: docId => ref(`${name}/${docId}`), where: (field, op, value) => ({ query: name, field, value }) });
  const db = { collection, async runTransaction(fn) { return fn({
    async get(target) {
      if (target.query) return { docs: [{ id }] };
      if (target.path === `users/${id}`) return { exists: true, data: () => owner };
      return { exists: false };
    },
    create: (ref, value) => writes.push({ type: 'create', path: ref.path, value }),
    update: (ref, value) => writes.push({ type: 'update', path: ref.path, value }),
  }); } };
  return { db, writes };
}

test('owner emergency bootstrap is dry-run by default and applies atomically with version bump and audit', async () => {
  const { db, writes } = fixture();
  assert.deepEqual(await bootstrapOwnerPassword({ db }), { eligible: true, applied: false });
  assert.equal(writes.length, 0);
  const record = { credentialType: 'PASSWORD_V1' };
  assert.deepEqual(await bootstrapOwnerPassword({ db, record, apply: true }), { eligible: true, applied: true });
  assert.equal(writes.length, 3);
  assert.equal(writes[0].path, `users/${id}/credentials/primary`);
  assert.deepEqual({ ...writes[1].value, updatedAt: undefined }, { activated: true, firstAccessCompleted: true, authorizationVersion: 2, updatedAt: undefined });
  assert.match(writes[2].path, /^auditEvents\/identity-bootstrap:/);
});

test('owner emergency bootstrap refuses already activated or mismatched accounts', async () => {
  for (const change of [{ activated: true }, { firstAccessCompleted: true }, { owner: false }, { email: 'other@example.com' }]) {
    const { db, writes } = fixture(change);
    await assert.rejects(bootstrapOwnerPassword({ db, record: { credentialType: 'PASSWORD_V1' }, apply: true }), /OWNER_NOT_ELIGIBLE/);
    assert.equal(writes.length, 0);
  }
});