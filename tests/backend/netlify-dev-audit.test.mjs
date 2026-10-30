import test from 'node:test';
import assert from 'node:assert/strict';
import {auditNetlify,inspectVariables,effectiveDevVariable} from '../../scripts/netlify-dev-audit.mjs';
const env={GITHUB_REPOSITORY:'jogabsr01/Sistema-da-Livraria',GITHUB_REF:'refs/heads/dev',GITHUB_EVENT_NAME:'push',NETLIFY_DEV_AUDIT_TOKEN:'FAKE_NETLIFY_TEST_TOKEN_123456789'};
const site={id:'11111111-2222-4333-8444-555555555555',name:'merry-chimera-49a1f3',account_id:'account_fake_12345',build_settings:{provider:'github',repo_path:'jogabsr01/Sistema-da-Livraria',repo_branch:'main'}};
const variable=(key,value,context='branch',context_parameter='dev',scopes=['functions'])=>({key,scopes,values:[{context,context_parameter,value}]});
function remote({modifySite=()=>{},vars=[],deploys=[],status=200,raw=null,throwError=false}={}){const calls=[];const fetchImpl=async(url,options)=>{calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer '+env.NETLIFY_DEV_AUDIT_TOKEN);if(throwError)throw Error('PRIVATE_HTTP_TOKEN_SENTINEL');const value=structuredClone(site);modifySite(value);const body=url.endsWith('.netlify.app')?value:url.includes('/env?')?vars:deploys;return new Response(raw??JSON.stringify(body),{status,headers:{'content-type':'application/json'}});};return{calls,fetchImpl};}
test('audit is fixed to DEV and GET-only, checks project binding first and does not disclose provider objects',async()=>{
 const privateValue='PRIVATE_VALUE_SENTINEL',r=remote({vars:[variable('WORKSPACE_PIN_PEPPER',privateValue)],deploys:[{branch:'main',context:'production',state:'ready',error_message:privateValue},{branch:'dev',context:'branch-deploy',state:'ready',commit_ref:'a'.repeat(40),created_at:'2026-10-30T12:35:00Z',log:privateValue}]});
 const report=await auditNetlify(env,r);assert.equal(report.state,'AUDITED');assert.equal(r.calls.length,3);assert.ok(r.calls[1].url.includes('site_id='+site.id));assert.equal(report.latestDevDeploy.branch,'dev');assert.equal(report.latestDevDeploy.state,'ready');const raw=JSON.stringify(report);assert.ok(!raw.includes(privateValue));assert.ok(!raw.includes(env.NETLIFY_DEV_AUDIT_TOKEN));assert.ok(!raw.includes(site.id));assert.ok(!raw.includes(site.account_id));assert.equal(report.productionModified,false);
});
test('missing credential reports not connected; wrong repository, branch and event cannot send any request',async()=>{
 const r=remote();assert.equal((await auditNetlify({...env,NETLIFY_DEV_AUDIT_TOKEN:undefined},r)).state,'NOT_CONFIGURED');assert.equal(r.calls.length,0);
 for(const patch of [{GITHUB_REF:'refs/heads/main'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REF:'refs/pull/1/merge'}])await assert.rejects(auditNetlify({...env,...patch},r),{auditCode:'DEV_CONTEXT_REQUIRED'});assert.equal(r.calls.length,0);
});
test('an unexpected project or account cannot reach environment-variable endpoints',async()=>{
 for(const modifySite of [s=>s.name='other',s=>s.id='bad',s=>s.account_id='../escape',s=>s.build_settings.repo_path='other/repo',s=>s.build_settings.repo_branch='dev',s=>s.build_settings.provider='other']){const r=remote({modifySite});await assert.rejects(auditNetlify(env,r),{auditCode:'PROJECT_BINDING_MISMATCH'});assert.equal(r.calls.length,1);}
});
test('branch:dev overrides branch-deploy and all; Netlify local dev and production never substitute for the deployed DEV branch',()=>{
 const v=variable('FLAG','all','all');v.values.push({context:'branch-deploy',value:'branch-deploy'},{context:'branch',context_parameter:'dev',value:'exact'},{context:'dev',value:'local'},{context:'production',value:'production'},{context:'branch',context_parameter:'other',value:'other'});assert.equal(effectiveDevVariable([v],'FLAG').value,'exact');v.values=v.values.filter(x=>x.context!=='branch');assert.equal(effectiveDevVariable([v],'FLAG').value,'branch-deploy');v.values=v.values.filter(x=>x.context!=='branch-deploy');assert.equal(effectiveDevVariable([v],'FLAG').value,'all');v.values=v.values.filter(x=>x.context!=='all');assert.equal(effectiveDevVariable([v],'FLAG').status,'LOCAL_DEV_ONLY');
});
test('missing function scope, duplicate metadata, unavailable values and secrets are reported without their values',()=>{
 for(const [v,status]of [[variable('FLAG','true','all',null,['builds']),'FUNCTIONS_SCOPE_MISSING'],[{...variable('FLAG','SENTINEL'),is_secret:true},'VALUE_NOT_READABLE'],[{key:'FLAG',scopes:['functions'],values:[{context:'branch-deploy'}]},'VALUE_NOT_READABLE']]){assert.equal(effectiveDevVariable([v],'FLAG').status,status);assert.ok(!JSON.stringify(inspectVariables([v],['FLAG'])).includes('SENTINEL'));}
 const duplicate=variable('FLAG','true');duplicate.values.push({...duplicate.values[0]});assert.equal(effectiveDevVariable([duplicate],'FLAG').status,'AMBIGUOUS_CONTEXT');assert.equal(effectiveDevVariable([duplicate,duplicate],'FLAG').status,'DUPLICATE_VARIABLE');
});
test('checks validate formats, required flags, the pinned script URL, and distinct private keys without exposing hashes',()=>{
 const keys=['WORKSPACE_HMAC_SECRET','WORKSPACE_SESSION_TOKEN_KEY','WORKSPACE_AUTH_GUARD_KEY','WORKSPACE_PIN_PEPPER','WORKSPACE_PERSONAL_DATA_KEY','WORKSPACE_PERSONAL_INDEX_KEY'];const vars=[...keys.map((key,i)=>variable(key,(i+1).toString(16).repeat(64))),variable('APP_ENV','dev'),variable('WORKSPACE_SCRIPT_URL','https://attacker.invalid'),variable('WORKSPACE_PROFILE_ENABLED','false'),variable('WORKSPACE_STAFF_ENABLED','true','dev',null)];
 let report=inspectVariables(vars,['WORKSPACE_PROFILE_ENABLED','WORKSPACE_STAFF_ENABLED']);assert.equal(report.checks.find(x=>x.name==='APP_ENV').status,'OK');assert.equal(report.checks.find(x=>x.name==='WORKSPACE_SCRIPT_URL').status,'INVALID_VALUE');assert.equal(report.checks.find(x=>x.name==='WORKSPACE_PROFILE_ENABLED').status,'INVALID_VALUE');assert.equal(report.checks.find(x=>x.name==='WORKSPACE_STAFF_ENABLED').status,'LOCAL_DEV_ONLY');assert.ok(!JSON.stringify(report).includes('https://attacker.invalid'));
 vars[1].values[0].value=vars[0].values[0].value;report=inspectVariables(vars,[]);assert.equal(report.checks.filter(x=>x.status==='KEY_REUSED').length,2);for(const v of vars.slice(0,6))assert.ok(!JSON.stringify(report).includes(v.values[0].value));
});
test('provider failures, invalid JSON and network exceptions emit only fixed audit errors',async()=>{
 for(const status of [401,403,404,429,500]){const r=remote({status,raw:'PRIVATE_PROVIDER_SENTINEL'});await assert.rejects(auditNetlify(env,r),e=>e.auditCode==='NETLIFY_HTTP_'+status||status===500&&e.auditCode==='NETLIFY_HTTP_FAILURE');}
 await assert.rejects(auditNetlify(env,remote({raw:'PRIVATE_JSON_SENTINEL'})),{auditCode:'INVALID_API_RESPONSE'});await assert.rejects(auditNetlify(env,remote({throwError:true})),e=>e.auditCode==='NETLIFY_REQUEST_FAILED'&&!e.message.includes('PRIVATE'));
});
test('oversized responses and malformed environment/deploy lists fail closed',async()=>{
 await assert.rejects(auditNetlify(env,remote({raw:'x'.repeat(1048577)})),{auditCode:'API_RESPONSE_TOO_LARGE'});
 await assert.rejects(auditNetlify(env,remote({vars:{private:'SENTINEL'}})),{auditCode:'INVALID_ENVIRONMENT_RESPONSE'});
 await assert.rejects(auditNetlify(env,remote({deploys:{private:'SENTINEL'}})),{auditCode:'INVALID_DEPLOY_RESPONSE'});
});
