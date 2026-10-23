import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { staffFixture } from '../helpers/staff-fixture.mjs';
import { createPersonalDataVault,loadPersonalDataSettings } from '../../backend/personal-data.mjs';
import { normalizeCpf } from '../../backend/staff-model.mjs';
import { createStaffHandler,loadStaffSettings,STAFF_ORIGIN } from '../../backend/staff-handler.mjs';
import { environment } from './fixtures.mjs';
const result=async r=>({status:r.status,...await r.json()});
const rows=s=>s.main.getSheetByName('Usuarios');
const emailCode=s=>s.gas.outbox.at(-1).body.match(/\n([A-Za-z0-9_-]{43})\n/)[1];
function hash(s){const f=s.priv.getSheetByName('_Identity_Flows');return f.rows.at(-1)[f.rows[0].indexOf('Token_Hash')];}

test('personal data uses scoped authenticated encryption, keyed indexes, fresh IVs, independent keys and valid CPF',()=>{
 const s=staffFixture(),id=randomUUID(),v={name:'Pessoa fictícia'},one=s.vault.seal('users',id,v),two=s.vault.seal('users',id,v);
 assert.notEqual(one,two);assert.deepEqual(s.vault.open('users',id,one),v);assert.ok(!one.includes(v.name));
 for(const [entity,target,sealed] of [['customers',id,one],['users',randomUUID(),one],['users',id,one.slice(0,-8)+'ABCDEFGH']])assert.throws(()=>s.vault.open(entity,target,sealed));
 const another=createPersonalDataVault({...s.settings,config:{...s.settings.config,environment:'prod'}});assert.throws(()=>another.open('users',id,one));
 assert.notEqual(s.vault.index('email','123'),s.vault.index('cpf','123'));
 for(const key of ['WORKSPACE_HMAC_SECRET','WORKSPACE_SESSION_TOKEN_KEY','WORKSPACE_PIN_PEPPER','WORKSPACE_AUTH_GUARD_KEY','WORKSPACE_PERSONAL_INDEX_KEY'])assert.throws(()=>loadPersonalDataSettings({...s.env,WORKSPACE_PERSONAL_DATA_KEY:s.env[key]}));
 assert.equal(normalizeCpf('529.982.247-25'),'52998224725');for(const cpf of ['00000000000','52998224726','123'])assert.throws(()=>normalizeCpf(cpf));
});

test('staff creation stores encrypted contact and reason, masks CPF, audits and retries exactly once without plaintext',async()=>{
 const s=staffFixture(),c=s.command(),a=await result(await s.http('save',c)),b=await result(await s.http('save',c));
 assert.equal(a.status,200);assert.deepEqual(a.data,b.data);assert.equal(rows(s).getLastRow(),3);
 const list=await result(await s.http('list'));assert.equal(list.status,200);const employee=list.data.users.find(u=>u.id===c.id);assert.equal(employee.name,c.contact.name);assert.equal(employee.cpfMasked,'***.982.247-**');assert.equal(employee.activated,false);assert.equal(employee.revision,1);assert.equal(employee.cpf,undefined);
 const persisted=JSON.stringify([...s.main.tables].map(([_,t])=>t.rows));for(const text of Object.values(c.contact).concat(c.reason))assert.ok(!persisted.includes(text));
 const logs=s.main.getSheetByName('Logs_Auditoria');assert.equal(logs.rows.filter(r=>r[0]===c.commandId).length,1);
 const changed=await result(await s.http('save',{...c,status:'INATIVO'}));assert.equal(changed.status,409);
});

test('privilege transitions resolve authoritative roles, protect owner/self and require recent strong authentication',async()=>{
 const s=staffFixture(),c=s.command({role:'ADMIN'});assert.equal((await s.http('save',c)).status,200);const admin=s.session(c.id);
 const attendant=s.command({contact:{name:'Outro teste',cpf:'11144477735',email:'outro@example.invalid',phone:''}});assert.equal((await s.http('save',attendant,admin)).status,200);
 for(const command of [{...c,commandId:randomUUID(),expectedRevision:1,role:'ATENDENTE'},{...attendant,commandId:randomUUID(),id:s.master.id},{...attendant,commandId:randomUUID(),id:c.id,expectedRevision:1}])assert.equal((await s.http('save',command,admin)).status,403);
 const worker=s.session(attendant.id);assert.equal((await s.http('list',null,worker)).status,403);
 // Direct signed GAS calls cannot trust Node's earlier authorization result.
 await assert.rejects(s.client.staff('save',worker.actor,{}),{code:'WORKSPACE_FORBIDDEN'});
 const table=s.main.getSheetByName('Sessoes'),entry=table.rows.find(r=>r[table.rows[0].indexOf('Token_Hash')]===s.master.tokenHash);entry[table.rows[0].indexOf('Criado_Em')]=new Date(Date.now()-301000).toISOString();
 assert.equal((await s.http('list')).status,401);
});

test('duplicate identity including inactive users, stale updates and reserved owner address are refused',async()=>{
 const s=staffFixture(),c=s.command();await s.http('save',c);
 for(const contact of [c.contact,{...c.contact,cpf:'11144477735'},{...c.contact,email:'different@example.invalid'},{...c.contact,cpf:'11144477735',email:'owner@example.invalid'}])assert.equal((await s.http('save',s.command({contact}))).status,409);
 assert.equal((await s.http('save',{...c,commandId:randomUUID(),contact:{...c.contact,name:'Stale'}})).status,409);
 const update={...c,commandId:randomUUID(),expectedRevision:1,status:'INATIVO',contact:{...c.contact,cpf:''}};const r=await result(await s.http('save',update));assert.equal(r.status,200);assert.equal(r.data.reenrollmentRequired,true);assert.equal((await s.http('save',update)).status,200);
});

