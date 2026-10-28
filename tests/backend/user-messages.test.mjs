import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {safeFailure,ApiError} from '../../backend/errors.mjs';
import {normalizeStaffContact} from '../../backend/staff-model.mjs';
import {normalizeCustomer} from '../../backend/customer-model.mjs';
import {normalizeProduct} from '../../backend/catalog-model.mjs';
import {staffFixture} from '../helpers/staff-fixture.mjs';
import {unpackProfile} from '../../backend/profile-handler.mjs';
const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../../ui-messages.js',import.meta.url),'utf8'),context);
const describe=context.LivrariaMessages.describe;
test('invalid personal fields survive the HTTP boundary as one precise human explanation without echoing values',async()=>{
 const person={name:'Pessoa fictícia',cpf:'52998224725',email:'pessoa@example.invalid',phone:'11988887777'};
 for(const [field,value,match] of [['cpf','123',/CPF inválido/],['email','incompleto@',/E-mail inválido/],['phone','x',/Telefone inválido/],['name','',/nome válido/]]){
  let error;try{normalizeStaffContact({...person,[field]:value});}catch(e){error=e;}
  const response=safeFailure(error,'fictitious'),data=(await response.json()).error;
  assert.equal(response.status,400);assert.equal(data.field,field);assert.match(describe(data),match);
  assert.ok(!JSON.stringify(data).includes('pessoa@example.invalid'));
 }
 const customer={...person,contactPreference:'NONE',marketingConsent:false};
 for(const [field,value] of [['cpf','123'],['email','bad@'],['phone','bad'],['postalCode','123'],['state','ZZ']]){
  let e;try{normalizeCustomer({...customer,[field]:value});}catch(error){e=error;}
  assert.equal(e.field,field);assert.ok(describe((await safeFailure(e,'fictitious').json()).error));
 }
 const book={isbn:'',title:'Livro fictício',priceCents:5000,nicheIds:['00000000-0000-4000-8000-000000000001'],active:true};
 for(const [field,value,match] of [['isbn','123',/ISBN inválido/],['title','',/título/],['priceCents',-1,/Preço inválido/],['minimumStock',-1,/Estoque mínimo/]]){
  let e;try{normalizeProduct({...book,[field]:value},'00000000-0000-4000-8000-000000000002');}catch(error){e=error;}
  assert.equal(e.field,field);assert.match(describe((await safeFailure(e,'fictitious').json()).error),match);
 }
});
test('duplicate CPF and duplicate email are distinguished by authoritative staff checks',async()=>{
 const s=staffFixture(),c=s.command();assert.equal((await s.http('save',c)).status,200);
 for(const [contact,expected,match] of [[{...c.contact,email:'outro@example.invalid'},'WORKSPACE_STAFF_CPF_DUPLICATE',/CPF já cadastrado/],[{...c.contact,cpf:'11144477735'},'WORKSPACE_STAFF_EMAIL_DUPLICATE',/E-mail já cadastrado/]]){
  const response=await s.http('save',s.command({contact})),data=(await response.json()).error;
  assert.equal(response.status,409);assert.equal(data.code,expected);assert.match(describe(data),match);
 }
});
test('read failures never imply a save and unknown/provider text cannot become a user message',()=>{
 for(const code of ['UPSTREAM_TIMEOUT','UPSTREAM_UNAVAILABLE','UPSTREAM_UNTRUSTED','INTERNAL']){
  const text=describe({code,readOnly:true,message:'PRIVATE_SENTINEL'});assert.match(text,/carregar os dados/);assert.ok(!/salv|PIN|PRIVATE/.test(text));
 }
 assert.equal(describe({code:'<script>PRIVATE_SENTINEL</script>',field:'PRIVATE_SENTINEL',message:'PRIVATE_SENTINEL'}),null);
 assert.equal(describe({code:'INVALID_CUSTOMER',field:'__proto__'}),null);
 assert.equal(describe({code:'PERSONAL_DATA_UNAVAILABLE',field:'cpf'}).includes('CPF inválido'),false);
 const forbidden=new ApiError(403,'FORBIDDEN');forbidden.field='cpf';assert.equal(safeFailure(forbidden,'fictitious').status,403);
 assert.equal(describe({code:'WORKSPACE_SALE_PRICE_CHANGED'}),'O preço mudou. Atualize o carrinho e confira o novo total antes de confirmar.');
});
test('invalid stored profile data is a service error, never a validation error blamed on the user',async()=>{
 const id='00000000-0000-4000-8000-000000000001',data={id,role:'SUPER_ADMIN',owner:true,revision:0,hasPhoto:false,lastAccess:'',email:'owner@example.invalid',contact:'private-envelope'};
 let error;try{unpackProfile(data,{open:()=>({name:'Conta fictícia',phone:'BAD_STORED_PHONE'})},id);}catch(e){error=e;}
 assert.equal(error.status,502);assert.equal(error.code,'UPSTREAM_UNTRUSTED');
 const result=(await safeFailure(error,'fictitious').json()).error;assert.equal(result.field,undefined);
 assert.ok(!JSON.stringify(result).includes('BAD_STORED_PHONE'));assert.ok(!/Telefone inválido|CPF inválido/.test(describe({...result,readOnly:true})));
 const malformed=safeFailure(new ApiError(400,'<private provider response>'),'fictitious');assert.equal(malformed.status,500);assert.deepEqual((await malformed.json()).error,{code:'INTERNAL',requestId:'fictitious'});
});
