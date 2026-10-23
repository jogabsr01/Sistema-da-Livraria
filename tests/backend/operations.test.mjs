import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { operationsFixture } from '../helpers/operations-fixture.mjs';
import { validateOperationData } from '../../backend/operations-model.mjs';
import { createOperationsHandler,loadOperationsSettings } from '../../backend/operations-handler.mjs';
import { environment } from './fixtures.mjs';
const body=async r=>({status:r.status,...await r.json()});
const sale=(id,extra={})=>({idempotencyKey:randomUUID(),customerId:null,items:[{productId:id,quantity:1}],paymentMethod:'PIX',expectedTotalCents:3290,...extra});
const stock=async(s,id)=>(await s.client.catalog('get',s.master.actor,{id})).product;

test('admin adjustments preserve book identity, version and nonnegative balance across sales, metadata and replenishment',async()=>{
 const s=operationsFixture(),id=await s.product(3),adjust={commandId:randomUUID(),id,expectedVersion:2,newStock:1,reason:'Contagem física conferida'};
 const a=await body(await s.operationsHttp('adjust',adjust));assert.equal(a.status,200);assert.equal(a.data.stockAfter,1);assert.deepEqual((await body(await s.operationsHttp('adjust',adjust))).data,a.data);
 const committed=await body(await s.saleHttp(sale(id)));assert.equal(committed.status,200);assert.equal((await stock(s,id)).stock,0);
 const b={...adjust,commandId:randomUUID(),expectedVersion:4,newStock:5};assert.equal((await s.operationsHttp('adjust',b)).status,200);
 const p=await stock(s,id),record=Object.fromEntries(['isbn','internalCode','title','author','publisher','edition','supplier','priceCents','minimumStock','category','coverUrl','year','pages','synopsis','nicheIds','active'].map(k=>[k,p[k]]));record.title='Título após ajuste';await s.client.catalog('save',s.master.actor,{commandId:randomUUID(),id,expectedVersion:p.version,record});s.gas.call('recoverDevelopmentSales');assert.equal((await stock(s,id)).title,record.title);
 assert.equal((await s.operationsHttp('adjust',{...b,commandId:randomUUID()})).status,409);
 for(const newStock of [-1,1.5,1000001])assert.equal((await s.operationsHttp('adjust',{...b,commandId:randomUUID(),newStock})).status,400);
});

test('reversal restores exact quantities once, preserves sale/items/audit and reports current cancellation on cashier retries',async()=>{
 const s=operationsFixture(),id=await s.product(2),command=sale(id);await s.saleHttp(command);const reverse={commandId:randomUUID(),saleId:command.idempotencyKey,reason:'Compra cancelada e unidades conferidas'};
 const a=await body(await s.operationsHttp('reverse',reverse));assert.equal(a.status,200);assert.equal(a.data.totalCents,3290);assert.equal((await stock(s,id)).stock,2);assert.equal((await s.operationsHttp('reverse',reverse)).status,200);
 assert.equal((await s.operationsHttp('reverse',{...reverse,commandId:randomUUID()})).status,409);assert.equal((await s.operationsHttp('reverse',{...reverse,reason:'Outro motivo'})).status,409);
 const current=(await body(await s.saleHttp(command))).data;assert.equal(current.state,'CANCELADA');assert.equal((await stock(s,id)).stock,2);
 const read=await body(await s.operationsHttp('get',{id:command.idempotencyKey}));assert.equal(read.data.sale.state,'CANCELADA');assert.equal(read.data.sale.items[0].title,'Livro fictício');assert.equal(s.main.getSheetByName('Vendas').getLastRow(),2);assert.equal(s.main.getSheetByName('Itens_Venda').getLastRow(),2);
 const logs=s.main.getSheetByName('Logs_Auditoria');assert.equal(logs.rows.filter(r=>r[0]===reverse.commandId).length,1);assert.equal(logs.rows.filter(r=>r[0]===command.idempotencyKey).length,1);
});

