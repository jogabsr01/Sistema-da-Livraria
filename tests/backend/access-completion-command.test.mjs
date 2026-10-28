import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {ownerFixture,injectAccessFault} from '../helpers/owner-access-fixture.mjs';
import {properties} from './fixtures.mjs';
import {enableRecovery} from '../helpers/recovery-fixture.mjs';
import {createLoginGuard} from '../../backend/login-guard.mjs';
async function setup(proof=false){
 const s=ownerFixture(),token=randomBytes(32).toString('base64url'),ip='192.0.2.164',svc=s.service();
 await svc.execute('start',{email:properties.OWNER_EMAIL},token,ip);
 const code=s.gas.outbox.at(-1).body.match(/\n([A-HJ-NP-Z2-9]{7})\n/)[1];await svc.execute('email',{code},token,ip);await svc.execute('pin',{pin:'8274'},token,ip);
 const table=s.priv.getSheetByName('_Identity_Flows'),cols=table.rows[0],row=table.rows.at(-1),tokenHash=row[cols.indexOf('Token_Hash')];
 if(proof)s.storageProof(tokenHash);else await svc.execute('options',{},token,ip);
 const keys=createLoginGuard(s.settings,{client:s.client}).attemptKeys({identifier:'flow:'+tokenHash,originAddress:ip});
 const payload={...keys,tokenHash,sessionTokenHash:randomBytes(32).toString('hex'),credentialId:randomBytes(32).toString('base64url'),hasResponse:true,allowReplacement:false,handleSubjectId:''};
 return {...s,token,ip,svc,row,cols,payload};
}
test('completion prepares durable attempt, current flow and one-time ceremony using one signed RPC without granting a session',async()=>{
 const s=await setup(),calls=[],post=s.gas.post;s.gas.post=e=>{calls.push(JSON.parse(Buffer.from(e.message,'base64')).action);return post(e);};
 const result=await s.client.prepareAccessCompletion(s.payload);
 assert.deepEqual(calls,['identity.access.prepareCompletion']);assert.equal(result.done,false);assert.equal(result.ceremony.purpose,'REGISTER');assert.equal(result.flow.proofReady,false);assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
 await assert.rejects(s.client.prepareAccessCompletion(s.payload),{code:'WORKSPACE_PASSKEY_REJECTED'});
});
test('stored verified proof commits and repeated acknowledgements return exactly the same session in one RPC each',async()=>{
 const s=await setup(true),post=s.gas.post;let calls=0;s.gas.post=e=>{calls++;return post(e);};
 const first=await s.client.prepareAccessCompletion({...s.payload,hasResponse:false,credentialId:''});assert.equal(first.done,true);assert.equal(calls,1);
 const second=await s.client.prepareAccessCompletion({...s.payload,hasResponse:false,credentialId:''});assert.equal(second.done,true);assert.equal(calls,2);assert.deepEqual(first.principal,second.principal);assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),2);assert.equal(s.main.getSheetByName('Logs_Auditoria').getLastRow(),2);
 await assert.rejects(s.client.prepareAccessCompletion({...s.payload,sessionTokenHash:'cd'.repeat(32)}));
});
test('partial activation projections still resume once through the combined completion command without exposing an incomplete session',async()=>{
 for(const stage of ['intent','pin','user','session','audit','marker'])for(const after of [false,true]){
  const s=await setup(true);injectAccessFault(s,stage,after);await assert.rejects(s.client.prepareAccessCompletion(s.payload));
  const done=await s.client.prepareAccessCompletion(s.payload);assert.equal(done.done,true);assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),2);assert.equal(s.main.getSheetByName('Logs_Auditoria').getLastRow(),2);
 }
});
test('disabled/epoch/expired/missing response, flag changes and spoofed fields cannot consume a ceremony or grant access',async()=>{
 for(const mode of ['disabled','epoch','expired','response','flags','extra']){
  const s=await setup(),p={...s.payload};
  if(mode==='disabled'){const u=s.main.getSheetByName('Usuarios');u.rows[1][u.rows[0].indexOf('Status')]='INATIVO';}
  if(mode==='epoch')s.main.getSheetByName('Configuracoes').rows[1][1]=2;
  if(mode==='expired'){s.row[s.cols.indexOf('Created_At')]=new Date(Date.now()-700000).toISOString();s.row[s.cols.indexOf('Expires_At')]=new Date(Date.now()-100000).toISOString();}
  if(mode==='response')p.hasResponse=false;
  if(mode==='flags')s.gas.props.IDENTITY_PASSKEYS_ENABLED='false';
  if(mode==='extra')p.role='SUPER_ADMIN';
  await assert.rejects(s.client.prepareAccessCompletion(p));assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
  const c=s.priv.getSheetByName('_Passkey_Ceremonies');assert.equal(c.rows.at(-1)[c.rows[0].indexOf('Consumed_At')],'');
 }
});
test('blocked attempt refuses challenge take while completed acknowledgement does not consume another guessing budget',async()=>{
 const s=await setup();for(let i=0;i<8;i++)await s.client.reserveAuthAttempt({accountKey:s.payload.accountKey,originKey:s.payload.originKey});
 await assert.rejects(s.client.prepareAccessCompletion(s.payload),e=>e.code==='AUTH_RATE_LIMITED'&&e.retryAfterSeconds>0);
 const c=s.priv.getSheetByName('_Passkey_Ceremonies');assert.equal(c.rows.at(-1)[c.rows[0].indexOf('Consumed_At')],'');
 const t=await setup(true);for(let i=0;i<8;i++)await t.client.reserveAuthAttempt({accountKey:t.payload.accountKey,originKey:t.payload.originKey});
 assert.equal((await t.client.prepareAccessCompletion(t.payload)).done,true);
});
test('a revoked verified key or changed owner epoch cannot release the stored proof as a session',async()=>{
 for(const mode of ['key','epoch','disabled']){
  const s=await setup(true);
  if(mode==='key'){const k=s.priv.getSheetByName('_Passkeys');k.rows[1][k.rows[0].indexOf('Revoked_At')]=new Date().toISOString();}
  if(mode==='epoch')s.main.getSheetByName('Configuracoes').rows[1][1]=2;
  if(mode==='disabled'){const u=s.main.getSheetByName('Usuarios');u.rows[1][u.rows[0].indexOf('Status')]='INATIVO';}
  await assert.rejects(s.client.prepareAccessCompletion(s.payload));assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
 }
});

