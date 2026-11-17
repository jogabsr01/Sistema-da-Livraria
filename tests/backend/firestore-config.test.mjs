import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../backend/config.mjs';
import { loadFirestoreSettings } from '../../backend/firestore-config.mjs';
import { createFirestoreDb } from '../../backend/firestore-client.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { environment } from './fixtures.mjs';

test('Firestore configuration preserves GAS as the default storage mode', () => {
  assert.deepEqual(loadFirestoreSettings({}), { mode: 'gas' });
  const config = loadConfig(environment());
  assert.equal(config.storageMode, 'gas');
  assert.equal(config.firestore.mode, 'gas');
  assert.match(config.scriptUrl, /^https:\/\/script\.google\.com\//);
});

test('production password-only admin login requires explicit opt-in and Firestore mode', () => {
  const base = environment({ APP_ENV: 'prod', CONTEXT: 'production', BRANCH: 'main', DEPLOY_PRIME_URL: 'https://merry-chimera-49a1f3.netlify.app' });
  assert.equal(loadConfig({ ...base, WORKSPACE_ADMIN_PASSWORD_LOGIN_ENABLED: 'true' }).adminPasswordLogin, false);
  // The Firestore settings are separately validated with production credentials in integration tests.
  assert.equal(loadConfig({ ...base, WORKSPACE_ADMIN_PIN_LOGIN_ENABLED: 'true' }).adminPinLogin, false);
});

test('opt-in environment diagnostics expose presence only, and RSA newlines parse in production', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const account = JSON.stringify({ project_id: 'livraria-ipb-dev', client_email: 'test@livraria-ipb-dev.iam.gserviceaccount.com', private_key: privateKey });
  const original = console.info, messages = [];
  console.info = value => messages.push(JSON.parse(value));
  try {
    const env = { APP_ENV: 'prod', WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev', WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1', WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: account, WORKSPACE_FIRESTORE_DIAGNOSTICS: 'true' };
    for (const source of [account, account.replace(/\\n/g, '\n')]) {
      assert.equal(loadFirestoreSettings({ ...env, WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: source }).credentials.private_key, privateKey);
    }
    assert.deepEqual(messages[0], { event: 'firestore_environment_presence', serviceAccountJsonPresent: true, projectIdPresent: true });
    assert.ok(!JSON.stringify(messages).includes(privateKey));
    assert.ok(!JSON.stringify(messages).includes('livraria-ipb-dev'));
    const prod = environment({ ...env, CONTEXT: 'production', BRANCH: 'main', DEPLOY_PRIME_URL: 'https://merry-chimera-49a1f3.netlify.app', WORKSPACE_ADMIN_PASSWORD_LOGIN_ENABLED: 'true' });
    assert.equal(loadConfig(prod).adminPasswordLogin, true);
    assert.equal(loadConfig(prod).adminPinLogin, false);
    assert.equal(loadConfig({ ...prod, WORKSPACE_ADMIN_PASSWORD_LOGIN_ENABLED: 'false' }).adminPasswordLogin, false);
  } finally { console.info = original; }
});

test('inline service account reaches Firestore SDK with normalized RSA key and database', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const projectId = 'livraria-ipb-dev', clientEmail = `test@${projectId}.iam.gserviceaccount.com`;
  const account = JSON.stringify({ project_id: projectId, client_email: clientEmail, private_key: privateKey.replace(/\n/g, '\\n') });
  const settings = loadFirestoreSettings({ APP_ENV: 'prod', WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIRESTORE_PROJECT_ID: projectId,
    WORKSPACE_FIRESTORE_DATABASE: '(default)', WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1', WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: account });
  const client = createFirestoreDb(settings);
  assert.equal(client.projectId, projectId);
  assert.equal(client._settings.databaseId, '(default)');
  assert.equal(client._settings.auth.cachedCredential.email, clientEmail);
  assert.equal(client._settings.auth.cachedCredential.key, privateKey);
  assert.equal(Object.hasOwn(client._settings, 'credentials'), false);
});

test('client configuration errors identify missing fields without exposing values', () => {
  const original = console.error, messages = [];
  console.error = value => messages.push(JSON.parse(value));
  try {
    assert.throws(() => createFirestoreDb({ databaseId: '(default)', credentials: { private_key: 'private-key' } }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
    assert.deepEqual(messages, [{ event: 'firestore_client_configuration_unavailable', projectIdPresent: false, databaseIdPresent: true, credentialsPresent: true, applicationCredentialsPresent: false, emulatorHostPresent: false }]);
    assert.ok(!JSON.stringify(messages).includes('private-'));
  } finally { console.error = original; }
});

test('project aliases agree and application credential paths reach the Firestore client', () => {
  const dir = mkdtempSync(join(tmpdir(), 'livraria-credentials-'));
  const path = join(dir, 'account.json');
  writeFileSync(path, JSON.stringify({ project_id: 'livraria-ipb-dev', client_email: 'test@example.invalid', private_key: 'test-key' }));
  try {
  const base = { WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIREBASE_PROJECT_ID: 'livraria-ipb-dev',
    GOOGLE_CLOUD_PROJECT: 'livraria-ipb-dev', WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1',
    GOOGLE_APPLICATION_CREDENTIALS: path };
  const settings = loadFirestoreSettings(base);
  assert.equal(settings.projectId, 'livraria-ipb-dev');
  assert.equal(settings.credentials.project_id, 'livraria-ipb-dev');
  assert.equal(createFirestoreDb(settings)._settings.auth.cachedCredential.email, 'test@example.invalid');
  assert.throws(() => loadFirestoreSettings({ ...base, GCLOUD_PROJECT: 'other-project' }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
  assert.throws(() => loadFirestoreSettings({ ...base, GOOGLE_APPLICATION_CREDENTIALS: path + '.missing' }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Firebase service-account alias is accepted and conflicting inline credentials fail closed', () => {
  const account = JSON.stringify({ project_id: 'livraria-ipb-dev', client_email: 'test@example.invalid', private_key: 'test-key' });
  const base = { WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIREBASE_PROJECT_ID: 'livraria-ipb-dev',
    WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1', WORKSPACE_FIREBASE_SERVICE_ACCOUNT_JSON: account };
  assert.equal(loadFirestoreSettings(base).credentials.project_id, 'livraria-ipb-dev');
  assert.equal(loadFirestoreSettings({ ...base, WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: account }).credentials.project_id, 'livraria-ipb-dev');
  assert.throws(() => loadFirestoreSettings({ ...base, WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: '{}' }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
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
