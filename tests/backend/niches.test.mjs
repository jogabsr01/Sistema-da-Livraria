import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { nicheFixture } from '../helpers/niche-fixture.mjs';
import { loadNicheSettings } from '../../backend/niche-handler.mjs';
import { environment } from './fixtures.mjs';
const data=async r=>(await r.json()).data;

test('administrative create/edit/deactivate preserves niche ID, linked books and inactive associations while denying new inactive assignments',async()=>{
 const s=nicheFixture(),p=s.nicheCommand();assert.equal((await s.nicheHttp('save',p)).status,200);const books=s.command({record:{nicheIds:[p.id]}});await s.client.catalog('save',s.admin.actor,books);
 const updated={...p,commandId:randomUUID(),expectedRevision:1,record:{...p.record,name:'Crescimento cristão',active:false}};assert.equal((await s.nicheHttp('save',updated)).status,200);assert.equal(s.main.getSheetByName('Produto_Nichos').rows[1][1],p.id);
 const keep={...books,commandId:randomUUID(),expectedVersion:1,record:{...books.record,title:'Edição preservada'}};assert.equal((await s.client.catalog('save',s.admin.actor,keep)).version,2);
 await assert.rejects(s.client.catalog('save',s.admin.actor,s.command({record:{nicheIds:[p.id]}})),{code:'WORKSPACE_CATALOG_INVALID'});
 const list=(await data(await s.nicheHttp('list'))).niches.find(n=>n.id===p.id);assert.equal(list.active,false);assert.equal(list.productCount,1);assert.equal(list.version,2);assert.equal(s.main.getSheetByName('Nichos').getLastRow(),3);
});

test('idempotent saves, actor binding, duplicate normalized names and stale revisions do not overwrite or duplicate audit',async()=>{
 const s=nicheFixture(),p=s.nicheCommand();await s.nicheHttp('save',p);assert.equal((await s.nicheHttp('save',p)).status,200);assert.equal((await s.nicheHttp('save',{...p,record:{...p.record,name:'Outro'}})).status,409);assert.equal((await s.nicheHttp('save',p,s.session('ADMIN'))).status,409);
 assert.equal((await s.nicheHttp('save',s.nicheCommand({record:{...p.record,name:'VIDA CRISTA'}}))).status,409);assert.equal((await s.nicheHttp('save',{...p,commandId:randomUUID(),record:{...p.record,order:3}})).status,409);
 assert.equal(s.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r[0]===p.commandId).length,1);
});

test('all interrupted niche projections recover before reads even when the feature is disabled',async()=>{
 for(const stage of ['intent','niche','revision','audit','marker'])for(const after of [false,true]){const s=nicheFixture(),p=s.nicheCommand(),save=s.gas.context.accessSaveMain_;let once=true;s.gas.context.accessSaveMain_=(t,r)=>{const target=t.sheet.name==='Nichos'?'niche':t.sheet.name==='Logs_Auditoria'?'audit':r.Chave?.startsWith('niche.revision.')?'revision':r.Chave?.startsWith('niche.command.')?JSON.parse(r.Valor).state==='PENDING'?'intent':'marker':'';if(!once||target!==stage)return save(t,r);once=false;if(after)save(t,r);throw Error('INJECTED_NICHE');};assert.notEqual((await s.nicheHttp('save',p)).status,200);if(stage==='intent'&&!after)assert.equal((await s.nicheHttp('save',p)).status,200);s.gas.props.NICHES_ENABLED='false';await s.client.readSession(s.admin.tokenHash);s.gas.props.NICHES_ENABLED='true';assert.equal((await s.nicheHttp('save',p)).status,200);assert.equal(s.main.getSheetByName('Nichos').rows.filter(r=>r[0]===p.id).length,1);assert.equal(s.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r[0]===p.commandId).length,1);}
});

test('private sanitized background is bound to niche, shared to authenticated readers and removal preserves originals',async()=>{
 const s=nicheFixture(),p=s.nicheCommand();p.image=(await sharp({create:{width:800,height:400,channels:3,background:'#417c58'}}).jpeg().toBuffer()).toString('base64');assert.equal((await s.nicheHttp('save',p)).status,200);assert.equal((await s.nicheHttp('save',p)).status,200);const list=(await data(await s.nicheHttp('list'))).niches,n=list.find(n=>n.id===p.id);assert.ok(n.imageUrl);const image=await s.nicheHttp('image?id='+p.id,null,s.session());assert.equal(image.status,200);const meta=await sharp(Buffer.from(await image.arrayBuffer())).metadata();assert.equal(meta.width,768);assert.equal(meta.height,384);assert.equal(meta.exif,undefined);
 const files=[...s.gas.resources.values()].filter(r=>r.kind==='image');assert.equal(files.length,1);files[0].sharing='public';assert.equal((await s.nicheHttp('image?id='+p.id)).status,503);files[0].sharing='private';
 const metadata={...p,commandId:randomUUID(),expectedRevision:1};delete metadata.image;assert.equal((await s.nicheHttp('save',metadata)).status,200);assert.equal([...s.gas.resources.values()].filter(r=>r.kind==='image').length,1);
 const other=s.nicheCommand({record:{...p.record,name:'Teologia'}});assert.equal((await s.nicheHttp('save',other)).status,200);const table=s.main.getSheetByName('Nichos'),row=table.rows.find(r=>r[0]===other.id),column=table.rows[0].indexOf('Imagem_Drive_ID');row[column]=files[0].id;assert.equal((await s.nicheHttp('image?id='+other.id)).status,503);row[column]='';
 const update={...p,commandId:randomUUID(),expectedRevision:2,image:null};assert.equal((await s.nicheHttp('save',update)).status,200);assert.equal((await s.nicheHttp('image?id='+p.id)).status,404);assert.equal(files.length,1);
});

test('role, recent strong authentication, exact CSRF/origin/input and independent default-off flags protect niche writes',async()=>{
 assert.throws(()=>loadNicheSettings(environment()),{code:'NICHES_NOT_ACTIVATED'});const s=nicheFixture(),p=s.nicheCommand();assert.equal((await s.nicheHttp('save',p,s.session())).status,403);assert.equal((await s.nicheHttp('list',null,s.session())).status,403);
 for(const h of [{origin:'https://evil.invalid'},{'x-csrf-token':''},{'content-type':'text/plain'}])assert.equal((await s.nicheHttp('save',p,undefined,h)).status,403);
 for(const k of ['role','stock','createdBy'])assert.equal((await s.nicheHttp('save',{...p,[k]:'forged'})).status,400);assert.equal((await s.nicheHttp('save',{...p,record:{...p.record,color:'url(evil)'}})).status,400);assert.equal((await s.nicheHttp('save',{...p,image:'a'.repeat(100001)})).status,413);
 const t=s.main.getSheetByName('Sessoes'),r=t.rows.find(r=>r[t.rows[0].indexOf('Token_Hash')]===s.admin.tokenHash);r[t.rows[0].indexOf('Criado_Em')]=new Date(Date.now()-301000).toISOString();assert.equal((await s.nicheHttp('save',p)).status,401);
});