test('every interrupted reversal projection replays safely, including status, two product rows and disabled operation flag',async()=>{
 for(const name of ['_Eventos_Dominio','Vendas','Movimentacoes_Estoque','Logs_Auditoria','Produtos','Clientes'])for(const after of [false,true]){
  const s=operationsFixture(),c=s.command();await s.customerHttp('save',c);const ids=[await s.product(2),await s.product(2)],command=sale(ids[0],{customerId:c.id,items:ids.map(productId=>({productId,quantity:1})),expectedTotalCents:6580});await s.saleHttp(command);
  const reverse={commandId:randomUUID(),saleId:command.idempotencyKey,reason:'Estorno de teste'},sheet=s.main.getSheetByName(name);let once=true;
  if(['Produtos','Vendas','Clientes'].includes(name)){const get=sheet.getRange.bind(sheet);sheet.getRange=(...args)=>{const range=get(...args),set=range.setValues;range.setValues=values=>{if(!once)return set(values);once=false;if(after)set(values);throw Error('INJECTED');};return range;};}
  else{const append=sheet.appendRow.bind(sheet);sheet.appendRow=values=>{if(!once)return append(values);once=false;if(after)append(values);throw Error('INJECTED');};}
  assert.notEqual((await s.operationsHttp('reverse',reverse)).status,200,name+after);
  if(name==='_Eventos_Dominio'&&!after)assert.equal((await s.operationsHttp('reverse',reverse)).status,200);
  s.gas.props.OPERATIONS_ENABLED='false';for(const id of ids)assert.equal((await stock(s,id)).stock,2,name+after);s.gas.props.OPERATIONS_ENABLED='true';assert.equal((await s.operationsHttp('reverse',reverse)).status,200,name+after);
  const customer=(await body(await s.customerHttp('get',{id:c.id}))).data.customer;assert.equal(customer.lastPurchase,'');
 }
});

test('attendant sees only own sales and cannot forge administrative adjustments or read another operator receipt',async()=>{
 const s=operationsFixture();
 const staff={commandId:randomUUID(),id:randomUUID(),expectedRevision:0,role:'ATENDENTE',status:'ATIVO',contact:{name:'Operador fictício',cpf:'11144477735',email:'worker@example.invalid',phone:''},reason:'Teste'};
 await s.http('save',staff);const worker=s.session(staff.id),id=await s.product(3),own=sale(id),other=sale(id);await s.saleHttp(own,worker);await s.saleHttp(other);
 const list=(await body(await s.operationsHttp('list',s.period(),worker))).data;assert.equal(list.total,1);assert.equal(list.sales[0].saleId,own.idempotencyKey);assert.equal((await s.operationsHttp('get',{id:other.idempotencyKey},worker)).status,404);
 assert.equal((await s.operationsHttp('reverse',{commandId:randomUUID(),saleId:own.idempotencyKey,reason:'Teste'},worker)).status,403);
 await assert.rejects(s.client.operations('adjust',worker.actor,{commandId:randomUUID(),id,expectedVersion:4,newStock:5,reason:'Teste'}),{code:'WORKSPACE_FORBIDDEN'});
});

test('concurrent cancellation commands restore only once and revoked, stale or cross-origin administrative sessions cannot mutate',async()=>{
 const s=operationsFixture(),id=await s.product(1),command=sale(id);await s.saleHttp(command);const p={commandId:randomUUID(),saleId:command.idempotencyKey,reason:'Teste concorrente'};
 for(const headers of [{origin:'https://evil.invalid'},{'x-csrf-token':''},{'content-type':'text/plain'}])assert.equal((await s.operationsHttp('reverse',p,undefined,headers)).status,403);
 const results=await Promise.all([s.operationsHttp('reverse',p),s.operationsHttp('reverse',{...p,commandId:randomUUID()})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await stock(s,id)).stock,1);
 const sessions=s.main.getSheetByName('Sessoes'),entry=sessions.rows.find(r=>r[sessions.rows[0].indexOf('Token_Hash')]===s.master.tokenHash);entry[sessions.rows[0].indexOf('Criado_Em')]=new Date(Date.now()-301000).toISOString();assert.equal((await s.operationsHttp('list',s.period())).status,401);
});

