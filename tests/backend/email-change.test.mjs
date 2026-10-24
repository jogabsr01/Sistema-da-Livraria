import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { emailChangeFixture } from '../helpers/email-change-fixture.mjs';
import { loadEmailChangeSettings,createEmailChangeHandler } from '../../backend/email-change-handler.mjs';
import { environment } from './fixtures.mjs';
const data=async r=>(await r.json()).data;
const add=(table,value)=>table.appendRow(table.rows[0].map(k=>value[k]??''));

test('owner changes verified login email while Google owner/bindings and current session remain intact',async()=>{
 const s=emailChangeFixture(),other=s.session(),p=s.emailCommand(),original={owner:s.gas.props.OWNER_EMAIL,binding:s.gas.props.IDENTITY_OWNER_EMAIL_BINDING};
 assert.equal((await s.emailHttp('start',p)).status,202);assert.equal(s.gas.outbox.at(-1).to,p.email);const code=s.emailCode();assert.equal((await data(await s.profileHttp('get'))).email,original.owner);
 assert.equal((await s.emailHttp('confirm',{commandId:p.commandId,code})).status,200);assert.equal((await data(await s.profileHttp('get'))).email,p.email);assert.equal(s.gas.props.OWNER_EMAIL,original.owner);assert.equal(s.gas.props.IDENTITY_OWNER_EMAIL_BINDING,original.binding);
 assert.ok(s.gas.call('accessOwner_',s.gas.call('baseSettings_'),p.email));assert.equal(s.gas.call('accessOwner_',s.gas.call('baseSettings_'),original.owner),null);
 assert.ok(await s.client.readSession(s.master.tokenHash));await assert.rejects(s.client.readSession(other.tokenHash),{code:'UNAUTHENTICATED'});
 assert.equal((await s.emailHttp('confirm',{commandId:p.commandId,code})).status,200);assert.equal((await s.emailHttp('start',{...p,email:'outro@example.invalid'})).status,409);const logs=s.main.getSheetByName('Logs_Auditoria');assert.equal(logs.rows.filter(r=>r[0]===p.commandId).length,1);
 const publicData=JSON.stringify([...s.main.tables].map(([_,t])=>t.rows));assert.ok(!publicData.includes(p.email));assert.ok(!publicData.includes(code));assert.ok(!JSON.stringify(s.gas.props).includes(code));
});

test('staff email is resealed, CPF/role/PIN epoch preserved, and future first-access/recovery delivery uses the new binding',async()=>{
 const s=emailChangeFixture(),c=s.command();await s.http('save',c);const worker=s.session(c.id),p=s.emailCommand({expectedRevision:1,email:'atualizado@example.invalid'});assert.equal((await s.emailHttp('start',p,worker)).status,202);
 const save=s.gas.context.accessSaveMain_;let once=true;s.gas.context.accessSaveMain_=(table,row)=>{const out=save(table,row);if(once&&table.sheet.name==='Logs_Auditoria'){once=false;throw Error('INJECTED_STAFF_EMAIL');}return out;};
 assert.equal((await s.emailHttp('confirm',{commandId:p.commandId,code:s.emailCode()},worker)).status,502);s.gas.props.EMAIL_CHANGE_ENABLED='false';s.gas.props.STAFF_ENABLED='false';s.gas.props.PROFILE_ENABLED='false';assert.ok(await s.client.readSession(worker.tokenHash));s.gas.props.EMAIL_CHANGE_ENABLED='true';s.gas.props.STAFF_ENABLED='true';s.gas.props.PROFILE_ENABLED='true';
 const own=await data(await s.profileHttp('get',null,worker));assert.equal(own.email,p.email);assert.equal(own.role,'ATENDENTE');assert.equal(own.cpfMasked,'***.982.247-**');assert.equal(own.name,c.contact.name);assert.equal((await s.client.readSession(worker.tokenHash)).authorizationVersion,1);
 const lookup=await s.client.staffAccess('lookup',{emailIndex:s.vault.index('email',p.email),cpfIndex:''});assert.equal(s.vault.open('users',c.id,lookup.account.contact).email,p.email);
 assert.equal((await s.client.staffAccess('lookup',{emailIndex:s.vault.index('email',c.contact.email),cpfIndex:''})).account,null);
 const change=s.command({commandId:randomUUID(),id:c.id,expectedRevision:1});assert.equal((await s.http('save',change)).status,409);
});

