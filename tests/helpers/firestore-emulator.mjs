import { randomUUID } from 'node:crypto';
import { createFirestoreDb } from '../../backend/firestore-client.mjs';

const LOOPBACK_EMULATOR = /^(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/i;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const NAMESPACE = /^[a-z][a-z0-9-]{0,11}$/;

function emulatorHost(env) {
  const value = env?.FIRESTORE_EMULATOR_HOST;
  if (typeof value !== 'string') return null;
  const match = LOOPBACK_EMULATOR.exec(value);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? value : null;
}

export function firestoreEmulatorAvailable(env = process.env) {
  return emulatorHost(env) !== null;
}

export function createFirestoreEmulatorDb({ env = process.env, namespace = 'test' } = {}) {
  const host = emulatorHost(env);
  if (!host) throw new Error('FIRESTORE_LOOPBACK_EMULATOR_REQUIRED');
  if (typeof namespace !== 'string' || !NAMESPACE.test(namespace)) throw new Error('INVALID_FIRESTORE_TEST_NAMESPACE');

  // A fresh logical project isolates every test and every run. Firestore's
  // emulator keeps documents in memory after a client terminates, so sharing a
  // fixed project ID would make collection counts and retries order-dependent.
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const projectId = `livraria-${namespace}-${suffix}`;
  if (!PROJECT_ID.test(projectId)) throw new Error('INVALID_FIRESTORE_TEST_PROJECT');

  // The SDK otherwise probes the link-local GCP metadata service while
  // initializing auth, even though this client can only reach loopback.
  process.env.METADATA_SERVER_DETECTION = 'none';

  return createFirestoreDb({
    firestore: {
      projectId,
      databaseId: '(default)',
      emulatorHost: host,
    },
  });
}
