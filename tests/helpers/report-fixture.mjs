import { createHmac } from 'node:crypto';
import { operationsFixture } from './operations-fixture.mjs';
import { createReportHandler,loadReportSettings } from '../../backend/report-handler.mjs';
const origin='https://dev--merry-chimera-49a1f3.netlify.app';
export function reportFixture(){const s=operationsFixture();s.env.WORKSPACE_REPORTS_ENABLED='true';s.gas.props.REPORTS_ENABLED='true';const handler=createReportHandler({loadSettings:()=>loadReportSettings(s.env),createClient:()=>s.client});
 const filters=(extra={})=>({kind:'SALES',from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+86400000).toISOString(),employeeId:'',customerId:'',cpf:'',productId:'',query:'',isbn:'',author:'',publisher:'',supplier:'',nicheId:'',category:'',city:'',minCents:null,maxCents:null,paymentMethod:'',stock:'ALL',activity:'ALL',movementType:'',...extra});
 async function http(op,p,who=s.master,headers={},fn=handler){const csrf=createHmac('sha256',s.settings.tokenKey).update(JSON.stringify(['csrf.v1',s.settings.config.environment,s.settings.config.installationId,who.rawToken])).digest('base64url');return fn(new Request(origin+'/api/v1/reports/'+op,{method:'POST',headers:{cookie:who.cookie,origin,'content-type':'application/json','x-csrf-token':csrf,...headers},body:JSON.stringify(p)}));}
 return {...s,reportHandler:handler,reportHttp:http,reportFilters:filters};}
