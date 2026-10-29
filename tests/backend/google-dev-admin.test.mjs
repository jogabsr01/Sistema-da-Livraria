import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runAdmin,contentHash,safeTimings,safeProcesses,safeFailures,sha256,validateRequest,withSheetsBatch} from '../../scripts/google-dev-admin.mjs';
const source='// GENERATED: npm run google:single.\nfunction doPost() {}\n';
function fixture() {
  const target={scriptId:'synthetic-script',deploymentId:'synthetic-deployment',cloudProjectId:'synthetic-cloud'};
  const credentials={client_id:'synthetic-client',client_secret:'secret-marker',refresh_token:'refresh-marker'};
  const env={GITHUB_REPOSITORY:'jogabsr01/Sistema-da-Livraria',GITHUB_REF:'refs/heads/dev',GITHUB_EVENT_NAME:'push',GITHUB_SHA:'a'.repeat(40),GOOGLE_DEV_ADMIN:JSON.stringify({...target,credentials})};
  const pins=Object.fromEntries(Object.entries(target).map(([k,v])=>[k,sha256(v)]));
  let files=[{name:'Código',type:'SERVER_JS',source:'function old() {}'},{name:'appsscript',type:'JSON',source:'{"timeZone":"America/Sao_Paulo","oauthScopes":["private-scope"]}'}];
  const versions=new Map([[7,structuredClone(files)]]);
  let deployment={deploymentId:target.deploymentId,deploymentConfig:{scriptId:target.scriptId,versionNumber:7,manifestFileName:'appsscript',description:'keep-description'},entryPoints:[{entryPointType:'WEB_APP'}]};
  const calls=[];
  const state={calls,versions,processes:[],logs:{entries:[]},driveStatus:'DISABLED',drivePending:false,get files(){return files;},get deployment(){return deployment;},fault:null};
  const fetchImpl=async(url,options)=>{
    const path=new URL(url).pathname,method=options.method||'GET';
    calls.push({url,path,method,body:options.body,redirect:options.redirect});
    if(state.fault)await state.fault({path,method,options,state});
    let value;
    if(path==='/token')value={access_token:'access-marker-123456789'};
    else if(path==='/v2/entries:list')value=state.logs;
    else if(path==='/v1/processes:listScriptProcesses')value={processes:state.processes};
    else if(['/v1/projects/590183543759/services/drive.googleapis.com','/v1/projects/590183543759/services/sheets.googleapis.com'].includes(path))value={state:state.driveStatus};
    else if(['/v1/projects/590183543759/services/drive.googleapis.com:enable','/v1/projects/590183543759/services/sheets.googleapis.com:enable'].includes(path)){if(!state.drivePending)state.driveStatus='ENABLED';value={name:'private-operation-marker'};}
    else if(path.endsWith('/content') && method==='GET')value={files:structuredClone(new URL(url).searchParams.has('versionNumber')?versions.get(Number(new URL(url).searchParams.get('versionNumber'))):files)};
    else if(path.endsWith('/content') && method==='PUT'){files=JSON.parse(options.body).files;value={files};}
    else if(path.endsWith('/versions') && method==='POST'){const versionNumber=Math.max(...versions.keys())+1;versions.set(versionNumber,structuredClone(files));value={versionNumber};}
    else if(path.endsWith('/deployments/'+target.deploymentId)){if(method==='PUT')deployment={...deployment,...JSON.parse(options.body)};value=deployment;}
    else throw Error('unexpected route with secret-marker');
    return {ok:true,text:async()=>JSON.stringify(value)};
  };
  const run=request=>runAdmin({env,pins,source,fetchImpl,request,wait:async()=>{}});
  const inspect=()=>run({mode:'inspect',revision:1});
  const deployRequest=report=>({mode:'deploy',revision:2,expectedEditorHash:report.editorHash,expectedDeploymentVersion:report.deploymentVersion,candidateHash:report.candidateHash});
  return {env,pins,state,run,inspect,deployRequest};
}
const writes=f=>f.state.calls.filter(c=>c.path.startsWith('/v1/projects/')&&c.method!=='GET');
test('inspection verifies editor, pinned existing deployment and candidate without Google source writes or disclosure',async()=>{
  const f=fixture();f.state.logs.entries=[{jsonPayload:{metric:'rpc.duration',lockMs:3,bindingsMs:4,schemaMs:6000,workMs:17000,totalMs:23007,extra:'secret-marker'},textPayload:'private-contact'}];
  const r=await f.inspect();assert.equal(r.state,'INSPECTED');assert.equal(r.deploymentVersion,7);assert.equal(r.logging,'SAMPLED');assert.equal(r.timings[0].totalMs,23007);assert.equal(writes(f).length,0);
  assert.ok(!/secret-marker|refresh-marker|access-marker|private-contact|private-scope|synthetic-script|keep-description/.test(JSON.stringify(r)));
  assert.ok(f.state.calls.every(c=>c.redirect==='error'));
});
test('DEV repository, branch and event gates refuse before any network even with credentials',async()=>{
  for(const change of [{GITHUB_REF:'refs/heads/main'},{GITHUB_REF:'refs/pull/1/merge'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_EVENT_NAME:'pull_request_target'}]){
    const f=fixture();Object.assign(f.env,change);await assert.rejects(f.inspect(),/DEV_CONTEXT_REQUIRED/);assert.equal(f.state.calls.length,0);
  }
});
test('absent configuration reports configuration required and target substitution refuses before OAuth',async()=>{
  const f=fixture();delete f.env.GOOGLE_DEV_ADMIN;assert.deepEqual(await f.inspect(),{state:'CONFIGURATION_REQUIRED',mode:'inspect'});assert.equal(f.state.calls.length,0);
  const g=fixture(),c=JSON.parse(g.env.GOOGLE_DEV_ADMIN);c.scriptId='different-project';g.env.GOOGLE_DEV_ADMIN=JSON.stringify(c);await assert.rejects(g.inspect(),/TARGET_MISMATCH/);assert.equal(g.state.calls.length,0);
});
test('OAuth and transport errors disclose only safe codes, without redirect following or request retries',async()=>{
  const f=fixture();f.state.fault=()=>{throw Error('secret-marker refresh-marker');};await assert.rejects(f.inspect(),/OAUTH_REFRESH_FAILED/);assert.equal(f.state.calls.length,1);
});
test('logging unavailability is explicit and numeric allowlist omits raw provider fields and malformed samples',async()=>{
  const f=fixture();f.state.fault=({path})=>{if(path==='/v2/entries:list')throw Error('secret-marker');};assert.equal((await f.inspect()).logging,'UNAVAILABLE');
  const p={metric:'rpc.duration',lockMs:0,bindingsMs:1,schemaMs:2,workMs:3,totalMs:6};assert.deepEqual(safeTimings([{jsonPayload:p},{jsonPayload:{...p,totalMs:'secret-marker'}},{jsonPayload:{...p,workMs:-1}},{jsonPayload:{...p,metric:'other'}}]),[{lockMs:0,bindingsMs:1,schemaMs:2,workMs:3,totalMs:6}]);
});
test('explicit deployment backs up verified old source before editor update and preserves manifest and deployment configuration',async()=>{
  const f=fixture(),old=structuredClone(f.state.files),r=await f.inspect();f.state.calls.length=0;
  const result=await f.run(f.deployRequest(r));assert.equal(result.state,'DEPLOYED');assert.equal(result.backupVersion,8);assert.equal(result.deploymentVersion,9);assert.deepEqual(f.state.versions.get(8),old);
  assert.deepEqual(f.state.files.find(x=>x.type==='JSON'),old.find(x=>x.type==='JSON'));assert.equal(f.state.files.find(x=>x.type==='SERVER_JS').source,source);assert.equal(f.state.deployment.deploymentConfig.description,'keep-description');assert.equal(f.state.deployment.deploymentId,'synthetic-deployment');
  assert.deepEqual(writes(f).map(c=>[c.method,c.path.split('/').at(-1)]),[['POST','versions'],['PUT','content'],['POST','versions'],['PUT','synthetic-deployment']]);
  const before=writes(f).length;assert.equal((await f.run(f.deployRequest(r))).state,'ALREADY_CURRENT');assert.equal(writes(f).length,before);
});
test('changed candidate, editor or deployment version cannot publish from a stale inspection',async()=>{
  for(const change of ['candidate','editor','version']){
    const f=fixture(),r=await f.inspect(),p=f.deployRequest(r);f.state.calls.length=0;
    if(change==='candidate')p.candidateHash='0'.repeat(64);
    if(change==='editor')f.state.files[0].source='manual-change';
    if(change==='version')p.expectedDeploymentVersion=6;
    await assert.rejects(f.run(p),change==='candidate'?/CANDIDATE_CHANGED/:/REMOTE_CHANGED/);assert.equal(writes(f).length,0);
  }
});
test('failed or mismatched backup never writes editor; a concurrent edit during backup is detected',async()=>{
  for(const mode of ['failure','wrong-backup','concurrent-edit']){
    const f=fixture(),r=await f.inspect();f.state.calls.length=0;
    f.state.fault=({path,method,options})=>{
      if(mode==='failure'&&path.endsWith('/versions'))throw Error('secret-marker');
      if(mode==='wrong-backup'&&path.endsWith('/content')&&method==='GET'&&new URL(f.state.calls.at(-1).url).searchParams.has('versionNumber')){const v=f.state.versions.get(8);if(v)v[0].source='wrong-backup';}
      if(mode==='concurrent-edit'&&path.endsWith('/content')&&method==='GET'&&f.state.versions.has(8)&&!new URL(f.state.calls.at(-1).url).searchParams.has('versionNumber'))f.state.files[0].source='concurrent-edit';
    };
    await assert.rejects(f.run(f.deployRequest(r)),/GOOGLE_API_FAILED|BACKUP_UNCONFIRMED|REMOTE_CHANGED/);assert.equal(writes(f).filter(c=>c.method==='PUT').length,0);
  }
});
test('lost write acknowledgement is uncertain, never retried and does not claim deployment success',async()=>{
  const f=fixture(),r=await f.inspect();f.state.calls.length=0;f.state.fault=({method})=>{if(method==='PUT')throw Error('secret-marker');};
  await assert.rejects(f.run(f.deployRequest(r)),/WRITE_UNCONFIRMED_INSPECT_BEFORE_RETRY/);assert.equal(writes(f).filter(c=>c.method==='PUT').length,1);assert.equal(f.state.deployment.deploymentConfig.versionNumber,7);
});
test('request rejects unknown fields, invalid modes and hash/version substitutions; remote layout cannot lose extra files',()=>{
  for(const request of [{mode:'inspect',revision:1,url:'https://evil.invalid'},{mode:'reset',revision:1},{mode:'deploy',revision:1},{mode:'inspect',revision:0}])assert.throws(()=>validateRequest(request),/INVALID_REQUEST/);
  assert.throws(()=>contentHash([{name:'appsscript',type:'JSON',source:'{}'},{name:'Code',type:'SERVER_JS',source:''},{name:'extra',type:'SERVER_JS',source:''}]),/UNSUPPORTED_REMOTE_LAYOUT/);
});
test('workflow exposes secret only to controller, never runs against PR or main and validates the explicit administration request',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/google-dev-admin.yml',import.meta.url),'utf8');
  assert.match(workflow,/branches: \[dev\]/);assert.match(workflow,/contents: read/);assert.match(workflow,/cancel-in-progress: false/);assert.ok(!/pull_request|pull_request_target|write-all|npm install|npm ci/.test(workflow));assert.equal((workflow.match(/secrets\.GOOGLE_DEV_ADMIN/g)||[]).length,1);
  const request=JSON.parse(readFileSync(new URL('../../ops/google-dev-request.json',import.meta.url)));validateRequest(request);
});

