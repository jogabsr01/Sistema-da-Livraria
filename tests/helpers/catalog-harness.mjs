// Local disposable storage only. Runtime code never exposes /test/* routes.
import { createServer } from 'node:http';
import { ownerFixture } from './owner-access-fixture.mjs';
import { injectCatalogFault } from './catalog-fixture.mjs';
import { createCatalogHandler, loadCatalogSettings, loadIsbnLookupSettings } from '../../backend/catalog-handler.mjs';
import { createIsbnLookupService } from '../../backend/isbn-lookup.mjs';
import { createStaffHandler,loadStaffSettings } from '../../backend/staff-handler.mjs';
import { randomUUID,randomBytes } from 'node:crypto';
import { normalizeProduct } from '../../backend/catalog-model.mjs';
import { createCheckoutHandler, loadCheckoutSettings } from '../../backend/checkout-handler.mjs';
import { createNotificationHandler, loadNotificationSettings } from '../../backend/notification-handler.mjs';
import { isbnProviderFixture } from './isbn-provider-fixtures.mjs';
const origin='https://dev--merry-chimera-49a1f3.netlify.app', fixture=ownerFixture();
fixture.env.WORKSPACE_COVER_PHOTOS_ENABLED='true'; fixture.gas.props.COVER_PHOTOS_ENABLED='true';
fixture.env.WORKSPACE_CATALOG_ENABLED='true'; fixture.gas.props.CATALOG_ENABLED='true'; fixture.gas.call('provisionDevelopmentCatalog');
fixture.env.WORKSPACE_ISBN_LOOKUP_ENABLED='true';
fixture.env.WORKSPACE_CHECKOUT_ENABLED='true'; fixture.gas.props.CHECKOUT_ENABLED='true';
const checkoutHandler=createCheckoutHandler({loadSettings:()=>loadCheckoutSettings(fixture.env),createClient:()=>fixture.client});
const notificationHandler=createNotificationHandler({loadSettings:()=>loadNotificationSettings(fixture.env),createClient:()=>fixture.client});
const staffHandler=createStaffHandler({loadSettings:()=>loadStaffSettings(fixture.env),createClient:()=>fixture.client});
let lookupMode='normal';const providerCalls=[];
const makeLookup=()=>createIsbnLookupService({fetchImpl:(...args)=>isbnProviderFixture(lookupMode,providerCalls)(...args)});
let lookupService=makeLookup();
const handler=createCatalogHandler({loadSettings:()=>loadCatalogSettings(fixture.env),createClient:()=>fixture.client,loadLookupSettings:()=>loadIsbnLookupSettings(fixture.env),lookupService:{lookup:isbn=>lookupService.lookup(isbn)}});
const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>140000)throw Error('TEST_BODY_LIMIT');}
    if(req.url==='/test/enable-staff'){fixture.env.WORKSPACE_STAFF_ENABLED='true';fixture.gas.props.STAFF_ENABLED='true';fixture.env.WORKSPACE_PERSONAL_DATA_KEY=randomBytes(32).toString('hex');fixture.env.WORKSPACE_PERSONAL_INDEX_KEY=randomBytes(32).toString('hex');res.end('{}');return;}
    if(req.url==='/test/code'){res.end(JSON.stringify({code:fixture.gas.outbox.at(-1)?.body.match(/\n([A-Za-z0-9_-]{43})\n/)[1]}));return;}
    if(req.url==='/test/fault'){const input=JSON.parse(body);injectCatalogFault(fixture,input.stage,input.after);res.end('{}');return;}
    if(req.url==='/test/lookup-mode'){lookupMode=JSON.parse(body).mode;lookupService=makeLookup();res.end('{}');return;}
    if(req.url==='/test/disable-photos'){fixture.env.WORKSPACE_COVER_PHOTOS_ENABLED='false';res.end('{}');return;}
    if(req.url==='/test/disable-lookup'){fixture.env.WORKSPACE_ISBN_LOOKUP_ENABLED='false';res.end('{}');return;}
    if(req.url==='/test/disable-checkout'){fixture.env.WORKSPACE_CHECKOUT_ENABLED='false';res.end('{}');return;}
    if(req.url==='/test/enable-notifications'){fixture.env.WORKSPACE_NOTIFICATIONS_ENABLED='true';fixture.gas.props.NOTIFICATIONS_ENABLED='true';res.end('{}');return;}
    if(req.url==='/test/disable-notifications'){fixture.env.WORKSPACE_NOTIFICATIONS_ENABLED='false';res.end('{}');return;}
    if(req.url==='/test/set-role'){
      const role=JSON.parse(body).role;if(!['ATENDENTE','ADMIN','SUPER_ADMIN'].includes(role))throw Error('TEST_ROLE_INVALID');
      const table=fixture.main.getSheetByName('Usuarios'),owner=fixture.gas.props.IDENTITY_OWNER_USER_ID;
      const row=table.rows.find(row=>row[table.rows[0].indexOf('ID_Usuario')]===owner);row[table.rows[0].indexOf('Perfil')]=role;res.end('{}');return;
    }
    if(req.url==='/test/seed-checkout'){
      const table=fixture.main.getSheetByName('Produtos'),niche=fixture.main.getSheetByName('Nichos').rows[1][0],ids=[];
      for(const [title,price,stock] of [['Livro de teste do Caixa',3290,2],['Livro sem estoque',1500,0]]){
        const id=randomUUID(),record=normalizeProduct({title,priceCents:price,minimumStock:1,nicheIds:[niche],active:true},id),now=new Date().toISOString();ids.push(id);
        const map={ISBN:'isbn',Codigo_Interno:'internalCode',Titulo:'title',Autor:'author',Editora:'publisher',Edicao:'edition',Fornecedor:'supplier',Preco_Venda:'priceCents',Estoque_Minimo:'minimumStock',Categoria:'category',Capa_URL_Externa:'coverUrl',Ano_Publicacao:'year',Paginas:'pages',Sinopse:'synopsis',Ativo:'active'};
        const values={ID_Produto:id,Capa_Drive_ID:'',Estoque_Atual:stock,Versao_Registro:1,Criado_Em:now,Atualizado_Em:now,Criado_Por:randomUUID(),Atualizado_Por:randomUUID()};
        for(const [key,value] of Object.entries(map))values[key]=record[value];table.appendRow(table.rows[0].map(key=>values[key]??''));
        fixture.main.getSheetByName('Produto_Nichos').appendRow([id,niche]);
      }
      res.end(JSON.stringify({ids}));return;
    }
    if(req.url==='/test/checkout-price'){const table=fixture.main.getSheetByName('Produtos');table.rows[1][table.rows[0].indexOf('Preco_Venda')]=4500;res.end('{}');return;}
    if(req.url==='/test/checkout-fault'){
      const sheet=fixture.main.getSheetByName('Produtos'),get=sheet.getRange.bind(sheet);let once=true;
      sheet.getRange=(...args)=>{const range=get(...args),set=range.setValues;range.setValues=values=>{if(!once)return set(values);once=false;throw Error('INJECTED_CHECKOUT_FAILURE');};return range;};res.end('{}');return;
    }
    if(req.url==='/test/checkout-state'){const sales=fixture.main.getSheetByName('Vendas'),products=fixture.main.getSheetByName('Produtos');res.end(JSON.stringify({sales:sales.getLastRow()-1,stock:products.rows[1]?.[products.rows[0].indexOf('Estoque_Atual')],journals:fixture.main.getSheetByName('_Eventos_Dominio').getLastRow()-1}));return;}
    if(req.url==='/test/disable'){fixture.env.WORKSPACE_CATALOG_ENABLED='false';res.end('{}');return;}
    if(req.url==='/test/state'){res.end(JSON.stringify({files:[...fixture.gas.resources.values()].filter(r=>r.kind==='image').length,providerRequests:providerCalls.length,products:fixture.main.getSheetByName('Produtos').getLastRow()-1,logs:fixture.main.getSheetByName('Logs_Auditoria').getLastRow()-1}));return;}
    const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body})});
    const response=req.url.startsWith('/api/v1/staff/')?await staffHandler(request):req.url.startsWith('/api/v1/notifications/')?await notificationHandler(request):req.url==='/api/v1/checkout'?await checkoutHandler(request):req.url.startsWith('/api/v1/catalog/')?await handler(request):req.url==='/api/v1/session'?await fixture.sessions.current(request):req.url==='/api/v1/session/logout'?await fixture.sessions.logout(request):await fixture.handler(request,{ip:'192.0.2.40'});
    const headers=Object.fromEntries(response.headers);delete headers['set-cookie'];
    res.end(JSON.stringify({status:response.status,headers,cookies:response.headers.getSetCookie(),...(response.headers.get('content-type')==='image/jpeg'?{bodyBase64:Buffer.from(await response.arrayBuffer()).toString('base64')}:{body:await response.text()})}));
  }catch{res.statusCode=500;res.end(JSON.stringify({error:'TEST_HARNESS_FAILURE'}));}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