test('corrupted reversal quantities, value, original sale or stock chain block all projections before writes',async()=>{
 for(const kind of ['quantity','value','sale','version']){
  const s=operationsFixture(),id=await s.product(2),command=sale(id);await s.saleHttp(command);await s.operationsHttp('reverse',{commandId:randomUUID(),saleId:command.idempotencyKey,reason:'Teste'});
  const table=s.main.getSheetByName('_Eventos_Dominio'),cols=table.rows[0],row=table.rows.at(-1),event=JSON.parse(row[cols.indexOf('Conteudo_JSON')]);
  if(kind==='quantity')event.lines[0].after++;if(kind==='value')event.receipt.totalCents++;if(kind==='sale')event.command.saleId=randomUUID();if(kind==='version')event.lines[0].expectedVersion++;
  row[cols.indexOf('Conteudo_JSON')]=JSON.stringify(event);const before=s.gas.writes;assert.throws(()=>s.gas.call('recoverDevelopmentSales'),/JOURNAL_INVALID|PROJECTION_CONFLICT/);assert.equal(s.gas.writes,before);
 }
});

test('operational APIs are closed by default, limit query periods and validate upstream receipt totals',async()=>{
 assert.throws(()=>loadOperationsSettings(environment()),{code:'OPERATIONS_NOT_ACTIVATED'});assert.equal((await createOperationsHandler()(new Request('https://dev--merry-chimera-49a1f3.netlify.app/api/v1/operations/list'))).status,503);
 const s=operationsFixture();assert.equal((await s.operationsHttp('list',{from:'2020-01-01T00:00:00.000Z',to:'2026-01-01T00:00:00.000Z',offset:0})).status,400);
 const id=await s.product(1),command=sale(id);await s.saleHttp(command);const data=(await body(await s.operationsHttp('get',{id:command.idempotencyKey}))).data;data.sale.items[0].subtotalCents++;assert.throws(()=>validateOperationData('get',data,{id:command.idempotencyKey}),{code:'UPSTREAM_UNTRUSTED'});
 s.gas.props.OPERATIONS_ENABLED='false';await assert.rejects(s.client.operations('get',s.master.actor,{id:command.idempotencyKey}),{code:'WORKSPACE_OPERATIONS_UNAVAILABLE'});
});


test('negative stock correction survives interruption at journal, movement, audit and stock row boundaries',async()=>{
 for(const name of ['_Eventos_Dominio','Movimentacoes_Estoque','Logs_Auditoria','Produtos'])for(const after of [false,true]){
  const s=operationsFixture(),id=await s.product(4),p={commandId:randomUUID(),id,expectedVersion:2,newStock:0,reason:'Conferência de teste'},sheet=s.main.getSheetByName(name);let once=true;
  if(name==='Produtos'){const get=sheet.getRange.bind(sheet);sheet.getRange=(...args)=>{const range=get(...args),set=range.setValues;range.setValues=values=>{if(!once)return set(values);once=false;if(after)set(values);throw Error('INJECTED');};return range;};}
  else{const append=sheet.appendRow.bind(sheet);sheet.appendRow=values=>{if(!once)return append(values);once=false;if(after)append(values);throw Error('INJECTED');};}
  assert.notEqual((await s.operationsHttp('adjust',p)).status,200);assert.equal((await s.operationsHttp('adjust',p)).status,200);assert.equal((await stock(s,id)).stock,0);assert.equal(s.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r[0]===p.commandId).length,1);
 }
});

test('receipts retain original title and value after catalog edits, and cancellation keeps the book inactive',async()=>{
 const s=operationsFixture(),id=await s.product(2),command=sale(id);await s.saleHttp(command);const p=await stock(s,id),record=Object.fromEntries(['isbn','internalCode','title','author','publisher','edition','supplier','priceCents','minimumStock','category','coverUrl','year','pages','synopsis','nicheIds','active'].map(k=>[k,p[k]]));record.title='Novo título';record.priceCents=9999;record.active=false;
 await s.client.catalog('save',s.master.actor,{commandId:randomUUID(),id,expectedVersion:p.version,record});await s.operationsHttp('reverse',{commandId:randomUUID(),saleId:command.idempotencyKey,reason:'Unidade devolvida'});
 const receipt=(await body(await s.operationsHttp('get',{id:command.idempotencyKey}))).data.sale;assert.equal(receipt.totalCents,3290);assert.equal(receipt.items[0].title,'Livro fictício');assert.equal((await stock(s,id)).active,false);assert.equal((await stock(s,id)).stock,2);
});
