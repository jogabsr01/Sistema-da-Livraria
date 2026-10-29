import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {ownerFixture,injectAccessFault} from '../helpers/owner-access-fixture.mjs';
import {properties,environment} from './fixtures.mjs';
import {createOwnerAccessService} from '../../backend/owner-access.mjs';
import {createSessionService,validateSessionPrincipal} from '../../backend/session-service.mjs';
import {requirePermission} from '../../backend/authorization.mjs';
import {loadConfig} from '../../backend/config.mjs';
import {accessReceipts} from '../../backend/access-receipt.mjs';
async function ready(){
 const s=ownerFixture({adminPinLogin:true}),token=randomBytes(32).toString('base64url'),ip='192.0.2.31',svc=s.service();
 await svc.execute('start',{email:properties.OWNER_EMAIL},token,ip);
 const code=s.gas.outbox.at(-1).body.match(/\n([A-HJ-NP-Z2-9]{7})\n/)[1];await svc.execute('email',{code},token,ip);await svc.execute('pin',{pin:'8274'},token,ip);
 const f=s.priv.getSheetByName('_Identity_Flows');s.storageProof(f.rows.at(-1)[f.rows[0].indexOf('Token_Hash')]);await svc.execute('complete',{},token,ip);

 return {...s,ip,token:randomBytes(32).toString('base64url'),svc:createOwnerAccessService(s.settings,{client:s.client,pinLogin:true,stagedCompletion:true,segmentedCompletion:true})};
}
async function begin(s){return s.svc.execute('login',{email:properties.OWNER_EMAIL,pin:'8274'},s.token,s.ip);}
function request(done){return new Request('https://dev--merry-chimera-49a1f3.netlify.app/api/v1/session',{headers:{cookie:done.cookie.split(';')[0]}});}
test('approved DEV PIN entry uses two RPCs, truthful pin assurance and one idempotent grant; business works, credentials require step-up',async()=>{
 const s=await ready(),actions=[],post=s.gas.post;s.gas.post=e=>{actions.push(JSON.parse(Buffer.from(e.message,'base64')).action);return post(e);};
 const keys=JSON.stringify(s.priv.getSheetByName('_Passkeys').rows),first=await begin(s),saved=accessReceipts(s.settings,s.token).open(first.loginReceipt,'login');
 assert.equal(saved.mode,'pin-session');assert.equal(first.cookie,undefined);assert.deepEqual(actions,['identity.access.loginLookup']);
 const done=await s.svc.execute('continue-login',{receipt:first.loginReceipt},s.token,s.ip);assert.equal(done.stage,'COMPLETE');assert.equal(done.user.assurance,'pin');assert.deepEqual(actions,['identity.access.loginLookup','identity.access.pinLogin']);
 const session=createSessionService(s.settings,{client:s.client}),principal=await session.authenticate(request(done));assert.equal(principal.role,'SUPER_ADMIN');assert.equal(principal.assurance,'pin');requirePermission(principal,'products.write');requirePermission(principal,'reports.read');assert.throws(()=>requirePermission(principal,'credentials.self.manage'),{code:'REAUTHENTICATION_REQUIRED'});
 assert.throws(()=>validateSessionPrincipal(principal),{code:'UNAUTHENTICATED'});
 const again=await s.svc.execute('continue-login',{receipt:first.loginReceipt},s.token,s.ip);assert.equal(again.cookie,done.cookie);assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),3);assert.equal(JSON.stringify(s.priv.getSheetByName('_Passkeys').rows),keys);
});
test('PIN receipt is cookie-bound, rejects wrong PIN and rechecks disabled accounts, epoch, verifier and policy',async()=>{
 for(const mode of ['cookie','disabled','epoch','verifier','policy']){
  const s=await ready();await assert.rejects(s.svc.execute('login',{email:properties.OWNER_EMAIL,pin:'0193'},s.token,s.ip),{code:'ACCESS_REJECTED'});const first=await begin(s);
  if(mode==='disabled'){const t=s.main.getSheetByName('Usuarios');t.rows[1][t.rows[0].indexOf('Status')]='INATIVO';}
  if(mode==='epoch'){const t=s.main.getSheetByName('Configuracoes');t.rows.find(r=>r[0]==='identity.version.'+s.gas.props.IDENTITY_OWNER_USER_ID)[1]=2;}
  if(mode==='verifier'){const t=s.priv.getSheetByName('_Pin_Verifiers');t.rows[1][t.rows[0].indexOf('Record_JSON')]='{}';}
  if(mode==='policy')s.gas.props.ADMIN_PIN_LOGIN_ENABLED='false';
  await assert.rejects(s.svc.execute('continue-login',{receipt:first.loginReceipt},mode==='cookie'?randomBytes(32).toString('base64url'):s.token,s.ip));assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),2);
 }
});
test('partial PIN completion repairs intent, session, audit, user and marker exactly once',async()=>{
 for(const stage of ['intent','session','audit','user','marker'])for(const after of [false,true]){
  const s=await ready(),first=await begin(s);injectAccessFault(s,stage,after);await assert.rejects(s.svc.execute('continue-login',{receipt:first.loginReceipt},s.token,s.ip));
  const done=await s.svc.execute('continue-login',{receipt:first.loginReceipt},s.token,s.ip);assert.equal(done.stage,'COMPLETE');assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),3);
  assert.equal(s.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r.includes('IDENTITY_LOGIN')).length,1);
 }
});
test('DEV policy defaults follow owner consent and explicit false restores strong authentication; PROD never opts in',()=>{
 const env=environment();delete env.WORKSPACE_ADMIN_PIN_LOGIN_ENABLED;assert.equal(loadConfig(env).adminPinLogin,true);assert.equal(loadConfig({...env,WORKSPACE_ADMIN_PIN_LOGIN_ENABLED:'false'}).adminPinLogin,false);assert.throws(()=>loadConfig({...env,WORKSPACE_ADMIN_PIN_LOGIN_ENABLED:'yes'}),{code:'CONFIGURATION_UNAVAILABLE'});
 const prod={...env,APP_ENV:'prod',CONTEXT:'production',BRANCH:'main',DEPLOY_PRIME_URL:'https://merry-chimera-49a1f3.netlify.app/'};assert.equal(loadConfig({...prod,WORKSPACE_ADMIN_PIN_LOGIN_ENABLED:'true'}).adminPinLogin,false);
});
test('PIN sessions still reject revocation, disabled user, changed epoch, idle and absolute expiry',async()=>{
 for(const mode of ['revoked','disabled','epoch','idle','absolute']){
  const s=await ready(),first=await begin(s),done=await s.svc.execute('continue-login',{receipt:first.loginReceipt},s.token,s.ip),table=s.main.getSheetByName('Sessoes'),row=table.rows.at(-1),set=(key,value)=>row[table.rows[0].indexOf(key)]=value;
  if(mode==='revoked')set('Revogado_Em',new Date().toISOString());
  if(mode==='disabled'){const t=s.main.getSheetByName('Usuarios');t.rows[1][t.rows[0].indexOf('Status')]='INATIVO';}
  if(mode==='epoch')s.main.getSheetByName('Configuracoes').rows.find(r=>r[0]==='identity.version.'+s.gas.props.IDENTITY_OWNER_USER_ID)[1]=2;
  if(mode==='idle'){set('Criado_Em',new Date(Date.now()-1900000).toISOString());set('Ultima_Atividade',new Date(Date.now()-1800001).toISOString());set('Expira_Em',new Date(Date.now()+1000000).toISOString());}
  if(mode==='absolute')set('Expira_Em',new Date(Date.now()-1).toISOString());
  await assert.rejects(createSessionService(s.settings,{client:s.client}).current(request(done)));
 }
});
