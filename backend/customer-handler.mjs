import { createPostalCodeLookup,normalizePostalCode } from './postal-code.mjs';
import { randomUUID } from 'node:crypto';
import { ApiError,json,safeFailure } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { createSessionService } from './session-service.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { requirePermission,requireSameOriginMutation,requireCsrfToken } from './authorization.mjs';
import { loadPersonalDataSettings,createPersonalDataVault } from './personal-data.mjs';
import { normalizeCpf } from './staff-model.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { normalizeCustomerCommand,customerInvalid,customerDto } from './customer-model.mjs';
const ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app';
export function loadCustomerSettings(env=process.env){if(env.WORKSPACE_CUSTOMERS_ENABLED!=='true')throw new ApiError(503,'CUSTOMERS_NOT_ACTIVATED');return {...loadSessionSettings(env),...loadPersonalDataSettings(env)};}
export function createCustomerHandler(dependencies={}){return async request=>{const requestId=randomUUID();try{
 const url=new URL(request.url),op=url.pathname.split('/').at(-1);if(url.origin!==ORIGIN)throw new ApiError(403,'FORBIDDEN');if(!['find','get','save','postal-code'].includes(op)||url.search)throw new ApiError(404,'NOT_FOUND');
 if(request.method!=='POST'){const r=json({error:{code:'METHOD_NOT_ALLOWED',requestId}},405);r.headers.set('allow','POST');return r;}
 const settings=(dependencies.loadSettings||loadCustomerSettings)(),client=(dependencies.createClient||createWorkspaceClient)(settings.config),vault=createPersonalDataVault(settings),sessions=createSessionService(settings,{client});
 requireSameOriginMutation(request,ORIGIN);const principal=await sessions.authenticate(request);requirePermission(principal,op==='save'?'customers.write':'customers.read');requireCsrfToken(request,sessions.csrfFor(request,principal));
 const actor={sessionTokenHash:principal.sessionTokenHash},reader=request.body?.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0;if(reader){try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8000){await reader.cancel();throw new ApiError(413,'INVALID_CUSTOMER');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}catch(e){if(e instanceof ApiError)throw e;customerInvalid();}}
 let p;try{p=JSON.parse(text);}catch{customerInvalid();}
 if(op==='postal-code'){
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).join()!=='postalCode')customerInvalid();const postalCode=normalizePostalCode(p.postalCode);
  const limit=await client.reserveAuthAttempt({accountKey:vault.fingerprint(['postal-code.user.v1',principal.id]),originKey:vault.fingerprint(['postal-code.installation.v1',settings.config.installationId])});
  if(!limit.allowed){const r=json({error:{code:'POSTAL_CODE_RATE_LIMITED',retryAfterSeconds:limit.retryAfterSeconds},requestId},429);r.headers.set('retry-after',String(limit.retryAfterSeconds));return r;}
  return json({data:await (dependencies.postalLookup||createPostalCodeLookup())(postalCode),requestId});
 }
 if(op==='find'||op==='get'){
  const key=op==='find'?'cpf':'id';if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).join()!==key)customerInvalid();
  let payload;if(op==='find'){try{payload={cpfIndex:vault.index('customer.cpf',normalizeCpf(p.cpf))};}catch{customerInvalid();}}else{if(!catalogUuid(p.id))customerInvalid();payload=p;}
  const data=await client.customers(op,actor,payload);if(!data||!Object.hasOwn(data,'customer'))throw new ApiError(502,'UPSTREAM_UNTRUSTED');
  if(data.customer===null)return json({data:{customer:null},requestId});
  const customer=customerDto(data.customer,vault);if(op==='get'&&customer.id!==p.id)throw new ApiError(502,'UPSTREAM_UNTRUSTED');
  if(op==='find'&&normalizeCpf(p.cpf)!==vault.open('customers',customer.id,data.customer.contact).cpf)throw new ApiError(502,'UPSTREAM_UNTRUSTED');
  return json({data:{customer},requestId});
 }
 if(p?.record?.cpf===''&&catalogUuid(p.id)&&Number.isSafeInteger(p.expectedRevision)&&p.expectedRevision>0){const d=await client.customers('get',actor,{id:p.id});if(d?.customer?.id!==p.id)customerInvalid();p.record.cpf=vault.open('customers',p.id,d.customer.contact).cpf;}
 const command=normalizeCustomerCommand(p),data=await client.customers('save',actor,{commandId:command.commandId,id:command.id,expectedRevision:command.expectedRevision,
  contact:vault.seal('customers',command.id,command.record),cpfIndex:vault.index('customer.cpf',command.record.cpf),fingerprint:vault.fingerprint(command),contactPreference:command.record.contactPreference,marketingConsent:command.record.marketingConsent});
 if(data?.id!==command.id||data.revision!==command.expectedRevision+1)throw new ApiError(502,'UPSTREAM_UNTRUSTED');return json({data:{id:data.id,revision:data.revision},requestId});
}catch(error){return safeFailure(error,requestId);}};}
