import { fileURLToPath } from 'node:url';
import { loadFirestoreSettings } from '../backend/firestore-config.mjs';
import { createFirestoreDb } from '../backend/firestore-client.mjs';

export const CHECK_COLLECTIONS = Object.freeze(['products','sales','users','niches','schedules','notifications','notificationRecipients']);

// Read-only connectivity probe. Empty collections are valid and do not prove
// that writes, indexes, application mappings or referential integrity work.
export async function checkFirestore({ env=process.env, createDb=createFirestoreDb } = {}) {
  const settings=loadFirestoreSettings(env);
  if(settings.mode!=='firestore') throw new Error('FIRESTORE_MODE_REQUIRED');
  const db=createDb(settings), results=[];
  try {
    for(const collection of CHECK_COLLECTIONS) {
      const started=performance.now();
      try {
        const snapshot=await db.collection(collection).limit(1).get();
        results.push({collection,ok:true,empty:snapshot.empty,elapsedMs:Math.round(performance.now()-started)});
      } catch { results.push({collection,ok:false,elapsedMs:Math.round(performance.now()-started)}); }
    }
    return results;
  } finally { await db.terminate(); }
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    const results=await checkFirestore();
    for(const result of results)console.log(`${result.collection}: ${result.ok?'OK':'FALHOU'} (${result.elapsedMs} ms)${result.ok&&result.empty?' — vazia':''}`);
    console.log('Somente leitura: não comprova escrita, schema completo, relacionamentos ou ausência futura de falhas.');
    if(results.some(result=>!result.ok))process.exitCode=1;
  } catch {console.error('FIRESTORE_CHECK_FAILED: verifique configuração, credenciais e conectividade.');process.exitCode=1;}
}