test('codes are bound to subject, command and current session, expire, stop after five failures and can be cancelled',async()=>{
 const s=emailChangeFixture(),p=s.emailCommand();await s.emailHttp('start',p);const code=s.emailCode(),other=s.session();assert.equal((await data(await s.emailHttp('state',null,other))).stage,'IDLE');assert.equal((await s.emailHttp('confirm',{commandId:p.commandId,code},other)).status,400);
 assert.equal((await s.emailHttp('confirm',{commandId:randomUUID(),code})).status,400);
 for(let i=0;i<5;i++)assert.equal((await s.emailHttp('confirm',{commandId:p.commandId,code:randomBytes(32).toString('base64url')})).status,400);
 assert.equal(s.emailJournal().state,'REVOKED');assert.equal((await s.emailHttp('confirm',{commandId:p.commandId,code})).status,400);
 const t=emailChangeFixture(),q=t.emailCommand();await t.emailHttp('start',q);await t.emailHttp('cancel',{commandId:q.commandId});assert.equal((await t.emailHttp('confirm',{commandId:q.commandId,code:t.emailCode()})).status,400);
 const x=emailChangeFixture(),r=x.emailCommand();await x.emailHttp('start',r);const flow=x.emailJournal();flow.createdAt=new Date(Date.now()-301000).toISOString();flow.expiresAt=new Date(Date.parse(flow.createdAt)+300000).toISOString();x.gas.call('emailChangeSave_',flow);assert.equal((await x.emailHttp('confirm',{commandId:r.commandId,code:x.emailCode()})).status,400);
});

test('retries send once, reissue invalidates old proof, delivery/cooldown/hourly quotas and private capacity fail closed',async()=>{
 const s=emailChangeFixture(),p=s.emailCommand();await s.emailHttp('start',p);const first=s.emailCode();await s.emailHttp('start',p);assert.equal(s.gas.outbox.length,1);assert.equal((await s.emailHttp('start',s.emailCommand())).status,429);
 for(let n=1;n<5;n++){const v=s.emailJournal();v.createdAt=new Date(Date.now()-61000).toISOString();v.expiresAt=new Date(Date.parse(v.createdAt)+300000).toISOString();s.gas.call('emailChangeSave_',v);assert.equal((await s.emailHttp('start',s.emailCommand())).status,202);}
 const v=s.emailJournal();v.createdAt=new Date(Date.now()-61000).toISOString();v.expiresAt=new Date(Date.parse(v.createdAt)+300000).toISOString();s.gas.call('emailChangeSave_',v);assert.equal((await s.emailHttp('start',s.emailCommand())).status,429);assert.equal((await s.emailHttp('confirm',{commandId:v.id,code:first})).status,400);
 for(const kind of ['failure','quota','capacity']){const t=emailChangeFixture();if(kind==='failure')t.gas.mailFailure=true;if(kind==='quota')t.gas.mailQuota=0;if(kind==='capacity')t.gas.props.FILLER='x'.repeat(401000);assert.equal((await t.emailHttp('start',t.emailCommand())).status,503);assert.equal(t.gas.outbox.length,0);assert.equal(t.gas.props.IDENTITY_OWNER_LOGIN_EMAIL,undefined);}
});

