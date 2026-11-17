import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirestoreProfileService } from '../../backend/firestore-profile.mjs';

test('an older valid session saves and rereads its own Firestore profile without step-up', async () => {
  const id=randomUUID(), sessionId=randomUUID(), now=Date.now();
  const values=new Map([[`users/${id}`,{id,role:'SUPER_ADMIN',owner:true,revision:0,contact:'old-cipher',hasPhoto:false,email:'owner@example.invalid'}]]);
  const db={collection:name=>({doc:id=>({path:`${name}/${id}`,id}),where:(field,op,value)=>({query:true,name,field,value})}),runTransaction:async work=>{
    let written=false;const writes=[];
    const tx={get:async ref=>{if(written)throw Error('READ_AFTER_WRITE');if(ref.query)return {docs:[...values].filter(([path,v])=>path.startsWith(ref.name+'/')&&v[ref.field]===ref.value).map(([path])=>({id:path.split('/').at(-1)}))};const v=values.get(ref.path);return {exists:v!==undefined,id:ref.id,data:()=>structuredClone(v)};},
      set:(ref,value)=>{written=true;writes.push(()=>values.set(ref.path,structuredClone(value)));},
      create:(ref,value)=>{written=true;writes.push(()=>{if(values.has(ref.path))throw Error('exists');values.set(ref.path,structuredClone(value));});},
      update:(ref,value)=>{written=true;writes.push(()=>values.set(ref.path,{...values.get(ref.path),...structuredClone(value)}));}};
    const result=await work(tx);writes.forEach(write=>write());return result;
  }};
  const principal={id,sessionId,role:'SUPER_ADMIN',assurance:'password',authenticatedAt:now-600000,expiresAt:now+600000,authorizationVersion:1};
  const service=createFirestoreProfileService({db,identityService:{readSessionInTransaction:async()=>principal},config:{adminPasswordLogin:true},now:()=>now});
  const actor={sessionTokenHash:'a'.repeat(64)}, payload={commandId:randomUUID(),expectedRevision:0,contact:'new-cipher',fingerprint:'b'.repeat(64)};
  assert.deepEqual(await service.execute('save',actor,payload),{revision:1});
  assert.equal((await service.execute('get',actor)).contact,'new-cipher');
  assert.equal((await service.execute('get',actor)).revision,1);
  const cpfIndex='c'.repeat(64), cpf='52998224725';
  assert.deepEqual(await service.execute('save',actor,{...payload,commandId:randomUUID(),expectedRevision:1,cpf,ownerCpfIndex:cpfIndex}),{revision:2});
  assert.equal(values.get(`uniqueness/staff-cpf:${cpfIndex}`).ownerId,id);
  await assert.rejects(service.execute('save',actor,{...payload,commandId:randomUUID(),expectedRevision:2,cpf,ownerCpfIndex:'d'.repeat(64)}),{code:'PROFILE_CPF_LOCKED'});
  principal.expiresAt=now-1;
  await assert.rejects(service.execute('save',actor,{...payload,commandId:randomUUID(),expectedRevision:2}),{code:'UNAUTHENTICATED'});
});