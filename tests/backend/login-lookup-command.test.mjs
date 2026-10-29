import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../../backend/errors.mjs';
import {randomBytes} from 'node:crypto';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
import {properties} from './fixtures.mjs';
import {createLoginGuard} from '../../backend/login-guard.mjs';
import {ACCESS_ORIGIN,ACCESS_COOKIE,createOwnerAccessHandler} from '../../backend/owner-access.mjs';
const ip='192.0.2.194',pin='8274';
function payload(s,extra={}){return {...createLoginGuard(s.settings,{client:s.client}).attemptKeys({identifier:properties.OWNER_EMAIL,originAddress:ip}),email:properties.OWNER_EMAIL,emailIndex:'',cpfIndex:'',staffLookup:false,...extra};}
async function activate(){
 const s=ownerFixture(),token=randomBytes(32).toString('base64url'),service=s.service();
 await service.execute('start',{email:properties.OWNER_EMAIL},token,ip);
 await service.execute('email',{code:s.gas.outbox.at(-1).body.match(/\n([A-HJ-NP-Z2-9]{7})\n/)[1]},token,ip);
 await service.execute('pin',{pin},token,ip);
 const f=s.priv.getSheetByName('_Identity_Flows');s.storageProof(f.rows.at(-1)[f.rows[0].indexOf('Token_Hash')]);
 await service.execute('complete',{response:null},token,ip);return s;
}
test('registered owner login uses two signed RPCs, keeps PIN verification in Node and issues no session before passkey',async()=>{
 const s=await activate(),before=s.client.timings().calls,flows=s.priv.getSheetByName('_Identity_Flows'),sessions=s.main.getSheetByName('Sessoes').getLastRow();
 const result=await s.service().execute('login',{email:properties.OWNER_EMAIL,pin},randomBytes(32).toString('base64url'),ip);
 assert.deepEqual(result,{stage:'PASSKEY'});assert.equal(s.client.timings().calls-before,2);assert.equal(flows.rows.at(-1)[flows.rows[0].indexOf('Purpose')],'LOGIN');assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),sessions);
});
test('lookup alone reserves a durable attempt but creates no flow or session; unknown email and unlinked CPF stay generic',async()=>{
 const s=await activate(),flows=s.priv.getSheetByName('_Identity_Flows').getLastRow(),sessions=s.main.getSheetByName('Sessoes').getLastRow();
 const a=await s.client.lookupAccessLogin(payload(s));assert.equal(a.kind,'OWNER');assert.equal(a.account.record.algorithm,'scrypt-N32768-r8-p1');
 assert.equal((await s.client.lookupAccessLogin(payload(s,{email:'unknown@example.invalid'}))).account,null);
 assert.equal((await s.client.lookupAccessLogin(payload(s,{email:'',cpfIndex:'a'.repeat(64)}))).account,null);
 assert.equal(s.priv.getSheetByName('_Identity_Flows').getLastRow(),flows);assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),sessions);
});
test('lookup refuses subject/role spoofing and staff flag bypass, while a durable blocked attempt cannot reveal a verifier',async()=>{
 const s=await activate();await assert.rejects(s.client.lookupAccessLogin({...payload(s),subjectId:s.gas.props.IDENTITY_OWNER_USER_ID}));
 await assert.rejects(s.client.lookupAccessLogin(payload(s,{staffLookup:true,emailIndex:'b'.repeat(64)})));
 let blocked=false;for(let i=0;i<20;i++){try{await s.client.lookupAccessLogin(payload(s));}catch(e){assert.equal(e.code,'AUTH_RATE_LIMITED');assert.ok(e.retryAfterSeconds>0);blocked=true;break;}}assert.equal(blocked,true);
});
test('wrong PIN never creates a login flow and account revocation between lookup and flow is rechecked',async()=>{
 const s=await activate(),flows=s.priv.getSheetByName('_Identity_Flows').getLastRow();
 await assert.rejects(s.service().execute('login',{email:properties.OWNER_EMAIL,pin:'0193'},randomBytes(32).toString('base64url'),ip),{code:'ACCESS_REJECTED'});assert.equal(s.priv.getSheetByName('_Identity_Flows').getLastRow(),flows);
 const original=s.client.lookupAccessLogin;s.client.lookupAccessLogin=async p=>{const result=await original(p);const users=s.main.getSheetByName('Usuarios');users.rows[1][users.rows[0].indexOf('Status')]='INATIVO';return result;};
 await assert.rejects(s.service().execute('login',{email:properties.OWNER_EMAIL,pin},randomBytes(32).toString('base64url'),ip));assert.equal(s.priv.getSheetByName('_Identity_Flows').getLastRow(),flows);
});
test('login shares a 27-second request deadline and preserves only the preauth cookie on uncertain transport failure',async()=>{
 const s=ownerFixture();let options,calls=0;
 const handler=createOwnerAccessHandler({loadSettings:()=>s.settings,createClient:(_c,o)=>{options=o;return {...s.client,lookupAccessLogin:async()=>{calls++;throw new ApiError(502,'UPSTREAM_TIMEOUT');}};}});
 const fresh=await handler(new Request(ACCESS_ORIGIN+'/api/v1/access/state')),cookie=fresh.headers.get('set-cookie').split(';')[0],csrf=(await fresh.json()).data.csrfToken;
 const before=performance.now(),response=await handler(new Request(ACCESS_ORIGIN+'/api/v1/access/login',{method:'POST',headers:{cookie,origin:ACCESS_ORIGIN,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({email:properties.OWNER_EMAIL,pin})}),{ip});
 assert.ok(options.deadlineAt>=before+27000&&options.deadlineAt<=performance.now()+27000);assert.equal(calls,1);assert.equal(response.status,502);assert.ok(response.headers.get('set-cookie').startsWith(ACCESS_COOKIE+'='));assert.ok(!response.headers.get('set-cookie').includes('__Host-livraria_session'));
});
