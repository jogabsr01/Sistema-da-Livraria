import { staffFixture } from './staff-fixture.mjs';
import { loadProfileSettings,createProfileHandler } from '../../backend/profile-handler.mjs';
import { createSessionService } from '../../backend/session-service.mjs';
export function profileFixture(){const s=staffFixture();s.env.WORKSPACE_PROFILE_ENABLED='true';s.gas.props.PROFILE_ENABLED='true';const sessions=createSessionService(s.settings,{client:s.client}),handler=createProfileHandler({loadSettings:()=>loadProfileSettings(s.env),createClient:()=>s.client});
 async function profileHttp(op,p,who=s.master,headers={}){const current=await sessions.current(new Request('https://dev--merry-chimera-49a1f3.netlify.app/api/v1/session',{headers:{cookie:who.cookie}}));return handler(new Request('https://dev--merry-chimera-49a1f3.netlify.app/api/v1/profile/'+op,{method:p?'POST':'GET',headers:{cookie:who.cookie,...(p?{origin:'https://dev--merry-chimera-49a1f3.netlify.app','content-type':'application/json','x-csrf-token':current.csrfToken}:{}),...headers},...(p?{body:JSON.stringify(p)}:{})}));}
 return {...s,profileHandler:handler,profileHttp};}
