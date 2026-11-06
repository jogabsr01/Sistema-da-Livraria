import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogFixture,CATALOG_ORIGIN} from '../helpers/catalog-fixture.mjs';
const request=(cookie,query='')=>new Request(CATALOG_ORIGIN+'/api/v1/catalog/bootstrap'+query,{headers:{cookie}});
test('catalog opening authenticates and returns niches, first page and CSRF in one signed RPC',async()=>{
 const s=catalogFixture(),session=s.session('ADMIN'),command=s.command();await s.client.catalog('save',session.actor,command);
 const expected=await s.sessionService.current(new Request(CATALOG_ORIGIN+'/api/v1/session',{headers:{cookie:session.cookie}}));
 const calls=[],post=s.gas.post;s.gas.post=e=>{calls.push(JSON.parse(Buffer.from(e.message,'base64')).action);return post(e);};
 const response=await s.handler(request(session.cookie));assert.equal(response.status,200);const {data}=await response.json();
 assert.deepEqual(calls,['catalog.bootstrap']);assert.equal(data.user.id,session.userId);assert.equal(data.csrfToken,expected.csrfToken);assert.equal(data.products.length,1);assert.equal(data.products[0].id,command.id);assert.equal(data.niches.length,1);
 assert.equal(data.principal,undefined);assert.ok(!JSON.stringify(data).includes(session.tokenHash));
});
test('new-product opening checks session and niches without scanning the entire product list',async()=>{
 const s=catalogFixture(),session=s.session();s.gas.context.catalogProducts_=()=>{throw Error('SHOULD_NOT_SCAN_STOCK_TO_OPEN_FORM');};
 const response=await s.handler(request(session.cookie,'?create=true'));assert.equal(response.status,200);const {data}=await response.json();assert.equal(data.niches.length,1);assert.deepEqual(data.products,[]);
});
test('catalog bootstrap denies revoked, disabled and changed-epoch sessions and rejects query identity claims',async()=>{
 for(const mode of ['revoked','disabled','epoch','spoof']){
  const s=catalogFixture(),session=s.session('ADMIN');
  if(mode==='revoked'){const t=s.main.getSheetByName('Sessoes');t.rows.at(-1)[t.rows[0].indexOf('Revogado_Em')]=new Date().toISOString();}
  if(mode==='disabled'){const t=s.main.getSheetByName('Usuarios');t.rows.at(-1)[t.rows[0].indexOf('Status')]='INATIVO';}
  if(mode==='epoch')s.main.getSheetByName('Configuracoes').rows.at(-1)[1]=2;
  let calls=0;const post=s.gas.post;s.gas.post=e=>{calls++;return post(e);};
  const r=await s.handler(request(session.cookie,mode==='spoof'?'?role=SUPER_ADMIN':''));assert.equal(r.status,mode==='spoof'?400:401);assert.equal((await r.json()).data,undefined);if(mode==='spoof')assert.equal(calls,0);
 }
});
