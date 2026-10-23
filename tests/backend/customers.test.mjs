import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { customerFixture,CUSTOMER_ORIGIN } from '../helpers/customer-fixture.mjs';
import { createCustomerHandler,loadCustomerSettings } from '../../backend/customer-handler.mjs';
import { normalizeCustomer } from '../../backend/customer-model.mjs';
import { environment } from './fixtures.mjs';
const result=async r=>({status:r.status,...await r.json()});

test('customer contacts and consent are normalized, encrypted, looked up by valid CPF, and never returned with full CPF',async()=>{
 const s=customerFixture(),c=s.command({record:{postalCode:'05500-000',state:'sp',city:'Cidade fictícia'}});assert.equal((await s.customerHttp('save',c)).status,200);
 const out=await result(await s.customerHttp('find',{cpf:'529.982.247-25'}));assert.equal(out.status,200);assert.equal(out.data.customer.id,c.id);assert.equal(out.data.customer.cpf,undefined);assert.equal(out.data.customer.cpfMasked,'***.982.247-**');assert.equal(out.data.customer.state,'SP');assert.equal(out.data.customer.marketingConsent,false);
 const persisted=JSON.stringify([...s.main.tables].map(([_,t])=>t.rows));for(const value of ['52998224725','Cliente fictício','cliente@example.invalid','Cidade fictícia'])assert.ok(!persisted.includes(value));
 const audit=s.main.getSheetByName('Logs_Auditoria');assert.ok(audit.rows.some(r=>r[audit.rows[0].indexOf('Acao')]==='CUSTOMER_READ'));assert.equal((await result(await s.customerHttp('find',{cpf:'11144477735'}))).data.customer,null);
});

test('customer changes use a stable command, reject duplicates/stale edits/CPF changes and record consent changes',async()=>{
 const s=customerFixture(),c=s.command();await s.customerHttp('save',c);assert.equal((await s.customerHttp('save',c)).status,200);
 assert.equal((await s.customerHttp('save',s.command())).status,409);assert.equal((await s.customerHttp('save',{...c,commandId:randomUUID()})).status,409);
 const update={...c,commandId:randomUUID(),expectedRevision:1,record:{...c.record,cpf:'',contactPreference:'WHATSAPP',marketingConsent:true}};assert.equal((await s.customerHttp('save',update)).status,200);assert.equal((await s.customerHttp('save',update)).status,200);
 const data=(await result(await s.customerHttp('get',{id:c.id}))).data.customer;assert.equal(data.marketingConsent,true);assert.ok(data.consentAt);
 assert.equal((await s.customerHttp('save',{...c,commandId:randomUUID(),expectedRevision:2,record:{...c.record,cpf:'11144477735'}})).status,403);
 const revoke={...c,commandId:randomUUID(),expectedRevision:2,record:{...c.record,cpf:''}};assert.equal((await s.customerHttp('save',revoke)).status,200);assert.equal((await result(await s.customerHttp('get',{id:c.id}))).data.customer.marketingConsent,false);
 const clients=s.main.getSheetByName('Clientes');assert.equal(clients.getLastRow(),2);
});

test('interrupted customer writes recover exactly once at every projection, at every interrupted write',async()=>{
 for(const stage of ['intent','customer','revision','audit','marker'])for(const after of [false,true]){
  const s=customerFixture(),c=s.command(),save=s.gas.context.accessSaveMain_;let once=true;
  s.gas.context.accessSaveMain_=(table,row)=>{const target=table.sheet.name==='Clientes'?'customer':table.sheet.name==='Logs_Auditoria'?'audit':row.Chave?.startsWith('customer.revision.')?'revision':row.Chave?.startsWith('customer.command.')?JSON.parse(row.Valor).state==='PENDING'?'intent':'marker':'';if(!once||target!==stage)return save(table,row);once=false;if(after)save(table,row);throw Error('INJECTED');};
  assert.equal((await s.customerHttp('save',c)).status,502,stage+after);assert.equal((await s.customerHttp('save',c)).status,200,stage+after);assert.equal(s.main.getSheetByName('Clientes').getLastRow(),2);assert.equal(s.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r[0]===c.commandId).length,1);
 }
});

