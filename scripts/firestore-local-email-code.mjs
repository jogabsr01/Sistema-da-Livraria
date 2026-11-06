import { pathToFileURL } from 'node:url';
import { createFirestoreDb } from '../backend/firestore-client.mjs';
import { loadFirestoreSettings } from '../backend/firestore-config.mjs';
import { openEmailDelivery } from '../backend/email-delivery-crypto.mjs';

// Local-only diagnostic; never used by the application or the outbox worker.
export function assertLocalEmailCodeAccess(env, args, isTTY) {
  if (isTTY !== true || args.length !== 1 || args[0] !== '--show-local-code' ||
      env.APP_ENV !== 'dev' || env.WORKSPACE_STORAGE_MODE !== 'firestore' ||
      env.WORKSPACE_FIRESTORE_PROJECT_ID !== 'demo-livraria' || env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      env.GOOGLE_APPLICATION_CREDENTIALS || env.WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON ||
      env.WORKSPACE_EMAIL_PROVIDER || env.WORKSPACE_EMAIL_PROVIDER_KEY) throw Error('LOCAL_EMAIL_CODE_DENIED');
}

export function extractLocalCode(entry, settings) {
  if (!entry || entry.type !== 'EMAIL_DELIVERY' || entry.state !== 'PENDING' ||
      typeof entry.idempotencyKey !== 'string' || !entry.idempotencyKey.startsWith('auth:')) throw Error('LOCAL_EMAIL_CODE_INVALID');
  const message = openEmailDelivery(settings, 'body', entry.idempotencyKey, entry.payload?.deliveryCiphertext);
  const match = /Código de uso único \(válido por 15 minutos\):\n([A-Za-z0-9_-]{7}|[A-Za-z0-9_-]{43})(?:\n|$)/.exec(message);
  if (!match) throw Error('LOCAL_EMAIL_CODE_INVALID');
  return match[1];
}

async function main() {
  assertLocalEmailCodeAccess(process.env, process.argv.slice(2), process.stdout.isTTY);
  const settings = loadFirestoreSettings(process.env);
  const db = createFirestoreDb({ firestore: settings });
  try {
    const snapshot = await db.collection('outbox').where('type', '==', 'EMAIL_DELIVERY').get();
    const eligible = snapshot.docs.map(doc => doc.data()).filter(entry => entry.state === 'PENDING' && entry.idempotencyKey?.startsWith('auth:'));
    if (eligible.length !== 1) throw Error('LOCAL_EMAIL_CODE_EXPECTED_SINGLE_PENDING');
    console.log(`Código de teste local (sigiloso): ${extractLocalCode(eligible[0], settings)}`);
  } finally { await db.terminate(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('LOCAL_EMAIL_CODE_UNAVAILABLE'); process.exitCode = 1; });
}