const setup={mode:'enable-drive',revision:4};
test('Drive setup enables only the fixed DEV API, reads back its state and never writes Apps Script or IAM',async()=>{
  const f=fixture();const result=await f.run(setup);assert.deepEqual(result,{state:'DRIVE_API_ENABLED',mode:'enable-drive'});
  const posts=f.state.calls.filter(c=>c.method==='POST'&&!c.path.endsWith('/token'));
  assert.deepEqual(posts.map(c=>c.url),['https://serviceusage.googleapis.com/v1/projects/590183543759/services/drive.googleapis.com:enable']);
  assert.equal(f.state.calls.some(c=>c.url.includes('script.googleapis.com')),false);
  assert.ok(!/secret-marker|private-operation-marker/.test(JSON.stringify(result)));
  f.state.calls.length=0;assert.equal((await f.run(setup)).state,'DRIVE_API_ENABLED');assert.equal(f.state.calls.filter(c=>c.path.endsWith(':enable')).length,0);
});
test('pending activation polls reads at most five times, returns pending honestly and never repeats enable POST',async()=>{
  const f=fixture();f.state.drivePending=true;assert.equal((await f.run(setup)).state,'DRIVE_API_ENABLE_PENDING');
  assert.equal(f.state.calls.filter(c=>c.path.endsWith(':enable')).length,1);assert.equal(f.state.calls.filter(c=>c.path.endsWith('drive.googleapis.com')).length,6);
});
test('Drive setup rejects scope substitution or non-DEV context before IO and reports uncertain enable without retry',async()=>{
  const f=fixture();await assert.rejects(f.run({...setup,service:'other.googleapis.com'}),/INVALID_REQUEST/);assert.equal(f.state.calls.length,0);
  f.env.GITHUB_REF='refs/heads/main';await assert.rejects(f.run(setup),/DEV_CONTEXT_REQUIRED/);assert.equal(f.state.calls.length,0);
  const g=fixture();g.state.fault=({path})=>{if(path.endsWith(':enable'))throw Error('secret-marker');};await assert.rejects(g.run(setup),/DRIVE_API_ENABLE_UNCONFIRMED/);assert.equal(g.state.calls.filter(c=>c.path.endsWith(':enable')).length,1);
});
test('untrusted service state cannot claim enabled or trigger any mutation',async()=>{
  const f=fixture();f.state.driveStatus='secret-marker';await assert.rejects(f.run(setup),/DRIVE_API_STATUS_UNAVAILABLE/);assert.equal(f.state.calls.filter(c=>c.path.endsWith(':enable')).length,0);
});
test('Apps Script message and text metric formats retain numeric timings without disclosing messages, identifiers or malformed payloads',()=>{
  const metric={metric:'rpc.duration',lockMs:8,bindingsMs:9,schemaMs:10,workMs:11,totalMs:38,email:'private-contact',code:'secret-marker'};
  const expected={lockMs:8,bindingsMs:9,schemaMs:10,workMs:11,totalMs:38};
  assert.deepEqual(safeTimings([{jsonPayload:{message:JSON.stringify(metric)}},{textPayload:JSON.stringify(metric)},{textPayload:'rpc.duration secret-marker'},{jsonPayload:{message:'{broken secret-marker'}},{textPayload:JSON.stringify({...metric,totalMs:'secret-marker'})}]),[expected,expected]);
  assert.deepEqual(safeTimings([{textPayload:' '.repeat(4097)+JSON.stringify(metric)}]),[]);
});

