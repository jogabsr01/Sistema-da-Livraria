import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFirestoreSettings } from '../../backend/firestore-config.mjs';

test('service account file is loaded and invalid paths fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'livraria-account-'));
  const path = join(dir, 'account.json');
  try {
    writeFileSync(path, JSON.stringify({ project_id: 'livraria-ipb-dev', client_email: 'test@example.invalid', private_key: 'test-key' }));
    const env = { WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev', WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1', GOOGLE_APPLICATION_CREDENTIALS: path };
    assert.equal(loadFirestoreSettings(env).credentials.project_id, 'livraria-ipb-dev');
    assert.throws(() => loadFirestoreSettings({ ...env, GOOGLE_APPLICATION_CREDENTIALS: path + '.missing' }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});