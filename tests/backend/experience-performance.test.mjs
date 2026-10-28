import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
import {profileFixture} from '../helpers/profile-fixture.mjs';
import {properties} from './fixtures.mjs';
import {createSessionService} from '../../backend/session-service.mjs';

function observe(s){
 const calls=[],headers=new Map();const post=s.gas.post;
 s.gas.post=envelope=>{calls.push(JSON.parse(Buffer.from(envelope.message,'base64')).action);return post(envelope);};
 for(const ss of s.gas.sheets.values())for(const sheet of ss.tables.values()){
  const range=sheet.getRange;sheet.getRange=function(row,...args){const r=range.call(this,row,...args),read=r.getValues;r.getValues=()=>{if(row===1)headers.set(sheet,(headers.get(sheet)||0)+1);return read();};return r;};
 }
 return {calls,headers,reset(){calls.length=0;headers.clear();}};
}
test('successful access reduces Google round trips without changing flow or skipping durable attempts',async()=>{
 const s=ownerFixture(),o=observe(s),service=s.service(),token=randomBytes(32).toString('base64url'),ip='192.0.2.116';
 await service.execute('start',{email:properties.OWNER_EMAIL},token,ip);
 assert.deepEqual(o.calls,['identity.access.startGuarded']);
 const code=s.gas.outbox.at(-1).body.match(/\n([A-HJ-NP-Z2-9]{7})\n/)[1];
 o.reset();assert.equal((await service.execute('email',{code},token,ip)).stage,'PIN');
 assert.deepEqual(o.calls,['identity.access.emailGuarded']);
 o.reset();assert.equal((await service.execute('pin',{pin:'8274'},token,ip)).stage,'PASSKEY');
 assert.deepEqual(o.calls,['identity.access.pinReadGuarded','identity.access.pin']);
 o.reset();assert.equal((await service.state(token)).stage,'PASSKEY');
 assert.deepEqual(o.calls,['identity.access.read']);
 assert.ok([...o.headers.values()].every(n=>n===1),'headers read at most once per table per locked RPC');
 assert.equal(o.headers.size,s.gas.context.LIVRARIA_SCHEMA.tables.length+s.gas.context.AUTH_CONTROL_SCHEMA.tables.length,'all public and private table headers are validated');
 const optimized=[...o.headers.values()].reduce((a,b)=>a+b,0),reader=s.gas.context.rowValues_;
 s.gas.context.rowValues_=(sheet,last)=>(last===undefined?sheet.getLastRow():last)?sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0]:[];
 o.reset();assert.equal((await service.state(token)).stage,'PASSKEY');
 const repeated=[...o.headers.values()].reduce((a,b)=>a+b,0);assert.ok(optimized<repeated);
 console.info(JSON.stringify({metric:'state.headerReads',before:repeated,after:optimized}));
 s.gas.context.rowValues_=reader;
 assert.equal(s.gas.context.RPC_STORAGE_SCOPE_,null);
 const sheet=s.main.getSheetByName('Usuarios'),saved=sheet.rows[0][0];sheet.rows[0][0]='CORRUPTED_HEADER';
 await assert.rejects(service.state(token),{code:'WORKSPACE_SCHEMA_CONFLICT'});
 sheet.rows[0][0]=saved;
 assert.equal(s.gas.context.RPC_STORAGE_SCOPE_,null);
 assert.equal((await service.state(token)).stage,'PASSKEY');
 assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
});
test('profile mutations perform one session RPC and recheck revocation at the storage operation',async()=>{
 const s=profileFixture(),origin='https://dev--merry-chimera-49a1f3.netlify.app';
 const current=await createSessionService(s.settings,{client:s.client}).current(new Request(origin+'/api/v1/session',{headers:{cookie:s.master.cookie}})),o=observe(s);
 const send=revision=>s.profileHandler(new Request(origin+'/api/v1/profile/save',{method:'POST',headers:{cookie:s.master.cookie,origin,'content-type':'application/json','x-csrf-token':current.csrfToken},body:JSON.stringify({commandId:crypto.randomUUID(),expectedRevision:revision,phone:''})}));
 const result=await send(0);
 assert.equal(result.status,200);assert.equal(o.calls.filter(a=>a==='identity.session.read').length,1);
 const original=s.client.profile;let revoked=false;
 s.client.profile=async(...args)=>{if(!revoked){revoked=true;await s.client.revokeSession(s.master.tokenHash);}return original(...args);};
 assert.equal((await send(1)).status,401);
});
test('contended runtime requests return a signed busy result before the transport deadline without any storage write',async()=>{
 const s=ownerFixture(),waits=[],before=s.gas.writes;
 s.gas.context.LockService.getScriptLock=()=>({tryLock(ms){waits.push(ms);return false;},releaseLock(){assert.fail('unacquired lock must not be released');}});
 await assert.rejects(s.client.access('read',{tokenHash:'ab'.repeat(32)}),{status:503,code:'WORKSPACE_BUSY'});
 assert.deepEqual(waits,[5000]);assert.equal(s.gas.writes,before);assert.equal(s.gas.context.RPC_STORAGE_SCOPE_,null);
 assert.throws(()=>s.gas.call('inspectDevelopmentSchema'),/BUSY/);
 assert.deepEqual(waits,[5000,20000],'editor maintenance retains its existing wait budget');
});