test('combined completion honors the intentional recovery epoch increment and replays the same replacement session',async()=>{
 const s=enableRecovery();await s.activateOwner();const pending=await s.pendingRecovery();s.proof();
 const rows=s.priv.getSheetByName('_Identity_Flows'),cols=rows.rows[0],f=rows.rows.at(-1),tokenHash=f[cols.indexOf('Token_Hash')];
 const keys=createLoginGuard(s.settings,{client:s.client}).attemptKeys({identifier:'flow:'+tokenHash,originAddress:pending.ip});
 const payload={...keys,tokenHash,sessionTokenHash:randomBytes(32).toString('hex'),hasResponse:false,credentialId:'',handleSubjectId:'',allowReplacement:false};
 const done=await s.client.prepareAccessCompletion(payload);assert.equal(done.done,true);assert.equal(done.principal.authorizationVersion,done.flow.authorizationVersion+1);
 assert.deepEqual((await s.client.prepareAccessCompletion(payload)).principal,done.principal);
});

test('out-of-order completion requests still consume the durable guessing budget before rejection',async()=>{
 const s=await setup();s.row[s.cols.indexOf('State')]='PIN';s.row[s.cols.indexOf('Ceremony_ID')]='';let limited=false;
 for(let i=0;i<8;i++)try{await s.client.prepareAccessCompletion(s.payload);assert.fail('early flow cannot complete');}catch(error){if(error.code==='AUTH_RATE_LIMITED'){limited=true;break;}assert.equal(error.code,'WORKSPACE_ACCESS_REJECTED');}
 assert.equal(limited,true);assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
});
