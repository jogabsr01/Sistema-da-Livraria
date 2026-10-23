import { customerFixture,CUSTOMER_ORIGIN } from './customer-fixture.mjs';
import { createOperationsHandler,loadOperationsSettings } from '../../backend/operations-handler.mjs';
import { createSessionService } from '../../backend/session-service.mjs';
export function operationsFixture(){
 const s=customerFixture();s.env.WORKSPACE_OPERATIONS_ENABLED='true';s.gas.props.OPERATIONS_ENABLED='true';const sessions=createSessionService(s.settings,{client:s.client});
 const handler=createOperationsHandler({loadSettings:()=>loadOperationsSettings(s.env),createClient:()=>s.client});
 async function http(op,p,who=s.master,headers={}){const write=['adjust','reverse'].includes(op),session=await sessions.current(new Request(CUSTOMER_ORIGIN+'/api/v1/session',{headers:{cookie:who.cookie}}));const query=!write?'?'+new URLSearchParams(Object.entries(p)):'';
 return handler(new Request(CUSTOMER_ORIGIN+'/api/v1/operations/'+op+query,{method:write?'POST':'GET',headers:{cookie:who.cookie,...(write?{origin:CUSTOMER_ORIGIN,'content-type':'application/json','x-csrf-token':session.csrfToken}:{}),...headers},...(write?{body:JSON.stringify(p)}:{})}));}
 const period=()=>({from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+86400000).toISOString(),offset:0});
 return {...s,operationsHandler:handler,operationsHttp:http,period};
}
