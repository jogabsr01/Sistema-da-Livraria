import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreWorkspaceClient, FIRESTORE_COLLECTIONS, FIRESTORE_SCHEMA_VERSION } from '../../backend/firestore-client.mjs';
import { loadConfig } from '../../backend/config.mjs';
import { environment } from './fixtures.mjs';

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

