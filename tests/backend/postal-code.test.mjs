import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostalCodeLookup } from '../../backend/postal-code.mjs';
import { customerFixture } from '../helpers/customer-fixture.mjs';
const address={cep:'05500000',city:'Cidade fictícia',state:'SP',street:'Rua fictícia',neighborhood:'Bairro fictício'};
test('authorized optional CEP lookup sends only normalized CEP to the fixed HTTPS provider without redirects or user headers',async()=>{
 const calls=[],lookup=createPostalCodeLookup({fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(address));}});
 assert.deepEqual(await lookup('05500-000'),{postalCode:'05500000',city:address.city,state:'SP',street:address.street,district:address.neighborhood});assert.equal(calls[0].url,'https://brasilapi.com.br/api/cep/v2/05500000');assert.equal(calls[0].options.redirect,'manual');assert.deepEqual(calls[0].options.headers,{accept:'application/json'});assert.equal(calls[0].options.body,undefined);
});
test('invalid CEP, redirects, mismatched responses, active text, invalid UTF8 and oversized responses cannot fill the form',async()=>{
 for(const value of ['http://evil.invalid','0550000','055000000','05500000/extra'])await assert.rejects(createPostalCodeLookup({fetchImpl:()=>{throw Error('must not call');}})(value),{code:'INVALID_CUSTOMER'});
 for(const response of [new Response('',{status:302,headers:{location:'https://evil.invalid'}}),new Response(JSON.stringify({...address,cep:'11111111'})),new Response(JSON.stringify({...address,state:'ZZ'})),new Response(JSON.stringify({...address,street:'=FORMULA'})),new Response('x'.repeat(8001)),new Response(new Uint8Array([0xff,0xfe]))])await assert.rejects(createPostalCodeLookup({fetchImpl:async()=>response})('05500000'),{code:'POSTAL_CODE_UNAVAILABLE'});
 await assert.rejects(createPostalCodeLookup({fetchImpl:async()=>new Response('',{status:404})})('05500000'),{code:'POSTAL_CODE_NOT_FOUND'});
});
test('customer CEP API requires session-bound CSRF and exact body, with persistent limits separate from identity login buckets',async()=>{
 const s=customerFixture();assert.equal((await s.customerHttp('postal-code',{postalCode:'05500-000'},undefined,{'x-csrf-token':''})).status,403);
 assert.equal((await s.customerHttp('postal-code',{postalCode:'05500000',cpf:'do not send'})).status,400);
 for(let i=0;i<5;i++){const r=await s.customerHttp('postal-code',{postalCode:'05500000'});assert.equal(r.status,200);assert.equal((await r.json()).data.city,'Cidade fictícia');}
 const blocked=await s.customerHttp('postal-code',{postalCode:'05500000'});assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);assert.ok(!JSON.stringify([...s.priv.tables].map(([_,t])=>t.rows)).includes('05500000'));
});
