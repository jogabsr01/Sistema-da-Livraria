import { createHash,createHmac,randomBytes,randomUUID } from 'node:crypto';
import { ApiError,json,safeFailure } from './errors.mjs';
import { loadProfileSettings,unpackProfile } from './profile-handler.mjs';
import { createPersonalDataVault } from './personal-data.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { createSessionService } from './session-service.mjs';
import { requirePermission,requireSameOriginMutation,requireCsrfToken } from './authorization.mjs';
import { staffText } from './staff-model.mjs';
import { catalogUuid } from './catalog-model.mjs';
const ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app';
export function loadEmailChangeSettings(env=process.env){if(env.WORKSPACE_EMAIL_CHANGE_ENABLED!=='true')throw new ApiError(503,'EMAIL_CHANGE_NOT_ACTIVATED');return loadProfileSettings(env);}
const invalid=()=>{throw new ApiError(400,'INVALID_EMAIL_CHANGE');};
function address(value){const email=staffText(value,254,true).toLowerCase(),parts=email.split('@');if(parts.length!==2||parts[0].length>64||!/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/i.test(parts[0])||parts[0][0]==='.'||parts[0].endsWith('.')||parts[0].includes('..')||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(parts[1]))invalid();return email;}
export function emailChangeCodeHash(settings,userId,commandId,code){return createHmac('sha256',settings.indexKey).update(JSON.stringify(['email-change.code.v1',settings.config.environment,settings.config.installationId,userId,commandId,code])).digest('hex');}
function dto(v){if(!v||!['EMAIL','IDLE','COMPLETE'].includes(v.stage)||v.commandId!==null&&!catalogUuid(v.commandId)||v.revision!==null&&(!Number.isSafeInteger(v.revision)||v.revision<1)||v.expiresAt!==null&&(typeof v.expiresAt!=='string'||!Number.isFinite(Date.parse(v.expiresAt)))||v.stage==='COMPLETE'&&v.revision===null||v.stage==='EMAIL'&&(!v.commandId||!v.expiresAt))throw new ApiError(502,'UPSTREAM_UNTRUSTED');return {commandId:v.commandId,stage:v.stage,revision:v.revision,expiresAt:v.expiresAt};}
export function createEmailChangeHandler(dependencies={}){return async request=>{const requestId=randomUUID();try{
 const url=new URL(request.url),op=url.pathname.split('/').at(-1);if(url.origin!==ORIGIN)throw new ApiError(403,'FORBIDDEN');if(!['state','start','confirm','cancel'].includes(op)||url.search)throw new ApiError(404,'NOT_FOUND');const method=op==='state'?'GET':'POST';if(request.method!==method){const r=json({error:{code:'METHOD_NOT_ALLOWED',requestId}},405);r.headers.set('allow',method);return r;}
 const settings=(dependencies.loadSettings||loadEmailChangeSettings)(),client=(dependencies.createClient||createWorkspaceClient)(settings.config),sessions=createSessionService(settings,{client}),vault=createPersonalDataVault(settings);if(method==='POST')requireSameOriginMutation(request,ORIGIN);
 const principal=await sessions.authenticate(request);requirePermission(principal,method==='POST'?'profile.self.write':'profile.self.read');const actor={sessionTokenHash:principal.sessionTokenHash};if(method==='POST')requireCsrfToken(request,(await sessions.current(request)).csrfToken);
 if(op==='state')return json({data:dto(await client.profile('emailState',actor,{})),requestId});
 let text='',size=0;const reader=request.body?.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});try{if(reader){while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();throw new ApiError(413,'INVALID_EMAIL_CHANGE');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}}catch(e){if(e instanceof ApiError)throw e;invalid();}
 let p;try{p=JSON.parse(text);}catch{invalid();}const fields={start:['commandId','expectedRevision','email'],confirm:['commandId','code'],cancel:['commandId']}[op];if(!p||typeof p!=='object'||Array.isArray(p)||JSON.stringify(Object.keys(p).sort())!==JSON.stringify(fields.sort())||!catalogUuid(p.commandId))invalid();
 let payload={commandId:p.commandId};if(op==='start'){
  const delivery=address(p.email);if(!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<0||p.expectedRevision>1000000)invalid();
  const own=unpackProfile(await client.profile('get',actor,{}),vault,principal.id),code=randomBytes(32).toString('base64url');
  payload={...payload,expectedRevision:p.expectedRevision,delivery,emailIndex:vault.index('email',delivery),contact:own.owner?'':vault.seal('users',principal.id,{...own.record,email:delivery}),sourceHash:createHash('sha256').update(own.contact).digest('hex'),fingerprint:vault.fingerprint({operation:'email.change',id:principal.id,commandId:p.commandId,expectedRevision:p.expectedRevision,email:delivery}),code,codeHash:emailChangeCodeHash(settings,principal.id,p.commandId,code)};
 }else if(op==='confirm'){if(typeof p.code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(p.code))invalid();payload.codeHash=emailChangeCodeHash(settings,principal.id,p.commandId,p.code);}
 const operation={start:'emailStart',confirm:'emailConfirm',cancel:'emailCancel'}[op],data=dto(await client.profile(operation,actor,payload));return json({data,requestId},op==='start'?202:200);
 }catch(e){return safeFailure(e,requestId);}};}
