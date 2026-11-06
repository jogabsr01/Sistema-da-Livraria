import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../backend/config.mjs';
import { loadFirestoreSettings } from '../../backend/firestore-config.mjs';
import { environment } from './fixtures.mjs';

test('Firestore configuration preserves GAS as the default storage mode', () => {
  assert.deepEqual(loadFirestoreSettings({}), { mode: 'gas' });
  const config = loadConfig(environment());
  assert.equal(config.storageMode, 'gas');
  assert.equal(config.firestore.mode, 'gas');
  assert.match(config.scriptUrl, /^https:\/\/script\.google\.com\//);
});

test('Firestore emulator mode does not require service-account credentials or Sheets', () => {
  const env = environment({
    WORKSPACE_STORAGE_MODE: 'firestore',
    WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev',
    WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    WORKSPACE_SCRIPT_URL: undefined,
    WORKSPACE_SPREADSHEET_ID: undefined,
  });
  const firestore = loadFirestoreSettings(env);
  assert.deepEqual(firestore, {
    mode: 'firestore',
    projectId: 'livraria-ipb-dev',
    databaseId: '(default)',
    location: 'southamerica-east1',
    emulatorHost: '127.0.0.1:8080',
    credentials: null,
    applicationCredentials: null,
    emailProvider: null,
    emailProviderKey: null,
    emailFrom: null,
    emailDeliveryKey: null,
  });
  const config = loadConfig(env);
  assert.equal(config.storageMode, 'firestore');
  assert.equal(config.scriptUrl, null);
  assert.equal(config.spreadsheetId, null);
});

test('Firestore service-account configuration is validated without exposing the private key', () => {
  const env = {
    WORKSPACE_STORAGE_MODE: 'firestore',
    WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev',
    WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1',
    WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: 'livraria-ipb-dev',
      client_email: 'firestore@livraria-ipb-dev.iam.gserviceaccount.com',
      private_key: 'test-private-key',
    }),
  };
  const settings = loadFirestoreSettings(env);
  assert.equal(settings.credentials.project_id, 'livraria-ipb-dev');
  assert.equal(settings.credentials.client_email, 'firestore@livraria-ipb-dev.iam.gserviceaccount.com');
  assert.equal(settings.credentials.private_key, 'test-private-key');
});

test('service account JSON accepts normal and doubly escaped private-key newlines', () => {
  const base = { WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev', WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1' };
  for (const key of ['line1\nline2', 'line1\\nline2']) {
    const credentials = JSON.stringify({ project_id: 'livraria-ipb-dev', client_email: 'test@example.invalid', private_key: key });
    assert.equal(loadFirestoreSettings({ ...base, WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: credentials }).credentials.private_key, 'line1\nline2');
  }
});

test('service account parsing repairs literal PEM line breaks but rejects unrelated malformed JSON', () => {
  const base = { WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev', WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1' };
  const raw = '{"project_id":"livraria-ipb-dev","client_email":"test@example.invalid","private_key":"line1\r\nline2"}';
  assert.equal(loadFirestoreSettings({ ...base, WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: raw }).credentials.private_key, 'line1\nline2');
  for (const invalid of [raw.replace('test@example.invalid', 'test\n@example.invalid'), raw.replace('line1', 'line1\\q')]) {
    assert.throws(() => loadFirestoreSettings({ ...base, WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: invalid }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
  }
});

test('service account accepts surrounding quotes and rejects malformed quoted input', () => {
  const base = { WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev', WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1' };
  const json = JSON.stringify({ project_id: 'livraria-ipb-dev', client_email: 'test@example.invalid', private_key: 'line1\nline2' });
  for (const value of ["'" + json + "'", '"' + json + '"', JSON.stringify(json)]) {
    assert.equal(loadFirestoreSettings({ ...base, WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: value }).credentials.private_key, 'line1\nline2');
  }
  assert.throws(() => loadFirestoreSettings({ ...base, WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: "'{invalid}'" }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
});

test('deployed and production configurations refuse an emulator host', () => {
  const base={WORKSPACE_STORAGE_MODE:'firestore',WORKSPACE_FIRESTORE_PROJECT_ID:'livraria-ipb-dev',WORKSPACE_FIRESTORE_LOCATION:'southamerica-east1',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'};
  for(const env of [{...base,NETLIFY:'true'},{...base,APP_ENV:'prod'}]) assert.throws(()=>loadFirestoreSettings(env),{code:'FIRESTORE_CONFIGURATION_UNAVAILABLE'});
});

test('Firestore configuration rejects missing or cross-environment bindings', () => {
  assert.throws(() => loadFirestoreSettings({ WORKSPACE_STORAGE_MODE: 'invalid' }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
  assert.throws(() => loadFirestoreSettings({
    WORKSPACE_STORAGE_MODE: 'firestore',
    WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev',
    WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1',
  }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
  assert.throws(() => loadFirestoreSettings({
    WORKSPACE_STORAGE_MODE: 'firestore',
    WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev',
    WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:70000',
  }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
  assert.throws(() => loadFirestoreSettings({
    WORKSPACE_STORAGE_MODE: 'firestore',
    WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev',
    WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1',
    WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: 'other-project', client_email: 'x@example.invalid', private_key: 'key',
    }),
  }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
});

test('shadow mode still requires the GAS binding for the authoritative adapter', () => {
  const env = environment({
    WORKSPACE_STORAGE_MODE: 'shadow',
    WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev',
    WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  });
  const config = loadConfig(env);
  assert.equal(config.storageMode, 'shadow');
  assert.equal(config.firestore.mode, 'shadow');
  assert.match(config.scriptUrl, /^https:\/\/script\.google\.com\//);
});
