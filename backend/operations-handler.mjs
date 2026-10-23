import { randomUUID } from 'node:crypto';
import { ApiError,json,safeFailure } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { createSessionService } from './session-service.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { requirePermission,requireSameOriginMutation,requireCsrfToken } from './authorization.mjs';
import { normalizeOperation } from './operations-model.mjs';
import { catalogUuid } from './catalog-model.mjs';
const ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app';
export function loadOperationsSettings(env=process.env){if(env.WORKSPACE_OPERATIONS_ENABLED!=='true')throw new ApiError(503,'OPERATIONS_NOT_ACTIVATED');return loadSessionSettings(env);}
export function createOperationsHandler(dependencies={}){return async request=>{const requestId=randomUUID();try{
 const url=new URL(request.url),op=url.pathname.split('/').at(-1),write=['adjust','reverse'].includes(op);if(url.origin!==ORIGIN)throw new ApiError(403,'FORBIDDEN');if(!['list','get','adjust','reverse'].includes(op))throw new ApiError(404,'NOT_FOUND');const method=write?'POST':'GET';if(request.method!==method){const r=json({error:{code:'METHOD_NOT_ALLOWED',requestId}},405);r.headers.set('allow',method);return r;}
 const settings=(dependencies.loadSettings||loadOperationsSettings)(),client=(dependencies.createClient||createWorkspaceClient)(settings.config),sessions=createSessionService(settings,{client});if(write)requireSameOriginMutation(request,ORIGIN);const principal=await sessions.authenticate(request);
 requirePermission(principal,write?op==='adjust'?'stock.adjust':'sales.reverse':principal.role==='ATENDENTE'?'sales.self.read':'audit.read');if(write)requireCsrfToken(request,(await sessions.current(request)).csrfToken);
 let payload;if(write){if(url.search)throw new ApiError(400,'INVALID_OPERATION');const reader=request.body?.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0;try{if(reader){while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000){await reader.cancel();throw new ApiError(413,'INVALID_OPERATION');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}payload=normalizeOperation(op,JSON.parse(text));}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(400,'INVALID_OPERATION');}}
 else if(op==='get'){if([...url.searchParams.keys()].some(k=>k!=='id'||url.searchParams.getAll(k).length!==1)||!catalogUuid(url.searchParams.get('id')))throw new ApiError(400,'INVALID_OPERATION');payload={id:url.searchParams.get('id')};}
 else{const q=url.searchParams;if([...q.keys()].some(k=>!['from','to','offset'].includes(k)||q.getAll(k).length!==1)||!/^\d{1,4}$/.test(q.get('offset')||'0'))throw new ApiError(400,'INVALID_OPERATION');const from=q.get('from'),to=q.get('to');if(![from,to].every(s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s)||Date.parse(to)<Date.parse(from)||Date.parse(to)-Date.parse(from)>366*86400000)throw new ApiError(400,'INVALID_OPERATION');payload={from,to,offset:Number(q.get('offset')||0)};}
 return json({data:await client.operations(op,{sessionTokenHash:principal.sessionTokenHash},payload),requestId});
 }catch(e){return safeFailure(e,requestId);}};}
