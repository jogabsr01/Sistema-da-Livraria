import { identityConfigurationIssues } from './identity-configuration.mjs';
import { emergencyCodeHash } from './emergency-codes.mjs';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { loadPersonalDataSettings, createPersonalDataVault } from './personal-data.mjs';
import { normalizeCpf, normalizeStaffContact } from './staff-model.mjs';
import { catalogUuid } from './catalog-model.mjs';
import { ApiError, json, safeFailure } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { loadLoginGuardSettings, createLoginGuard } from './login-guard.mjs';
import { loadPasskeySettings, createPasskeyService, preparedAccessOptions, validatePasskeyResponse } from './passkey-service.mjs';
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
  let personal = null;
  if (staffEnabled) personal = loadPersonalDataSettings(env);
  else if (env.WORKSPACE_PERSONAL_DATA_KEY && env.WORKSPACE_PERSONAL_INDEX_KEY) { try { personal = loadPersonalDataSettings(env); } catch {} }
  return { ...sessions, ...guards, ...personal, cpfEnabled: !!personal, pepper: Buffer.from(pepper, 'hex'),staffEnabled,emergencyRecoveryEnabled:env.WORKSPACE_EMERGENCY_RECOVERY_ENABLED==='true'&&env.WORKSPACE_RECOVERY_ENABLED==='true',recoveryEnabled:env.WORKSPACE_RECOVERY_ENABLED==='true', };
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
export function createOwnerAccessService(settings, { client, stagedCompletion = false }) {
  const { config, guardKey, tokenKey, pepper } = settings;
  if (config.environment !== 'dev') throw new ApiError(503, 'IDENTITY_NOT_ACTIVATED');
  const vault=settings.cpfEnabled||settings.staffEnabled?createPersonalDataVault(settings):null;
  const identifier=value=>{if(typeof value!=='string')throw new ApiError(400,'INVALID_AUTH_REQUEST');if(value.includes('@'))return email(value);if(!vault)throw new ApiError(503,'ACCESS_CPF_NOT_AVAILABLE');return normalizeCpf(value);};
  async function staffLookup(value){
    if(!vault||!settings.staffEnabled)return null;const data=await client.staffAccess('lookup',{emailIndex:value.includes('@')?vault.index('email',value):'',cpfIndex:value.includes('@')?'':vault.index('cpf',value)});
    if(!data||!Object.hasOwn(data,'account'))throw new ApiError(502,'UPSTREAM_UNTRUSTED');if(data.account===null)return null;
    const a=data.account;if(!catalogUuid(a.subjectId)||!Number.isSafeInteger(a.authorizationVersion)||a.authorizationVersion<1||typeof a.activated!=='boolean')throw new ApiError(502,'UPSTREAM_UNTRUSTED');
    let contact;try{contact=normalizeStaffContact(vault.open('users',a.subjectId,a.contact));}catch(e){if(e instanceof ApiError&&e.status===400)throw new ApiError(502,'UPSTREAM_UNTRUSTED');throw e;}
    if((value.includes('@')?contact.email:contact.cpf)!==value)throw new ApiError(502,'UPSTREAM_UNTRUSTED');return {...a,delivery:contact.email};
  }
  async function ownerDelivery(value, operation) {
    if (value.includes('@')) return value;
    const result = await client.access('ownerLookup',{cpfIndex:vault.index('cpf',value)});
    if (result.email) return result.email;
    if (operation === 'start') throw new ApiError(404,'ACCESS_CPF_NOT_REGISTERED');
    return 'unknown@example.invalid';
  }
  function acceptedStart(result, value) {
    if (result?.accepted !== true || result.outcome !== undefined && !['SENT','NOT_FOUND','ALREADY_ACTIVE','THROTTLED','DELIVERY_UNAVAILABLE'].includes(result.outcome)) throw new ApiError(502,'UPSTREAM_UNTRUSTED');
    const codes = {NOT_FOUND:value.includes('@')?'ACCESS_EMAIL_NOT_REGISTERED':'ACCESS_CPF_NOT_REGISTERED',ALREADY_ACTIVE:'ACCESS_ALREADY_ACTIVATED',THROTTLED:'AUTH_DELIVERY_RATE_LIMITED',DELIVERY_UNAVAILABLE:'ACCESS_EMAIL_DELIVERY_UNAVAILABLE'};
    if (codes[result.outcome]) { const error=new ApiError(result.outcome==='NOT_FOUND'?404:result.outcome==='ALREADY_ACTIVE'?409:result.outcome==='THROTTLED'?429:503,codes[result.outcome]);if(result.outcome==='THROTTLED')error.retryAfterSeconds=60;throw error; }
    return {stage:'EMAIL',message:result.outcome==='SENT'?'Código enviado ao e-mail vinculado ao seu cadastro. Confira a caixa de entrada.':'Se houver uma conta elegível, o código será enviado ao e-mail cadastrado.'};
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
  function completedOutput(flow, value, rawToken) {
    const principal=validateSessionPrincipal(value);
    if(principal.id!==flow.subjectId||principal.sessionId!==flow.flowId||principal.authorizationVersion!==flow.authorizationVersion+(flow.purpose==='RECOVER'?1:0)||!['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(principal.role)||principal.assurance!=='passkey')rejected();
    const sessionCsrfToken=createHmac('sha256',tokenKey).update(JSON.stringify(['csrf.v1',config.environment,config.installationId,rawToken])).digest('base64url');
    return {stage:'COMPLETE',user:{role:principal.role,assurance:principal.assurance},cookie:sessionCookie(rawToken),sessionCsrfToken};
  }
  async function completePrepared(input,token,ip) {
    const response=input.response;
    const hasResponse=response!==null&&response!==undefined&&!(typeof response==='object'&&!Array.isArray(response)&&Object.keys(response).length===0);
    let handleSubjectId='';
    if(hasResponse){
      validatePasskeyResponse(response);
      const handle=response.response?.userHandle;
      if(handle!==null&&handle!==undefined){
        if(typeof handle!=='string'||Buffer.from(handle,'base64url').toString('base64url')!==handle)rejected();
        handleSubjectId=Buffer.from(handle,'base64url').toString('utf8');if(!catalogUuid(handleSubjectId))rejected();
      }
    }
    const rawToken=digest('access.session.v1',token,'base64url',tokenKey),sessionTokenHash=tokens.hash(rawToken);
    const prepared=await client.prepareAccessCompletion({...guard.attemptKeys({identifier:'flow:'+hash(token),originAddress:ip}),tokenHash:hash(token),sessionTokenHash,credentialId:hasResponse&&typeof response.id==='string'?response.id:'',hasResponse,allowReplacement:settings.emergencyRecoveryEnabled===true,handleSubjectId});
    const flow=prepared.flow;
    if(prepared.done)return completedOutput(flow,prepared.principal,rawToken);
    const user={subjectId:flow.subjectId,authorizationVersion:flow.authorizationVersion};
    const provider=createPasskeyService(settings,{client:{...client,
      takePasskey:async supplied=>{
        if(supplied.subjectId!==flow.subjectId||supplied.authorizationVersion!==flow.authorizationVersion||supplied.ceremonyId!==flow.ceremonyId||supplied.credentialId!==(flow.purpose==='ACTIVATE'||flow.replacementAllowed?'':response.id))rejected();
        return prepared.ceremony;
      },
      ...(flow.replacementAllowed?{registerPasskey:({ceremonyId,credentialId,publicKey,counter,transports})=>client.access('rescueKey',{tokenHash:hash(token),sessionTokenHash,ceremonyId,credentialId,publicKey,counter,transports})}:{})
    }});
    await provider[flow.purpose==='ACTIVATE'||flow.replacementAllowed?'verifyRegistration':'verifyAuthentication']({...user,ceremonyId:flow.ceremonyId},response);
    // Positive acknowledgement only: proof is durable, but no session/cookie is
    // granted until a subsequent authoritative commit succeeds.
    if(stagedCompletion)return {stage:'COMMITTING',proofSaved:true};
    return completedOutput(flow,await client.access('commit',{tokenHash:hash(token),sessionTokenHash}),rawToken);
  }

  return {
    csrf,
    async state(token) {
      try { const f=await read(token);return {stage:f.state==='PASSKEY'&&f.proofReady?'COMMITTING':f.state,purpose:f.purpose,replacementAllowed:f.replacementAllowed===true}; }
      catch (error) { if (error?.code === 'WORKSPACE_ACCESS_REJECTED') return { stage: 'INITIAL' }; throw error; }
    },
    async execute(operation, input, token, ip) {
     try {
      // Trusted platform address only, never body/forwarded HTTP headers.
      if (operation === 'email' && typeof client.verifyAccessEmail === 'function' && typeof input.code === 'string' && (/^[A-HJ-NP-Z2-9]{7}$/i.test(input.code.trim()) || canonical(input.code.trim()))) {
        const code=normalizeAccessEmailCode(input.code);
        const result=await client.verifyAccessEmail({...guard.attemptKeys({identifier:'flow:'+hash(token),originAddress:ip}),tokenHash:hash(token),codeHash:digest('access.email.v1',[hash(token),code])});
        if (!result.verified) rejected();
        return {stage:'PIN'};
      }
      let pinFlow;
      if (operation === 'pin' && typeof client.readAccessForPin === 'function') pinFlow=await client.readAccessForPin({...guard.attemptKeys({identifier:'flow:'+hash(token),originAddress:ip}),tokenHash:hash(token)});
      if (operation === 'start' && !settings.staffEnabled && typeof client.startOwnerAccess === 'function' && typeof input.email === 'string' && input.email.includes('@')) {
        const value=identifier(input.email), code=createAccessEmailCode();
        const result=await client.startOwnerAccess({...guard.attemptKeys({identifier:value,originAddress:ip}),email:value,flowId:randomUUID(),tokenHash:hash(token),codeHash:digest('access.email.v1',[hash(token),code]),code});
        return acceptedStart(result,value);
      }
      // This fixed command reserves the SAME durable attempt in GAS before
      // checking the flow, listing keys, storing the challenge and binding it.
      // Other operations, completion/retry and time budgets remain unchanged.
      if (operation === 'options' && typeof client.prepareAccessOptions === 'function') {
        const attempt = guard.attemptKeys({ identifier: 'flow:' + hash(token), originAddress: ip });
        const prepared = await client.prepareAccessOptions({ ...attempt, tokenHash: hash(token),
          ceremonyId: randomUUID(), challenge: randomBytes(32).toString('base64url'),
          allowReplacement: settings.emergencyRecoveryEnabled === true });
        return await preparedAccessOptions(prepared);
      }
      if(operation==='complete'&&typeof client.prepareAccessCompletion==='function')return await completePrepared(input,token,ip);
      let completedRetry=false;if(operation==='complete'){try{const previous=await read(token);completedRetry=previous.state==='COMPLETE'&&previous.proofReady;}catch{}}
      // Releasing the same durable, cookie-bound grant is not another guess.
      if(!completedRetry&&!pinFlow)await guard.reserveAttempt({ identifier: ['start', 'login','recover'].includes(operation) ? identifier(input.email) : (operation==='rescue'?'rescue:':'flow:') + hash(token), originAddress: ip });
      if (operation === 'start'||operation==='recover') {
        if(operation==='recover'&&!settings.recoveryEnabled)throw new ApiError(503,'RECOVERY_NOT_ACTIVATED');
        const code = createAccessEmailCode();
        const value=identifier(input.email),staff=await staffLookup(value),proof={flowId:randomUUID(),tokenHash:hash(token),codeHash:digest('access.email.v1',[hash(token),code]),code};
        const result=staff ? await client.staffAccess(operation==='recover'?'recover':'start',{...proof,subjectId:staff.subjectId,contactHash:createHash('sha256').update(staff.contact).digest('hex'),delivery:staff.delivery})
          : await client.access(operation==='recover'?'recover':'start', { email:await ownerDelivery(value,operation),...proof });
        return operation==='start'?acceptedStart(result,value):{stage:'EMAIL',message:'Se houver uma conta elegível, o código será enviado ao e-mail cadastrado.'};
      }
      if (operation === 'login') {
        if (typeof input.pin !== 'string' || !/^[0-9]{4}$/.test(input.pin)) rejected();
        const value=identifier(input.email),staff=await staffLookup(value);
        const {account}=staff?{account:staff.activated&&staff.record?staff:null}:await client.access('lookup',{email:await ownerDelivery(value,'login')});
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
      const flow = pinFlow || await read(token), subject = { subjectId: flow.subjectId, authorizationVersion: flow.authorizationVersion };
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
        return completedOutput(flow,principal,rawToken);
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
export const COMPLETION_REQUEST_BUDGET_MS = 27_000;
export function createOwnerAccessHandler(dependencies = {}) {
  return async (request, context = {}) => {
    const requestId = randomUUID(), startedAt = performance.now();
    const completionRequest=new URL(request.url).pathname.split('/').at(-1)==='complete'&&request.headers.get('x-access-completion-version')==='2';
    const deadlineAt=startedAt+(completionRequest?COMPLETION_REQUEST_BUDGET_MS:OWNER_ACCESS_BUDGET_MS);
    let operation, settingsLoaded = false, client;
    const timed=response=>{const metrics=client?.timings?.();response.headers.set('server-timing',`app;dur=${Math.round(performance.now()-startedAt)}`+(metrics?`, google;dur=${metrics.durationMs}, rpc;desc="${metrics.calls}"`:''));return response;};
    try {
      if (new URL(request.url).origin !== ACCESS_ORIGIN) throw new ApiError(403, 'FORBIDDEN');
      operation = new URL(request.url).pathname.split('/').at(-1);
      if (operation !== 'state' && !Object.hasOwn(shapes, operation)) throw new ApiError(404, 'NOT_FOUND');
      const method = operation === 'state' ? 'GET' : 'POST';
      if (request.method !== method) { const result = json({ error: { code: 'METHOD_NOT_ALLOWED', requestId } }, 405); result.headers.set('allow', method); return result; }
      const settings = (dependencies.loadSettings || loadOwnerAccessSettings)();
      settingsLoaded = true;
      client=(dependencies.createClient || createWorkspaceClient)(settings.config, { deadlineAt });
      const service = createOwnerAccessService(settings, { client, stagedCompletion:request.headers.get('x-access-completion-version')==='2' });
      let token;
      if (operation === 'state') {
        let fresh = false;
        try { token = readCookie(request); } catch { token = randomBytes(32).toString('base64url'); fresh = true; }
        const data = fresh ? { stage: 'INITIAL' } : await service.state(token);
        const result = json({ data: { ...data,emergencyRecoveryEnabled:settings.emergencyRecoveryEnabled===true,recoveryEnabled:settings.recoveryEnabled===true, cpfAvailable:settings.cpfEnabled===true, csrfToken: service.csrf(token) }, requestId });
        if (fresh) result.headers.set('set-cookie', accessCookie(token)); return timed(result);
      }
      requireSameOriginMutation(request, ACCESS_ORIGIN);
      // A missing/expired/invalid pre-auth cookie is not a rejected account or
      // PIN. This code is emitted only before body parsing, guard/KDF or RPC.
      try { token = readCookie(request); }
      catch { throw new ApiError(401, 'ACCESS_CONTEXT_EXPIRED'); }
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
      const result = json({ data: { ...data,emergencyRecoveryEnabled:settings.emergencyRecoveryEnabled===true,recoveryEnabled:settings.recoveryEnabled===true, cpfAvailable:settings.cpfEnabled===true, csrfToken: service.csrf(token) }, requestId }, ['start','recover'].includes(operation)||data.stage==='COMMITTING' ? 202 : 200);
      if (cookie) {
        result.headers.append('set-cookie', cookie);
        result.headers.append('set-cookie', `${ACCESS_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
      } else if (['start', 'login','recover'].includes(operation)) result.headers.set('set-cookie', accessCookie(token));
      return timed(result);
    } catch (error) {
      // DEV operator setup only, before any identity/cookie/command processing.
      // This does not relax validation or expose key material on public errors.
      if (!settingsLoaded && operation === 'state' && process.env.APP_ENV === 'dev' &&
          error instanceof ApiError && error.code === 'IDENTITY_CONFIGURATION_UNAVAILABLE') {
        const configurationIssues = identityConfigurationIssues(process.env);
        if (configurationIssues.length) return json({ error: { code: error.code, requestId, configurationIssues } }, 503);
      }
      const result = safeFailure(error, requestId);
      if (['AUTH_RATE_LIMITED','AUTH_DELIVERY_RATE_LIMITED'].includes(error?.code)) result.headers.set('retry-after', String(error.retryAfterSeconds));
      return timed(result);
    }
  };
}
