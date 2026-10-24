import { randomUUID } from 'node:crypto';
import { ApiError,json,safeFailure } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { loadPersonalDataSettings,createPersonalDataVault } from './personal-data.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { createSessionService } from './session-service.mjs';
import { requirePermission,requireSameOriginMutation,requireCsrfToken } from './authorization.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { staffText } from './staff-model.mjs';
import { auditFilters,auditHash,invalidAudit,validateAuditData } from './audit-model.mjs';
import { createAuditWorkbook } from './audit-xlsx.mjs';
const ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app';
export function loadAuditSettings(env=process.env){if(env.WORKSPACE_AUDIT_ENABLED!=='true'||env.WORKSPACE_CATALOG_ENABLED!=='true')throw new ApiError(503,'AUDIT_NOT_ACTIVATED');return {...loadSessionSettings(env),...loadPersonalDataSettings(env)};}
export function createAuditHandler(deps={}){return async request=>{const requestId=randomUUID();try{
 const url=new URL(request.url),op=url.pathname.split('/').at(-1),exporting=op==='export';if(url.origin!==ORIGIN)throw new ApiError(403,'FORBIDDEN');if(!['list','export'].includes(op))throw new ApiError(404,'NOT_FOUND');const method=exporting?'POST':'GET';if(request.method!==method){const r=json({error:{code:'METHOD_NOT_ALLOWED',requestId}},405);r.headers.set('allow',method);return r;}
 const settings=(deps.loadSettings||loadAuditSettings)(),client=(deps.createClient||createWorkspaceClient)(settings.config),sessions=createSessionService(settings,{client}),vault=createPersonalDataVault(settings);if(exporting)requireSameOriginMutation(request,ORIGIN);const principal=await sessions.authenticate(request);requirePermission(principal,'audit.read');if(exporting)requireCsrfToken(request,(await sessions.current(request)).csrfToken);
 let p;if(exporting){if(url.search)invalidAudit();let text='',size=0;const reader=request.body?.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});try{if(reader){while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4000){await reader.cancel();throw new ApiError(413,'INVALID_AUDIT');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}p=JSON.parse(text);}catch(e){if(e instanceof ApiError)throw e;invalidAudit();}if(!p||Object.keys(p).sort().join()!=='commandId,filters,snapshot'||!catalogUuid(p.commandId)||!auditHash(p.snapshot))invalidAudit();p={commandId:p.commandId,filters:auditFilters(p.filters),snapshot:p.snapshot};}
 else{const keys=['from','to','employeeId','operation','productId','saleId','result','offset','snapshot'];if([...url.searchParams.keys()].some(k=>!keys.includes(k)||url.searchParams.getAll(k).length!==1))invalidAudit();const q=url.searchParams,filters=auditFilters(Object.fromEntries(keys.slice(0,7).map(k=>[k,q.get(k)||''])));if(!/^\d{1,4}$/.test(q.get('offset')||'0'))invalidAudit();const offset=Number(q.get('offset')||0),snapshot=q.get('snapshot')||'';if(offset>5000||snapshot&&!auditHash(snapshot)||offset&&!snapshot)invalidAudit();p={filters,offset,snapshot};}
 const data=validateAuditData(await client.audit(op,{sessionTokenHash:principal.sessionTokenHash},p),op,p);
 const people=data.people.map(person=>{if(['SYSTEM_STOCK','SYSTEM_AUTH'].includes(person.id))return {id:person.id,name:person.id==='SYSTEM_STOCK'?'Sistema de estoque':'Sistema de autenticação'};if(!catalogUuid(person.id))throw new ApiError(502,'UPSTREAM_UNTRUSTED');if(person.missing){if(person.owner||person.contact)throw new ApiError(502,'UPSTREAM_UNTRUSTED');return {id:person.id,name:'Conta histórica · '+person.id.slice(0,8)};}const record=person.contact?vault.open('users',person.id,person.contact):null;if(!record&&!person.owner)throw new ApiError(502,'UPSTREAM_UNTRUSTED');return {id:person.id,name:record?staffText(record.name,160,true):'Conta proprietária'};});
 const clean={items:data.items,total:data.total,nextOffset:data.nextOffset,snapshot:data.snapshot,sourceCount:data.sourceCount,generatedAt:data.generatedAt,people,operations:data.operations,results:data.results};
 if(!exporting)return json({data:clean,requestId});
 const bytes=createAuditWorkbook(clean,p.filters,p.commandId);return new Response(bytes,{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':'attachment; filename="auditoria-livraria-'+p.commandId+'.xlsx"','cache-control':'private, no-store','x-content-type-options':'nosniff','x-audit-export-id':p.commandId}});
 }catch(e){return safeFailure(e,requestId);}};}
