import { loadConfig } from '../../backend/config.mjs';
import { createFirestoreDb } from '../../backend/firestore-client.mjs';
import { processPendingFirestoreOutbox } from '../../backend/firestore-outbox.mjs';

export const config = { schedule: '* * * * *' };

export async function runOutbox({ load = loadConfig, createDb = createFirestoreDb, process = processPendingFirestoreOutbox } = {}) {
  try {
    const appConfig = load();
    if (appConfig.storageMode !== 'firestore') return { processed: false, skipped: true };
    return await process({ db: createDb(appConfig), config: appConfig });
  } catch (error) {
    const code = error?.code && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code) ? error.code : 'OUTBOX_FAILED';
    console.error(JSON.stringify({ metric: 'firestore.outbox', outcome: 'ERROR', code }));
    throw error;
  }
}
export default async function processOutbox() { return runOutbox(); }
