import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { ApiError } from './errors.mjs';
// Short-lived, opaque continuation bound to this pre-auth cookie and installation.
// It contains no PIN, verifier or delivery address and never grants a session.
export function accessReceipts(settings, token) {
  const scope=JSON.stringify(['access.continuation.v1',settings.config.environment,settings.config.installationId,token]);
  const key=createHmac('sha256',settings.guardKey).update('access.continuation.key.v1').digest();
  const reject=()=>{throw new ApiError(401,'ACCESS_CONTINUATION_EXPIRED');};
  return {
    seal(kind,value){
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(scope));
      const body=Buffer.concat([cipher.update(JSON.stringify({kind,expires:Date.now()+180000,value}),'utf8'),cipher.final()]);
      return [iv,body,cipher.getAuthTag()].map(x=>x.toString('base64url')).join('.');
    },
    open(encoded,kind){
      if(typeof encoded!=='string'||encoded.length>12000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(encoded))reject();
      try{
        const [iv,body,tag]=encoded.split('.').map(x=>Buffer.from(x,'base64url'));
        if(iv.length!==12||tag.length!==16)reject();
        const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(scope));cipher.setAuthTag(tag);
        const data=JSON.parse(Buffer.concat([cipher.update(body),cipher.final()]).toString('utf8'));
        if(data.kind!==kind||!Number.isSafeInteger(data.expires)||data.expires<=Date.now()||data.expires>Date.now()+185000)reject();
        return data.value;
      }catch{reject();}
    }
  };
}
