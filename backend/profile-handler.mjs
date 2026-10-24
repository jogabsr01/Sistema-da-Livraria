import { createHash,randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ApiError,json,safeFailure } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { loadPersonalDataSettings,createPersonalDataVault } from './personal-data.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { createSessionService } from './session-service.mjs';
import { requirePermission,requireSameOriginMutation,requireCsrfToken } from './authorization.mjs';
import { normalizeStaffContact,staffText } from './staff-model.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { prepareCoverPhoto } from './cover-photo.mjs';
const ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app';
export function loadProfileSettings(env=process.env){if(env.WORKSPACE_PROFILE_ENABLED!=='true')throw new ApiError(503,'PROFILE_NOT_ACTIVATED');return {...loadSessionSettings(env),...loadPersonalDataSettings(env),recoveryEnabled:env.WORKSPACE_RECOVERY_ENABLED==='true',emailChangeEnabled:env.WORKSPACE_EMAIL_CHANGE_ENABLED==='true'};}
function invalid(){throw new ApiError(400,'INVALID_PROFILE');}
export function unpackProfile(data,vault,id){
 if(!data||data.id!==id||!catalogUuid(id)||!['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(data.role)||typeof data.owner!=='boolean'||!Number.isSafeInteger(data.revision)||data.revision<0||typeof data.hasPhoto!=='boolean'||typeof data.lastAccess!=='string'||data.lastAccess&&!Number.isFinite(Date.parse(data.lastAccess)))throw new ApiError(502,'UPSTREAM_UNTRUSTED');
 if(data.owner){const record=data.contact?vault.open('users',id,data.contact):{name:'Conta proprietária',phone:''};return {...data,record:{name:staffText(record.name,160,true),phone:phone(record.phone)},email:staffText(data.email,254,true),cpfMasked:''};}
 const record=normalizeStaffContact(vault.open('users',id,data.contact));return {...data,record,email:record.email,cpfMasked:'***.'+record.cpf.slice(3,6)+'.'+record.cpf.slice(6,9)+'-**'};
}
function phone(value){if(typeof value!=='string'||value.length>20)invalid();const p=value.replace(/[\s()+-]/g,'');if(p&&!/^\d{10,15}$/.test(p))invalid();return p;}
export function createProfileHandler(dependencies={}){return async request=>{const requestId=randomUUID();try{
 const url=new URL(request.url),op=url.pathname.split('/').at(-1);if(url.origin!==ORIGIN)throw new ApiError(403,'FORBIDDEN');if(!['get','save','photo'].includes(op))throw new ApiError(404,'NOT_FOUND');const method=op==='save'?'POST':'GET';if(request.method!==method){const r=json({error:{code:'METHOD_NOT_ALLOWED',requestId}},405);r.headers.set('allow',method);return r;}
 if([...url.searchParams.keys()].some(k=>op!=='photo'||k!=='v'||url.searchParams.getAll(k).length!==1)||url.searchParams.has('v')&&!/^\d{1,7}$/.test(url.searchParams.get('v')))invalid();
 const settings=(dependencies.loadSettings||loadProfileSettings)(),client=(dependencies.createClient||createWorkspaceClient)(settings.config),sessions=createSessionService(settings,{client}),vault=createPersonalDataVault(settings);if(method==='POST')requireSameOriginMutation(request,ORIGIN);
 const principal=await sessions.authenticate(request);requirePermission(principal,op==='save'?'profile.self.write':'profile.self.read');const actor={sessionTokenHash:principal.sessionTokenHash};if(method==='POST')requireCsrfToken(request,(await sessions.current(request)).csrfToken);
 if(op==='photo'){const p=await client.profile('photo',actor,{});if(typeof p?.bytes!=='string'||p.bytes.length>65536||!/^([A-Za-z0-9+/]+={0,2})$/.test(p.bytes))throw new ApiError(502,'UPSTREAM_UNTRUSTED');const bytes=Buffer.from(p.bytes,'base64');if(bytes.length>49152||bytes.toString('base64')!==p.bytes||createHash('sha256').update(bytes).digest('hex')!==p.sha256||bytes[0]!==255||bytes[1]!==216)throw new ApiError(502,'UPSTREAM_UNTRUSTED');return new Response(bytes,{headers:{'content-type':'image/jpeg','cache-control':'private, no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin','content-security-policy':"default-src 'none'; sandbox"}});}
 if(op==='get'){const d=unpackProfile(await client.profile('get',actor,{}),vault,principal.id);return json({data:{id:d.id,role:d.role,owner:d.owner,name:d.record.name,email:d.email,phone:d.record.phone,cpfMasked:d.cpfMasked,lastAccess:d.lastAccess,revision:d.revision,photoUrl:d.hasPhoto?'/api/v1/profile/photo?v='+d.revision:'',recoveryEnabled:settings.recoveryEnabled===true,emailChangeEnabled:settings.emailChangeEnabled===true},requestId});}
 const reader=request.body?.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0;try{if(reader){while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>100000){await reader.cancel();throw new ApiError(413,'INVALID_PROFILE');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}}catch(e){if(e instanceof ApiError)throw e;invalid();}
 let p;try{p=JSON.parse(text);}catch{invalid();}if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['commandId','expectedRevision','phone','displayName','photo'].includes(k))||!catalogUuid(p.commandId)||!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<0)invalid();
 const d=unpackProfile(await client.profile('get',actor,{}),vault,principal.id),record={...d.record,phone:phone(p.phone)};if(p.displayName!==undefined){if(!d.owner)invalid();record.name=staffText(p.displayName,160,true);}
 const payload={commandId:p.commandId,expectedRevision:p.expectedRevision,contact:vault.seal('users',principal.id,record)},hasPhoto=Object.hasOwn(p,'photo');
 if(hasPhoto){const photo=await prepareCoverPhoto(p.photo);if(photo===null)payload.photo=null;else{const bytes=await sharp(Buffer.from(photo.bytes,'base64')).resize(256,256,{fit:'cover'}).jpeg({quality:75}).toBuffer();payload.photo={bytes:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};}}
 payload.fingerprint=vault.fingerprint({commandId:p.commandId,id:principal.id,expectedRevision:p.expectedRevision,phone:record.phone,...(d.owner?{displayName:record.name}:{}),...(hasPhoto?{photo:payload.photo?.sha256||null}:{})});
 const out=await client.profile('save',actor,payload);if(out?.revision!==p.expectedRevision+1)throw new ApiError(502,'UPSTREAM_UNTRUSTED');return json({data:{revision:out.revision},requestId});
 }catch(e){return safeFailure(e,requestId);}};}
