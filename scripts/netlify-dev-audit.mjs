// Read-only Netlify audit. No secrets, IDs, hashes or provider bodies in reports.
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
const REPOSITORY='jogabsr01/Sistema-da-Livraria';
const SITE='merry-chimera-49a1f3';
const API='https://api.netlify.com/api/v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS=['WORKSPACE_HMAC_SECRET','WORKSPACE_SESSION_TOKEN_KEY','WORKSPACE_AUTH_GUARD_KEY','WORKSPACE_PIN_PEPPER','WORKSPACE_PERSONAL_DATA_KEY','WORKSPACE_PERSONAL_INDEX_KEY'];
const FLAGS=['WORKSPACE_BACKEND_ENABLED','WORKSPACE_IDENTITY_SESSIONS_ENABLED','WORKSPACE_IDENTITY_GUARDS_ENABLED','WORKSPACE_IDENTITY_PASSKEYS_ENABLED','WORKSPACE_IDENTITY_ACCESS_ENABLED'];
const SCRIPT='https://script.google.com/macros/s/AKfycbxSYOOABzjAgAj6658XPlAxq9U2BNz26e5ylERHzYY8UbDwNgDDKovC5rlSujolrAWO/exec';
function fail(code){throw Object.assign(new Error(code),{auditCode:code});}
// Netlify "dev" is local `netlify dev`, NOT the deployed branch named dev.
export function effectiveDevVariable(items,key){
 const matches=items.filter(v=>v?.key===key);if(matches.length>1)return {status:'DUPLICATE_VARIABLE'};
 if(!matches.length)return {status:'NOT_SET_AT_SITE'};
 const item=matches[0];if(!Array.isArray(item.scopes)||!item.scopes.includes('functions'))return {status:'FUNCTIONS_SCOPE_MISSING'};
 if(!Array.isArray(item.values))return {status:'INVALID_METADATA'};
 for(const [context,parameter]of [['branch','dev'],['branch-deploy',null],['all',null]]){
  const values=item.values.filter(v=>v?.context===context&&(context!=='branch'||v.context_parameter===parameter));
  if(values.length>1)return {status:'AMBIGUOUS_CONTEXT'};
  if(values.length){const selected=values[0];return {status:item.is_secret===true||typeof selected.value!=='string'?'VALUE_NOT_READABLE':'READABLE',context:context==='branch'?'branch:dev':context,value:item.is_secret===true?undefined:selected.value};}
 }
 return {status:item.values.some(v=>v?.context==='dev')?'LOCAL_DEV_ONLY':'DEPLOYED_DEV_VALUE_MISSING'};
}
export function inspectVariables(items,moduleFlags){
 if(!Array.isArray(items)||items.length>1000)fail('INVALID_ENVIRONMENT_RESPONSE');
 const checks=[],secrets=[];
 const rules=[['APP_ENV',v=>v==='dev'],['WORKSPACE_INSTALLATION_ID',v=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)],['WORKSPACE_SCRIPT_URL',v=>v===SCRIPT],...['WORKSPACE_SPREADSHEET_ID','WORKSPACE_DRIVE_ROOT_ID'].map(k=>[k,v=>/^[A-Za-z0-9_-]{20,160}$/.test(v)]),...KEYS.map(k=>[k,v=>/^[a-f0-9]{64}$/i.test(v)]),...[...FLAGS,...moduleFlags].map(k=>[k,v=>v==='true'])];
 for(const[key,valid]of rules){const entry=effectiveDevVariable(items,key);let status=entry.status;if(status==='READABLE'){status=valid(entry.value)?'OK':'INVALID_VALUE';if(KEYS.includes(key)&&status==='OK')secrets.push({key,value:entry.value.toLowerCase()});}checks.push({name:key,status,...(entry.context?{context:entry.context}:{}),...(FLAGS.includes(key)||moduleFlags.includes(key)?{usesAllContextsValue:entry.context==='all'}:{})});}
 for(const secret of secrets)if(secrets.some(other=>other.key!==secret.key&&other.value===secret.value))checks.find(c=>c.name===secret.key).status='KEY_REUSED';
 return {scope:'SITE_VARIABLES_FOR_BRANCH_DEV_FUNCTIONS',sharedTeamVariablesInspected:false,valuesDisclosed:false,googleSecretEqualityChecked:false,checks};
}
function safeDeploy(value){
 if(!value||value.branch!=='dev'||value.context!=='branch-deploy')return null;
 const states=['ready','error','building','enqueued','processing','uploading','prepared','new','pending_review','rejected','accepted','retrying','canceled'];
 return {branch:'dev',context:'branch-deploy',state:states.includes(value.state)?value.state:'OTHER',...(typeof value.commit_ref==='string'&&/^[a-f0-9]{40}$/.test(value.commit_ref)?{commit:value.commit_ref}:{}),...(typeof value.created_at==='string'&&/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(value.created_at)?{createdAt:value.created_at}:{})};
}
export async function auditNetlify(env=process.env,{fetchImpl=fetch,moduleFlags=[]}={}){
 if(env.GITHUB_REPOSITORY!==REPOSITORY||env.GITHUB_REF!=='refs/heads/dev'||!['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))fail('DEV_CONTEXT_REQUIRED');
 const token=env.NETLIFY_DEV_AUDIT_TOKEN;if(!token)return {state:'NOT_CONFIGURED',requiredSecret:'NETLIFY_DEV_AUDIT_TOKEN',readOnly:true};
 if(typeof token!=='string'||!/^\S{20,2048}$/.test(token))fail('INVALID_TOKEN_CONFIGURATION');
 async function get(path){
  const allowed=path==='/sites/'+SITE+'.netlify.app'||/^\/accounts\/[A-Za-z0-9_-]{8,80}\/env\?site_id=[a-f0-9-]{36}$/i.test(path)||/^\/sites\/[a-f0-9-]{36}\/deploys\?per_page=50&page=1$/i.test(path);
  if(!allowed)fail('REQUEST_OUT_OF_SCOPE');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetchImpl(API+path,{method:'GET',redirect:'error',headers:{authorization:'Bearer '+token,accept:'application/json'},signal:controller.signal});if(!response.ok)fail([401,403,404,429].includes(response.status)?'NETLIFY_HTTP_'+response.status:'NETLIFY_HTTP_FAILURE');
   const reader=response.body?.getReader();if(!reader)fail('INVALID_API_RESPONSE');let raw='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();fail('API_RESPONSE_TOO_LARGE');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();try{return JSON.parse(raw);}catch{fail('INVALID_API_RESPONSE');}
  }catch(error){if(error.auditCode)throw error;fail('NETLIFY_REQUEST_FAILED');}finally{clearTimeout(timer);}
 }
 const site=await get('/sites/'+SITE+'.netlify.app');
 if(!site||!UUID.test(site.id)||site.name!==SITE||!/^[A-Za-z0-9_-]{8,80}$/.test(site.account_id)||site.build_settings?.provider!=='github'||site.build_settings?.repo_path!==REPOSITORY||site.build_settings?.repo_branch!=='main')fail('PROJECT_BINDING_MISMATCH');
 const variables=await get('/accounts/'+site.account_id+'/env?site_id='+site.id);
 const configuration=inspectVariables(variables,moduleFlags);
 const deploys=await get('/sites/'+site.id+'/deploys?per_page=50&page=1');if(!Array.isArray(deploys)||deploys.length>50)fail('INVALID_DEPLOY_RESPONSE');
 const latest=deploys.map(safeDeploy).find(Boolean)||null;
 return {state:'AUDITED',readOnly:true,project:SITE,branch:'dev',configuration,latestDevDeploy:latest,deploymentLimit:50,productionModified:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const request=JSON.parse(await readFile(new URL('../ops/netlify-dev-audit-request.json',import.meta.url),'utf8'));if(Object.keys(request).sort().join(',')!=='mode,revision'||request.mode!=='inspect'||!Number.isSafeInteger(request.revision)||request.revision<1)fail('INVALID_REQUEST');
  const flags=(await readFile(new URL('../docs/v17/ATIVACAO_COMPLETA_DEV.env.example',import.meta.url),'utf8')).split('\n').filter(line=>/^WORKSPACE_[A-Z_]+=true$/.test(line)).map(line=>line.split('=')[0]);if(flags.length!==17||new Set(flags).size!==17)fail('INVALID_MODULE_MANIFEST');
  console.info(JSON.stringify(await auditNetlify(process.env,{moduleFlags:flags})));
 }catch(error){console.info(JSON.stringify({state:'AUDIT_FAILED',code:typeof error.auditCode==='string'?error.auditCode:'AUDIT_UNAVAILABLE',readOnly:true}));process.exitCode=1;}
}
