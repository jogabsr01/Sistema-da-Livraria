// Disposable recovery contract. These storage proofs are NEVER runtime code.
import { randomBytes,randomUUID } from 'node:crypto';
import { ownerFixture } from './owner-access-fixture.mjs';
import { createOwnerAccessService,loadOwnerAccessSettings } from '../../backend/owner-access.mjs';
export function enableRecovery(s=ownerFixture()){
 s.env.WORKSPACE_RECOVERY_ENABLED='true';s.gas.props.RECOVERY_ENABLED='true';
 const service=()=>createOwnerAccessService(loadOwnerAccessSettings(s.env),{client:s.client});
 const code=()=>s.gas.outbox.at(-1).body.match(/\n([A-Za-z0-9_-]{43})\n/)[1];
 const flow=token=>{const rows=s.priv.getSheetByName('_Identity_Flows');return rows.rows.at(-1);};
 const hash=()=>{const rows=s.priv.getSheetByName('_Identity_Flows');return rows.rows.at(-1)[rows.rows[0].indexOf('Token_Hash')];};
 function proof(){const flows=s.priv.getSheetByName('_Identity_Flows'),f=flows.rows.at(-1),cols=flows.rows[0],id=f[cols.indexOf('Subject_ID')],version=f[cols.indexOf('Authorization_Version')],keys=s.priv.getSheetByName('_Passkeys');
  const key=keys.rows.slice(1).find(r=>r[keys.rows[0].indexOf('Subject_ID')]===id&&r[keys.rows[0].indexOf('Authorization_Version')]===version&&r[keys.rows[0].indexOf('Revoked_At')]==='');if(!key)throw Error('No enrolled test credential');
  const at=Date.now(),ceremonies=s.priv.getSheetByName('_Passkey_Ceremonies'),cid=randomUUID(),value={ID:cid,Subject_ID:id,Purpose:'AUTHENTICATE',Challenge:randomBytes(32).toString('base64url'),Created_At:new Date(at).toISOString(),Expires_At:new Date(at+300000).toISOString(),Consumed_At:new Date(at).toISOString(),Authorization_Version:version,Completed_At:new Date(at).toISOString(),Credential_ID:key[0],Expected_Counter:0};ceremonies.appendRow(ceremonies.rows[0].map(k=>value[k]??''));f[cols.indexOf('Ceremony_ID')]=cid;
 }
 async function activate(){const token=randomBytes(32).toString('base64url'),svc=service(),ip='192.0.2.3';await svc.execute('start',{email:'owner@example.invalid'},token,ip);await svc.execute('email',{code:code()},token,ip);await svc.execute('pin',{pin:'8274'},token,ip);s.storageProof(hash());const result=await svc.execute('complete',{response:null},token,ip);return result;}
 async function pending(identifier='owner@example.invalid',ip='192.0.2.4'){const token=randomBytes(32).toString('base64url'),svc=service();await svc.execute('recover',{email:identifier},token,ip);await svc.execute('email',{code:code()},token,ip);await svc.execute('pin',{pin:'9382'},token,ip);return {svc,token,ip};}
 return {...s,recoveryService:service,code,flow,hash,proof,activateOwner:activate,pendingRecovery:pending};
}
