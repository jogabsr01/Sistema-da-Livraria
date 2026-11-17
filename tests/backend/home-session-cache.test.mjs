import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('home shows cached navigation immediately and removes it when session is rejected', async () => {
  const source = await readFile(new URL('../../home-dev.js', import.meta.url), 'utf8');
  const nodes = new Map(), handlers = {};
  const element = () => ({ hidden:true, disabled:false, textContent:'', classList:{add(){},remove(){}}, addEventListener(){}, close(){}, append(){}, replaceChildren(){} });
  const document = { hidden:false, body:element(), head:element(), getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}, querySelectorAll(){return [];}, createElement:element, addEventListener(){} };
  document.body.dataset={};
  const store = new Map([['livraria.navigation.session.v1',JSON.stringify({id:'user',role:'ADMIN',at:Date.now(),expiresAt:Date.now()+60000})]]);
  const sessionStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  let resolveFetch;const fetch=()=>new Promise(resolve=>{resolveFetch=resolve;});
  const window={addEventListener(type,fn){handlers[type]=fn;},dispatchEvent(){}};
  class Event {constructor(type){this.type=type;}}
  vm.runInNewContext(source,{document,window,sessionStorage,fetch,Event,CustomEvent:Event,location:{origin:'https://dev--merry-chimera-49a1f3.netlify.app',search:''},URLSearchParams,URL,performance,AbortController,setTimeout,clearTimeout,navigator:{}});
  assert.equal(nodes.get('home').hidden,false);
  assert.equal(nodes.get('status').textContent,'O que você quer fazer agora?');
  resolveFetch({status:401,headers:{get:()=>''}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get('home').hidden,true);
  assert.equal(store.size,0);
  assert.equal(nodes.get('sign-in').hidden,false);
});