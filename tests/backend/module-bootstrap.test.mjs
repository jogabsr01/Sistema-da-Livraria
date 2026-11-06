import test from 'node:test';
import assert from 'node:assert/strict';
import {profileFixture} from '../helpers/profile-fixture.mjs';
import {catalogFixture} from '../helpers/catalog-fixture.mjs';
const origin='https://dev--merry-chimera-49a1f3.netlify.app';
const request=(s,module,query='')=>new Request(origin+'/api/v1/'+module+'/bootstrap'+query,{headers:{cookie:s.master.cookie}});
test('profile and team bootstrap return fresh authorized data and CSRF with one Google call each',async()=>{
 for(const module of ['profile','staff']){
  const s=profileFixture(),calls=[],post=s.gas.post;s.gas.post=e=>{calls.push(JSON.parse(Buffer.from(e.message,'base64')).action);return post(e);};
  const r=await (module==='profile'?s.profileHandler:s.handler)(request(s,module));assert.equal(r.status,200);const {data}=await r.json();
  assert.deepEqual(calls,[module+'.bootstrap']);assert.equal(data.user.id,s.master.id);assert.match(data.csrfToken,/^[A-Za-z0-9_-]{43}$/);assert.equal(data.principal,undefined);assert.ok(!JSON.stringify(data).includes(s.master.tokenHash));
  if(module==='profile'){assert.equal(data.email,'owner@example.invalid');assert.equal(data.id,s.master.id);}else assert.ok(Array.isArray(data.users));
 }
});
test('module bootstrap refuses revoked sessions, changed epoch, disabled accounts and caller identity claims',async()=>{
 for(const module of ['profile','staff'])for(const mode of ['revoked','disabled','epoch','spoof']){
  const s=profileFixture();
  if(mode==='revoked'){const t=s.main.getSheetByName('Sessoes');t.rows.at(-1)[t.rows[0].indexOf('Revogado_Em')]=new Date().toISOString();}
  if(mode==='disabled'){const t=s.main.getSheetByName('Usuarios');t.rows[1][t.rows[0].indexOf('Status')]='INATIVO';}
  if(mode==='epoch'){const t=s.main.getSheetByName('Configuracoes');t.rows.find(r=>r[0]==='identity.version.'+s.master.id)[1]=2;}
  const r=await (module==='profile'?s.profileHandler:s.handler)(request(s,module,mode==='spoof'?'?role=SUPER_ADMIN':''));assert.equal(r.status,mode==='spoof'?400:401,module+mode);assert.equal((await r.json()).data,undefined);
 }
});
test('storefront activation is owner-only, idempotent and refuses nonprivate resources before enabling flags',()=>{
 const s=catalogFixture();s.gas.props.CATALOG_ENABLED='false';s.gas.props.CHECKOUT_ENABLED='false';const backup=s.gas.backupCount;
 assert.equal(s.gas.call('activateDevelopmentStorefront').catalog,true);assert.equal(s.gas.props.CATALOG_ENABLED,'true');assert.equal(s.gas.props.CHECKOUT_ENABLED,'true');s.gas.call('activateDevelopmentStorefront');assert.equal(s.gas.backupCount,backup);
 s.gas.props.CATALOG_ENABLED='false';s.gas.props.CHECKOUT_ENABLED='false';s.gas.owner='other@example.invalid';assert.throws(()=>s.gas.call('activateDevelopmentStorefront'),/FORBIDDEN/);assert.equal(s.gas.props.CATALOG_ENABLED,'false');
 s.gas.owner='owner@example.invalid';s.gas.resources.get(s.gas.props.CATALOG_JOURNAL_ID).sharing='public';assert.throws(()=>s.gas.call('activateDevelopmentStorefront'));assert.equal(s.gas.props.CATALOG_ENABLED,'false');assert.equal(s.gas.props.CHECKOUT_ENABLED,'false');
});