test('Sheets activation is restricted to the fixed API and existing pinned DEV project',async()=>{
 const f=fixture();assert.equal((await f.run({mode:'enable-sheets',revision:14})).state,'SHEETS_API_ENABLED');
 assert.equal(f.state.calls.filter(c=>c.path.endsWith(':enable')).length,1);assert.equal(f.state.calls.find(c=>c.path.endsWith(':enable')).url,'https://serviceusage.googleapis.com/v1/projects/590183543759/services/sheets.googleapis.com:enable');
 await assert.rejects(f.run({mode:'enable-sheets',revision:14,sheetsBatch:true}),/INVALID_REQUEST/);
});
test('explicit Sheets manifest preparation preserves existing scopes, runtime, libraries and other settings, and never adds authorization scopes',async()=>{
 const f=fixture(),manifest={timeZone:'America/Sao_Paulo',exceptionLogging:'NONE',runtimeVersion:'V8',oauthScopes:['https://www.googleapis.com/auth/spreadsheets','private-scope'],dependencies:{libraries:[{userSymbol:'Legacy',libraryId:'private-library',version:'1'}]}};
 f.state.files.find(x=>x.type==='JSON').source=JSON.stringify(manifest);
 const r=await f.run({mode:'inspect',revision:15,sheetsBatch:true});assert.equal(writes(f).length,0);
 const request={...f.deployRequest(r),sheetsBatch:true};assert.equal((await f.run(request)).state,'DEPLOYED');
 const saved=JSON.parse(f.state.files.find(x=>x.type==='JSON').source);assert.deepEqual(saved.oauthScopes,manifest.oauthScopes);assert.deepEqual(saved.dependencies.libraries,manifest.dependencies.libraries);assert.equal(saved.exceptionLogging,manifest.exceptionLogging);assert.equal(saved.timeZone,manifest.timeZone);
 assert.deepEqual(saved.dependencies.enabledAdvancedServices,[{userSymbol:'Sheets',serviceId:'sheets',version:'v4'}]);
 assert.equal(withSheetsBatch(JSON.stringify(saved)),withSheetsBatch(JSON.stringify(saved)));
});
test('implicit manifest changes, missing spreadsheet scope and conflicting service symbols cannot be deployed',()=>{
 for(const manifest of [null,[],{oauthScopes:[]}, {oauthScopes:['private-scope']},{oauthScopes:['https://www.googleapis.com/auth/spreadsheets'],dependencies:{enabledAdvancedServices:[{userSymbol:'Sheets',serviceId:'other',version:'v4'}]}}])assert.throws(()=>withSheetsBatch(JSON.stringify(manifest)),/INVALID_MANIFEST|MANIFEST_SERVICE_CONFLICT/);
 assert.throws(()=>validateRequest({mode:'inspect',revision:1,sheetsBatch:false}),/INVALID_REQUEST/);
 assert.throws(()=>validateRequest({mode:'inspect',revision:1,services:['other']}),/INVALID_REQUEST/);
});

