import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
import {properties} from './fixtures.mjs';
import {ACCESS_ORIGIN} from '../../backend/owner-access.mjs';
async function activated(){
 const s=ownerFixture(),token=randomBytes(32).toString('base64url'),service=s.service(),ip='192.0.2.55';
 await service.execute('start',{email:properties.OWNER_EMAIL},token,ip);const code=s.gas.outbox.at(-1).body.match(/\n([A-HJ-NP-Z2-9]{7})\n/)[1];await service.execute('email',{code},token,ip);await service.execute('pin',{pin:'8274'},token,ip);
 const f=s.priv.getSheetByName('_Identity_Flows');s.storageProof(f.rows.at(-1)[f.rows[0].indexOf('Token_Hash')]);const done=await service.execute('complete',{},token,ip);
 const session=done.cookie.split(';')[0],access='__Host-livraria_access='+token;
 const request=(op,extra={})=>new Request(ACCESS_ORIGIN+'/api/v1/access/'+op,{method:'POST',headers:{origin:ACCESS_ORIGIN,'content-type':'application/json',cookie:access+'; '+session,'x-csrf-token':service.csrf(token),...extra},body:JSON.stringify(op==='complete'?{response:null,receipt:null}:{})});
 return {...s,token,service,session,access,request};
}
test('separate completion sends one session cookie and confirms its receipt before clearing only the pre-auth cookie',async()=>{
 const s=await activated();const completed=await s.handler(s.request('complete',{'x-access-completion-version':'3','x-access-cookie-mode':'separate'}),{ip:'192.0.2.55'});assert.equal(completed.status,200);assert.equal((await completed.json()).data.cookieConfirmationRequired,true);const cookies=completed.headers.getSetCookie();assert.equal(cookies.length,1);assert.ok(cookies[0].startsWith('__Host-livraria_session='));assert.ok(!cookies[0].includes('Max-Age=0'));
 let calls=0;const post=s.gas.post;s.gas.post=e=>{calls++;return post(e);};const result=await s.handler(s.request('cookie'));assert.equal(result.status,200);assert.equal((await result.json()).data.stage,'COOKIE_CONFIRMED');assert.equal(calls,0);assert.equal(result.headers.getSetCookie().length,1);assert.match(result.headers.get('set-cookie'),/^__Host-livraria_access=;.*Max-Age=0$/);assert.ok(!result.headers.get('set-cookie').includes('__Host-livraria_session'));
});
test('cookie confirmation rejects missing, wrong, duplicated, cross-flow and cross-origin cookies without clearing or granting anything',async()=>{
 const s=await activated();let calls=0;const post=s.gas.post;s.gas.post=e=>{calls++;return post(e);};
 for(const extra of [{cookie:s.access},{cookie:s.access+'; __Host-livraria_session='+randomBytes(32).toString('base64url')},{cookie:s.access+'; '+s.session+'; '+s.session},{cookie:'__Host-livraria_access='+randomBytes(32).toString('base64url')+'; '+s.session},{origin:'https://evil.invalid'},{'x-csrf-token':''}]){
  const r=await s.handler(s.request('cookie',extra));assert.ok([401,403].includes(r.status));assert.equal(r.headers.get('set-cookie'),null);assert.equal((await r.json()).data,undefined);
 }
 assert.equal(calls,0);assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),2);
});
