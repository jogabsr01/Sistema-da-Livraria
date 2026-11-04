import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeEmulatorImport } from '../../scripts/firestore-import-executor.mjs';

test('executor fails closed before preflight without the exact execution flag', async () => {
  for (const args of [[], ['--execute-emulator-import', '--extra'], ['--execute-import']]) {
    assert.deepEqual(await executeEmulatorImport({ args, env: {} }), {
      status: 'BLOCKED', writePerformed: false, code: 'IMPORT_EXECUTION_FLAG_REQUIRED',
    });
  }
});

test('executor denies invalid targets and remains blocked even after a successful TCP preflight', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'import-executor-'));
  const server = createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const backup = join(dir, 'backup');
    await writeFile(backup, 'synthetic backup');
    const env = { IMPORT_PREFLIGHT_MODE: 'emulator', IMPORT_PREFLIGHT_PROJECT_ID: 'demo-import-test',
      IMPORT_PREFLIGHT_EXPECTED_PROJECT_ID: 'demo-import-test', IMPORT_PREFLIGHT_CONFIRM_EMULATOR: 'YES',
      FIRESTORE_EMULATOR_HOST: `127.0.0.1:${server.address().port}`, IMPORT_PREFLIGHT_BACKUP_PATH: backup,
      IMPORT_PREFLIGHT_BACKUP_SHA256: createHash('sha256').update('synthetic backup').digest('hex') };
    const args = ['--execute-emulator-import'];
    for (const change of [{ FIRESTORE_EMULATOR_HOST: 'localhost:8080' },
      { IMPORT_PREFLIGHT_PROJECT_ID: 'production-project' }, { GOOGLE_APPLICATION_CREDENTIALS: '/secret' },
      { IMPORT_PREFLIGHT_BACKUP_SHA256: '0'.repeat(64) }]) {
      assert.deepEqual(await executeEmulatorImport({ args, env: { ...env, ...change } }),
        { status: 'BLOCKED', writePerformed: false, code: 'IMPORT_PREFLIGHT_FAILED' });
    }
    assert.deepEqual(await executeEmulatorImport({ args, env }),
      { status: 'BLOCKED', writePerformed: false, code: 'IMPORT_DOCUMENT_CONTRACT_NOT_READY' });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});