test('concurrent profile/admin edits and an address occupied after issuance cannot be overwritten by confirmation',async()=>{
 for(const action of ['profile','other-user','command-collision']){const s=emailChangeFixture(),p=s.emailCommand();await s.emailHttp('start',p);const code=s.emailCode();
  if(action==='profile')assert.equal((await s.profileHttp('save',{commandId:randomUUID(),expectedRevision:0,phone:'11988887777'})).status,200);
  else if(action==='other-user')assert.equal((await s.http('save',s.command({contact:{name:'Pessoa fictícia',cpf:'52998224725',email:p.email,phone:''}}))).status,200);
  else assert.equal((await s.http('save',s.command({commandId:p.commandId}))).status,200);
  assert.equal((await s.emailHttp('confirm',{commandId:p.commandId,code})).status,409);assert.equal(s.gas.props.IDENTITY_OWNER_LOGIN_EMAIL,undefined);assert.ok(await s.client.readSession(s.master.tokenHash));assert.equal(s.gas.props.IDENTITY_EMAIL_PENDING||'','');
 }
 const s=emailChangeFixture(),c=s.command();await s.http('save',c);const worker=s.session(c.id);assert.equal((await s.emailHttp('start',s.emailCommand({expectedRevision:1,email:s.gas.props.OWNER_EMAIL}),worker)).status,409);
});

test('each interrupted email projection repairs before session acceptance, even with feature flags disabled',async()=>{
 for(const stage of ['intent','owner','user','revision','session','flow','audit','marker'])for(const after of [false,true]){
  const s=emailChangeFixture(),other=s.session(),p=s.emailCommand();
  // Unfinished old-address login proof must never outlive the change.
  const flowId=randomUUID(),privateFlows=s.priv.getSheetByName('_Identity_Flows'),at=Date.now();add(privateFlows,{ID:flowId,Token_Hash:randomBytes(32).toString('hex'),Subject_ID:s.master.id,Purpose:'LOGIN',State:'PASSKEY',Created_At:new Date(at).toISOString(),Expires_At:new Date(at+600000).toISOString(),Attempt_Count:0,Authorization_Version:1});
  await s.emailHttp('start',p);const code=s.emailCode();let once=true;
  const fault=(target,write)=>{if(!once||target!==stage)return write();once=false;if(after)write();throw Error('INJECTED_EMAIL_CHANGE');};
  for(const name of ['accessSaveMain_','authControlSave_']){const save=s.gas.context[name];s.gas.context[name]=(table,row)=>fault(table.sheet.name==='Usuarios'?'user':table.sheet.name==='Configuracoes'&&row.Chave.startsWith('staff.revision.')?'revision':table.sheet.name==='Sessoes'?'session':table.sheet.name==='_Identity_Flows'?'flow':table.sheet.name==='Logs_Auditoria'?'audit':'',()=>save(table,row));}
  const properties=s.gas.context.PropertiesService.getScriptProperties;s.gas.context.PropertiesService.getScriptProperties=()=>{const props=properties();return {...props,setProperty:(key,value)=>fault(key==='IDENTITY_OWNER_LOGIN_EMAIL'?'owner':key.startsWith('IDENTITY_EMAIL_CHANGE_')?JSON.parse(value).state==='COMMITTING'?'intent':JSON.parse(value).state==='COMPLETE'?'marker':'':'',()=>props.setProperty(key,value))};};
  assert.notEqual((await s.emailHttp('confirm',{commandId:p.commandId,code})).status,200,stage+after);
  if(stage==='intent'&&!after)assert.equal((await s.emailHttp('confirm',{commandId:p.commandId,code})).status,200);
  s.gas.props.EMAIL_CHANGE_ENABLED='false';s.gas.props.PROFILE_ENABLED='false';s.gas.props.STAFF_ENABLED='false';
  assert.ok(await s.client.readSession(s.master.tokenHash));await assert.rejects(s.client.readSession(other.tokenHash),{code:'UNAUTHENTICATED'});assert.equal(s.gas.props.IDENTITY_OWNER_LOGIN_EMAIL,p.email);
  s.gas.props.EMAIL_CHANGE_ENABLED='true';s.gas.props.PROFILE_ENABLED='true';assert.equal((await s.emailHttp('confirm',{commandId:p.commandId,code})).status,200);assert.equal(s.emailJournal().state,'COMPLETE');assert.equal(privateFlows.rows.find(r=>r[0]===flowId)[4],'REVOKED');
  assert.equal(s.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r[0]===p.commandId).length,1);
 }
});

