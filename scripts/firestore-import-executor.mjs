import { pathToFileURL } from 'node:url';
import { preflight } from './firestore-import-preflight.mjs';
import { createHash } from 'node:crypto';
import { createFirestoreDb } from '../backend/firestore-client.mjs';
import { validateFirestoreBundle } from '../backend/firestore-bundle-validator.mjs';
import { commitImportBundle } from '../backend/firestore-import-transaction.mjs';

// Only the explicit emulator guard and preflight can reach the SDK client.
export async function executeEmulatorImport({ args = [], env = process.env, bytes, schema, context } = {}) {
  const result = { status: 'BLOCKED', writePerformed: false };
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--execute-emulator-import') {
    return { ...result, code: 'IMPORT_EXECUTION_FLAG_REQUIRED' };
  }
  try {
    const inspection = await preflight(env);
    if (inspection.status !== 'INSPECTION_ONLY' || inspection.mode !== 'emulator' ||
        inspection.backupHashVerified !== true || inspection.loopbackPortReachable !== true ||
        inspection.writePerformed !== false) throw Error('IMPORT_PREFLIGHT_FAILED');
  } catch {
    return { ...result, code: 'IMPORT_PREFLIGHT_FAILED' };
  }
  let bundle;
  try { bundle = validateFirestoreBundle(bytes, schema, context); }
  catch { return { ...result, code: 'IMPORT_DOCUMENT_CONTRACT_NOT_READY' }; }
  // Bind the run to all logical documents, excluding randomized customer ciphertext.
  const logical = Object.entries(bundle.domains).map(([domain, groups]) => [domain, groups.map(group => ({ id: group.id,
    fingerprint: group.fingerprint ?? null, documents: group.documents.map(doc => ({ path: doc.path,
      data: domain === 'customers' && doc.path.startsWith('customers/') ? { ...doc.data, contact: group.fingerprint } : doc.data })) }))]);
  const runId = createHash('sha256').update(JSON.stringify(['emulator-import-v1', env.IMPORT_PREFLIGHT_PROJECT_ID, logical])).digest('hex');
  let db;
  try {
    db = createFirestoreDb({ projectId: env.IMPORT_PREFLIGHT_PROJECT_ID, databaseId: '(default)', emulatorHost: env.FIRESTORE_EMULATOR_HOST });
    return { ...(await commitImportBundle(db, bundle, { runId, vaultSettings: context.vaultSettings })), runId };
  } catch { return { status: 'FAILED', writePerformed: null, code: 'IMPORT_COMMIT_FAILED', runId }; }
  finally { if (db) await db.terminate(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await executeEmulatorImport({ args: process.argv.slice(2) });
  console.log(JSON.stringify(result));
  process.exitCode = 1;
}