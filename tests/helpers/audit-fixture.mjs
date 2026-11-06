import { createHmac,randomUUID } from 'node:crypto';
import { staffFixture } from './staff-fixture.mjs';
import { createAuditHandler,loadAuditSettings } from '../../backend/audit-handler.mjs';
const origin='https://dev--merry-chimera-49a1f3.netlify.app';
export function auditFixture(){
 const s=staffFixture();s.env.WORKSPACE_AUDIT_ENABLED='true';s.gas.props.AUDIT_ENABLED='true';s.env.WORKSPACE_CATALOG_ENABLED='true';s.gas.props.CATALOG_ENABLED='true';s.gas.call('provisionDevelopmentCatalog');
 const handler=createAuditHandler({loadSettings:()=>loadAuditSettings(s.env),createClient:()=>s.client});
 const filters=()=>({from:'2026-01-01T03:00:00.000Z',to:'2026-12-31T02:59:59.999Z',employeeId:'',operation:'',productId:'',saleId:'',result:''});
 async function http(op,body,who=s.master,headers={},fn=handler){const csrf=createHmac('sha256',s.settings.tokenKey).update(JSON.stringify(['csrf.v1',s.settings.config.environment,s.settings.config.installationId,who.rawToken])).digest('base64url');return fn(new Request(origin+'/api/v1/audit/'+op,{method:body?'POST':'GET',headers:{cookie:who.cookie,...(body?{origin,'content-type':'application/json','x-csrf-token':csrf}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}));}
 const list=(f=filters(),offset=0,snapshot='')=>http('list?'+new URLSearchParams({...f,offset,snapshot}));
 function add(extra={}){const r={ID_Log:randomUUID(),Data_Hora:'2026-10-24T12:00:00.000Z',ID_Usuario:s.master.id,Perfil:'SUPER_ADMIN',Acao:'PRODUCT_UPDATE',Entidade:'Produtos',ID_Entidade:randomUUID(),Antes:'{"version":1}',Depois:'{"version":2}',Resultado:'SUCESSO',ID_Requisicao:randomUUID(),...extra};const table=s.main.getSheetByName('Logs_Auditoria');table.appendRow(table.rows[0].map(k=>r[k]));return r;}
 return {...s,auditHttp:http,auditList:list,addAudit:add,filters};
}
