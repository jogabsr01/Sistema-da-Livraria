import { createHash, randomUUID } from 'node:crypto';
import { ApiError, json, safeFailure } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { createSessionService,sessionTransportContext,validateSessionPrincipal } from './session-service.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { requirePermission, requireSameOriginMutation, requireCsrfToken } from './authorization.mjs';
import { loadPersonalDataSettings, createPersonalDataVault } from './personal-data.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { normalizeStaffCommand, staffDto, staffInvalid } from './staff-model.mjs';
export const STAFF_ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app';
export function loadStaffSettings(env=process.env){if(env.WORKSPACE_STAFF_ENABLED!=='true')throw new ApiError(503,'STAFF_NOT_ACTIVATED');return {...loadSessionSettings(env),...loadPersonalDataSettings(env)};}
export function createStaffHandler(dependencies={}){
 return async request=>{const requestId=randomUUID();try{
  const url=new URL(request.url),op=url.pathname.split('/').at(-1);if(url.origin!==STAFF_ORIGIN)throw new ApiError(403,'FORBIDDEN');
  if(!['bootstrap','list','save'].includes(op))throw new ApiError(404,'NOT_FOUND');const method=op==='save'?'POST':'GET';
  if(request.method!==method){const r=json({error:{code:'METHOD_NOT_ALLOWED',requestId}},405);r.headers.set('allow',method);return r;}
  const settings=(dependencies.loadSettings||loadStaffSettings)(),client=(dependencies.createClient||createWorkspaceClient)(settings.config),vault=createPersonalDataVault(settings),sessions=createSessionService(settings,{client});
  if(op==='bootstrap'){
   if([...url.searchParams.keys()].some(k=>k!=='offset'||url.searchParams.getAll(k).length!==1)||!/^\d{1,4}$/.test(url.searchParams.get('offset')||'0')||Number(url.searchParams.get('offset')||0)>5000)staffInvalid();
   const context=sessionTransportContext(request,settings),data=await client.staff('bootstrap',context.actor,{offset:Number(url.searchParams.get('offset')||0)}),principal=validateSessionPrincipal(data?.principal,Date.now(),settings.config.adminPinLogin===true);requirePermission(principal,'users.attendant.manage',{targetRole:'ATENDENTE'});
   if(!Array.isArray(data.users)||data.users.length>25||!Number.isSafeInteger(data.total)||data.total<0||data.total>5000||data.nextOffset!==null&&(!Number.isSafeInteger(data.nextOffset)||data.nextOffset!==Number(url.searchParams.get('offset')||0)+data.users.length||data.nextOffset>=data.total))throw new ApiError(502,'UPSTREAM_UNTRUSTED');
   return json({data:{total:data.total,nextOffset:data.nextOffset,users:data.users.map(row=>staffDto(row,vault)),user:{id:principal.id,role:principal.role,assurance:principal.assurance,expiresAt:principal.expiresAt},csrfToken:context.csrfToken},requestId});
  }
  if(method==='POST')requireSameOriginMutation(request,STAFF_ORIGIN);const principal=await sessions.authenticate(request);
  // Current target role is resolved AGAIN in GAS; here only the broad admin gate.
  requirePermission(principal,'users.attendant.manage',{targetRole:'ATENDENTE'});
  const actor={sessionTokenHash:principal.sessionTokenHash};
  if(op==='list'){
   if([...url.searchParams.keys()].some(key=>key!=='offset'||url.searchParams.getAll(key).length!==1)||!/^\d{1,4}$/.test(url.searchParams.get('offset')||'0'))staffInvalid();
   const data=await client.staff('list',actor,{offset:Number(url.searchParams.get('offset')||0)});
   if(!data||!Array.isArray(data.users)||data.users.length>25||!Number.isSafeInteger(data.total)||data.total<0||data.total>5000||data.nextOffset!==null&&(!Number.isSafeInteger(data.nextOffset)||data.nextOffset!==Number(url.searchParams.get('offset')||0)+data.users.length||data.nextOffset>=data.total))throw new ApiError(502,'UPSTREAM_UNTRUSTED');
   return json({data:{total:data.total,nextOffset:data.nextOffset,users:data.users.map(row=>staffDto(row,vault))},requestId});
  }
  if(url.search)staffInvalid();requireCsrfToken(request,sessions.csrfFor(request,principal));
  const reader=request.body?.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let content='',size=0;
  if(reader){try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>5000){await reader.cancel();throw new ApiError(413,'INVALID_STAFF');}content+=decoder.decode(value,{stream:true});}content+=decoder.decode();}catch(e){if(e instanceof ApiError)throw e;staffInvalid();}}
  let input;try{input=JSON.parse(content);}catch{staffInvalid();}if(input?.contact?.cpf===''&&catalogUuid(input.id)&&Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>0){
   const existing=await client.staff('get',actor,{id:input.id});
   if(existing?.user?.id!==input.id)throw new ApiError(409,'WORKSPACE_STAFF_CONFLICT');
   input.contact.cpf=vault.open('users',input.id,existing.user.contact).cpf;
  }
  const command=normalizeStaffCommand(input);
  if(command.role==='ADMIN')requirePermission(principal,'users.admin.manage',{targetRole:'ADMIN'});
  const {contact,...rest}=command;
  // Stable private command digest tolerates fresh encryption IVs on safe retry.
  const fingerprint=vault.fingerprint({...rest,contact});
  const data=await client.staff('save',actor,{...rest,reason:vault.seal('users',command.id,{reason:command.reason}),fingerprint,emailCheck:createHash('sha256').update(contact.email).digest('hex'),contact:vault.seal('users',command.id,contact),emailIndex:vault.index('email',contact.email),cpfIndex:vault.index('cpf',contact.cpf)});
  if(data?.id!==command.id||data.revision!==command.expectedRevision+1||typeof data.reenrollmentRequired!=='boolean')throw new ApiError(502,'UPSTREAM_UNTRUSTED');
  return json({data,requestId});
 }catch(error){return safeFailure(error,requestId);}};
}