test('every interrupted staff projection recovers once and invalidates stale sessions before a disabled user can read',async()=>{
 for(const stage of ['intent','epoch','user','revision','audit','marker'])for(const after of [false,true]){
  const s=staffFixture(),c=s.command();await s.http('save',c);const worker=s.session(c.id),update={...c,commandId:randomUUID(),expectedRevision:1,status:'INATIVO'};
  const save=s.gas.context.accessSaveMain_;let once=true;s.gas.context.accessSaveMain_=(table,row)=>{
   const target=table.sheet.name==='Usuarios'?'user':table.sheet.name==='Logs_Auditoria'?'audit':row.Chave?.startsWith('identity.version.')?'epoch':row.Chave?.startsWith('staff.revision.')?'revision':row.Chave?.startsWith('staff.command.')?JSON.parse(row.Valor).state==='PENDING'?'intent':'marker':'';
   if(!once||target!==stage)return save(table,row);once=false;if(after)save(table,row);throw Error('INJECTED');
  };
  assert.equal((await s.http('save',update)).status,502,stage+after);
  // If failure preceded the durable intent, retry it before testing revocation.
  if(stage==='intent'&&!after)assert.equal((await s.http('save',update)).status,200);
  await assert.rejects(s.client.readSession(worker.tokenHash),{code:'UNAUTHENTICATED'});
  const retry=await result(await s.http('save',update));assert.equal(retry.status,200);assert.equal(retry.data.revision,2);
  const logs=s.main.getSheetByName('Logs_Auditoria');assert.equal(logs.rows.filter(r=>r[0]===update.commandId).length,1);
 }
});

test('first access by CPF proves enrolled email and passkey, enforces PIN, and login preserves attendant role',async()=>{
 const s=staffFixture(),c=s.command();await s.http('save',c);const token=randomBytes(32).toString('base64url'),ip='192.0.2.5',service=s.accessService();
 assert.equal((await service.execute('start',{email:c.contact.cpf},token,ip)).stage,'EMAIL');assert.equal(s.gas.outbox.at(-1).to,c.contact.email);
 await assert.rejects(service.execute('email',{code:randomBytes(32).toString('base64url')},token,ip));
 await service.execute('email',{code:emailCode(s)},token,ip);await service.execute('pin',{pin:'8274'},token,ip);
 await assert.rejects(service.execute('complete',{response:null},token,ip));s.storageProof(hash(s));
 const complete=await service.execute('complete',{response:null},token,ip);assert.equal(complete.user.role,'ATENDENTE');assert.match(complete.cookie,/HttpOnly/);
 const login=randomBytes(32).toString('base64url');await assert.rejects(service.execute('login',{email:c.contact.email,pin:'1357'},login,'192.0.2.6'));
 assert.equal((await service.execute('login',{email:c.contact.email,pin:'8274'},login,'192.0.2.6')).stage,'PASSKEY');
 assert.equal(s.gas.outbox.length,1);
});

test('role change revokes old credentials and requires new email proof and enrollment; partial activation remains recoverable',async()=>{
 const s=staffFixture(),c=s.command();await s.http('save',c);const token=randomBytes(32).toString('base64url'),ip='192.0.2.6',service=s.accessService();
 await service.execute('start',{email:c.contact.email},token,ip);await service.execute('email',{code:emailCode(s)},token,ip);await service.execute('pin',{pin:'8274'},token,ip);s.storageProof(hash(s));await service.execute('complete',{response:null},token,ip);
 await s.http('save',{...c,commandId:randomUUID(),expectedRevision:1,role:'ADMIN'});
 await assert.rejects(service.execute('complete',{response:null},token,ip));
 // Age prior flow to satisfy delivery cooldown; fixture clock only.
 const flows=s.priv.getSheetByName('_Identity_Flows');for(const row of flows.rows.slice(1)){row[5]=new Date(Date.now()-70000).toISOString();row[6]=new Date(Date.parse(row[5])+600000).toISOString();}
 const next=randomBytes(32).toString('base64url');await service.execute('start',{email:c.contact.email},next,'192.0.2.7');await service.execute('email',{code:emailCode(s)},next,'192.0.2.7');await service.execute('pin',{pin:'9382'},next,'192.0.2.7');s.storageProof(hash(s));
 const done=await service.execute('complete',{response:null},next,'192.0.2.7');assert.equal(done.user.role,'ADMIN');assert.equal(s.priv.getSheetByName('_Pin_Verifiers').getLastRow(),2);
});

test('staff endpoints remain closed by default, enforce CSRF, exact origin, stream bounds and reject extra claims',async()=>{
 assert.throws(()=>loadStaffSettings(environment()),{code:'STAFF_NOT_ACTIVATED'});assert.equal((await createStaffHandler()(new Request(STAFF_ORIGIN+'/api/v1/staff/list'))).status,503);
 const s=staffFixture(),c=s.command();for(const headers of [{'x-csrf-token':''},{origin:'https://evil.invalid'},{'content-type':'text/plain'}])assert.equal((await s.http('save',c,s.master,headers)).status,403);
 assert.equal((await s.http('save',{...c,assurance:'passkey'})).status,400);assert.equal((await s.http('save',{...c,reason:'x'.repeat(6000)})).status,413);
 s.gas.props.STAFF_ENABLED='false';await assert.rejects(s.client.staff('list',s.master.actor,{offset:0}),{code:'WORKSPACE_STAFF_UNAVAILABLE'});
});