test('auto-inferred Apps Script scopes remain auto-inferred when enabling only the Sheets service',()=>{
 const before={timeZone:'America/Sao_Paulo',runtimeVersion:'V8',exceptionLogging:'STACKDRIVER'};
 const after=JSON.parse(withSheetsBatch(JSON.stringify(before)));assert.equal(Object.hasOwn(after,'oauthScopes'),false);assert.equal(after.timeZone,before.timeZone);assert.equal(after.exceptionLogging,before.exceptionLogging);assert.equal(after.dependencies.enabledAdvancedServices.length,1);
});

test('timing operation tags and schema batch counts are optional closed metadata, never arbitrary provider strings',()=>{
 const metric={metric:'rpc.duration',lockMs:1,bindingsMs:2,schemaMs:3,workMs:4,totalMs:10,operation:'START',schemaBatchReads:2};
 assert.deepEqual(safeTimings([{jsonPayload:metric}]),[{lockMs:1,bindingsMs:2,schemaMs:3,workMs:4,totalMs:10,operation:'START',schemaBatchReads:2}]);
 const result=safeTimings([{jsonPayload:{...metric,operation:'PRIVATE_EMAIL',schemaBatchReads:999}}]);assert.equal(Object.hasOwn(result[0],'operation'),false);assert.equal(Object.hasOwn(result[0],'schemaBatchReads'),false);
});

