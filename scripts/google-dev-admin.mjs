import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
// Target fingerprints prevent a credential/configuration mix-up. Raw resource
// identifiers and OAuth credentials live only in the repository secret.
export const TARGET_PINS = Object.freeze({"scriptId": "8c1e14b7a75cfa5f43689efd972bb477b74f1ecd6bbd6888e583d921c99a45cb", "deploymentId": "b8b963e1cf07a7890b012aa7167539762700841efafefae08d89e1e29afa3a72", "cloudProjectId": "1e4a9d86c8dc20f46dcc7fdbeb44acb4505355abcf6a70f002ced47229ad4f7d"});
class AdminError extends Error {}
const fail = code => { throw new AdminError(code); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.sort());
export function contentHash(files) {
  if (!Array.isArray(files) || files.length !== 2 || files.filter(f => f.name === 'appsscript' && f.type === 'JSON').length !== 1 || files.filter(f => f.type === 'SERVER_JS').length !== 1 || files.some(f => typeof f.name !== 'string' || typeof f.source !== 'string')) fail('UNSUPPORTED_REMOTE_LAYOUT');
  return sha256(JSON.stringify(files.map(({name,type,source})=>({name,type,source})).sort((a,b)=>a.name.localeCompare(b.name,'en'))));
}
export function validateRequest(request) {
  const keys = request?.mode === 'deploy' ? ['mode','revision','expectedEditorHash','expectedDeploymentVersion','candidateHash'] : ['mode','revision'];
  if (!exact(request,keys) || !['inspect','deploy','enable-drive'].includes(request.mode) || !Number.isSafeInteger(request.revision) || request.revision < 1) fail('INVALID_REQUEST');
  if (request.mode === 'deploy' && (!hex(request.expectedEditorHash) || !hex(request.candidateHash) || !Number.isSafeInteger(request.expectedDeploymentVersion) || request.expectedDeploymentVersion < 1)) fail('INVALID_REQUEST');
}
function configuration(env,pins) {
  if (env.GITHUB_REPOSITORY !== 'jogabsr01/Sistema-da-Livraria' || env.GITHUB_REF !== 'refs/heads/dev' || !['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) fail('DEV_CONTEXT_REQUIRED');
  if (!env.GOOGLE_DEV_ADMIN) return null;
  let config; try { config=JSON.parse(env.GOOGLE_DEV_ADMIN); } catch { fail('INVALID_CONFIGURATION'); }
  for (const key of ['scriptId','deploymentId','cloudProjectId']) if (typeof config[key] !== 'string' || sha256(config[key]) !== pins[key]) fail('TARGET_MISMATCH');
  const c=config.credentials;
  if (!c || ['client_id','client_secret','refresh_token'].some(key=>typeof c[key] !== 'string' || !c[key].length || c[key].length > 10000 || /[\r\n]/.test(c[key]))) fail('INVALID_CREDENTIALS');
  return config;
}
export function safeTimings(entries) {
  return (Array.isArray(entries)?entries:[]).slice(0,50).flatMap(entry=>{
    let p=entry?.jsonPayload;
    // console.info(JSON.stringify(metric)) is stored as a message string by
    // Apps Script. Parse locally, then keep the same closed numeric schema.
    if(p?.metric!=='rpc.duration'){
      const message=typeof p?.message==='string'?p.message:entry?.textPayload;
      if(typeof message!=='string'||message.length>4096)return [];
      try { p=JSON.parse(message); } catch { return []; }
    }
    if (p?.metric !== 'rpc.duration') return [];
    const result={};
    for (const key of ['lockMs','bindingsMs','schemaMs','workMs','totalMs']) {
      if (!Number.isSafeInteger(p[key]) || p[key]<0 || p[key]>3600000) return [];
      result[key]=p[key];
    }
    return [result];
  });
}
export async function runAdmin({env=process.env,request,source,fetchImpl=fetch,pins=TARGET_PINS,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  validateRequest(request);
  const config=configuration(env,pins);
  if (!config) return {state:'CONFIGURATION_REQUIRED',mode:request.mode};
  if (typeof source !== 'string' || !source.startsWith('// GENERATED: npm run google:single.') || Buffer.byteLength(source)>2000000) fail('INVALID_CANDIDATE');
  async function requestJson(url,options={},code='GOOGLE_API_FAILED') {
    let response;
    try { response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)}); }
    catch { fail(code); }
    if (!response.ok) fail(code);
    // Provider error bodies/exception text/headers never enter Actions output.
    let data; try { const body=await response.text(); if(Buffer.byteLength(body)>5000000)fail(code); data=JSON.parse(body); } catch { fail(code); }
    return data;
  }
  const token=await requestJson('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:config.credentials.client_id,client_secret:config.credentials.client_secret,refresh_token:config.credentials.refresh_token,grant_type:'refresh_token'}).toString()
  },'OAUTH_REFRESH_FAILED');
  if (typeof token.access_token !== 'string' || !/^[\x21-\x7e]{10,10000}$/.test(token.access_token)) fail('OAUTH_REFRESH_FAILED');
  if (request.mode === 'enable-drive') {
    // Fixed service and project number, belonging to the pinned Cloud project.
    // No caller-supplied service, billing, IAM, code or deployment changes.
    const endpoint='https://serviceusage.googleapis.com/v1/projects/590183543759/services/drive.googleapis.com';
    const headers={authorization:'Bearer '+token.access_token,'content-type':'application/json'};
    const readState=async()=>{
      const service=await requestJson(endpoint,{headers},'DRIVE_API_STATUS_UNAVAILABLE');
      if(!['ENABLED','DISABLED'].includes(service.state))fail('DRIVE_API_STATUS_UNAVAILABLE');
      return service.state;
    };
    if(await readState()==='ENABLED')return {state:'DRIVE_API_ENABLED',mode:request.mode};
    await requestJson(endpoint+':enable',{method:'POST',headers,body:'{}'},'DRIVE_API_ENABLE_UNCONFIRMED');
    for(let attempt=0;attempt<5;attempt++){
      if(attempt)await wait(1000);
      if(await readState()==='ENABLED')return {state:'DRIVE_API_ENABLED',mode:request.mode};
    }
    return {state:'DRIVE_API_ENABLE_PENDING',mode:request.mode};
  }
  const api=(path,method='GET',body)=>requestJson('https://script.googleapis.com/v1/projects/'+encodeURIComponent(config.scriptId)+path,{
    method,headers:{authorization:'Bearer '+token.access_token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const editor=await api('/content'), editorHash=contentHash(editor.files);
  const deployment=await api('/deployments/'+encodeURIComponent(config.deploymentId));
  if (deployment.deploymentId !== config.deploymentId || deployment.deploymentConfig?.scriptId !== config.scriptId || !Number.isSafeInteger(deployment.deploymentConfig.versionNumber) || deployment.deploymentConfig.versionNumber<1 || !deployment.entryPoints?.some(p=>p.entryPointType==='WEB_APP')) fail('DEPLOYMENT_MISMATCH');
  const version=deployment.deploymentConfig.versionNumber;
  const deployed=await api('/content?versionNumber='+version), deployedHash=contentHash(deployed.files);
  const candidateFiles=editor.files.map(f=>({name:f.name,type:f.type,source:f.type==='SERVER_JS'?source:f.source}));
  const candidateHash=contentHash(candidateFiles);
  const report={state:'INSPECTED',mode:request.mode,editorHash,deployedHash,deploymentVersion:version,candidateHash,candidateMatchesEditor:candidateHash===editorHash};
  if (request.mode === 'inspect') {
    try {
      const logs=await requestJson('https://logging.googleapis.com/v2/entries:list',{
        method:'POST',headers:{authorization:'Bearer '+token.access_token,'content-type':'application/json'},
        body:JSON.stringify({resourceNames:['projects/'+config.cloudProjectId],filter:'resource.type="app_script_function" AND (jsonPayload.metric="rpc.duration" OR jsonPayload.message:"rpc.duration" OR textPayload:"rpc.duration") AND timestamp>="'+new Date(Date.now()-3600000).toISOString()+'"',orderBy:'timestamp desc',pageSize:50})
      },'LOGS_UNAVAILABLE');
      report.timings=safeTimings(logs.entries);report.logging=report.timings.length?'SAMPLED':'NO_METRICS_IN_LAST_HOUR';
    } catch { report.logging='UNAVAILABLE'; }
    return report;
  }
  if (request.candidateHash !== candidateHash) fail('CANDIDATE_CHANGED');
  if (editorHash===candidateHash && deployedHash===candidateHash) return {...report,state:'ALREADY_CURRENT'};
  if (request.expectedEditorHash !== editorHash || request.expectedDeploymentVersion !== version) fail('REMOTE_CHANGED');
  // Immutable Google version retains the complete editor source before any PUT.
  const backup=await api('/versions','POST',{description:'DEV backup before '+env.GITHUB_SHA});
  if (!Number.isSafeInteger(backup.versionNumber) || backup.versionNumber<1) fail('BACKUP_UNCONFIRMED');
  const saved=await api('/content?versionNumber='+backup.versionNumber);
  if (contentHash(saved.files)!==editorHash) fail('BACKUP_UNCONFIRMED');
  // Recheck immediately before writing. Google has no atomic compare-and-swap;
  // do not edit manually while this workflow is running.
  if (contentHash((await api('/content')).files)!==editorHash || (await api('/deployments/'+encodeURIComponent(config.deploymentId))).deploymentConfig?.versionNumber!==version) fail('REMOTE_CHANGED');
  let editorWriteStarted=false;
  try {
    editorWriteStarted=true;
    await api('/content','PUT',{files:candidateFiles});
    if(contentHash((await api('/content')).files)!==candidateHash) fail('EDITOR_UNCONFIRMED');
    const release=await api('/versions','POST',{description:'DEV '+env.GITHUB_SHA});
    if(!Number.isSafeInteger(release.versionNumber)||release.versionNumber<1)fail('VERSION_UNCONFIRMED');
    if(contentHash((await api('/content?versionNumber='+release.versionNumber)).files)!==candidateHash)fail('VERSION_UNCONFIRMED');
    // Preserve the existing deployment, access/execution policy and manifest.
    await api('/deployments/'+encodeURIComponent(config.deploymentId),'PUT',{deploymentConfig:{...deployment.deploymentConfig,versionNumber:release.versionNumber}});
    const confirmed=await api('/deployments/'+encodeURIComponent(config.deploymentId));
    if(confirmed.deploymentId!==config.deploymentId || confirmed.deploymentConfig?.versionNumber!==release.versionNumber)fail('DEPLOYMENT_UNCONFIRMED');
    return {...report,state:'DEPLOYED',backupVersion:backup.versionNumber,deploymentVersion:release.versionNumber};
  } catch(error) { if(editorWriteStarted)fail('WRITE_UNCONFIRMED_INSPECT_BEFORE_RETRY');throw error; }
}
export async function main() {
  try {
    const request=JSON.parse(readFileSync('ops/google-dev-request.json','utf8'));
    const source=readFileSync('instalacao-google-dev/CodigoUnico.gs.txt','utf8');
    console.log(JSON.stringify(await runAdmin({request,source})));
  } catch(error) {
    console.error(JSON.stringify({state:'FAILED',code:error instanceof AdminError?error.message:'ADMIN_UNAVAILABLE'}));process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
