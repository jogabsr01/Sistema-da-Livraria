// Local disposable storage only. Runtime code never exposes /test/* routes.
import { createServer } from 'node:http';
import { ownerFixture } from './owner-access-fixture.mjs';
import { injectCatalogFault } from './catalog-fixture.mjs';
import { createCatalogHandler, loadCatalogSettings } from '../../backend/catalog-handler.mjs';
const origin='https://dev--merry-chimera-49a1f3.netlify.app', fixture=ownerFixture();
fixture.env.WORKSPACE_CATALOG_ENABLED='true'; fixture.gas.props.CATALOG_ENABLED='true'; fixture.gas.call('provisionDevelopmentCatalog');
const handler=createCatalogHandler({loadSettings:()=>loadCatalogSettings(fixture.env),createClient:()=>fixture.client});
const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>45000)throw Error('TEST_BODY_LIMIT');}
    if(req.url==='/test/code'){res.end(JSON.stringify({code:fixture.gas.outbox.at(-1)?.body.match(/\n([A-Za-z0-9_-]{43})\n/)[1]}));return;}
    if(req.url==='/test/fault'){const input=JSON.parse(body);injectCatalogFault(fixture,input.stage,input.after);res.end('{}');return;}
    if(req.url==='/test/disable'){fixture.env.WORKSPACE_CATALOG_ENABLED='false';res.end('{}');return;}
    if(req.url==='/test/state'){res.end(JSON.stringify({products:fixture.main.getSheetByName('Produtos').getLastRow()-1,logs:fixture.main.getSheetByName('Logs_Auditoria').getLastRow()-1}));return;}
    const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body})});
    const response=req.url.startsWith('/api/v1/catalog/')?await handler(request):req.url==='/api/v1/session'?await fixture.sessions.current(request):req.url==='/api/v1/session/logout'?await fixture.sessions.logout(request):await fixture.handler(request,{ip:'192.0.2.40'});
    const headers=Object.fromEntries(response.headers);delete headers['set-cookie'];
    res.end(JSON.stringify({status:response.status,headers,cookies:response.headers.getSetCookie(),body:await response.text()}));
  }catch{res.statusCode=500;res.end(JSON.stringify({error:'TEST_HARNESS_FAILURE'}));}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
