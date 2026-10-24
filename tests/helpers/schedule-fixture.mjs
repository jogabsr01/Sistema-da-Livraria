// Disposable encrypted contacts, sessions and emulated Google only.
import { createHmac,randomUUID } from 'node:crypto';
import { staffFixture } from './staff-fixture.mjs';
import { createScheduleHandler,loadScheduleSettings } from '../../backend/schedule-handler.mjs';
import { createNotificationHandler,loadNotificationSettings } from '../../backend/notification-handler.mjs';
const origin='https://dev--merry-chimera-49a1f3.netlify.app';
export function scheduleFixture(){const s=staffFixture();for(const mod of ['CATALOG','NOTIFICATIONS','SCHEDULES']){s.env['WORKSPACE_'+mod+'_ENABLED']='true';s.gas.props[mod+'_ENABLED']='true';}s.gas.call('provisionDevelopmentCatalog');const handler=createScheduleHandler({loadSettings:()=>loadScheduleSettings(s.env),createClient:()=>s.client}),notifications=createNotificationHandler({loadSettings:()=>loadNotificationSettings(s.env),createClient:()=>s.client});
 async function call(url,body,who=s.master,headers={},fn=handler){const csrf=createHmac('sha256',s.settings.tokenKey).update(JSON.stringify(['csrf.v1',s.settings.config.environment,s.settings.config.installationId,who.rawToken])).digest('base64url');return fn(new Request(origin+url,{method:body?'POST':'GET',headers:{cookie:who.cookie,...(body?{origin,'content-type':'application/json','x-csrf-token':csrf}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}));}
 const scheduleHttp=(op,p,who,headers)=>call('/api/v1/schedules/'+op,p,who,headers);
 const notifyHttp=(op,p,who)=>call('/api/v1/notifications/'+op,p,who,{},notifications);
 const command=(employeeId,x={})=>({commandId:randomUUID(),id:randomUUID(),expectedRevision:0,record:{employeeId,date:'2026-11-10',start:'09:00',end:'12:00',notes:'Observação privada de teste',status:'PUBLICADA'},...x});
 async function addWorker(extra={}){const c=s.command(extra);const r=await s.http('save',c);if(r.status!==200)throw Error('Test worker setup failed');return {command:c,session:s.session(c.id),id:c.id};}
 return {...s,scheduleHttp,notifyHttp,scheduleCommand:command,addWorker};}
