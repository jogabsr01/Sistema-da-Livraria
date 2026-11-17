import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreDb, createFirestoreWorkspaceClient, FIRESTORE_COLLECTIONS, FIRESTORE_SCHEMA_VERSION } from '../../backend/firestore-client.mjs';
import { loadConfig } from '../../backend/config.mjs';
import { environment } from './fixtures.mjs';
import { runFirestoreTransaction } from '../../backend/firestore-transactions.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

function config() {
  return loadConfig(environment({
    WORKSPACE_STORAGE_MODE: 'firestore',
    WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev',
    WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    WORKSPACE_SCRIPT_URL: undefined,
    WORKSPACE_SPREADSHEET_ID: undefined,
  }));
}

test('Firestore clients are reused only for matching inline credentials and refreshed after termination', async () => {
  const settings = { projectId: 'livraria-ipb-dev', databaseId: '(default)', credentials: { project_id: 'livraria-ipb-dev', client_email: 'user@example.invalid', private_key: 'private-key' } };
  const first = createFirestoreDb(settings);
  assert.equal(createFirestoreDb({ ...settings, credentials: { ...settings.credentials } }), first);
  const other = createFirestoreDb({ ...settings, databaseId: 'other-db' });
  assert.notEqual(other, first);
  const rotated = createFirestoreDb({ ...settings, credentials: { ...settings.credentials, private_key: 'rotated-key' } });
  assert.notEqual(rotated, first);
  const current = createFirestoreDb(settings);
  await current.terminate();
  const replacement = createFirestoreDb(settings);
  assert.notEqual(replacement, current);
  await replacement.terminate();
  await first.terminate();
  await other.terminate();
  await rotated.terminate();
});

test('emulator and credential-file clients are not shared', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'livraria-auth-')), file = join(dir, 'account.json');
  writeFileSync(file, JSON.stringify({ project_id:'livraria-ipb-dev', client_email:'user@example.invalid', private_key:'private-key' }));
  try { for (const settings of [{ projectId: 'demo-livraria', databaseId: '(default)', emulatorHost: '127.0.0.1:8080' },
    { projectId: 'livraria-ipb-dev', databaseId: '(default)', applicationCredentials: file }]) {
    const first = createFirestoreDb(settings), second = createFirestoreDb(settings);
    assert.notEqual(first, second);
    await first.terminate(); await second.terminate();
  } } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('inline Firestore credentials use an explicit JWT auth object without deprecated SDK options', async () => {
  const warnings = [], original = console.warn;
  console.warn = value => warnings.push(String(value));
  const settings = { projectId:'livraria-ipb-dev', credentials:{ project_id:'livraria-ipb-dev', client_email:'service@example.invalid', private_key:'test-private-key' } };
  let db;
  try {
    db = createFirestoreDb(settings);
    assert.equal(Object.hasOwn(db._settings, 'credentials'), false);
    assert.equal(Object.hasOwn(db._settings, 'keyFilename'), false);
    const auth = await db._clientPool.run('auth-test', false, async client => client.auth);
    const jwt = await auth.getClient();
    assert.equal(jwt.email, settings.credentials.client_email);
    assert.equal(jwt.key, settings.credentials.private_key);
    assert.equal(await auth.getProjectId(), settings.projectId);
    assert.equal(warnings.some(value => value.includes('deprecated')), false);
  } finally { console.warn = original; if (db) await db.terminate(); }
});

test('explicit service-account authentication signs Firestore authorization without network access', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type:'pkcs8', format:'pem' }, publicKeyEncoding: { type:'spki', format:'pem' } });
  const db = createFirestoreDb({ projectId:'livraria-ipb-dev', credentials:{ project_id:'livraria-ipb-dev', client_email:'service@example.invalid', private_key:privateKey } });
  try {
    const auth = await db._clientPool.run('jwt-signing-test', false, async client => client.auth);
    const headers = await auth.getRequestHeaders('https://firestore.googleapis.com/');
    assert.match(headers.get('authorization'), /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  } finally { await db.terminate(); }
});

test('Firestore client defaults databaseId when omitted or empty', async () => {
  for (const databaseId of [undefined, '']) {
    const db = createFirestoreDb({ projectId: 'demo-livraria', databaseId, emulatorHost: '127.0.0.1:8080' });
    assert.equal(db._settings.databaseId, '(default)');
    await db.terminate();
  }
});

test('SDK error diagnostics retain only allowlisted codes, never messages or stacks', async () => {
  const original = console.error, logs = [];
  console.error = line => logs.push(JSON.parse(line));
  try {
    const client = createFirestoreWorkspaceClient(config(), { firestoreClient: { listCollections: async () => {
      const error = new Error('secret-message'); error.code = 7; error.stack = 'secret-stack'; throw error;
    } } });
    await assert.rejects(client.ping(), { code: 'FIRESTORE_UNAVAILABLE' });
    assert.deepEqual(logs, [{ event: 'firestore_sdk_error', phase: 'PING', code: 'PERMISSION_DENIED' }]);
    assert.ok(!JSON.stringify(logs).includes('secret-'));
  } finally { console.error = original; }
});

test('Firestore transaction failures log a safe authentication code and preserve the public error', async () => {
  const original = console.error, logs = [];
  console.error = line => logs.push(JSON.parse(line));
  try {
    const db = { runTransaction: async () => { const error = new Error('secret-message'); error.code = 16; error.stack = 'secret-stack'; throw error; } };
    await assert.rejects(runFirestoreTransaction(db, () => {}), { code: 'FIRESTORE_UNAVAILABLE' });
    assert.deepEqual(logs, [{ event: 'firestore_sdk_error', phase: 'TRANSACTION', code: 'UNAUTHENTICATED' }]);
    assert.ok(!JSON.stringify(logs).includes('secret-'));
  } finally { console.error = original; }
});

test('Firestore workspace client probes the injected emulator and exposes versioned schema', async () => {
  let probes = 0;
  const client = createFirestoreWorkspaceClient(config(), {
    firestoreClient: { listCollections: async () => { probes++; return []; } },
    now: (() => { let value = 0; return () => value += 3; })(),
  });
  assert.deepEqual(await client.ping(), { ready: true, environment: 'dev', schemaVersion: FIRESTORE_SCHEMA_VERSION });
  assert.deepEqual(await client.schema({ id: 'ignored-after-HTTP-authorization' }), { schemaVersion: 1, tables: [...FIRESTORE_COLLECTIONS] });
  assert.equal(probes, 1);
  assert.deepEqual(client.timings(), { calls: 2, durationMs: 6 });
});

test('Firestore workspace client maps transport failures to a safe public error', async () => {
  const client = createFirestoreWorkspaceClient(config(), {
    firestoreClient: { listCollections: async () => { throw new Error('private project and credential details'); } },
  });
  await assert.rejects(client.ping(), { code: 'FIRESTORE_UNAVAILABLE', status: 503 });
});

test('unported Firestore domains fail explicitly instead of becoming an internal TypeError', async () => {
  const client = createFirestoreWorkspaceClient(config(), { firestoreClient: { listCollections: async () => [] } });
  assert.throws(() => client.createAuthChallenge(null), { code: 'FIRESTORE_OPERATION_NOT_READY', status: 503 });
});

