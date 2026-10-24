import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { auditFixture } from '../helpers/audit-fixture.mjs';
import { createAuditHandler,loadAuditSettings } from '../../backend/audit-handler.mjs';
import { environment } from './fixtures.mjs';
const data=async r=>{assert.equal(r.status,200,await r.clone().text());return (await r.json()).data;};
test('audit filters intersect responsible user, operation, period, product in sale items, sale and result without changing historical rows',async()=>{
 const s=auditFixture(),product=randomUUID(),sale=randomUUID();s.addAudit({ID_Entidade:product});const hit=s.addAudit({Acao:'SALE_COMMITTED',Entidade:'Vendas',ID_Entidade:sale,Depois:JSON.stringify({totalCents:3290,paymentMethod:'PIX',items:[{productId:product,title:'Livro histórico',quantity:1,unitPriceCents:3290,subtotalCents:3290}]})});s.addAudit({Acao:'SALE_REJECTED',Entidade:'Vendas',ID_Entidade:sale,Resultado:'NEGADO'});
 const original=JSON.stringify(s.main.getSheetByName('Logs_Auditoria').rows);for(const [f,count]of [[{},3],[{employeeId:s.master.id,operation:'SALE_COMMITTED',saleId:sale,productId:product,result:'SUCESSO'},1],[{result:'NEGADO'},1],[{productId:product},2],[{productId:randomUUID()},0],[{from:'2026-10-25T03:00:00.000Z'},0]]){const out=await data(await s.auditList({...s.filters(),...f}));assert.equal(out.total,count);if(f.saleId)assert.equal(out.items[0].id,hit.ID_Log);}assert.equal(JSON.stringify(s.main.getSheetByName('Logs_Auditoria').rows),original);
});
test('closed disclosure omits PII, secrets, notes, encrypted envelopes and unknown fields but preserves safe sale lines and signals omission',async()=>{
 const s=auditFixture();s.addAudit({Antes:JSON.stringify({pin:'8274',token:'secret-marker',email:'person@example.invalid',cpf:'52998224725',contact:{name:'Private'},notes:'Private notes',version:1}),Depois:JSON.stringify({version:2,items:[{productId:randomUUID(),title:'=HYPERLINK("evil") <livro> 😀',quantity:2,token:'secret-marker'}]})});const r=await s.auditList();const text=await r.clone().text();assert.ok(!/secret-marker|52998224725|person@example|Private notes|8274/.test(text));const out=await data(r);assert.equal(out.items[0].detailsOmitted,true);assert.equal(out.items[0].after.items[0].quantity,2);assert.equal(out.people[0].name,'Conta proprietária');assert.equal(out.people[0].contact,undefined);
});
test('stable snapshot pagination refuses concurrent insert and raw historical edit instead of mixing pages or exporting unseen data',async()=>{
 const s=auditFixture();for(let i=0;i<27;i++)s.addAudit();const first=await data(await s.auditList());assert.equal(first.items.length,25);const second=await data(await s.auditList(s.filters(),25,first.snapshot));assert.equal(second.items.length,2);assert.ok(second.items.every(r=>!first.items.some(x=>x.id===r.id)));s.addAudit();assert.equal((await s.auditList(s.filters(),25,first.snapshot)).status,409);assert.equal((await s.auditHttp('export',{commandId:randomUUID(),filters:s.filters(),snapshot:first.snapshot})).status,409);
 const fresh=await data(await s.auditList());const table=s.main.getSheetByName('Logs_Auditoria');table.rows[1][table.rows[0].indexOf('Depois')]='{"version":9}';assert.equal((await s.auditHttp('export',{commandId:randomUUID(),filters:s.filters(),snapshot:fresh.snapshot})).status,409);
});
test('XLSX is a valid CRC-checked OOXML workbook with all filtered rows, detail sheet, safe literal formulas and Brazilian times; export is audited once',async()=>{
 const s=auditFixture();for(let i=0;i<27;i++)s.addAudit({Depois:JSON.stringify({items:[{productId:randomUUID(),title:'=1+1 <texto & ação> 😀',quantity:1}]})});const shown=await data(await s.auditList()),command={commandId:randomUUID(),filters:s.filters(),snapshot:shown.snapshot};const response=await s.auditHttp('export',command);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/spreadsheetml.sheet/);assert.match(response.headers.get('cache-control'),/no-store/);const bytes=Buffer.from(await response.arrayBuffer());
 const result=spawnSync('python3',['-c',`import sys,io,zipfile,xml.etree.ElementTree as E
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
for name in z.namelist(): E.fromstring(z.read(name))
import posixpath
for name in z.namelist():
 if name.endswith('.rels'):
  base='' if name=='_rels/.rels' else posixpath.dirname(posixpath.dirname(name))
  for rel in E.fromstring(z.read(name)):
   assert rel.attrib.get('TargetMode')!='External'
   assert posixpath.normpath(posixpath.join(base,rel.attrib['Target'])) in z.namelist()
for part in E.fromstring(z.read('[Content_Types].xml')):
 if part.tag.endswith('Override'): assert part.attrib['PartName'].lstrip('/') in z.namelist()
a=E.fromstring(z.read('xl/worksheets/sheet1.xml'));assert len(a.findall('m:sheetData/m:row',ns))==28
assert '24/10/2026, 09:00:00' in z.read('xl/worksheets/sheet1.xml').decode()
d=E.fromstring(z.read('xl/worksheets/sheet2.xml'));assert len(d.findall('.//m:f',ns))==0
texts=[t.text for t in d.findall('.//m:t',ns)];assert '=1+1 <texto & ação> 😀' in texts
assert all(c.attrib['t']=='inlineStr' for c in d.findall('.//m:c',ns))
assert not any('external' in name.lower() for name in z.namelist())
`],{input:bytes});assert.equal(result.status,0,result.stderr?.toString());assert.equal((await s.auditHttp('export',command)).status,200);const table=s.main.getSheetByName('Logs_Auditoria');assert.equal(table.rows.filter(r=>r[0]===command.commandId).length,1);assert.equal((await data(await s.auditList())).total,28);
});
test('export replay after lost acknowledgement or append fault repairs once, refuses actor/payload collision, and detects prefix corruption',async()=>{
 for(const after of [false,true]){const s=auditFixture();s.addAudit();const shown=await data(await s.auditList()),command={commandId:randomUUID(),filters:s.filters(),snapshot:shown.snapshot},save=s.gas.context.accessSaveMain_;let once=true;s.gas.context.accessSaveMain_=(t,r)=>{if(r.Acao!=='AUDIT_EXPORT'||!once)return save(t,r);once=false;if(after)save(t,r);throw Error('INJECTED_EXPORT');};assert.notEqual((await s.auditHttp('export',command)).status,200);s.gas.context.accessSaveMain_=save;assert.equal((await s.auditHttp('export',command)).status,200);assert.equal(s.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r[0]===command.commandId).length,1);assert.equal((await s.auditHttp('export',{...command,filters:{...s.filters(),result:'NEGADO'}})).status,409);s.addAudit({Depois:'{"version":3}'});assert.equal((await s.auditHttp('export',command)).status,200);s.main.getSheetByName('Logs_Auditoria').rows[1][9]='NEGADO';assert.equal((await s.auditHttp('export',command)).status,409);}
});
test('attendants, old assurance, revoked sessions, spoofed fields, CSRF, origin, invalid date and default-off flags fail closed at both boundaries',async()=>{
 const s=auditFixture();s.addAudit();const c=s.command();await s.http('save',c);const worker=s.session(c.id);assert.equal((await s.auditHttp('list?'+new URLSearchParams(s.filters()),null,worker)).status,403);await assert.rejects(()=>s.client.audit('list',worker.actor,{filters:s.filters(),offset:0,snapshot:''}),{status:403});
 const shown=await data(await s.auditList()),p={commandId:randomUUID(),filters:s.filters(),snapshot:shown.snapshot};for(const h of [{origin:'https://evil.invalid'},{'x-csrf-token':''},{'content-type':'text/plain'}])assert.equal((await s.auditHttp('export',p,undefined,h)).status,403);
 assert.equal((await s.auditHttp('export',{...p,role:'ADMIN'})).status,400);assert.equal((await s.auditList({...s.filters(),from:'yesterday'})).status,400);assert.equal((await s.auditHttp('list?'+new URLSearchParams({...s.filters(),offset:25}))).status,400);assert.equal((await s.auditHttp('delete',p)).status,404);assert.throws(()=>loadAuditSettings(environment()),{code:'AUDIT_NOT_ACTIVATED'});
 const sessions=s.main.getSheetByName('Sessoes'),row=sessions.rows.find(r=>r[sessions.rows[0].indexOf('Token_Hash')]===s.master.tokenHash);row[sessions.rows[0].indexOf('Criado_Em')]=new Date(Date.now()-301000).toISOString();assert.equal((await s.auditList()).status,401);
});
test('500-row export is complete beyond pagination; 501 refuses explicitly; stock system events and historic identities remain queryable',async()=>{
 const s=auditFixture();for(let i=0;i<500;i++)s.addAudit({Acao:'STOCK_ALERT_OPENED',ID_Usuario:'SYSTEM_STOCK',Perfil:'SYSTEM'});const shown=await data(await s.auditList());assert.equal(shown.total,500);assert.equal(shown.people[0].name,'Sistema de estoque');assert.equal((await s.auditHttp('export',{commandId:randomUUID(),filters:s.filters(),snapshot:shown.snapshot})).status,200);const fresh=await data(await s.auditList());assert.equal(fresh.total,501);assert.equal((await s.auditHttp('export',{commandId:randomUUID(),filters:s.filters(),snapshot:fresh.snapshot})).status,413);
 const unknown=randomUUID();s.addAudit({ID_Usuario:unknown});const filtered=await data(await s.auditList({...s.filters(),employeeId:unknown}));assert.equal(filtered.total,1);assert.match(filtered.people.find(p=>p.id===unknown).name,/Conta histórica/);
});
test('Node rejects signed but malformed, out-of-filter or secret-bearing upstream DTOs before JSON or workbook disclosure',async()=>{
 const s=auditFixture();s.addAudit();const shown=await s.client.audit('list',s.master.actor,{filters:s.filters(),offset:0,snapshot:''});for(const mutate of [d=>{d.items[0].after={pin:'secret'};},d=>{d.items[0].at='2027-01-02T12:00:00.000Z';},d=>{d.total=500;},d=>{d.items[0].actorId='unexpected';}]){const forged=structuredClone(shown);mutate(forged);const fn=createAuditHandler({loadSettings:()=>loadAuditSettings(s.env),createClient:()=>({...s.client,audit:async()=>forged})});assert.equal((await s.auditHttp('list?'+new URLSearchParams(s.filters()),null,undefined,{},fn)).status,502);}
});

