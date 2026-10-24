// Disposable contacts and Google emulator only; never sends real email.
import { createHmac,randomUUID } from 'node:crypto';
import { profileFixture } from './profile-fixture.mjs';
import { createEmailChangeHandler,loadEmailChangeSettings } from '../../backend/email-change-handler.mjs';
const origin='https://dev--merry-chimera-49a1f3.netlify.app';
export function emailChangeFixture(){const s=profileFixture();s.env.WORKSPACE_EMAIL_CHANGE_ENABLED='true';s.gas.props.EMAIL_CHANGE_ENABLED='true';const handler=createEmailChangeHandler({loadSettings:()=>loadEmailChangeSettings(s.env),createClient:()=>s.client});
 const csrf=who=>createHmac('sha256',s.settings.tokenKey).update(JSON.stringify(['csrf.v1',s.settings.config.environment,s.settings.config.installationId,who.rawToken])).digest('base64url');
 async function emailHttp(op,body,who=s.master,headers={}){return handler(new Request(origin+'/api/v1/email-change/'+op,{method:body?'POST':'GET',headers:{cookie:who.cookie,...(body?{origin,'content-type':'application/json','x-csrf-token':csrf(who)}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}));}
 const command=(extra={})=>({commandId:randomUUID(),expectedRevision:0,email:'novo@example.invalid',...extra});
 const code=()=>s.gas.outbox.at(-1).body.match(/\n([A-Za-z0-9_-]{43})\n/)[1];
 const journal=(id=s.master.id)=>JSON.parse(s.gas.props['IDENTITY_EMAIL_CHANGE_'+id]);
 return {...s,emailHandler:handler,emailHttp,emailCommand:command,emailCode:code,emailJournal:journal};
}
