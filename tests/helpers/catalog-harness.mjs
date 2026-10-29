// Local disposable storage only. Runtime code never exposes /test/* routes.
import { createServer } from 'node:http';
import { ownerFixture } from './owner-access-fixture.mjs';
import { injectCatalogFault } from './catalog-fixture.mjs';
import { createKeyManagementHandler,loadKeyManagementSettings } from '../../backend/key-management-handler.mjs';
import { createCustomerInsightsHandler,loadCustomerInsightsSettings } from '../../backend/customer-insights-handler.mjs';
import { createReportHandler,loadReportSettings } from '../../backend/report-handler.mjs';
import { createAuditHandler,loadAuditSettings } from '../../backend/audit-handler.mjs';
import { createScheduleHandler,loadScheduleSettings } from '../../backend/schedule-handler.mjs';
import { createNicheHandler,loadNicheSettings } from '../../backend/niche-handler.mjs';
import { createCatalogHandler, loadCatalogSettings, loadIsbnLookupSettings } from '../../backend/catalog-handler.mjs';
import { createIsbnLookupService } from '../../backend/isbn-lookup.mjs';
import { createCustomerHandler,loadCustomerSettings } from '../../backend/customer-handler.mjs';
import { createOperationsHandler,loadOperationsSettings } from '../../backend/operations-handler.mjs';
import { createEmailChangeHandler,loadEmailChangeSettings } from '../../backend/email-change-handler.mjs';
import { createProfileHandler,loadProfileSettings } from '../../backend/profile-handler.mjs';
import { createSessionHandler } from '../../backend/session-handler.mjs';
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
const operationsHandler=createOperationsHandler({loadSettings:()=>loadOperationsSettings(fixture.env),createClient:()=>fixture.client});
const emailChangeHandler=createEmailChangeHandler({loadSettings:()=>loadEmailChangeSettings(fixture.env),createClient:()=>fixture.client});
const keyHandler=createKeyManagementHandler({loadSettings:()=>loadKeyManagementSettings(fixture.env),createClient:()=>fixture.client});
const insightHandler=createCustomerInsightsHandler({loadSettings:()=>loadCustomerInsightsSettings(fixture.env),createClient:()=>fixture.client});
const reportHandler=createReportHandler({loadSettings:()=>loadReportSettings(fixture.env),createClient:()=>fixture.client});
const auditHandler=createAuditHandler({loadSettings:()=>loadAuditSettings(fixture.env),createClient:()=>fixture.client});
const scheduleHandler=createScheduleHandler({loadSettings:()=>loadScheduleSettings(fixture.env),createClient:()=>fixture.client});
const nicheHandler=createNicheHandler({loadSettings:()=>loadNicheSettings(fixture.env),createClient:()=>fixture.client});
const profileHandler=createProfileHandler({loadSettings:()=>loadProfileSettings(fixture.env),createClient:()=>fixture.client});
const revokeOthers=createSessionHandler('revokeOthers',{loadSessionSettings:()=>fixture.settings,createWorkspaceClient:()=>fixture.client});
const checkoutHandler=createCheckoutHandler({loadSettings:()=>loadCheckoutSettings(fixture.env),createClient:()=>fixture.client});
const notificationHandler=createNotificationHandler({loadSettings:()=>loadNotificationSettings(fixture.env),createClient:()=>fixture.client});
const customerHandler=createCustomerHandler({loadSettings:()=>loadCustomerSettings(fixture.env),createClient:()=>fixture.client,postalLookup:async postalCode=>({postalCode,street:'Rua fictícia',district:'Bairro fictício',city:'Cidade fictícia',state:'SP'})});
const staffHandler=createStaffHandler({loadSettings:()=>loadStaffSettings(fixture.env),createClient:()=>fixture.client});
let lookupMode='normal';const providerCalls=[];
const makeLookup=()=>createIsbnLookupService({fetchImpl:(...args)=>isbnProviderFixture(lookupMode,providerCalls)(...args)});
let lookupService=makeLookup();
const handler=createCatalogHandler({loadSettings:()=>loadCatalogSettings(fixture.env),createClient:()=>fixture.client,loadLookupSettings:()=>loadIsbnLookupSettings(fixture.env),lookupService:{lookup:isbn=>lookupService.lookup(isbn)}});
const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>140000)throw Error('TEST_BODY_LIMIT');}
    if(req.url==='/test/emergency-state'){const a=fixture.main.getSheetByName('Logs_Auditoria'),u=fixture.gas.props.IDENTITY_OWNER_USER_ID,k=fixture.gas.call('emergencyKit_',fixture.gas.call('baseSettings_'),u);res.end(JSON.stringify({issued:a.rows.filter(r=>r[4]==='IDENTITY_RECOVERY_CODES_ISSUED').length,recovered:a.rows.filter(r=>r[4]==='IDENTITY_PASSKEY_RECOVERED').length,remaining:k&&k.state==='ACTIVE'?k.entries.filter(e=>!e.usedAt).length:0}));return;}
    if(req.url==='/test/enable-emergency'){fixture.env.WORKSPACE_EMERGENCY_RECOVERY_ENABLED='true';fixture.gas.props.EMERGENCY_RECOVERY_ENABLED='true';fixture.env.WORKSPACE_RECOVERY_ENABLED='true';fixture.gas.props.RECOVERY_ENABLED='true';fixture.env.WORKSPACE_KEY_MANAGEMENT_ENABLED='true';fixture.gas.props.KEY_MANAGEMENT_ENABLED='true';res.end('{}');return;}
    if(req.url==='/test/enable-keys'){fixture.env.WORKSPACE_KEY_MANAGEMENT_ENABLED='true';fixture.gas.props.KEY_MANAGEMENT_ENABLED='true';res.end('{}');return;}
    if(req.url==='/test/keys-state'){const t=fixture.priv.getSheetByName('_Passkeys'),c=t.rows[0],a=fixture.main.getSheetByName('Logs_Auditoria');res.end(JSON.stringify({active:t.rows.slice(1).filter(r=>r[c.indexOf('Revoked_At')]==='').length,added:a.rows.filter(r=>r[4]==='IDENTITY_PASSKEY_ADDED').length,removed:a.rows.filter(r=>r[4]==='IDENTITY_PASSKEY_REMOVED').length}));return;}
    if(req.url==='/test/enable-insights'){fixture.env.WORKSPACE_CUSTOMER_INSIGHTS_ENABLED='true';fixture.gas.props.CUSTOMER_INSIGHTS_ENABLED='true';fixture.env.WORKSPACE_REPORTS_ENABLED='true';fixture.gas.props.REPORTS_ENABLED='true';res.end('{}');return;}
    if(req.url==='/test/seed-insight-candidate'){const t=fixture.main.getSheetByName('Produtos'),r=[...t.rows[1]],id=randomUUID();for(const [k,v] of Object.entries({ID_Produto:id,Codigo_Interno:'SUGESTAO01',ISBN:'',Titulo:'Próxima leitura sugerida',Estoque_Atual:4,Preco_Venda:3500}))r[t.rows[0].indexOf(k)]=v;t.appendRow(r);fixture.main.getSheetByName('Produto_Nichos').appendRow([id,fixture.main.getSheetByName('Nichos').rows[1][0]]);res.end(JSON.stringify({id}));return;}
    if(req.url==='/test/insight-state'){res.end(JSON.stringify({views:fixture.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r[4]==='CUSTOMER_INSIGHTS_VIEW').length,messages:fixture.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r[4]==='CUSTOMER_MESSAGE_PREPARED').length}));return;}
    if(req.url==='/test/enable-reports'){fixture.env.WORKSPACE_REPORTS_ENABLED='true';fixture.gas.props.REPORTS_ENABLED='true';fixture.env.WORKSPACE_PERSONAL_DATA_KEY||=randomBytes(32).toString('hex');fixture.env.WORKSPACE_PERSONAL_INDEX_KEY||=randomBytes(32).toString('hex');res.end('{}');return;}
    if(req.url==='/test/report-state'){res.end(JSON.stringify({views:fixture.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r[4]==='COMMERCIAL_REPORT_VIEW').length,exports:fixture.main.getSheetByName('Logs_Auditoria').rows.filter(r=>r[4]==='COMMERCIAL_REPORT_EXPORT').length}));return;}
    if(req.url==='/test/security-events'){const table=fixture.main.getSheetByName('Logs_Auditoria');res.end(JSON.stringify({events:table.rows.slice(1).filter(r=>String(r[4]).startsWith('IDENTITY_')).map(r=>({action:r[4],actor:r[2],result:r[9],detail:JSON.parse(r[8]||'{}')}))}));return;}
    if(req.url==='/test/audit-state'){const table=fixture.main.getSheetByName('Logs_Auditoria');res.end(JSON.stringify({exports:table.rows.filter(r=>r[4]==='AUDIT_EXPORT').length}));return;}
    if(req.url==='/test/enable-audit'){fixture.env.WORKSPACE_AUDIT_ENABLED='true';fixture.gas.props.AUDIT_ENABLED='true';fixture.env.WORKSPACE_PERSONAL_DATA_KEY||=randomBytes(32).toString('hex');fixture.env.WORKSPACE_PERSONAL_INDEX_KEY||=randomBytes(32).toString('hex');res.end('{}');return;}
    if(req.url==='/test/audit-seed'){const {count=30}=JSON.parse(body),table=fixture.main.getSheetByName('Logs_Auditoria');const product=randomUUID(),sale=randomUUID();for(let i=0;i<count;i++){const r={ID_Log:randomUUID(),Data_Hora:new Date().toISOString(),ID_Usuario:fixture.gas.props.IDENTITY_OWNER_USER_ID,Perfil:'SUPER_ADMIN',Acao:i%2?'SALE_REJECTED':'SALE_COMMITTED',Entidade:'Vendas',ID_Entidade:sale,Antes:'',Depois:JSON.stringify({totalCents:3290,paymentMethod:'PIX',items:[{productId:product,title:'=1+1 <Livro & ação> 😀',quantity:1,unitPriceCents:3290,subtotalCents:3290}],pin:'TEST_SECRET_NOT_FOR_DISCLOSURE',email:'private@example.invalid'}),Resultado:i%2?'NEGADO':'SUCESSO',ID_Requisicao:randomUUID()};table.appendRow(table.rows[0].map(k=>r[k]));}res.end(JSON.stringify({productId:product,saleId:sale}));return;}
    if(req.url==='/test/schedule-state'){res.end(JSON.stringify({shifts:fixture.main.getSheetByName('Escalas').getLastRow()-1,events:fixture.main.getSheetByName('Notificacoes').rows.filter(r=>String(r[1]).startsWith('SCHEDULE_')).length}));return;}
    if(req.url==='/test/enable-schedules'){fixture.env.WORKSPACE_PROFILE_ENABLED='true';fixture.gas.props.PROFILE_ENABLED='true';fixture.env.WORKSPACE_SCHEDULES_ENABLED='true';fixture.gas.props.SCHEDULES_ENABLED='true';fixture.env.WORKSPACE_NOTIFICATIONS_ENABLED='true';fixture.gas.props.NOTIFICATIONS_ENABLED='true';fixture.env.WORKSPACE_PERSONAL_DATA_KEY||=randomBytes(32).toString('hex');fixture.env.WORKSPACE_PERSONAL_INDEX_KEY||=randomBytes(32).toString('hex');res.end('{}');return;}
    if(req.url==='/test/enable-niches'){fixture.env.WORKSPACE_NICHES_ENABLED='true';fixture.gas.props.NICHES_ENABLED='true';res.end('{}');return;}
    if(req.url==='/test/enable-email-change'){fixture.env.WORKSPACE_PROFILE_ENABLED='true';fixture.gas.props.PROFILE_ENABLED='true';fixture.env.WORKSPACE_EMAIL_CHANGE_ENABLED='true';fixture.gas.props.EMAIL_CHANGE_ENABLED='true';fixture.env.WORKSPACE_PERSONAL_DATA_KEY||=randomBytes(32).toString('hex');fixture.env.WORKSPACE_PERSONAL_INDEX_KEY||=randomBytes(32).toString('hex');res.end('{}');return;}
    if(req.url==='/test/maintenance-owner-recovery'){fixture.gas.props.MAINTENANCE_BACKUP_KEY||=randomBytes(32).toString('hex');fixture.gas.props.MAINTENANCE_PERSONAL_INDEX_KEY=fixture.env.WORKSPACE_PERSONAL_INDEX_KEY;fixture.gas.call('beginDevelopmentMaintenance');const result=fixture.gas.call('recoverDevelopmentOwnerAccess',randomUUID(),'new-owner@example.invalid','CASE-BROWSER-0001');fixture.gas.call('endDevelopmentMaintenance');res.end(JSON.stringify(result));return;}
    if(req.url==='/test/maintenance-backup'){fixture.env.WORKSPACE_NOTIFICATIONS_ENABLED='true';fixture.gas.props.NOTIFICATIONS_ENABLED='true';fixture.gas.props.MAINTENANCE_BACKUP_KEY||=randomBytes(32).toString('hex');fixture.gas.call('beginDevelopmentMaintenance');const result=fixture.gas.call('backupDevelopmentInstallation',randomUUID());const restore=fixture.gas.call('restoreDevelopmentCopy',result.backupId,randomUUID());fixture.gas.call('endDevelopmentMaintenance');res.end(JSON.stringify({isolated:restore.isolated,recovered:restore.recovered}));return;}
    if(req.url==='/test/maintenance-reconcile'){fixture.gas.props.MAINTENANCE_BACKUP_KEY||=randomBytes(32).toString('hex');fixture.gas.call('beginDevelopmentMaintenance');const result=fixture.gas.call('reconcileDevelopmentInstallation',randomUUID());fixture.gas.call('endDevelopmentMaintenance');res.end(JSON.stringify(result));return;}
    if(req.url==='/test/enable-profile'){fixture.env.WORKSPACE_PROFILE_ENABLED='true';fixture.gas.props.PROFILE_ENABLED='true';fixture.env.WORKSPACE_PERSONAL_DATA_KEY=randomBytes(32).toString('hex');fixture.env.WORKSPACE_PERSONAL_INDEX_KEY=randomBytes(32).toString('hex');fixture.env.WORKSPACE_RECOVERY_ENABLED='true';fixture.gas.props.RECOVERY_ENABLED='true';res.end('{}');return;}
    if(req.url==='/test/enable-operations'){fixture.env.WORKSPACE_OPERATIONS_ENABLED='true';fixture.gas.props.OPERATIONS_ENABLED='true';res.end('{}');return;}
    if(req.url==='/test/enable-customers'){fixture.env.WORKSPACE_CUSTOMERS_ENABLED='true';fixture.gas.props.CUSTOMERS_ENABLED='true';fixture.env.WORKSPACE_PERSONAL_DATA_KEY=randomBytes(32).toString('hex');fixture.env.WORKSPACE_PERSONAL_INDEX_KEY=randomBytes(32).toString('hex');res.end('{}');return;}
    if(req.url==='/test/enable-staff'){fixture.env.WORKSPACE_STAFF_ENABLED='true';fixture.gas.props.STAFF_ENABLED='true';fixture.env.WORKSPACE_PERSONAL_DATA_KEY=randomBytes(32).toString('hex');fixture.env.WORKSPACE_PERSONAL_INDEX_KEY=randomBytes(32).toString('hex');res.end('{}');return;}
    if(req.url==='/test/email-delivery'){res.end(JSON.stringify({count:fixture.gas.outbox.length,lastTo:fixture.gas.outbox.at(-1)?.to,googleOwner:fixture.gas.props.OWNER_EMAIL}));return;}
    if(req.url==='/test/code'){res.end(JSON.stringify({code:fixture.gas.outbox.at(-1)?.body.match(/\n([A-Za-z0-9_-]{7}|[A-Za-z0-9_-]{43})\n/)[1]}));return;}
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
    if(req.url==='/test/login-state'){res.end(JSON.stringify({sessions:fixture.main.getSheetByName('Sessoes').getLastRow()-1}));return;}
    if(req.url==='/test/state'){res.end(JSON.stringify({files:[...fixture.gas.resources.values()].filter(r=>r.kind==='image').length,providerRequests:providerCalls.length,products:fixture.main.getSheetByName('Produtos').getLastRow()-1,logs:fixture.main.getSheetByName('Logs_Auditoria').getLastRow()-1}));return;}
    const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body})});
    const response=req.url.startsWith('/api/v1/keys/')?await keyHandler(request):req.url.startsWith('/api/v1/customer-insights/')?await insightHandler(request):req.url.startsWith('/api/v1/reports/')?await reportHandler(request):req.url.startsWith('/api/v1/audit/')?await auditHandler(request):req.url.startsWith('/api/v1/schedules/')?await scheduleHandler(request):req.url.startsWith('/api/v1/niches/')?await nicheHandler(request):req.url.startsWith('/api/v1/email-change/')?await emailChangeHandler(request):req.url.startsWith('/api/v1/profile/')?await profileHandler(request):req.url==='/api/v1/session/revoke-others'?await revokeOthers(request):req.url.startsWith('/api/v1/operations/')?await operationsHandler(request):req.url.startsWith('/api/v1/customers/')?await customerHandler(request):req.url.startsWith('/api/v1/staff/')?await staffHandler(request):req.url.startsWith('/api/v1/notifications/')?await notificationHandler(request):req.url==='/api/v1/checkout'?await checkoutHandler(request):req.url.startsWith('/api/v1/catalog/')?await handler(request):req.url==='/api/v1/session'?await fixture.sessions.current(request):req.url==='/api/v1/session/logout'?await fixture.sessions.logout(request):await fixture.handler(request,{ip:'192.0.2.40'});
    const headers=Object.fromEntries(response.headers);delete headers['set-cookie'];
    res.end(JSON.stringify({status:response.status,headers,cookies:response.headers.getSetCookie(),...(['image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(response.headers.get('content-type'))?{bodyBase64:Buffer.from(await response.arrayBuffer()).toString('base64')}:{body:await response.text()})}));
  }catch{res.statusCode=500;res.end(JSON.stringify({error:'TEST_HARNESS_FAILURE'}));}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
