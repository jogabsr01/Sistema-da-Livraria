import { loadConfig } from '../../backend/config.mjs';
import { createFirestoreDb } from '../../backend/firestore-client.mjs';
import { processPendingFirestoreOutbox } from '../../backend/firestore-outbox.mjs';

export const config = { schedule: '* * * * *' };

export default async function processOutbox() {
  const appConfig = loadConfig();
  if (appConfig.environment !== 'dev' || appConfig.storageMode !== 'firestore') return { processed: false, skipped: true };
  try {
    return await processPendingFirestoreOutbox({ db: createFirestoreDb(appConfig), config: appConfig });
  } catch (error) {
    const code = error?.code && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code) ? error.code : 'OUTBOX_FAILED';
    console.error(JSON.stringify({ metric: 'firestore.outbox', outcome: 'ERROR', code }));
    throw error;
  }
}
