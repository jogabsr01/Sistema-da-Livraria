import test from 'node:test';
import assert from 'node:assert/strict';
import { createIsbnLookupService } from '../../backend/isbn-lookup.mjs';
import { createCatalogHandler,loadIsbnLookupSettings } from '../../backend/catalog-handler.mjs';
import { createLoginGuard } from '../../backend/login-guard.mjs';
import { catalogFixture,CATALOG_ORIGIN } from '../helpers/catalog-fixture.mjs';
import { isbnProviderFixture } from '../helpers/isbn-provider-fixtures.mjs';
const ISBN='9786589806691';
test('lookup queries fixed providers by exact ISBN and merges only bibliographic fields and safe candidates',async()=>{
  const calls=[],data=await createIsbnLookupService({fetchImpl:isbnProviderFixture('normal',calls)}).lookup(ISBN);
  assert.equal(calls.length,5);assert.equal(data.metadata.title,'Livro cristão fictício para QA');assert.equal(data.metadata.edition,'2ª edição');assert.equal(data.metadata.synopsis,'Sinopse de teste');assert.equal(data.fieldSources.title,'BrasilAPI (CBL)');
  assert.ok(data.covers.some(c=>c.url==='https://books.google.com/fixture-cover.png'));assert.equal(data.covers.at(-1).source,'Open Library Covers (ISBN)');
  for(const {url,options} of calls){assert.ok(url.includes(ISBN));assert.equal(options.redirect,'manual');assert.equal(options.method,'GET');assert.deepEqual(options.headers,{accept:'application/json'});assert.equal(options.body,undefined);}
  for(const forbidden of ['priceCents','supplier','stock','sessionToken','cookie','role'])assert.equal(Object.hasOwn(data.metadata,forbidden),false);
});
test('wrong editions are not used for either metadata or cover, and invalid ISBN never reaches providers',async()=>{
  const calls=[],service=createIsbnLookupService({fetchImpl:isbnProviderFixture('wrong',calls)}),data=await service.lookup(ISBN);
  assert.equal(data.metadata,null);assert.equal(data.covers.length,1);for(const bad of ['', '9786589806692','https://127.0.0.1','1'.repeat(100)])await assert.rejects(service.lookup(bad),{code:'INVALID_ISBN'});assert.equal(calls.length,5);
});
test('ISBN-10 normalizes before provider requests and duplicate thumbnails are deduplicated',async()=>{
  const calls=[],service=createIsbnLookupService({fetchImpl:isbnProviderFixture('normal',calls)});const data=await service.lookup('85-359-0277-5');assert.equal(data.isbn,'9788535902778');assert.ok(calls.every(c=>c.url.includes(data.isbn)));
  assert.equal(new Set(data.covers.map(c=>c.url)).size,data.covers.length);
});
test('curated editorial cover is a labeled candidate for its verified ISBN only, never a fabricated API result',async()=>{
  const service=createIsbnLookupService({fetchImpl:isbnProviderFixture('empty')});
  const data=await service.lookup('9788543303932');assert.equal(data.metadata,null);const cover=data.covers.find(c=>c.source==='Referência editorial (Mundo Cristão)');assert.ok(cover.url.endsWith('/Examinando-as-escrituras.png'));assert.equal(cover.referenceUrl,'https://www.mundocristao.com.br/produto/examinando-as-escrituras/');assert.ok(data.sources.every(s=>s.status==='not_found'));
  assert.equal((await service.lookup(ISBN)).covers.some(c=>c.source.startsWith('Referência editorial')),false);
});
test('rate limited provider stays explicit while another source and Covers API remain available',async()=>{
  const data=await createIsbnLookupService({fetchImpl:isbnProviderFixture('rate-limited')}).lookup(ISBN);
  assert.equal(data.sources.find(s=>s.name==='Google Books').httpStatus,429);assert.equal(data.metadata.title,'Livro cristão fictício para QA');assert.ok(data.covers.at(-1).url.includes('/b/isbn/'+ISBN));
});
test('oversized/HTML/corrupt responses, redirects and hung requests fail independently and within timeout',async()=>{
  const payloads=[new Response('x'.repeat(196609),{headers:{'content-type':'application/json'}}),new Response('<html>',{headers:{'content-type':'text/html'}}),new Response('{bad',{headers:{'content-type':'application/json'}}),new Response('',{status:302,headers:{location:'https://127.0.0.1/'}})];
  for(const response of payloads){const data=await createIsbnLookupService({fetchImpl:async()=>response.clone()}).lookup(ISBN);assert.equal(data.metadata,null);assert.ok(data.sources.every(s=>['invalid_response','unavailable','http_error'].includes(s.status)));}
  const start=Date.now(),timed=await createIsbnLookupService({fetchImpl:()=>new Promise(()=>{}),timeoutMs:20}).lookup(ISBN);assert.ok(Date.now()-start<1000);assert.ok(timed.sources.every(s=>s.status==='timeout'));
});
test('provider markup/formulas and private/non-HTTPS image URLs never become usable suggestions',async()=>{
  const service=createIsbnLookupService({fetchImpl:async url=>new Response(JSON.stringify({isbn:ISBN,title:'<b>Título válido</b>',authors:['=HYPERLINK("x")'],publisher:'<img src=x> Editora',cover_url:'https://127.0.0.1/private',price:1}),{headers:{'content-type':'application/json'}})});
  const data=await service.lookup(ISBN);assert.equal(data.metadata.title,'Título válido');assert.equal(data.metadata.author,'');assert.equal(data.metadata.publisher,'Editora');assert.equal(data.covers.length,1);
});
test('bounded cache deduplicates concurrent work, clones results, expires and backs off briefly after provider errors',async()=>{
  let now=0;const calls=[],fetchImpl=isbnProviderFixture('normal',calls),service=createIsbnLookupService({fetchImpl,now:()=>now});
  const [a,b]=await Promise.all([service.lookup(ISBN),service.lookup(ISBN)]);assert.equal(calls.length,5);a.metadata.title='MUTATED';assert.notEqual(b.metadata.title,a.metadata.title);
  assert.equal((await service.lookup(ISBN)).cached,true);now=300001;await service.lookup(ISBN);assert.equal(calls.length,10);
  const errors=[],retry=createIsbnLookupService({fetchImpl:isbnProviderFixture('rate-limited',errors),now:()=>now});await retry.lookup(ISBN);now+=30001;await retry.lookup(ISBN);assert.equal(errors.length,10);
});
test('provider work has a four-ISBN concurrency bound',async()=>{
  const service=createIsbnLookupService({fetchImpl:()=>new Promise(()=>{}),timeoutMs:30});const requests=['9788543303932',ISBN,'9780140328721','9780306406157'].map(isbn=>service.lookup(isbn));await assert.rejects(service.lookup('9788535902778'),{code:'ISBN_LOOKUP_BUSY'});await Promise.all(requests);
});
function fixture(){
  const s=catalogFixture(),calls=[],lookupService=createIsbnLookupService({fetchImpl:isbnProviderFixture('normal',calls)});
  const lookupSettings=()=>loadIsbnLookupSettings({...s.env,WORKSPACE_ISBN_LOOKUP_ENABLED:'true'});
  const handler=createCatalogHandler({loadSettings:()=>({...s.settings,lookupEnabled:true}),loadLookupSettings:lookupSettings,createClient:()=>s.client,lookupService});
  return {...s,calls,lookupSettings,handler,async post(actor,body={isbn:ISBN},headers={}){
    const session=await s.sessionService.current(new Request(CATALOG_ORIGIN+'/api/v1/session',{headers:{cookie:actor.cookie}}));
    return handler(new Request(CATALOG_ORIGIN+'/api/v1/catalog/isbn',{method:'POST',headers:{cookie:actor.cookie,origin:CATALOG_ORIGIN,'content-type':'application/json','x-csrf-token':session.csrfToken,...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
  }};
}
test('lookup HTTP is authenticated, origin/CSRF protected, strict and cannot accept caller URLs or identity',async()=>{
  const s=fixture(),a=s.session();
  for(const headers of [{'x-csrf-token':'wrong'},{origin:'https://evil.invalid'},{'content-type':'text/plain'}])assert.equal((await s.post(a,{isbn:ISBN},headers)).status,403);
  for(const body of [{isbn:ISBN,url:'https://127.0.0.1/'},{isbn:ISBN,role:'SUPER_ADMIN'},{isbn:'9786589806692'},{}])assert.equal((await s.post(a,body)).status,400);
  assert.equal((await s.post(a,'x'.repeat(129))).status,413);
  assert.equal((await s.handler(new Request(CATALOG_ORIGIN+'/api/v1/catalog/isbn',{method:'POST',headers:{origin:CATALOG_ORIGIN,'content-type':'application/json'},body:JSON.stringify({isbn:ISBN})}))).status,401);
  assert.equal((await s.handler(new Request('https://merry-chimera-49a1f3.netlify.app/api/v1/catalog/isbn',{method:'POST'}))).status,403);
  assert.equal(s.calls.length,0);assert.equal((await s.post(a)).status,200);assert.equal(s.calls.length,5);assert.equal(s.main.getSheetByName('Produtos').getLastRow(),1);
});
test('lookup quotas persist across handler instances and use buckets independent from login',async()=>{
  const s=fixture(),a=s.session();for(let i=0;i<5;i++)assert.equal((await s.post(a)).status,200);
  const limited=await s.post(a);assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');assert.equal((await limited.json()).error.code,'ISBN_RATE_LIMITED');assert.equal(s.calls.length,5);
  const fresh=createCatalogHandler({loadSettings:()=>s.settings,loadLookupSettings:s.lookupSettings,createClient:()=>s.client,lookupService:createIsbnLookupService({fetchImpl:isbnProviderFixture('normal')})});
  const current=await s.sessionService.current(new Request(CATALOG_ORIGIN+'/api/v1/session',{headers:{cookie:a.cookie}}));const response=await fresh(new Request(CATALOG_ORIGIN+'/api/v1/catalog/isbn',{method:'POST',headers:{cookie:a.cookie,origin:CATALOG_ORIGIN,'content-type':'application/json','x-csrf-token':current.csrfToken},body:JSON.stringify({isbn:ISBN})}));assert.equal(response.status,429);
  assert.equal((await createLoginGuard(s.lookupSettings(),{client:s.client}).reserveAttempt({identifier:'person@example.invalid',originAddress:'192.0.2.55'})).allowed,true);
});
test('lookup flag/guard dependencies fail closed, while the manual catalog remains available',async()=>{
  const s=fixture();assert.throws(()=>loadIsbnLookupSettings(s.env),{code:'ISBN_LOOKUP_NOT_ACTIVATED'});
  assert.throws(()=>loadIsbnLookupSettings({...s.env,WORKSPACE_ISBN_LOOKUP_ENABLED:'true',WORKSPACE_IDENTITY_GUARDS_ENABLED:'false'}));
  const closed=createCatalogHandler({loadSettings:()=>s.settings,createClient:()=>s.client});const actor=s.session();const current=await s.sessionService.current(new Request(CATALOG_ORIGIN+'/api/v1/session',{headers:{cookie:actor.cookie}}));
  assert.equal((await closed(new Request(CATALOG_ORIGIN+'/api/v1/catalog/isbn',{method:'POST',headers:{cookie:actor.cookie,origin:CATALOG_ORIGIN,'content-type':'application/json','x-csrf-token':current.csrfToken},body:JSON.stringify({isbn:ISBN})}))).status,503);
  assert.equal((await s.http(actor,'save',s.command())).status,200);assert.equal(s.calls.length,0);
});
