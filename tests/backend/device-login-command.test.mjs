import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
import {properties} from './fixtures.mjs';
async function fixture(){
 const s=ownerFixture(),token=randomBytes(32).toString('base64url'),svc=s.service(),ip='192.0.2.42';
 await svc.execute('start',{email:properties.OWNER_EMAIL},token,ip);const code=s.gas.outbox.at(-1).body.match(/\n([A-HJ-NP-Z2-9]{7})\n/)[1];await svc.execute('email',{code},token,ip);await svc.execute('pin',{pin:'8274'},token,ip);
 const f=s.priv.getSheetByName('_Identity_Flows');s.storageProof(f.rows.at(-1)[f.rows[0].indexOf('Token_Hash')]);await svc.execute('complete',{},token,ip);
 const keys=s.priv.getSheetByName('_Passkeys'),k=Object.fromEntries(keys.rows[0].map((c,i)=>[c,keys.rows[1][i]]));
 const payload={flowId:randomUUID(),tokenHash:randomBytes(32).toString('hex'),ceremonyId:randomUUID(),challenge:randomBytes(32).toString('base64url'),credentialId:k.Credential_ID,subjectId:k.Subject_ID,staffAllowed:false,accountKey:randomBytes(32).toString('hex'),originKey:randomBytes(32).toString('hex')};return {...s,payload,k};
}
test('discoverable preparation binds the selected key and consumes one challenge in one RPC without issuing a session',async()=>{
 const s=await fixture(),calls=[],post=s.gas.post;s.gas.post=e=>{calls.push(JSON.parse(Buffer.from(e.message,'base64')).action);return post(e);};
 const result=await s.client.prepareDeviceAccess(s.payload);assert.deepEqual(calls,['identity.access.devicePrepare']);assert.equal(result.flow.subjectId,s.k.Subject_ID);assert.equal(result.ceremony.credential.id,s.k.Credential_ID);assert.equal(result.flow.proofReady,false);assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),2);
 await assert.rejects(s.client.prepareDeviceAccess(s.payload));assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),2);
});
test('saved-key selection cannot bypass account status, key revocation, handle binding, epoch or flags',async()=>{
 for(const mode of ['disabled','revoked','handle','epoch','flags']){
  const s=await fixture();
  if(mode==='disabled'){const t=s.main.getSheetByName('Usuarios');t.rows[1][t.rows[0].indexOf('Status')]='INATIVO';}
  if(mode==='revoked'){const t=s.priv.getSheetByName('_Passkeys');t.rows[1][t.rows[0].indexOf('Revoked_At')]=new Date().toISOString();}
  if(mode==='handle')s.payload.subjectId=randomUUID();
  if(mode==='epoch')s.main.getSheetByName('Configuracoes').rows[1][1]=2;
  if(mode==='flags')s.gas.props.IDENTITY_PASSKEYS_ENABLED='false';
  await assert.rejects(s.client.prepareDeviceAccess(s.payload));assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),2);
 }
});
