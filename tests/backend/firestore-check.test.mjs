import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFirestore, CHECK_COLLECTIONS } from '../../scripts/check-firestore.mjs';

test('read-only Firestore check probes every critical collection and reports failures without leaking data', async () => {
  const env={WORKSPACE_STORAGE_MODE:'firestore',WORKSPACE_FIRESTORE_PROJECT_ID:'demo-check',WORKSPACE_FIRESTORE_LOCATION:'us-central1',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'};
  let terminated=false; const seen=[];
  const results=await checkFirestore({env,createDb:()=>({collection(name){seen.push(name);return {limit(n){assert.equal(n,1);return {async get(){if(name==='sales')throw Error('private detail');return {empty:true};}};}};},async terminate(){terminated=true;}})});
  assert.deepEqual(seen,[...CHECK_COLLECTIONS]);
  assert.equal(results.find(item=>item.collection==='sales').ok,false);
  assert.equal(results.find(item=>item.collection==='products').empty,true);
  assert.ok(terminated);assert.doesNotMatch(JSON.stringify(results),/private detail/);
});