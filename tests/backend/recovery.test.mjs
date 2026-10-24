import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { enableRecovery } from '../helpers/recovery-fixture.mjs';
import { createSessionTokens } from '../../backend/credential-core.mjs';
import { staffFixture } from '../helpers/staff-fixture.mjs';
const raw=r=>r.cookie.split('=')[1].split(';')[0];
const tokenHash=(s,r)=>createSessionTokens({...s.settings.config,tokenKey:s.settings.tokenKey}).hash(raw(r));

test('recovery needs both registered-email proof and an existing credential; it rotates PIN/epoch and revokes old sessions',async()=>{
 const s=enableRecovery(),old=await s.activateOwner(),p=await s.pendingRecovery();
 await assert.rejects(p.svc.execute('complete',{response:null},p.token,p.ip));assert.equal((await s.client.readSession(tokenHash(s,old))).authorizationVersion,1);
 s.proof();const done=await p.svc.execute('complete',{response:null},p.token,p.ip);assert.equal(done.user.role,'SUPER_ADMIN');assert.equal((await s.client.readSession(tokenHash(s,done))).authorizationVersion,2);await assert.rejects(s.client.readSession(tokenHash(s,old)),{code:'UNAUTHENTICATED'});
 await assert.rejects(s.recoveryService().execute('login',{email:'owner@example.invalid',pin:'8274'},randomBytes(32).toString('base64url'),'192.0.2.8'));
 assert.equal((await s.recoveryService().execute('login',{email:'owner@example.invalid',pin:'9382'},randomBytes(32).toString('base64url'),'192.0.2.8')).stage,'PASSKEY');
 assert.equal((await p.svc.execute('complete',{response:null},p.token,p.ip)).cookie,done.cookie);
 const audit=s.main.getSheetByName('Logs_Auditoria');assert.equal(audit.rows.filter(r=>r[audit.rows[0].indexOf('Acao')]==='IDENTITY_PIN_RECOVER').length,1);
});

test('unknown, inactive, pending and undeliverable accounts return generic acceptance without an authenticated grant',async()=>{
 for(const mode of ['unknown','inactive','pending','mail']){
  const s=enableRecovery();if(mode!=='pending')await s.activateOwner();const users=s.main.getSheetByName('Usuarios');if(mode==='inactive')users.rows[1][users.rows[0].indexOf('Status')]='INATIVO';if(mode==='mail')s.gas.mailFailure=true;
  const token=randomBytes(32).toString('base64url'),svc=s.recoveryService(),before=s.gas.outbox.length;const result=await svc.execute('recover',{email:mode==='unknown'?'unknown@example.invalid':'owner@example.invalid'},token,'192.0.2.5');assert.equal(result.stage,'EMAIL');assert.equal(s.gas.outbox.length,before);
  await assert.rejects(svc.execute('email',{code:randomBytes(32).toString('base64url')},token,'192.0.2.5'));
 }
});

test('failure at every recovery projection cannot revive an old session and replay returns exactly one replacement session',async()=>{
 for(const stage of ['intent','epoch','pin','key','session-revoke','user','session-new','audit','marker'])for(const after of [false,true]){
  const s=enableRecovery(),old=await s.activateOwner(),p=await s.pendingRecovery();s.proof();const oldHash=tokenHash(s,old);
  for(const name of ['accessSaveMain_','authControlSave_']){const save=s.gas.context[name];let once=true;s.gas.context[name]=(table,row)=>{
   const target=table.sheet.name==='_Identity_Flows'?row.State==='COMMITTING'?'intent':row.State==='COMPLETE'?'marker':'':table.sheet.name==='Configuracoes'&&row.Chave?.startsWith('identity.version.')?'epoch':table.sheet.name==='_Pin_Verifiers'?'pin':table.sheet.name==='_Passkeys'?'key':table.sheet.name==='Sessoes'?row.Token_Hash===oldHash?'session-revoke':'session-new':table.sheet.name==='Usuarios'?'user':table.sheet.name==='Logs_Auditoria'?'audit':'';
   if(!once||target!==stage)return save(table,row);once=false;if(after)save(table,row);throw Error('INJECTED_RECOVERY');
  };}
  await assert.rejects(p.svc.execute('complete',{response:null},p.token,p.ip));
  if(stage==='intent'&&!after){s.gas.props.RECOVERY_ENABLED='true';await p.svc.execute('complete',{response:null},p.token,p.ip);}
  s.gas.props.RECOVERY_ENABLED='false';await assert.rejects(s.client.readSession(oldHash),{code:'UNAUTHENTICATED'});
  const done=await p.svc.execute('complete',{response:null},p.token,p.ip);assert.equal((await s.client.readSession(tokenHash(s,done))).authorizationVersion,2,stage+after);assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),3);
 }
});

test('email proof does not authorize registering a replacement passkey; stale logins and expired flows are refused',async()=>{
 const s=enableRecovery();await s.activateOwner();const p=await s.pendingRecovery();const options=await p.svc.execute('options',{},p.token,p.ip);assert.equal(options.kind,'get');assert.ok(options.options.allowCredentials.length>0);
 const flows=s.priv.getSheetByName('_Identity_Flows'),cols=flows.rows[0],f=flows.rows.at(-1);f[cols.indexOf('Created_At')]=new Date(Date.now()-700000).toISOString();f[cols.indexOf('Expires_At')]=new Date(Date.parse(f[cols.indexOf('Created_At')])+600000).toISOString();await assert.rejects(p.svc.execute('pin',{pin:'1234'},p.token,p.ip));
});

test('staff recovery by CPF retains attendant permissions and is bound to the enrolled email',async()=>{
 const base=staffFixture(),s=enableRecovery(base),c=s.command();await s.http('save',c);let token=randomBytes(32).toString('base64url'),svc=s.recoveryService(),ip='192.0.2.15';await svc.execute('start',{email:c.contact.email},token,ip);await svc.execute('email',{code:s.code()},token,ip);await svc.execute('pin',{pin:'8274'},token,ip);s.storageProof(s.hash());await svc.execute('complete',{response:null},token,ip);
 // Move test flow clocks past the delivery cooldown without sleeping.
 const f=s.priv.getSheetByName('_Identity_Flows');for(const row of f.rows.slice(1)){row[5]=new Date(Date.now()-70000).toISOString();row[6]=new Date(Date.parse(row[5])+600000).toISOString();}
 const p=await s.pendingRecovery(c.contact.cpf,'192.0.2.16');assert.equal(s.gas.outbox.at(-1).to,c.contact.email);s.proof();
 const save=s.gas.context.accessSaveMain_;let once=true;s.gas.context.accessSaveMain_=(table,row)=>{if(once&&table.sheet.name==='Logs_Auditoria'){once=false;save(table,row);throw Error('INJECTED_STAFF_RECOVERY');}return save(table,row);};
 await assert.rejects(p.svc.execute('complete',{response:null},p.token,p.ip));
 s.gas.props.STAFF_ENABLED='false';s.gas.props.RECOVERY_ENABLED='false';
 const done=await p.svc.execute('complete',{response:null},p.token,p.ip);assert.equal(done.user.role,'ATENDENTE');
 assert.equal((await s.client.readSession(tokenHash(s,done))).authorizationVersion,2);
});
