import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { catalogUuid } from './catalog-model.mjs';
const unavailable = () => { throw new ApiError(503, 'PERSONAL_DATA_UNAVAILABLE'); };
export function loadPersonalDataSettings(env = process.env) {
  const cipher = env.WORKSPACE_PERSONAL_DATA_KEY, index = env.WORKSPACE_PERSONAL_INDEX_KEY;
  const other = ['WORKSPACE_HMAC_SECRET','WORKSPACE_SESSION_TOKEN_KEY','WORKSPACE_AUTH_GUARD_KEY','WORKSPACE_PIN_PEPPER'].map(key => env[key]?.toLowerCase());
  if (![cipher,index].every(key => typeof key === 'string' && /^[a-f0-9]{64}$/i.test(key)) || cipher.toLowerCase() === index.toLowerCase() ||
      [cipher,index].some(key => other.includes(key.toLowerCase()))) unavailable();
  return { dataKey:Buffer.from(cipher,'hex'), indexKey:Buffer.from(index,'hex') };
}
export function createPersonalDataVault(settings) {
  const {config,dataKey,indexKey}=settings;
  if (!catalogUuid(config?.installationId) || !['dev','prod'].includes(config.environment) || ![dataKey,indexKey].every(key=>Buffer.isBuffer(key)&&key.length===32) || dataKey.equals(indexKey)) unavailable();
  const aad=(entity,id)=>{ if (!['users','customers'].includes(entity)||!catalogUuid(id)) unavailable(); return Buffer.from(JSON.stringify(['personal.v1',config.environment,config.installationId,entity,id])); };
  return {
    fingerprint(value) {return createHmac('sha256',indexKey).update(JSON.stringify(['command.v1',config.environment,config.installationId,value])).digest('hex');},
    index(kind,value) { if (!['email','cpf'].includes(kind)||typeof value!=='string'||!value||value.length>254) unavailable();return createHmac('sha256',indexKey).update(JSON.stringify(['index.v1',config.environment,config.installationId,kind,value])).digest('hex'); },
    seal(entity,id,value) {
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',dataKey,iv);cipher.setAAD(aad(entity,id));
      const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
      return ['pd1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),bytes.toString('base64url')].join('.');
    },
    open(entity,id,value) {
      try {
        if(typeof value!=='string'||value.length>16000||!/^pd1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(value)) unavailable();
        const [,iv,tag,body]=value.split('.'),decipher=createDecipheriv('aes-256-gcm',dataKey,Buffer.from(iv,'base64url'));
        decipher.setAAD(aad(entity,id));decipher.setAuthTag(Buffer.from(tag,'base64url'));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,'base64url')),decipher.final()]).toString('utf8'));
      }catch { unavailable(); }
    },
  };
}
