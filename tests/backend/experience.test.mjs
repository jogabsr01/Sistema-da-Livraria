import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {profileFixture} from '../helpers/profile-fixture.mjs';
import {createSessionService} from '../../backend/session-service.mjs';
import {createOwnerAccessService,loadOwnerAccessSettings} from '../../backend/owner-access.mjs';
import {safeFailure,ApiError} from '../../backend/errors.mjs';

test('CSRF derivation reuses only a principal authenticated by that exact service and cookie',async()=>{
 const s=profileFixture(),original=s.client.readSession;let reads=0;
 s.client.readSession=async(...args)=>{reads++;return original(...args);};
 const service=createSessionService(s.settings,{client:s.client});
 const req=new Request('https://dev--merry-chimera-49a1f3.netlify.app/api/v1/profile/save',{headers:{cookie:s.master.cookie}});
 const principal=await service.authenticate(req);assert.equal(reads,1);
 const csrf=service.csrfFor(req,principal);assert.equal(reads,1);assert.equal(typeof csrf,'string');
 assert.throws(()=>service.csrfFor(req,{...principal}),{code:'UNAUTHENTICATED'});
 assert.throws(()=>createSessionService(s.settings,{client:s.client}).csrfFor(req,principal),{code:'UNAUTHENTICATED'});
 const other=new Request(req.url,{headers:{cookie:'__Host-livraria_session='+randomBytes(32).toString('base64url')}});
 assert.throws(()=>service.csrfFor(other,principal),{code:'UNAUTHENTICATED'});
});

test('master CPF is encrypted, indexed, immutable after linking and resolves to the existing delivery address',async()=>{
 const s=profileFixture(),input={commandId:randomUUID(),expectedRevision:0,displayName:'Pessoa fictícia',phone:'11988887777',cpf:'52998224725'};
 const saved=await s.profileHttp('save',input);assert.equal(saved.status,200);
 const data=(await (await s.profileHttp('get')).json()).data;assert.equal(data.cpfMasked,'***.982.247-**');assert.equal(data.cpf,undefined);
 const stored=JSON.stringify([...s.main.tables].map(([,table])=>table.rows));assert.ok(!stored.includes(input.cpf));
 const found=await s.client.access('ownerLookup',{cpfIndex:s.vault.index('cpf',input.cpf)});assert.equal(found.email,'owner@example.invalid');
 const changed=await s.profileHttp('save',{...input,commandId:randomUUID(),expectedRevision:1,cpf:'11144477735'});assert.equal(changed.status,409);
 assert.equal((await changed.json()).error.code,'PROFILE_CPF_LOCKED');
 const other=s.command();const duplicate=await s.http('save',other);assert.equal(duplicate.status,409);
});

test('master cannot link a CPF already assigned to another person and workers cannot change their CPF',async()=>{
 const s=profileFixture(),worker=s.command();assert.equal((await s.http('save',worker)).status,200);
 const command={commandId:randomUUID(),expectedRevision:0,displayName:'Pessoa fictícia',phone:'',cpf:worker.contact.cpf};
 const result=await s.profileHttp('save',command);assert.equal(result.status,409);assert.equal((await result.json()).error.code,'WORKSPACE_PROFILE_CPF_DUPLICATE');
 const employee=s.session(worker.id),bad=await s.profileHttp('save',{commandId:randomUUID(),expectedRevision:1,phone:'',cpf:'11144477735'},employee);
 assert.equal(bad.status,400);
});

test('first access distinguishes unknown email, active account and delivery failure without a session grant',async()=>{
 const s=profileFixture();
 const service=()=>createOwnerAccessService(loadOwnerAccessSettings(s.env),{client:s.client});
 await assert.rejects(service().execute('start',{email:'nobody@example.invalid'},randomBytes(32).toString('base64url'),'192.0.2.70'),{code:'ACCESS_EMAIL_NOT_REGISTERED'});
 await assert.rejects(service().execute('start',{email:'owner@example.invalid'},randomBytes(32).toString('base64url'),'192.0.2.71'),{code:'ACCESS_ALREADY_ACTIVATED'});
 assert.equal(s.gas.outbox.length,0);
});

test('API error fields are allowlisted names and never expose exception messages or submitted values',async()=>{
 const error=new ApiError(400,'INVALID_STAFF');error.field='cpf';error.message='PRIVATE_SENTINEL';
 assert.deepEqual((await safeFailure(error,'test').json()).error,{code:'INVALID_STAFF',requestId:'test',field:'cpf'});
 error.field='PRIVATE_SENTINEL';assert.equal((await safeFailure(error,'test').json()).error.field,undefined);
});
