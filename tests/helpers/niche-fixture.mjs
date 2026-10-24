import { createHmac,randomUUID } from 'node:crypto';
import { catalogFixture } from './catalog-fixture.mjs';
import { createNicheHandler,loadNicheSettings } from '../../backend/niche-handler.mjs';
export function nicheFixture(){const s=catalogFixture();s.env.WORKSPACE_NICHES_ENABLED='true';s.gas.props.NICHES_ENABLED='true';const admin=s.session('ADMIN'),handler=createNicheHandler({loadSettings:()=>loadNicheSettings(s.env),createClient:()=>s.client});
 const command=(x={})=>({commandId:randomUUID(),id:randomUUID(),expectedRevision:0,record:{name:'Vida cristã',description:'Leituras para o dia a dia',color:'#205b43',order:2,active:true},...x});
 async function nicheHttp(op,p,who=admin,headers={}){const csrf=createHmac('sha256',s.settings.tokenKey).update(JSON.stringify(['csrf.v1',s.settings.config.environment,s.settings.config.installationId,who.rawToken])).digest('base64url');return handler(new Request('https://dev--merry-chimera-49a1f3.netlify.app/api/v1/niches/'+op,{method:p?'POST':'GET',headers:{cookie:who.cookie,...(p?{origin:'https://dev--merry-chimera-49a1f3.netlify.app','content-type':'application/json','x-csrf-token':csrf}:{}),...headers},...(p?{body:JSON.stringify(p)}:{})}));}
 return {...s,admin,nicheHandler:handler,nicheCommand:command,nicheHttp};}
