import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { catalogFixture, injectCatalogFault, CATALOG_ORIGIN } from '../helpers/catalog-fixture.mjs';
import { normalizeProduct, normalizedIsbn } from '../../backend/catalog-model.mjs';
import { loadCatalogSettings, createCatalogHandler } from '../../backend/catalog-handler.mjs';
const list = { search:'',offset:0,nicheId:'',includeInactive:false };

test('test workers refuse external network calls even when the build has real service configuration',async()=>{
  await assert.rejects(fetch('https://example.com/'),/TEST_EXTERNAL_NETWORK_FORBIDDEN/);
});

test('catalog setup is private, idempotent, backs up before initialization and preserves the seventeen business schemas',()=>{
  const s = catalogFixture(), before = s.gas.backupCount;
  assert.equal(s.gas.call('provisionDevelopmentCatalog').prepared,true); assert.equal(s.gas.backupCount,before);
  assert.equal(s.main.tables.size,17); assert.equal(s.main.getSheetByName('Nichos').getLastRow(),2);
  assert.equal(s.journal.getLastRow(),1); s.gas.owner='other@example.invalid'; assert.throws(()=>s.gas.call('provisionDevelopmentCatalog'),/FORBIDDEN/);
});
test('signed create/detail/list persists metadata, cover URL, niche, cents, zero stock and one audit record',async()=>{
  const s=catalogFixture(),actor=s.session(),command=s.command({record:{coverUrl:'https://covers.example.org/test.png'}});
  assert.equal((await s.http(actor,'save',command)).status,200);
  const detail=(await s.client.catalog('get',actor.actor,{id:command.id})).product;
  assert.equal(detail.coverUrl,command.record.coverUrl); assert.equal(detail.title,command.record.title); assert.equal(detail.stock,0); assert.equal(detail.priceCents,3290); assert.equal(detail.version,1);
  assert.equal((await s.client.catalog('list',actor.actor,list)).total,1); assert.equal(s.main.getSheetByName('Logs_Auditoria').getLastRow(),2);
  assert.equal(s.journal.rows[1][s.journal.rows[0].indexOf('State')],'COMPLETE');
});
test('ISBN-10 and formatted ISBN normalize to the same real edition; invalid ISBNs and unsafe URLs are refused',()=>{
  assert.equal(normalizedIsbn('85-359-0277-5'),'9788535902778'); assert.equal(normalizedIsbn('978-85-433-0393-2'),'9788543303932');
  const s=catalogFixture(),base=s.command();
  for(const record of [{isbn:'9788543303933'},{priceCents:32.9},{stock:999},{role:'SUPER_ADMIN'},{title:'=IMPORTXML("https://evil")'},{nicheIds:[]},...['http://covers.example.org/a','https://localhost/a','https://127.0.0.1/a','https://a.local./a','https://user:pass@covers.example.org/a','data:image/png;base64,x'].map(coverUrl=>({coverUrl}))]) assert.throws(()=>normalizeProduct({...base.record,...record},base.id));
});
test('manual no-barcode books receive stable internal identifiers without a fabricated ISBN',async()=>{
  const s=catalogFixture(),actor=s.session(),c=s.command({record:{isbn:''}}); await s.client.catalog('save',actor.actor,c);
  const p=(await s.client.catalog('get',actor.actor,{id:c.id})).product; assert.equal(p.isbn,''); assert.match(p.internalCode,/^INT[A-Z0-9]{12}$/);
});
test('idempotency survives lost acknowledgements, rejects conflicting reuse/another actor, and never rolls back a newer edit',async()=>{
  const s=catalogFixture(),a=s.session(),b=s.session(),c=s.command(); await s.client.catalog('save',a.actor,c); await s.client.catalog('save',a.actor,c);
  const edit=s.command({id:c.id,expectedVersion:1,record:{title:'Versão mais recente'}}); await s.client.catalog('save',a.actor,edit);
  assert.equal((await s.client.catalog('save',a.actor,c)).version,1); assert.equal((await s.client.catalog('get',a.actor,{id:c.id})).product.title,'Versão mais recente');
  await assert.rejects(s.client.catalog('save',b.actor,c),{code:'WORKSPACE_CATALOG_CONFLICT'});
  await assert.rejects(s.client.catalog('save',a.actor,{...c,record:{...c.record,title:'Reuso diferente'}}),{code:'WORKSPACE_CATALOG_CONFLICT'});
  assert.equal(s.main.getSheetByName('Produtos').getLastRow(),2); assert.equal(s.journal.getLastRow(),3);
});
test('two independent sessions editing one revision yield one success and one conflict, without overwriting stock',async()=>{
  const s=catalogFixture(),a=s.session(),b=s.session(),c=s.command(); await s.client.catalog('save',a.actor,c);
  const results=await Promise.allSettled([s.client.catalog('save',a.actor,s.command({id:c.id,expectedVersion:1,record:{title:'Edição A'}})),s.client.catalog('save',b.actor,s.command({id:c.id,expectedVersion:1,record:{title:'Edição B'}}))]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1); assert.equal(results.find(x=>x.status==='rejected').reason.code,'WORKSPACE_CATALOG_CONFLICT');
  const p=(await s.client.catalog('get',a.actor,{id:c.id})).product; assert.equal(p.version,2); assert.equal(p.stock,0);
});
test('duplicate active ISBN is rejected before journal writes, inactive books are excluded unless requested',async()=>{
  const s=catalogFixture(),a=s.session(),c=s.command(); await s.client.catalog('save',a.actor,c); const before=s.journal.getLastRow();
  await assert.rejects(s.client.catalog('save',a.actor,s.command()),{code:'WORKSPACE_CATALOG_DUPLICATE'}); assert.equal(s.journal.getLastRow(),before);
  await s.client.catalog('save',s.session('ADMIN').actor,s.command({id:c.id,expectedVersion:1,record:{active:false}}));
  assert.equal((await s.client.catalog('list',a.actor,list)).total,0); assert.equal((await s.client.catalog('list',a.actor,{...list,includeInactive:true})).total,1);
});
test('failures before/after intent, product, relation, audit and receipt recover exactly one product/link/audit',async()=>{
  for(const stage of ['intent','product','link','audit','marker'])for(const after of [false,true]){
    const s=catalogFixture(),a=s.session(),c=s.command(); injectCatalogFault(s,stage,after);
    await assert.rejects(s.client.catalog('save',a.actor,c),{code:'UPSTREAM_UNAVAILABLE'});
    const done=await s.client.catalog('save',a.actor,c); assert.equal(done.version,1,stage);
    assert.equal((await s.client.catalog('list',a.actor,list)).total,1); assert.equal(s.main.getSheetByName('Produto_Nichos').getLastRow(),2); assert.equal(s.main.getSheetByName('Logs_Auditoria').getLastRow(),2);
  }
});
test('relationships change without clearing another product links and survive interrupted removals/additions',async()=>{
  const s=catalogFixture(),a=s.session(),first=s.command(),second=s.command({record:{isbn:''}}); await s.client.catalog('save',a.actor,first); await s.client.catalog('save',a.actor,second);
  const niches=s.main.getSheetByName('Nichos'),id=randomUUID(),row={ID_Nicho:id,Nome:'Outro nicho de teste',Cor_Destaque:'#205b43',Ordem_Exibicao:1,Ativo:true}; niches.appendRow(niches.rows[0].map(key=>row[key]??''));
  const edit=s.command({id:first.id,expectedVersion:1,record:{nicheIds:[id]}}); injectCatalogFault(s,'link',true); await assert.rejects(s.client.catalog('save',a.actor,edit));
  await s.client.catalog('save',a.actor,edit); assert.deepEqual((await s.client.catalog('get',a.actor,{id:first.id})).product.nicheIds,[id]);
  assert.deepEqual((await s.client.catalog('get',a.actor,{id:second.id})).product.nicheIds,second.record.nicheIds);
});
test('unknown or inactive niche, stale version and stock/sale journal conflicts are rejected before intent',async()=>{
  const s=catalogFixture(),a=s.session(),c=s.command();
  await assert.rejects(s.client.catalog('save',a.actor,s.command({record:{nicheIds:[randomUUID()]}})),{code:'WORKSPACE_CATALOG_INVALID'});
  await s.client.catalog('save',a.actor,c);
  const niches=s.main.getSheetByName('Nichos');niches.rows[1][niches.rows[0].indexOf('Ativo')]=false;
  await assert.rejects(s.client.catalog('save',a.actor,s.command()),{code:'WORKSPACE_CATALOG_INVALID'});niches.rows[1][niches.rows[0].indexOf('Ativo')]=true;
  const journal=s.main.getSheetByName('_Eventos_Dominio'),data={Tipo:'SALE_COMMITTED',Conteudo_JSON:JSON.stringify({lines:[{productId:c.id}]})}; journal.appendRow(journal.rows[0].map(key=>data[key]??''));
  await assert.rejects(s.client.catalog('save',a.actor,s.command({id:c.id,expectedVersion:1})),{code:'WORKSPACE_JOURNAL_INVALID'}); assert.equal(s.journal.getLastRow(),2);
});
test('persistent session is rechecked inside the Google write lock; revocation, epoch, disabled user and weak admin deny writes',async()=>{
  for(const mode of ['revoked','epoch','disabled','weak']){
    const s=catalogFixture(),a=s.session(mode==='weak'?'ADMIN':'ATENDENTE'),c=s.command();
    if(mode==='revoked'){const t=s.main.getSheetByName('Sessoes');t.rows.at(-1)[t.rows[0].indexOf('Revogado_Em')]=new Date().toISOString();}
    if(mode==='epoch'){const t=s.main.getSheetByName('Configuracoes');t.rows.at(-1)[t.rows[0].indexOf('Valor')]=2;}
    if(mode==='disabled'){const t=s.main.getSheetByName('Usuarios');t.rows.at(-1)[t.rows[0].indexOf('Status')]='INATIVO';}
    if(mode==='weak'){const t=s.main.getSheetByName('Sessoes');t.rows.at(-1)[t.rows[0].indexOf('Nivel_Autenticacao')]='pin';}
    await assert.rejects(s.client.catalog('save',a.actor,c),{code:'UNAUTHENTICATED'}); assert.equal(s.journal.getLastRow(),1);
  }
});
test('HTTP denies missing CSRF/cross-origin, forged identity/stock fields, oversized input and production; gates default closed',async()=>{
  const s=catalogFixture(),a=s.session(),c=s.command();
  for(const headers of [{'x-csrf-token':'wrong'},{origin:'https://evil.invalid'},{'content-type':'text/plain'}]) assert.equal((await s.http(a,'save',c,headers)).status,403);
  assert.equal((await s.http(a,'save',{...c,actor:{role:'SUPER_ADMIN'}})).status,400); assert.equal((await s.http(a,'save',{...c,record:{...c.record,stock:10}})).status,400);
  assert.equal((await s.http(a,'save',{...c,record:{...c.record,title:'x'.repeat(40001)}})).status,413);
  const handler=createCatalogHandler(); assert.equal((await handler(new Request(CATALOG_ORIGIN+'/api/v1/catalog/list'))).status,503);
  assert.equal((await s.handler(new Request('https://merry-chimera-49a1f3.netlify.app/api/v1/catalog/list',{headers:{cookie:a.cookie}}))).status,403);
  assert.throws(()=>loadCatalogSettings({...s.env,WORKSPACE_CATALOG_ENABLED:'false'}),{code:'CATALOG_NOT_ACTIVATED'});
  s.gas.props.CATALOG_ENABLED='false'; await assert.rejects(s.client.catalog('save',a.actor,c),{code:'WORKSPACE_CATALOG_UNAVAILABLE'});
});
test('corrupt pending journal content fails before projection instead of trusting a changed after snapshot',async()=>{
  const s=catalogFixture(),a=s.session(),c=s.command(); injectCatalogFault(s,'product',false); await assert.rejects(s.client.catalog('save',a.actor,c));
  const col=s.journal.rows[0].indexOf('After_JSON'),snap=JSON.parse(s.journal.rows[1][col]); snap.values[s.main.getSheetByName('Produtos').rows[0].indexOf('Preco_Venda')]=1;s.journal.rows[1][col]=JSON.stringify(snap);
  await assert.rejects(s.client.catalog('list',a.actor,list),{code:'WORKSPACE_CATALOG_UNAVAILABLE'});assert.equal(s.main.getSheetByName('Produtos').getLastRow(),1);
});
test('server search and stable pagination expose ten products at a time, without journal or identity fields',async()=>{
  const s=catalogFixture(),a=s.session();
  for(let i=0;i<12;i++)await s.client.catalog('save',a.actor,s.command({record:{isbn:'',title:'Livro '+String(i).padStart(2,'0'),author:i===11?'Autor de fé':'Autor fictício'}}));
  const first=await s.client.catalog('list',a.actor,list),second=await s.client.catalog('list',a.actor,{...list,offset:first.nextOffset});
  assert.equal(first.products.length,10);assert.equal(first.nextOffset,10);assert.equal(second.products.length,2);assert.equal(second.nextOffset,null);
  assert.equal(new Set([...first.products,...second.products].map(p=>p.id)).size,12);
  assert.equal((await s.client.catalog('list',a.actor,{...list,search:'Autor de fe'})).total,1);
  const serialized=JSON.stringify(first);for(const field of ['Token_Hash','Criado_Por','Record_Hash',a.tokenHash])assert.ok(!serialized.includes(field));
});
test('a revocation between Node authorization and the signed Google operation prevents the write',async()=>{
  const s=catalogFixture(),a=s.session(),command=s.command();
  const current=await s.sessionService.current(new Request(CATALOG_ORIGIN+'/api/v1/session',{headers:{cookie:a.cookie}}));
  const client={...s.client,catalog:(...args)=>{const sessions=s.main.getSheetByName('Sessoes');sessions.rows.at(-1)[sessions.rows[0].indexOf('Revogado_Em')]=new Date().toISOString();return s.client.catalog(...args);}};
  const handler=createCatalogHandler({loadSettings:()=>s.settings,createClient:()=>client});
  const response=await handler(new Request(CATALOG_ORIGIN+'/api/v1/catalog/save',{method:'POST',headers:{cookie:a.cookie,origin:CATALOG_ORIGIN,'content-type':'application/json','x-csrf-token':current.csrfToken},body:JSON.stringify(command)}));
  assert.equal(response.status,401);assert.equal(s.journal.getLastRow(),1);
});
test('wrong private journal binding, public sharing, PROD and occupied lock refuse catalog writes',async()=>{
  for(const mode of ['binding','public','prod','lock']){
    const s=catalogFixture(),a=s.session(),c=s.command();
    if(mode==='binding')s.gas.props.CATALOG_JOURNAL_ID=s.gas.props.SPREADSHEET_ID;
    if(mode==='public')s.gas.resources.get(s.gas.props.CATALOG_JOURNAL_ID).sharing='public';
    if(mode==='prod')s.gas.props.APP_ENV='prod';
    if(mode==='lock')s.gas.locked=true;
    await assert.rejects(s.client.catalog('save',a.actor,c));assert.equal(s.journal.getLastRow(),1);assert.equal(s.main.getSheetByName('Produtos').getLastRow(),1);
  }
});
test('orphan relations fail before a product command is recorded or projected',async()=>{
  const s=catalogFixture(),a=s.session(),c=s.command();s.main.getSheetByName('Produto_Nichos').appendRow([randomUUID(),c.record.nicheIds[0]]);
  await assert.rejects(s.client.catalog('save',a.actor,c),{code:'WORKSPACE_CATALOG_UNAVAILABLE'});assert.equal(s.journal.getLastRow(),1);
});
