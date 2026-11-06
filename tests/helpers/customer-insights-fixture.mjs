import { createHmac } from 'node:crypto';
import { reportFixture } from './report-fixture.mjs';
import { createCustomerInsightsHandler,loadCustomerInsightsSettings } from '../../backend/customer-insights-handler.mjs';
const origin='https://dev--merry-chimera-49a1f3.netlify.app';
export function insightFixture(){const s=reportFixture();s.env.WORKSPACE_CUSTOMER_INSIGHTS_ENABLED='true';s.gas.props.CUSTOMER_INSIGHTS_ENABLED='true';const handler=createCustomerInsightsHandler({loadSettings:()=>loadCustomerInsightsSettings(s.env),createClient:()=>s.client});
 async function http(op,p,who=s.master,headers={},fn=handler){const csrf=createHmac('sha256',s.settings.tokenKey).update(JSON.stringify(['csrf.v1',s.settings.config.environment,s.settings.config.installationId,who.rawToken])).digest('base64url');return fn(new Request(origin+'/api/v1/customer-insights/'+op,{method:'POST',headers:{cookie:who.cookie,origin,'content-type':'application/json','x-csrf-token':csrf,...headers},body:JSON.stringify(p)}));}
 return {...s,insightHttp:http,insightHandler:handler};}