test('inspection traces timestamped processes and failure categories without identities, exception bodies or Google writes',async()=>{
 const f=fixture();f.state.processes=[{startTime:'2026-10-29T12:30:00.123456Z',duration:'5.6s',processStatus:'FAILED',processType:'WEBAPP',functionName:'doPost',userAccessLevel:'OWNER',private:'secret-marker'}];
 f.state.logs.entries=[{timestamp:'2026-10-29T12:30:05.6Z',severity:'ERROR',textPayload:'TypeError secret-marker person@example.invalid'}];
 const r=await f.inspect();assert.equal(r.processHistory,'SAMPLED');assert.deepEqual(r.processes,[{timestamp:'2026-10-29T12:30:00.123Z',durationMs:5600,status:'FAILED',function:'doPost',type:'WEBAPP'}]);assert.deepEqual(r.failures,[{timestamp:'2026-10-29T12:30:05.600Z',severity:'ERROR',category:'SCRIPT_TYPE'}]);assert.equal(writes(f).length,0);assert.ok(!/secret-marker|person@example|OWNER|userAccess/.test(JSON.stringify(r)));
 const call=f.state.calls.find(c=>c.path==='/v1/processes:listScriptProcesses');assert.equal(call.method,'GET');assert.equal(new URL(call.url).searchParams.get('scriptId'),'synthetic-script');
});
test('process history fails independently and malformed diagnostic values cannot enter the report',async()=>{
 const f=fixture();f.state.fault=({path})=>{if(path==='/v1/processes:listScriptProcesses')throw Error('secret-marker');};const r=await f.inspect();assert.equal(r.processHistory,'UNAVAILABLE');assert.equal(r.logging,'NO_METRICS_IN_LAST_HOUR');assert.ok(!JSON.stringify(r).includes('secret-marker'));
 assert.deepEqual(safeProcesses([{startTime:'secret-marker',processStatus:'FAILED',duration:'1s'}]),[]);assert.deepEqual(safeProcesses([{startTime:'2026-10-29T12:30:00Z',processStatus:'secret-marker',duration:'1s'}]),[]);assert.deepEqual(safeFailures([{timestamp:'secret-marker',severity:'ERROR',textPayload:'TypeError'}]),[]);
 const metric={metric:'rpc.duration',lockMs:0,bindingsMs:1,schemaMs:2,workMs:3,totalMs:6};assert.equal(safeTimings([{timestamp:'2026-10-29T12:30:00.123456789Z',jsonPayload:metric}])[0].timestamp,'2026-10-29T12:30:00.123Z');assert.equal(Object.hasOwn(safeTimings([{timestamp:'secret-marker',jsonPayload:metric}])[0],'timestamp'),false);
});
