import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { profileFixture } from '../helpers/profile-fixture.mjs';
import { loadProfileSettings,createProfileHandler } from '../../backend/profile-handler.mjs';
import { environment } from './fixtures.mjs';
const result=async r=>({status:r.status,...await r.json()});
const photo=async()=> (await sharp({create:{width:600,height:500,channels:3,background:'#54927a'}}).jpeg().toBuffer()).toString('base64');

test('self profile returns own masked identity, allows phone changes, and never accepts role/CPF/another user fields',async()=>{
 const s=profileFixture(),c=s.command();await s.http('save',c);const worker=s.session(c.id),get=await result(await s.profileHttp('get',null,worker));assert.equal(get.data.cpfMasked,'***.982.247-**');assert.equal(get.data.cpf,undefined);
 const p={commandId:randomUUID(),expectedRevision:1,phone:'(11) 98888-7777'};assert.equal((await s.profileHttp('save',p,worker)).status,200);assert.equal((await s.profileHttp('save',p,worker)).status,200);
 const after=(await result(await s.profileHttp('get',null,worker))).data;assert.equal(after.phone,'11988887777');assert.equal(after.name,c.contact.name);assert.equal(after.email,c.contact.email);
 for(const field of ['role','cpf','email','userId'])assert.equal((await s.profileHttp('save',{...p,[field]:s.master.id},worker)).status,400);
 assert.equal((await s.profileHttp('save',{...p,displayName:'Trocar nome'},worker)).status,400);
 const stored=JSON.stringify([...s.main.tables].map(([_,t])=>t.rows));assert.ok(!stored.includes('11988887777'));assert.ok(!stored.includes(c.contact.name));
});

test('owner can set display name without changing the private delivery binding; profile revisions conflict with administrative edits',async()=>{
 const s=profileFixture(),p={commandId:randomUUID(),expectedRevision:0,phone:'11988887777',displayName:'Responsável fictício'};assert.equal((await s.profileHttp('save',p)).status,200);const owner=(await result(await s.profileHttp('get'))).data;assert.equal(owner.name,p.displayName);assert.equal(owner.email,'owner@example.invalid');assert.equal(s.gas.props.OWNER_EMAIL,'owner@example.invalid');
 assert.equal((await s.profileHttp('save',{...p,commandId:randomUUID()})).status,409);
 const c=s.command();await s.http('save',c);const worker=s.session(c.id);await s.profileHttp('save',{commandId:randomUUID(),expectedRevision:1,phone:'11988887777'},worker);assert.equal((await s.http('save',{...c,commandId:randomUUID(),expectedRevision:1})).status,409);
});

test('avatar is sanitized, private and user-bound, survives retries and can be removed without publishing or deleting originals',async()=>{
 const s=profileFixture(),p={commandId:randomUUID(),expectedRevision:0,phone:'',photo:await photo()};assert.equal((await s.profileHttp('save',p)).status,200);assert.equal((await s.profileHttp('save',p)).status,200);
 const files=[...s.gas.resources.values()].filter(r=>r.kind==='image');assert.equal(files.length,1);assert.equal(files[0].sharing,'private');assert.equal(files[0].parent,s.gas.props.PROFILES_FOLDER_ID);
 const proxy=await s.profileHttp('photo');assert.equal(proxy.status,200);assert.equal(proxy.headers.get('content-type'),'image/jpeg');const meta=await sharp(Buffer.from(await proxy.arrayBuffer())).metadata();assert.equal(meta.width,256);assert.equal(meta.height,256);assert.equal(meta.exif,undefined);
 files[0].sharing='public';assert.equal((await s.profileHttp('photo')).status,503);files[0].sharing='private';
 await s.profileHttp('save',{commandId:randomUUID(),expectedRevision:1,phone:'',photo:null});assert.equal((await s.profileHttp('photo')).status,404);assert.equal(files.length,1);
});

test('profile change repairs every interrupted projection and remains recoverable with the feature turned off',async()=>{
 for(const stage of ['intent','user','owner','revision','audit','marker'])for(const after of [false,true]){
  const s=profileFixture(),p={commandId:randomUUID(),expectedRevision:0,phone:'11988887777',displayName:'Perfil de teste',photo:await photo()},save=s.gas.context.accessSaveMain_;let once=true;
  s.gas.context.accessSaveMain_=(table,row)=>{const key=row.Chave||'',target=table.sheet.name==='Usuarios'?'user':table.sheet.name==='Logs_Auditoria'?'audit':key.startsWith('profile.owner.')?'owner':key.startsWith('staff.revision.')?'revision':key.startsWith('profile.command.')?JSON.parse(row.Valor).state==='PENDING'?'intent':'marker':'';if(!once||stage!==target)return save(table,row);once=false;if(after)save(table,row);throw Error('INJECTED_PROFILE');};
  assert.notEqual((await s.profileHttp('save',p)).status,200);if(stage==='intent'&&!after)assert.equal((await s.profileHttp('save',p)).status,200);
  s.gas.props.PROFILE_ENABLED='false';await s.client.readSession(s.master.tokenHash);s.gas.props.PROFILE_ENABLED='true';assert.equal((await s.profileHttp('save',p)).status,200,stage+after);assert.equal((await result(await s.profileHttp('get'))).data.name,p.displayName);assert.equal([...s.gas.resources.values()].filter(r=>r.kind==='image').length,1);
 }
});

test('profile requires recent strong authentication, CSRF, strict input size and independently closed defaults',async()=>{
 assert.throws(()=>loadProfileSettings(environment()),{code:'PROFILE_NOT_ACTIVATED'});assert.equal((await createProfileHandler()(new Request('https://dev--merry-chimera-49a1f3.netlify.app/api/v1/profile/get'))).status,503);
 const s=profileFixture(),p={commandId:randomUUID(),expectedRevision:0,phone:''};for(const headers of [{origin:'https://evil.invalid'},{'x-csrf-token':''},{'content-type':'text/plain'}])assert.equal((await s.profileHttp('save',p,undefined,headers)).status,403);
 assert.equal((await s.profileHttp('save',{...p,phone:'x'.repeat(100001)})).status,413);
 const sessions=s.main.getSheetByName('Sessoes'),row=sessions.rows.find(r=>r[sessions.rows[0].indexOf('Token_Hash')]===s.master.tokenHash);row[sessions.rows[0].indexOf('Criado_Em')]=new Date(Date.now()-301000).toISOString();assert.equal((await s.profileHttp('save',p)).status,401);
});
