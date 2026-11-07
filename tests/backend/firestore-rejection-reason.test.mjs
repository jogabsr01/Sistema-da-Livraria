import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFirestoreSettings } from '../../backend/firestore-config.mjs';

test('configuration rejection logs the exact fixed rule without values', () => {
  const env = { WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev',
    WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
  const cases = [
    [{ WORKSPACE_FIRESTORE_DATABASE: 'private.invalid' }, 'INVALID_DATABASE_ID'],
    [{ WORKSPACE_FIRESTORE_LOCATION: 'private.invalid' }, 'INVALID_LOCATION'],
    [{ WORKSPACE_EMAIL_DELIVERY_KEY: 'private-secret' }, 'INVALID_EMAIL_DELIVERY_KEY'],
    [{ WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: '{private-invalid' }, 'MALFORMED_SERVICE_ACCOUNT_JSON'],
  ];
  const original = console.log, lines = [];
  console.log = (...args) => lines.push(args);
  try {
    for (const [changes, reason] of cases) {
      assert.throws(() => loadFirestoreSettings({ ...env, ...changes }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
      assert.deepEqual(lines.splice(0), [['REJECTION REASON:', reason]]);
    }
  } finally { console.log = original; }
});