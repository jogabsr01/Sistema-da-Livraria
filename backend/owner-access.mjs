import { identityConfigurationIssues } from './identity-configuration.mjs';
import { emergencyCodeHash } from './emergency-codes.mjs';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { loadPersonalDataSettings, createPersonalDataVault } from './personal-data.mjs';
import { normalizeCpf, normalizeStaffContact } from './staff-model.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { ApiError, json, safeFailure } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { loadLoginGuardSettings, createLoginGuard } from './login-guard.mjs';
import { loadPasskeySettings, createPasskeyService } from './passkey-service.mjs';
import { createPinHasher, createSessionTokens } from './credential-core.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { requireSameOriginMutation, requireCsrfToken } from './authorization.mjs';
import { sessionCookie, validateSessionPrincipal } from './session-service.mjs';
export const ACCESS_ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app';
export const ACCESS_COOKIE = '__Host-livraria_access';
const rejected = () => { throw new ApiError(401, 'ACCESS_REJECTED'); };
const canonical = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value;
const EMAIL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function createAccessEmailCode() {
  // 32 symbols: masking is unbiased, using seven independent random bytes.
  return Array.from(randomBytes(7), byte => EMAIL_CODE_ALPHABET[byte & 31]).join('');
}
function normalizeAccessEmailCode(value) {
  if (typeof value !== 'string') rejected();
  const trimmed = value.trim();
  if (/^[A-HJ-NP-Z2-9]{7}$/i.test(trimmed)) return trimmed.toUpperCase();
  // A code already delivered before rollout remains valid for its original TTL.
  if (canonical(trimmed)) return trimmed;
  rejected();
}
function email(value) {
  if (typeof value !== 'string' || value.length > 254 || /[\x00-\x1f\x7f]/.test(value)) throw new ApiError(400, 'INVALID_AUTH_REQUEST');
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new ApiError(400, 'INVALID_AUTH_REQUEST');
  return normalized;
}
export function loadOwnerAccessSettings(env = process.env) {
  if (env.WORKSPACE_IDENTITY_ACCESS_ENABLED !== 'true') throw new ApiError(503, 'IDENTITY_NOT_ACTIVATED');
  const sessions = loadSessionSettings(env), guards = loadLoginGuardSettings(env);
  loadPasskeySettings(env);
  const pepper = env.WORKSPACE_PIN_PEPPER;
  if (typeof pepper !== 'string' || !/^[a-f0-9]{64}$/i.test(pepper) ||
      [sessions.config.secret, env.WORKSPACE_SESSION_TOKEN_KEY, env.WORKSPACE_AUTH_GUARD_KEY].some(key => key?.toLowerCase() === pepper.toLowerCase()) ||
      sessions.tokenKey.equals(guards.guardKey)) throw new ApiError(503, 'IDENTITY_CONFIGURATION_UNAVAILABLE');
  const staffEnabled=env.WORKSPACE_STAFF_ENABLED==='true';
  return { ...sessions, ...guards, pepper: Buffer.from(pepper, 'hex'),staffEnabled,emergencyRecoveryEnabled:env.WORKSPACE_EMERGENCY_RECOVERY_ENABLED==='true'&&env.WORKSPACE_RECOVERY_ENABLED==='true',recoveryEnabled:env.WORKSPACE_RECOVERY_ENABLED==='true',...(staffEnabled?loadPersonalDataSettings(env):{}) };
}
export function accessCookie(value) {
  if (!canonical(value)) rejected();
  return `${ACCESS_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`;
}
function readCookie(request) {
  const header = request.headers.get('cookie') || '';
  if (header.length > 4096) rejected();
  const found = header.split(';').map(value => value.trim()).filter(value => value.split('=', 1)[0] === ACCESS_COOKIE);
  if (found.length !== 1 || !canonical(found[0].slice(ACCESS_COOKIE.length + 1))) rejected();
  return found[0].slice(ACCESS_COOKIE.length + 1);
}
export function createOwnerAccessService(settings, { client }) {
  const { config, guardKey, tokenKey, pepper } = settings;
  if (config.environment !== 'dev') throw new ApiError(503, 'IDENTITY_NOT_ACTIVATED');
  const vault=settings.staffEnabled?createPersonalDataVault(settings):null;
  const identifier=value=>{if(typeof value!=='string')throw new ApiError(400,'INVALID_AUTH_REQUEST');if(value.includes('@'))return email(value);if(!vault)throw new ApiError(400,'INVALID_AUTH_REQUEST');return normalizeCpf(value);};
  async function staffLookup(value){
    if(!vault)return null;const data=await client.staffAccess('lookup',{emailIndex:value.includes('@')?vault.index('email',value):'',cpfIndex:value.includes('@')?'':vault.index('cpf',value)});
    if(!data||!Object.hasOwn(data,'account'))throw new ApiError(502,'UPSTREAM_UNTRUSTED');if(data.account===null)return null;
    const a=data.account;if(!catalogUuid(a.subjectId)||!Number.isSafeInteger(a.authorizationVersion)||a.authorizationVersion<1||typeof a.activated!=='boolean')throw new ApiError(502,'UPSTREAM_UNTRUSTED');
    const contact=normalizeStaffContact(vault.open('users',a.subjectId,a.contact));
    if((value.includes('@')?contact.email:contact.cpf)!==value)throw new ApiError(502,'UPSTREAM_UNTRUSTED');return {...a,delivery:contact.email};
  }
  const scope = [config.environment, config.installationId];
  const digest = (purpose, value, format = 'hex', key = guardKey) => createHmac('sha256', key).update(JSON.stringify([purpose, scope, value])).digest(format);
  const guard = createLoginGuard(settings, { client }), pins = createPinHasher({ ...config, pepper });
  const passkeys = createPasskeyService(settings, { client }), tokens = createSessionTokens({ ...config, tokenKey });
  const csrf = token => digest('access.csrf.v1', token, 'base64url');
  const hash = token => digest('access.token.v1', token);
  // Fixed fake record still performs the same KDF for unknown account/wrong PIN.
  const dummy = { version: 1, algorithm: 'scrypt-N32768-r8-p1', salt: '00'.repeat(32), hash: '00'.repeat(32) };
  async function read(token) { return client.access('read', { tokenHash: hash(token) }); }
  return {
    csrf,
    async state(token) {
      try { const f=await read(token);return {stage:f.state,purpose:f.purpose,replacementAllowed:f.replacementAllowed===true}; }
      catch (error) { if (error?.code === 'WORKSPACE_ACCESS_REJECTED') return { stage: 'INITIAL' }; throw error; }
    },
    async execute(operation, input, token, ip) {
     try {
      // Trusted platform address only, never body/forwarded HTTP headers.
      let completedRetry=false;if(operation==='complete'){try{const previous=await read(token);completedRetry=previous.state==='COMPLETE'&&previous.proofReady;}catch{}}
      // Releasing the same durable, cookie-bound grant is not another guess.
      if(!completedRetry)await guard.reserveAttempt({ identifier: ['start', 'login','recover'].includes(operation) ? identifier(input.email) : (operation==='rescue'?'rescue:':'flow:') + hash(token), originAddress: ip });
      if (operation === 'start'||operation==='recover') {
        if(operation==='recover'&&!settings.recoveryEnabled)throw new ApiError(503,'RECOVERY_NOT_ACTIVATED');
        const code = createAccessEmailCode();
        const value=identifier(input.email),staff=await staffLookup(value),proof={flowId:randomUUID(),tokenHash:hash(token),codeHash:digest('access.email.v1',[hash(token),code]),code};
        if(staff) await client.staffAccess(operation==='recover'?'recover':'start',{...proof,subjectId:staff.subjectId,contactHash:createHash('sha256').update(staff.contact).digest('hex'),delivery:staff.delivery});
        else await client.access(operation==='recover'?'recover':'start', { email:value.includes('@')?value:'unknown@example.invalid',...proof });
        return { stage: 'EMAIL', message: 'Se houver uma conta elegível, o código será enviado ao e-mail cadastrado.' };
      }
      if (operation === 'login') {
        if (typeof input.pin !== 'string' || !/^[0-9]{4}$/.test(input.pin)) rejected();
        const value=identifier(input.email),staff=await staffLookup(value);
        const {account}=staff?{account:staff.activated&&staff.record?staff:null}:await client.access('lookup',{email:value.includes('@')?value:'unknown@example.invalid'});
        const valid = await pins.verify(input.pin, account?.subjectId || '00000000-0000-4000-8000-000000000000', account?.record || dummy);
        if (!account || !valid) rejected();
        await client.access('login', { flowId: randomUUID(), tokenHash: hash(token), subjectId: account.subjectId, authorizationVersion: account.authorizationVersion });
        return { stage: 'PASSKEY' };
      }
      if (operation === 'email') {
        const code = normalizeAccessEmailCode(input.code);
        const { verified } = await client.access('email', { tokenHash: hash(token), codeHash: digest('access.email.v1', [hash(token), code]) });
        if (!verified) rejected(); return { stage: 'PIN' };
      }
      const flow = await read(token), subject = { subjectId: flow.subjectId, authorizationVersion: flow.authorizationVersion };
      if(operation==='rescue'){if(!settings.emergencyRecoveryEnabled)throw new ApiError(503,'EMERGENCY_RECOVERY_NOT_ACTIVATED');if(flow.purpose!=='RECOVER'||flow.state!=='PIN')rejected();const result=await client.access('rescue',{tokenHash:hash(token),codeHash:emergencyCodeHash(settings,flow.subjectId,input.recoveryCode)});if(!result.authorized)rejected();return {stage:'PIN',replacementAllowed:true};}
      if (operation === 'pin') {
        if (flow.state !== 'PIN') rejected();
        const record = await pins.hash(input.pin, flow.subjectId);
        await client.access('pin', { tokenHash: hash(token), record: JSON.stringify(record) }); return { stage: 'PASSKEY' };
      }
      if (operation === 'options') {
        if (flow.state !== 'PASSKEY') rejected();
        if(flow.replacementAllowed&&!settings.emergencyRecoveryEnabled)throw new ApiError(503,'EMERGENCY_RECOVERY_NOT_ACTIVATED');
        const provider=flow.replacementAllowed?createPasskeyService(settings,{client:{...client,beginPasskey:({ceremonyId,challenge})=>client.access('rescueBegin',{tokenHash:hash(token),ceremonyId,challenge})}}):passkeys;
        const ceremony = await provider[flow.purpose === 'ACTIVATE'||flow.replacementAllowed ? 'registrationOptions' : 'authenticationOptions'](subject);
        await client.access('bind', { tokenHash: hash(token), ceremonyId: ceremony.ceremonyId });
        return { stage: 'PASSKEY', kind: flow.purpose === 'ACTIVATE'||flow.replacementAllowed ? 'create' : 'get', options: ceremony.options };
      }
      if (operation === 'complete') {
        if (!['PASSKEY', 'COMMITTING', 'COMPLETE'].includes(flow.state) || !flow.ceremonyId) rejected();
        if (flow.state === 'PASSKEY' && !flow.proofReady){
          if(flow.replacementAllowed&&!settings.emergencyRecoveryEnabled)throw new ApiError(503,'EMERGENCY_RECOVERY_NOT_ACTIVATED');
          const futureRaw=digest('access.session.v1',token,'base64url',tokenKey),provider=flow.replacementAllowed?createPasskeyService(settings,{client:{...client,registerPasskey:({ceremonyId,credentialId,publicKey,counter,transports})=>client.access('rescueKey',{tokenHash:hash(token),sessionTokenHash:tokens.hash(futureRaw),ceremonyId,credentialId,publicKey,counter,transports})}}):passkeys;
          await provider[flow.purpose === 'ACTIVATE'||flow.replacementAllowed ? 'verifyRegistration' : 'verifyAuthentication']({ ...subject, ceremonyId: flow.ceremonyId }, input.response);
        }
        // Deterministic only for this unguessable pre-auth cookie and deployment.
        // A lost acknowledgement retries the SAME session, never a second grant.
        const rawToken = digest('access.session.v1', token, 'base64url', tokenKey), tokenHash = tokens.hash(rawToken);
        const principal = validateSessionPrincipal(await client.access('commit', { tokenHash: hash(token), sessionTokenHash: tokenHash }));
        if (principal.id !== flow.subjectId || principal.sessionId !== flow.flowId || !['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(principal.role) || principal.assurance !== 'passkey') rejected();
        return { stage: 'COMPLETE', user: { role: principal.role, assurance: principal.assurance }, cookie: sessionCookie(rawToken) };
      }
      throw new ApiError(404, 'NOT_FOUND');
     } catch(error) {
      if(error instanceof ApiError&&error.status===401&&['ACCESS_REJECTED','WORKSPACE_ACCESS_REJECTED','PASSKEY_REJECTED','WORKSPACE_PASSKEY_REJECTED','WORKSPACE_CHALLENGE_REJECTED'].includes(error.code)){const code=operation==='login'?'CREDENTIALS_REJECTED':operation==='email'?'EMAIL_PROOF_REJECTED':['PASSKEY_REJECTED','WORKSPACE_PASSKEY_REJECTED'].includes(error.code)?'PASSKEY_REJECTED':'FLOW_REJECTED';await client.recordSecurityEvent({commandId:randomUUID(),phase:operation==='rescue'?'RECOVER':operation.toUpperCase(),code});}
      throw error;
     }
    },
  };
}
const shapes = { rescue:['recoveryCode'],recover:['email'], start: ['email'], login: ['email', 'pin'], email: ['code'], pin: ['pin'], options: [], complete: ['response'] };
export const OWNER_ACCESS_BUDGET_MS = 55_000;
export function createOwnerAccessHandler(dependencies = {}) {
  return async (request, context = {}) => {
    const requestId = randomUUID(), deadlineAt = performance.now() + OWNER_ACCESS_BUDGET_MS;
    let operation, settingsLoaded = false;
    try {
      if (new URL(request.url).origin !== ACCESS_ORIGIN) throw new ApiError(403, 'FORBIDDEN');
      operation = new URL(request.url).pathname.split('/').at(-1);
      if (operation !== 'state' && !Object.hasOwn(shapes, operation)) throw new ApiError(404, 'NOT_FOUND');
      const method = operation === 'state' ? 'GET' : 'POST';
      if (request.method !== method) { const result = json({ error: { code: 'METHOD_NOT_ALLOWED', requestId } }, 405); result.headers.set('allow', method); return result; }
      const settings = (dependencies.loadSettings || loadOwnerAccessSettings)();
      settingsLoaded = true;
      const service = createOwnerAccessService(settings, { client: (dependencies.createClient || createWorkspaceClient)(settings.config, { deadlineAt }) });
      let token;
      if (operation === 'state') {
        let fresh = false;
        try { token = readCookie(request); } catch { token = randomBytes(32).toString('base64url'); fresh = true; }
        const data = fresh ? { stage: 'INITIAL' } : await service.state(token);
        const result = json({ data: { ...data,emergencyRecoveryEnabled:settings.emergencyRecoveryEnabled===true,recoveryEnabled:settings.recoveryEnabled===true, csrfToken: service.csrf(token) }, requestId });
        if (fresh) result.headers.set('set-cookie', accessCookie(token)); return result;
      }
      requireSameOriginMutation(request, ACCESS_ORIGIN); token = readCookie(request);
      requireCsrfToken(request, service.csrf(token));
      const declared = request.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > 20000)) throw new ApiError(413, 'INVALID_AUTH_REQUEST');
      // Bound the actual stream before parsing or invoking Google/KDF.
      const reader = request.body?.getReader(); let text = '', size = 0;
      if (reader) { const decoder = new TextDecoder('utf-8', { fatal: true }); try {
        while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 20000) { await reader.cancel(); throw new ApiError(413, 'INVALID_AUTH_REQUEST'); } text += decoder.decode(value, { stream: true }); } text += decoder.decode();
      } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'INVALID_AUTH_REQUEST'); } }
      let input; try { input = JSON.parse(text); } catch { throw new ApiError(400, 'INVALID_AUTH_REQUEST'); }
      if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(shapes[operation].slice().sort())) throw new ApiError(400, 'INVALID_AUTH_REQUEST');
      // Rotate the flow bearer for every new request/login, after CSRF validation.
      if (['start', 'login','recover'].includes(operation)) token = randomBytes(32).toString('base64url');
      const output = await service.execute(operation, input, token, context.ip), { cookie, ...data } = output;
      const result = json({ data: { ...data,emergencyRecoveryEnabled:settings.emergencyRecoveryEnabled===true,recoveryEnabled:settings.recoveryEnabled===true, csrfToken: service.csrf(token) }, requestId }, ['start','recover'].includes(operation) ? 202 : 200);
      if (cookie) {
        result.headers.append('set-cookie', cookie);
        result.headers.append('set-cookie', `${ACCESS_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
      } else if (['start', 'login','recover'].includes(operation)) result.headers.set('set-cookie', accessCookie(token));
      return result;
    } catch (error) {
      // DEV operator setup only, before any identity/cookie/command processing.
      // This does not relax validation or expose key material on public errors.
      if (!settingsLoaded && operation === 'state' && process.env.APP_ENV === 'dev' &&
          error instanceof ApiError && error.code === 'IDENTITY_CONFIGURATION_UNAVAILABLE') {
        const configurationIssues = identityConfigurationIssues(process.env);
        if (configurationIssues.length) return json({ error: { code: error.code, requestId, configurationIssues } }, 503);
      }
      const result = safeFailure(error, requestId);
      if (error?.code === 'AUTH_RATE_LIMITED') result.headers.set('retry-after', String(error.retryAfterSeconds));
      return result;
    }
  };
}