test('identified and anonymous sales share authoritative totals, stock and payment behavior, never leak customer contact into sales',async()=>{
 for(const paymentMethod of ['PIX','DINHEIRO','DEBITO','CREDITO']){
  const s=customerFixture(),c=s.command();await s.customerHttp('save',c);const id=await s.product(2),command={idempotencyKey:randomUUID(),customerId:c.id,paymentMethod,expectedTotalCents:3290,items:[{productId:id,quantity:1}]};
  const first=await result(await s.saleHttp(command));assert.equal(first.status,200);assert.equal(first.data.customerId,c.id);assert.deepEqual((await result(await s.saleHttp(command))).data,first.data);
  const customer=(await result(await s.customerHttp('get',{id:c.id}))).data.customer;assert.equal(customer.lastPurchase,first.data.createdAt);
  const anonymous=await result(await s.saleHttp({...command,idempotencyKey:randomUUID(),customerId:null}));assert.equal(anonymous.status,200);assert.equal(anonymous.data.customerId,null);
  const sales=s.main.getSheetByName('Vendas');assert.equal(sales.rows[1][sales.rows[0].indexOf('ID_Cliente')],c.id);assert.equal(sales.rows[2][sales.rows[0].indexOf('ID_Cliente')],'');
  const domain=JSON.stringify(s.main.getSheetByName('_Eventos_Dominio').rows);for(const value of [c.record.cpf,c.record.name,c.record.email,c.record.phone])assert.ok(!domain.includes(value));
 }
});

test('concurrent identified sales cannot consume the same last unit; invalid customer and disabled feature cannot create a sale',async()=>{
 const s=customerFixture(),c=s.command();await s.customerHttp('save',c);const id=await s.product(1),command={idempotencyKey:randomUUID(),customerId:c.id,paymentMethod:'PIX',expectedTotalCents:3290,items:[{productId:id,quantity:1}]};
 const unknown=await result(await s.saleHttp({...command,customerId:randomUUID()}));assert.equal(unknown.status,409);assert.equal(unknown.error.code,'WORKSPACE_CUSTOMER_UNAVAILABLE');
 s.env.WORKSPACE_CUSTOMERS_ENABLED='false';assert.equal((await s.saleHttp(command)).status,400);s.env.WORKSPACE_CUSTOMERS_ENABLED='true';s.gas.props.CUSTOMERS_ENABLED='false';assert.equal((await s.saleHttp(command)).status,409);s.gas.props.CUSTOMERS_ENABLED='true';
 const responses=await Promise.all([s.saleHttp(command),s.saleHttp({...command,idempotencyKey:randomUUID()})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(s.main.getSheetByName('Vendas').getLastRow(),2);
});

test('identified sale repairs interrupted last-purchase projection, preserves history after edits and returns one receipt after response loss',async()=>{
 const s=customerFixture(),c=s.command();await s.customerHttp('save',c);const id=await s.product(2),command={idempotencyKey:randomUUID(),customerId:c.id,paymentMethod:'DEBITO',expectedTotalCents:3290,items:[{productId:id,quantity:1}]};
 const save=s.gas.context.accessSaveMain_;let once=true;s.gas.context.accessSaveMain_=(table,row)=>{if(!once||table.sheet.name!=='Clientes')return save(table,row);once=false;throw Error('INJECTED_CUSTOMER_PROJECTION');};assert.equal((await s.saleHttp(command)).status,502);
 const customer=(await result(await s.customerHttp('get',{id:c.id}))).data.customer;assert.ok(customer.lastPurchase);const retry=await result(await s.saleHttp(command));assert.equal(retry.status,200);assert.equal(retry.data.createdAt,customer.lastPurchase);
 assert.equal((await s.customerHttp('save',{...c,commandId:randomUUID(),expectedRevision:1,record:{...c.record,cpf:'',name:'Novo nome fictício'}})).status,200);s.gas.call('recoverDevelopmentSales');assert.equal((await result(await s.customerHttp('get',{id:c.id}))).data.customer.name,'Novo nome fictício');
 s.gas.props.CUSTOMERS_ENABLED='false';s.env.WORKSPACE_CUSTOMERS_ENABLED='false';assert.equal((await s.saleHttp(command)).status,200);
});

test('customer APIs enforce session, CSRF, bounds, required consent choices and disabled defaults',async()=>{
 assert.throws(()=>loadCustomerSettings(environment()),{code:'CUSTOMERS_NOT_ACTIVATED'});assert.equal((await createCustomerHandler()(new Request(CUSTOMER_ORIGIN+'/api/v1/customers/find',{method:'POST',body:'{}'}))).status,503);
 const s=customerFixture(),c=s.command();for(const headers of [{'x-csrf-token':''},{origin:'https://evil.invalid'},{'content-type':'text/plain'}])assert.equal((await s.customerHttp('save',c,undefined,headers)).status,403);
 assert.equal((await s.customerHttp('save',{...c,record:{...c.record,name:'x'.repeat(8500)}})).status,413);
 for(const record of [{marketingConsent:true},{contactPreference:'EMAIL',email:''},{cpf:'00000000000'},{state:'ZZ'},{postalCode:'123'},{name:'=FORMULA'}])assert.throws(()=>normalizeCustomer({...c.record,...record}));
 s.gas.props.CUSTOMERS_ENABLED='false';await assert.rejects(s.client.customers('get',s.master.actor,{id:c.id}),{code:'WORKSPACE_CUSTOMERS_UNAVAILABLE'});
});
