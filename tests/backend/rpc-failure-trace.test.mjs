import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
import {safeTimings} from '../../scripts/google-dev-admin.mjs';
function capture(s){const logs=[];s.gas.context.console.info=text=>logs.push(JSON.parse(text));return logs;}
test('RPC failure trace identifies binding, schema and dispatch exceptions without disclosing provider text',async()=>{
 for(const [hook,phase,name] of [['storage_','BINDING','TypeError'],['assertSchema_','SCHEMA','ReferenceError'],['registerNonce_','NONCE','ReferenceError'],['ownerAccessOperation_','DISPATCH','TypeError']]){
  const s=ownerFixture(),logs=capture(s),sessions=s.main.getSheetByName('Sessoes').getLastRow();
  s.gas.context[hook]=()=>{const e=new Error('secret-marker person@example.invalid');e.name=name;e.stack='at internal (Code:123:7)';throw e;};
  await assert.rejects(s.client.access('read',{tokenHash:'a'.repeat(64)}),{code:'UPSTREAM_UNAVAILABLE'});
  const metric=logs.find(p=>p.metric==='rpc.duration');assert.equal(metric.phase,phase);assert.equal(metric.outcome,'ERROR');assert.equal(metric.faultClass,name==='TypeError'?'SCRIPT_TYPE':'SCRIPT_REFERENCE');assert.equal(metric.faultLine,123);assert.ok(!/secret-marker|person@example/.test(JSON.stringify(logs)));assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),sessions);assert.equal(s.gas.context.RPC_STORAGE_SCOPE_,null);
 }
});
test('missing replay store fails closed before identity reads, with a precise private diagnostic and no automatic repair',async()=>{
 const s=ownerFixture(),logs=capture(s);s.main.tables.delete('_Requisicoes');let called=false;
 s.gas.context.ownerAccessOperation_=()=>{called=true;throw Error('must not reach identity');};
 await assert.rejects(s.client.access('read',{tokenHash:'a'.repeat(64)}),{code:'WORKSPACE_SCHEMA_REQUIRED'});
 const metric=logs.find(p=>p.metric==='rpc.duration');assert.equal(metric.phase,'SCHEMA');assert.equal(metric.outcome,'ERROR');assert.equal(metric.faultClass,'APP_REJECTED');assert.equal(metric.faultCode,'SCHEMA_REQUIRED');assert.equal(called,false);assert.equal(s.main.getSheetByName('_Requisicoes'),null);
});
test('successful RPC emits an OK outcome without failure metadata',async()=>{
 const s=ownerFixture(),logs=capture(s);assert.equal((await s.client.ping()).ready,true);
 const metric=logs.find(p=>p.metric==='rpc.duration');assert.equal(metric.outcome,'OK');assert.equal(metric.phase,'DISPATCH');assert.equal(Object.hasOwn(metric,'faultClass'),false);assert.equal(Object.hasOwn(metric,'faultLine'),false);
});
test('private error categories are closed and admin inspection strips unknown text, codes and invalid lines',()=>{
 const s=ownerFixture();for(const [name,message,category] of [['Error','Service invoked too many times: secret-marker','GOOGLE_QUOTA'],['Error','Permission denied secret-marker','GOOGLE_PERMISSION'],['Error','service unavailable secret-marker','GOOGLE_SERVICE'],['Error','unknown secret-marker','UNKNOWN']]){assert.equal(s.gas.call('rpcFault_',{name,message}).faultClass,category);}
 const metric={metric:'rpc.duration',lockMs:1,bindingsMs:2,schemaMs:3,workMs:4,totalMs:10,phase:'NONCE',outcome:'ERROR',faultClass:'APP_REJECTED',faultCode:'SCHEMA_REQUIRED',faultLine:123};
 const result=safeTimings([{jsonPayload:metric}])[0];assert.equal(result.faultCode,'SCHEMA_REQUIRED');assert.equal(result.phase,'NONCE');
 const bad=safeTimings([{jsonPayload:{...metric,phase:'secret-marker',faultClass:'secret-marker',faultCode:'person@example.invalid',faultLine:52998224725}}])[0];assert.ok(!/secret-marker|person@example|52998224725/.test(JSON.stringify(bad)));assert.equal(Object.hasOwn(bad,'phase'),false);
});
