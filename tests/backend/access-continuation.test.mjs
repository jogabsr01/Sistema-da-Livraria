import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {accessReceipts} from '../../backend/access-receipt.mjs';
import {createOwnerAccessService,ACCESS_ORIGIN} from '../../backend/owner-access.mjs';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
import {properties} from './fixtures.mjs';
const rejected={code:'ACCESS_CONTINUATION_EXPIRED'};
test('opaque continuation expires and rejects changed ciphertext, cookie, kind, key and installation',t=>{
 const s=ownerFixture(),token=randomBytes(32).toString('base64url'),r=accessReceipts(s.settings,token),receipt=r.seal('proof',{method:'registerPasskey',command:{publicKey:'PUBLIC_KEY_SENTINEL'}});
 assert.deepEqual(r.open(receipt,'proof'),{method:'registerPasskey',command:{publicKey:'PUBLIC_KEY_SENTINEL'}});
 assert.ok(!receipt.includes('PUBLIC_KEY_SENTINEL'));
 const parts=receipt.split('.');parts[1]=(parts[1][0]==='A'?'B':'A')+parts[1].slice(1);
 for(const value of [parts.join('.'),'a.b.c','x'.repeat(12001)])assert.throws(()=>r.open(value,'proof'),rejected);
 assert.throws(()=>r.open(receipt,'login'),rejected);
 assert.throws(()=>accessReceipts(s.settings,'different').open(receipt,'proof'),rejected);
 assert.throws(()=>accessReceipts({...s.settings,guardKey:randomBytes(32)},token).open(receipt,'proof'),rejected);
 assert.throws(()=>accessReceipts({...s.settings,config:{...s.settings.config,installationId:'other'}},token).open(receipt,'proof'),rejected);
 const now=Date.now();t.mock.method(Date,'now',()=>now+180001);assert.throws(()=>r.open(receipt,'proof'),rejected);
});
async function activated(){
 const s=ownerFixture(),token=randomBytes(32).toString('base64url'),ip='192.0.2.31',svc=s.service();
 await svc.execute('start',{email:properties.OWNER_EMAIL},token,ip);
 const code=s.gas.outbox.at(-1).body.match(/\n([A-HJ-NP-Z2-9]{7})\n/)[1];await svc.execute('email',{code},token,ip);await svc.execute('pin',{pin:'8274'},token,ip);
 const flows=s.priv.getSheetByName('_Identity_Flows'),cols=flows.rows[0];s.storageProof(flows.rows.at(-1)[cols.indexOf('Token_Hash')]);await svc.execute('complete',{},token,ip);
 return {...s,ip};
}
test('biometric account selection does not verify a PIN or issue a session; continuation is cookie-bound and idempotent',async()=>{
 const s=await activated(),token=randomBytes(32).toString('base64url'),svc=createOwnerAccessService(s.settings,{client:s.client});
 let calls=0;const post=s.gas.post;s.gas.post=e=>{calls++;return post(e);};
 const first=await svc.execute('biometric',{email:properties.OWNER_EMAIL},token,s.ip);
 assert.equal(first.stage,'COMMITTING');assert.equal(calls,1);assert.equal(first.cookie,undefined);
 const before=s.main.getSheetByName('Sessoes').getLastRow();
 assert.equal((await svc.execute('continue-login',{receipt:first.loginReceipt},token,s.ip)).stage,'PASSKEY');assert.equal(calls,2);
 assert.equal((await svc.execute('continue-login',{receipt:first.loginReceipt},token,s.ip)).stage,'PASSKEY');assert.equal(calls,3);
 assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),before);
 await assert.rejects(svc.execute('continue-login',{receipt:first.loginReceipt},randomBytes(32).toString('base64url'),s.ip),rejected);
 await assert.rejects(svc.execute('biometric',{email:'unknown@example.invalid'},token,s.ip),{code:'ACCESS_REJECTED'});
});
test('per-RPC row metadata is fresh after writes and is never reused by a later request',async()=>{
 const s=ownerFixture(),sheet=s.main.getSheetByName('Usuarios'),c=s.gas.context;
 c.RPC_STORAGE_SCOPE_={lastRows:new WeakMap(),identityRows:new WeakMap()};
 assert.equal(c.rpcLastRow_(sheet),2);sheet.appendRow(['fixture']);assert.equal(c.rpcLastRow_(sheet),2);
 c.invalidateRpcRows_(sheet);assert.equal(c.rpcLastRow_(sheet),3);c.RPC_STORAGE_SCOPE_=null;assert.equal(c.rpcLastRow_(sheet),3);
});
test('acknowledging an already saved proof does not invoke the one-use verifier or change credential counters',async()=>{
 const s=await activated(),flows=s.priv.getSheetByName('_Identity_Flows'),f=Object.fromEntries(flows.rows[0].map((k,i)=>[k,flows.rows[1][i]]));
 const keys=s.priv.getSheetByName('_Passkeys'),k=Object.fromEntries(keys.rows[0].map((key,i)=>[key,keys.rows[1][i]]));
 const command={subjectId:f.Subject_ID,authorizationVersion:f.Authorization_Version,ceremonyId:f.Ceremony_ID,credentialId:k.Credential_ID,publicKey:k.Public_Key,counter:k.Counter,transports:JSON.parse(k.Transports_JSON)};
 s.gas.context.passkeyOperation_=()=>{throw Error('MUST_NOT_REPLAY_VERIFIER');};
 for(let i=0;i<2;i++)assert.deepEqual(await s.client.access('saveProof',{tokenHash:f.Token_Hash,method:'registerPasskey',command}),{stored:true});
 assert.equal(keys.getLastRow(),2);assert.equal(keys.rows[1][keys.rows[0].indexOf('Counter')],k.Counter);
 assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),2);
 await assert.rejects(s.client.access('saveProof',{tokenHash:f.Token_Hash,method:'registerPasskey',command:{...command,credentialId:'different'}}),{code:'WORKSPACE_ACCESS_REJECTED'});
 await assert.rejects(s.client.access('saveProof',{tokenHash:f.Token_Hash,method:'advancePasskeyCounter',command}),{code:'WORKSPACE_ACCESS_REJECTED'});
});

test('explicit new-login view creates only a fresh pre-auth cookie without Google reads or an authenticated grant',async()=>{
 const s=ownerFixture(),token=randomBytes(32).toString('base64url');let calls=0;const post=s.gas.post;s.gas.post=e=>{calls++;return post(e);};
 const response=await s.handler(new Request(ACCESS_ORIGIN+'/api/v1/access/state',{headers:{cookie:'__Host-livraria_access='+token,'x-access-view':'login'}}));
 assert.equal(response.status,200);const data=(await response.json()).data;assert.equal(data.stage,'INITIAL');assert.equal(calls,0);assert.equal(data.user,undefined);
 const cookies=response.headers.getSetCookie();assert.equal(cookies.length,1);assert.ok(cookies[0].startsWith('__Host-livraria_access='));assert.ok(!cookies[0].startsWith('__Host-livraria_access='+token+';'));
 assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
});
