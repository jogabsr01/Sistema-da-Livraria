import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { preflight } from '../../scripts/firestore-import-preflight.mjs';
import { ImportRecoveryModel } from '../helpers/import-recovery-model.mjs';

async function withBackup(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'preflight-'));
  try {
    const data = Buffer.from('synthetic backup'), path = join(dir, 'backup'); await writeFile(path, data);
    const env = { IMPORT_PREFLIGHT_MODE: 'emulator', IMPORT_PREFLIGHT_PROJECT_ID: 'demo-livraria-test', IMPORT_PREFLIGHT_EXPECTED_PROJECT_ID: 'demo-livraria-test',
      IMPORT_PREFLIGHT_CONFIRM_EMULATOR: 'YES', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', IMPORT_PREFLIGHT_BACKUP_PATH: path,
      IMPORT_PREFLIGHT_BACKUP_SHA256: createHash('sha256').update(data).digest('hex') };
    await fn(env);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('preflight requires explicit isolated emulator configuration and matching backup hash', async () => withBackup(async env => {
  const result = await preflight(env, { probe: async () => true });
  assert.equal(result.writePerformed, false); assert.equal(result.simulationAuthorized, false);
  assert.equal(result.firestoreIdentityVerified, false); assert.equal(result.backupRestorableVerified, false);
  for (const change of [
    { IMPORT_PREFLIGHT_PROJECT_ID: 'production-project' }, { IMPORT_PREFLIGHT_EXPECTED_PROJECT_ID: 'demo-other' },
    { IMPORT_PREFLIGHT_MODE: 'dev' }, { IMPORT_PREFLIGHT_CONFIRM_EMULATOR: '' },
    { FIRESTORE_EMULATOR_HOST: 'example.com:8080' }, { GOOGLE_APPLICATION_CREDENTIALS: '/private' },
    { IMPORT_PREFLIGHT_BACKUP_SHA256: '0'.repeat(64) }, { IMPORT_PREFLIGHT_BACKUP_PATH: 'relative' },
  ]) await assert.rejects(preflight({ ...env, ...change }, { probe: async () => true }));
  await assert.rejects(preflight(env, { probe: async () => false }), /PREFLIGHT_EMULATOR_UNREACHABLE/);
}));

test('loopback port reachability is checked but is not emulator identity verification', async () => withBackup(async env => {
  const server = createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${server.address().port}`;
    const result = await preflight(env);
    assert.equal(result.loopbackPortReachable, true); assert.equal(result.firestoreIdentityVerified, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));

test('model handles before commit, lost acknowledgement and idempotent checkpoint replay', () => {
  const model = new ImportRecoveryModel(), batch = { id: 'batch-1', fingerprint: 'hash-1', records: [{ id: 'a', value: 1 }] };
  assert.throws(() => model.commit(batch, 'before-commit'), /INJECTED_FAILURE/);
  assert.equal(model.records.size, 0); assert.equal(model.checkpoints.size, 0);
  assert.throws(() => model.commit(batch, 'after-commit'), /LOST_ACK/);
  assert.equal(model.commit(batch), 'REPLAY'); assert.equal(model.records.size, 1);
  assert.throws(() => model.commit({ ...batch, fingerprint: 'changed' }), /CHECKPOINT_CONFLICT/);
  assert.equal(model.records.get('a'), 1);
});

test('model resumes subsequent batches and does not apply conflicting writes', () => {
  const model = new ImportRecoveryModel();
  model.commit({ id: 'first', fingerprint: '1', records: [{ id: 'a', value: 1 }] });
  const second = { id: 'second', fingerprint: '2', records: [{ id: 'b', value: 2 }] };
  assert.throws(() => model.commit(second, 'before-commit'));
  assert.equal(model.commit(second), 'COMMITTED'); assert.equal(model.commit(second), 'REPLAY');
  assert.throws(() => model.commit({ id: 'third', fingerprint: '3', records: [{ id: 'a', value: 9 }] }), /RECORD_CONFLICT/);
  assert.equal(model.checkpoints.size, 2); assert.equal(model.records.get('a'), 1);
});