test('querying a full 5000-row log stays read-only; exporting refuses exhausted audit capacity without deleting history',async()=>{
 const s=auditFixture();for(let i=0;i<5000;i++)s.addAudit({Acao:i===0?'SALE_READ':'PRODUCT_UPDATE'});const f={...s.filters(),operation:'SALE_READ'},shown=await data(await s.auditList(f));assert.equal(shown.total,1);assert.equal(shown.sourceCount,5000);assert.equal((await s.auditHttp('export',{commandId:randomUUID(),filters:f,snapshot:shown.snapshot})).status,503);assert.equal(s.main.getSheetByName('Logs_Auditoria').getLastRow(),5001);
});
test('detailed exports exceeding the field budget refuse before recording authorization and date filters respect Brazilian midnight',async()=>{
 const s=auditFixture(),id=randomUUID();s.addAudit({Data_Hora:'2026-10-24T02:59:59.999Z',ID_Entidade:id});s.addAudit({Data_Hora:'2026-10-24T03:00:00.000Z',ID_Entidade:id});const f={...s.filters(),from:'2026-10-24T03:00:00.000Z',to:'2026-10-25T02:59:59.999Z'};assert.equal((await data(await s.auditList(f))).total,1);
 const items=Array.from({length:100},()=>({productId:id,title:'Item de teste',quantity:1,unitPriceCents:100,subtotalCents:100}));for(let i=0;i<61;i++)s.addAudit({Acao:'SALE_COMMITTED',Entidade:'Vendas',Depois:JSON.stringify({items})});const shown=await data(await s.auditList()),commandId=randomUUID();assert.equal((await s.auditHttp('export',{commandId,filters:s.filters(),snapshot:shown.snapshot})).status,413);assert.equal(s.main.getSheetByName('Logs_Auditoria').rows.some(r=>r[0]===commandId),false);
});
test('actor names are decrypted only for authorized admins, raw contacts stay private, and revoked sessions cannot replay an export',async()=>{
 const s=auditFixture(),c=s.command();assert.equal((await s.http('save',c)).status,200);s.addAudit({ID_Usuario:c.id,Perfil:'ATENDENTE'});const shown=await data(await s.auditList());assert.equal(shown.people.find(p=>p.id===c.id).name,'Pessoa de teste');assert.ok(!/52998224725|pessoa@example|11999999999/.test(JSON.stringify(shown)));
 const command={commandId:randomUUID(),filters:s.filters(),snapshot:shown.snapshot};assert.equal((await s.auditHttp('export',command)).status,200);const sessions=s.main.getSheetByName('Sessoes'),row=sessions.rows.find(r=>r[sessions.rows[0].indexOf('Token_Hash')]===s.master.tokenHash);row[sessions.rows[0].indexOf('Revogado_Em')]=new Date().toISOString();assert.equal((await s.auditList()).status,401);assert.equal((await s.auditHttp('export',command)).status,401);
});
test('product filtering includes explicit stock-alert references and export command ownership remains bound after another administrator logs in',async()=>{
 const s=auditFixture(),product=randomUUID();s.addAudit({Acao:'STOCK_ALERT_OPENED',Entidade:'Notificacoes',Depois:JSON.stringify({productId:product}),ID_Usuario:'SYSTEM_STOCK',Perfil:'SYSTEM'});const f={...s.filters(),productId:product},shown=await data(await s.auditList(f));assert.equal(shown.total,1);assert.equal(shown.items[0].after.productId,product);const command={commandId:randomUUID(),filters:f,snapshot:shown.snapshot};assert.equal((await s.auditHttp('export',command)).status,200);
 const c=s.command({role:'ADMIN'});assert.equal((await s.http('save',c)).status,200);const admin=s.session(c.id);assert.equal((await s.auditHttp('export',command,admin)).status,409);assert.equal((await s.auditHttp('export',command)).status,200);
});
