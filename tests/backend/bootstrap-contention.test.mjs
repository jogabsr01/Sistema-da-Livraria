import test from 'node:test';
import assert from 'node:assert/strict';
import{profileFixture}from'../helpers/profile-fixture.mjs';
test('a signed pre-execution BUSY is retried once for a read bootstrap with a fresh envelope',async()=>{
 const s=profileFixture(),post=s.gas.post,ids=[];let calls=0;
 s.gas.post=e=>{const r=JSON.parse(Buffer.from(e.message,'base64'));ids.push(r.requestId);s.gas.locked=calls++===0;try{return post(e);}finally{s.gas.locked=false;}};
 const out=await s.client.profile('bootstrap',s.master.actor,{});assert.equal(out.principal.id,s.master.id);assert.equal(calls,2);assert.notEqual(ids[0],ids[1]);
});
test('BUSY retries are bounded and writes are never automatically replayed',async()=>{
 const s=profileFixture(),post=s.gas.post;let calls=0;s.gas.post=e=>{calls++;s.gas.locked=true;try{return post(e);}finally{s.gas.locked=false;}};
 await assert.rejects(s.client.profile('bootstrap',s.master.actor,{}),{code:'WORKSPACE_BUSY'});assert.equal(calls,2);calls=0;await assert.rejects(s.client.profile('save',s.master.actor,{}),{code:'WORKSPACE_BUSY'});assert.equal(calls,1);
});
test('bootstrap transport uncertainty and revoked sessions are not replayed',async()=>{
 for(const mode of ['transport','revoked']){const s=profileFixture(),post=s.gas.post;let calls=0;if(mode==='revoked')await s.client.revokeSession(s.master.tokenHash);s.gas.post=e=>{calls++;if(mode==='transport')throw Error('NETWORK_SENTINEL');return post(e);};await assert.rejects(s.client.profile('bootstrap',s.master.actor,{}));assert.equal(calls,1);}
});