test('email API independently requires default-off flags, strict origin/CSRF, recent passkey and bounded exact input',async()=>{
 assert.throws(()=>loadEmailChangeSettings(environment()),{code:'EMAIL_CHANGE_NOT_ACTIVATED'});assert.equal((await createEmailChangeHandler()(new Request('https://dev--merry-chimera-49a1f3.netlify.app/api/v1/email-change/state'))).status,503);
 const s=emailChangeFixture(),p=s.emailCommand();for(const headers of [{origin:'https://evil.invalid'},{'x-csrf-token':''},{'content-type':'text/plain'}])assert.equal((await s.emailHttp('start',p,undefined,headers)).status,403);
 for(const field of ['id','role','userId','contact','emailIndex'])assert.equal((await s.emailHttp('start',{...p,[field]:'forged'})).status,400);
 assert.equal((await s.emailHttp('start',{...p,email:'a'.repeat(3000)})).status,413);
 const sessions=s.main.getSheetByName('Sessoes'),row=sessions.rows.find(r=>r[sessions.rows[0].indexOf('Token_Hash')]===s.master.tokenHash);row[sessions.rows[0].indexOf('Criado_Em')]=new Date(Date.now()-301000).toISOString();assert.equal((await s.emailHttp('start',p)).status,401);assert.equal((await s.emailHttp('state')).status,200);
});

test('commit pointer failures cannot expose a partially committed change or leave duplicate recovery effects',async()=>{
 for(const stage of ['begin','clear'])for(const after of [false,true]){
  const s=emailChangeFixture(),p=s.emailCommand();await s.emailHttp('start',p);const code=s.emailCode(),properties=s.gas.context.PropertiesService.getScriptProperties;let once=true;
  s.gas.context.PropertiesService.getScriptProperties=()=>{const props=properties();return {...props,setProperty:(key,value)=>{if(once&&key==='IDENTITY_EMAIL_PENDING'&&(value===''?'clear':'begin')===stage){once=false;if(after)props.setProperty(key,value);throw Error('INJECTED_POINTER');}return props.setProperty(key,value);}};};
  assert.notEqual((await s.emailHttp('confirm',{commandId:p.commandId,code})).status,200);assert.ok(await s.client.readSession(s.master.tokenHash));assert.equal(s.gas.props.IDENTITY_EMAIL_PENDING||'','');
  assert.equal((await s.emailHttp('confirm',{commandId:p.commandId,code})).status,200);assert.equal(s.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r[0]===p.commandId).length,1);
 }
});

test('email delivery accepts exactly one mailbox and rejects header/list injection and invalid local/domain parts',async()=>{
 const s=emailChangeFixture();for(const email of ['a,b@example.invalid','a;b@example.invalid','Pessoa <a@example.invalid>','a@example.invalid\r\nBcc: outra@example.invalid','.a@example.invalid','a..b@example.invalid','a@-example.invalid','a@example..invalid','a'.repeat(65)+'@example.invalid'])assert.equal((await s.emailHttp('start',s.emailCommand({email}))).status,400,email);
 assert.equal(s.gas.outbox.length,0);assert.equal((await s.emailHttp('start',s.emailCommand({email:'novo+teste@sub.example.invalid'}))).status,202);assert.equal(s.gas.outbox.at(-1).to,'novo+teste@sub.example.invalid');
});
