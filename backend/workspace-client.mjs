import { validateOperationData } from './operations-model.mjs';
import { ApiError } from './errors.mjs';
import { createHash } from 'node:crypto';
import { pack, unpack, requestMessage, verifyResponse } from './protocol.mjs';
import { catalogUuid, normalizeProduct, productFields } from './catalog-model.mjs';
import { paymentMethods } from './checkout-command.mjs';
import { validateNotificationResponse } from './notification-model.mjs';
export const WORKSPACE_RPC_TIMEOUT_MS = 20_000;
export function createWorkspaceClient(config, { fetchImpl = fetch, timeoutMs = WORKSPACE_RPC_TIMEOUT_MS, deadlineAt = Infinity, now = () => performance.now() } = {}) {
  let calls=0, durationMs=0;
  async function invoke(action, actor, payload = {}) {
    const request = requestMessage(config, actor);
    request.action = action;
    request.payload = payload;
    const remaining = Number.isFinite(deadlineAt) ? Math.floor(deadlineAt - now()) : Infinity;
    if (remaining <= 0) throw new ApiError(502, 'UPSTREAM_TIMEOUT');
    const signal = AbortSignal.timeout(Math.min(timeoutMs, remaining));
    const started=now();calls++;
    let response;
    try {
      response = await fetchImpl(config.scriptUrl, { method: 'POST', redirect: 'manual', signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(pack(request, config.secret, 'request')) });
      if (signal.aborted || now() >= deadlineAt) throw new ApiError(502, 'UPSTREAM_TIMEOUT');
      // Apps Script ContentService uses a one-time HTTPS redirect. Never forward the
      // signed POST or any credential to a redirected destination.
      if ([302, 303].includes(response.status)) {
        const url = new URL(response.headers.get('location'));
        if (url.protocol !== 'https:' || url.hostname !== 'script.googleusercontent.com' || url.port || url.username || url.password) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        response = await fetchImpl(url.href, { method: 'GET', redirect: 'manual', signal });
        if (signal.aborted || now() >= deadlineAt) throw new ApiError(502, 'UPSTREAM_TIMEOUT');
      }
      if (!response.ok) throw new ApiError(502, 'UPSTREAM_UNAVAILABLE');
      const limit = ['insights.source','reports.source','audit.list','audit.export','notifications.report','schedules.list','schedules.people'].includes(action) ? 4_000_000 : ['catalog.niches','niches.list'].includes(action)?1_500_000:180_000;
      let text;
      if (limit>180_000) {
        const reader = response.body?.getReader(), decoder = new TextDecoder('utf-8', { fatal:true }); text = ''; let size = 0;
        if (reader) { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
          if (size > limit) { await reader.cancel(); throw new ApiError(502,'UPSTREAM_UNTRUSTED'); } text += decoder.decode(value,{stream:true}); } text += decoder.decode(); }
      } else text = await response.text();
      if (signal.aborted || now() >= deadlineAt) throw new ApiError(502, 'UPSTREAM_TIMEOUT');
      if (text.length > limit) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
      const signed = unpack(JSON.parse(text), config.secret, 'response', limit);
      let data = verifyResponse(signed, request);
      if (['identity.access.startGuarded','identity.access.emailGuarded','identity.access.pinReadGuarded'].includes(action)) {
        if (data?.allowed === false && Number.isSafeInteger(data.retryAfterSeconds) && data.retryAfterSeconds > 0 && data.retryAfterSeconds <= 3600) { const error=new ApiError(429,'AUTH_RATE_LIMITED');error.retryAfterSeconds=data.retryAfterSeconds;throw error; }
        if(data?.allowed!==true)throw new ApiError(502,'UPSTREAM_UNTRUSTED');
        action={'identity.access.startGuarded':'identity.access.start','identity.access.emailGuarded':'identity.access.email','identity.access.pinReadGuarded':'identity.access.read'}[action];
      }
      if (action === 'identity.access.options') {
        if (data?.allowed === false && Number.isSafeInteger(data.retryAfterSeconds) && data.retryAfterSeconds >= 1 && data.retryAfterSeconds <= 3600) {
          const error = new ApiError(429, 'AUTH_RATE_LIMITED'); error.retryAfterSeconds = data.retryAfterSeconds; throw error;
        }
        if (data?.allowed !== true) throw new ApiError(502,'UPSTREAM_UNTRUSTED');
          const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
          if (!uuid(data.subjectId) || !Number.isSafeInteger(data.authorizationVersion) || data.authorizationVersion < 1 || !['create','get'].includes(data.kind) || data.ceremonyId !== payload.ceremonyId || data.challenge !== payload.challenge || typeof data.replacementAllowed !== 'boolean' || !Array.isArray(data.credentials) || data.credentials.length > 5 || data.credentials.some(key => !key || typeof key.id !== 'string' || key.id.length < 2 || key.id.length > 1400 || !Array.isArray(key.transports) || key.transports.some(t => !['ble','cable','hybrid','internal','nfc','smart-card','usb'].includes(t)))) throw new ApiError(502,'UPSTREAM_UNTRUSTED');
          return {subjectId:data.subjectId,authorizationVersion:data.authorizationVersion,kind:data.kind,credentials:data.credentials,ceremonyId:data.ceremonyId,challenge:data.challenge,replacementAllowed:data.replacementAllowed};
      }
      if(action.startsWith('keys.'))return data;
      if(action.startsWith('reports.')||action.startsWith('insights.'))return data;
      if(action==='identity.security.record'){if(!data||data.recorded!==true)throw new ApiError(502,'UPSTREAM_UNTRUSTED');return {recorded:true};}
      if(action.startsWith('audit.'))return data;
      if(action.startsWith('schedules.'))return data;
      if(action.startsWith('niches.'))return data;
      if(action.startsWith('profile.'))return data; // Self-service DTO/bytes validated before response.
      if (action.startsWith('customers.') || action.startsWith('staff.') || action.startsWith('identity.staffAccess.')) return data; // Validated by staff/access service before disclosure.
      if(action.startsWith('operations.'))return validateOperationData(action.slice('operations.'.length),data,payload);
      if (action.startsWith('notifications.')) return validateNotificationResponse(action.slice('notifications.'.length), data, payload, request.requestId);
      if (['sales.checkout','sales.receipt'].includes(action)) {
        const invalid = () => { throw new ApiError(502, 'UPSTREAM_UNTRUSTED'); };
        if (!data || data.saleId !== payload.idempotencyKey || data.totalCents !== payload.expectedTotalCents ||
            data.customerId !== payload.customerId || data.paymentMethod !== payload.paymentMethod || !paymentMethods.includes(data.paymentMethod) ||
            typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt)) ||
            !Array.isArray(data.items) || data.items.length !== payload.items.length) invalid();
        let total = 0;
        const items = data.items.map((line, index) => {
          if (!line || line.productId !== payload.items[index].productId || line.quantity !== payload.items[index].quantity ||
              !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0 ||
              !Number.isSafeInteger(line.subtotalCents) || line.subtotalCents !== line.quantity * line.unitPriceCents) invalid();
          if(line.title!==undefined&&(typeof line.title!=='string'||!line.title||line.title.length>300||/[\x00-\x1f\x7f]/.test(line.title)))invalid();
          total += line.subtotalCents;
          return { productId: line.productId, quantity: line.quantity, unitPriceCents: line.unitPriceCents, subtotalCents: line.subtotalCents,...(line.title!==undefined?{title:line.title}:{}) };
        });
        if (!Number.isSafeInteger(total) || total !== data.totalCents || data.state!==undefined&&!['CONFIRMADA','CANCELADA'].includes(data.state)) invalid();
        return { saleId: data.saleId, totalCents: data.totalCents, customerId: data.customerId, paymentMethod: data.paymentMethod, createdAt: data.createdAt,state:data.state||'CONFIRMADA', items };
      }
      if (action.startsWith('catalog.')) {
        const invalid = () => { throw new ApiError(502, 'UPSTREAM_UNTRUSTED'); };
        function product(value) {
          if (!value || !catalogUuid(value.id) || !Number.isSafeInteger(value.stock) || value.stock < 0 || !Number.isSafeInteger(value.version) || value.version < 1 ||
              typeof value.updatedAt !== 'string' || !Number.isSafeInteger(Date.parse(value.updatedAt))) invalid();
          const input = Object.fromEntries(productFields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
          let record; try { record = normalizeProduct(input, value.id); } catch { invalid(); }
          if (value.hasPhoto !== undefined && typeof value.hasPhoto !== 'boolean') invalid();
          return { id: value.id, ...record, stock: value.stock, version: value.version, updatedAt: value.updatedAt,hasPhoto:value.hasPhoto === true,
            photoUrl:value.hasPhoto === true ? `/api/v1/catalog/cover?id=${value.id}&v=${value.version}`:'' };
        }
        if (action === 'catalog.receive') {
          if (!data || data.commandId !== payload.commandId || data.id !== payload.id || data.quantity !== payload.quantity || data.version !== payload.expectedVersion + 1 ||
              !Number.isSafeInteger(data.stockBefore) || data.stockBefore < 0 || !Number.isSafeInteger(data.stockAfter) || data.stockAfter > 1_000_000 || data.stockAfter !== data.stockBefore + data.quantity ||
              typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))) invalid();
          return { commandId: data.commandId, id: data.id, quantity: data.quantity, version: data.version, stockBefore: data.stockBefore, stockAfter: data.stockAfter, createdAt: data.createdAt };
        }
        if (['catalog.save', 'catalog.remove'].includes(action)) {
          if (data?.id !== payload.id || data.version !== payload.expectedVersion + 1) invalid(); return { id: data.id, version: data.version };
        }
        if (action === 'catalog.cover') {
          if (typeof data?.bytes !== 'string' || data.bytes.length > 65536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.bytes) || typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)) invalid();
          const bytes = Buffer.from(data.bytes,'base64');
          if (bytes.length > 49152 || bytes.toString('base64') !== data.bytes || createHash('sha256').update(bytes).digest('hex') !== data.sha256 || bytes[0] !== 255 || bytes[1] !== 216) invalid();
          return {bytes:data.bytes,sha256:data.sha256};
        }
        if (action === 'catalog.get') { const value = product(data?.product); if (value.id !== payload.id) invalid(); return { product: value }; }
        if (action === 'catalog.list') {
          if (!data || !Array.isArray(data.products) || data.products.length > 10 || !Number.isSafeInteger(data.total) || data.total < 0 || data.total > 5000 ||
              data.nextOffset !== null && (!Number.isSafeInteger(data.nextOffset) || data.nextOffset !== payload.offset + data.products.length || data.nextOffset >= data.total)) invalid();
          return { products: data.products.map(product), total: data.total, nextOffset: data.nextOffset };
        }
        if (action === 'catalog.niches') {
          if (!Array.isArray(data?.niches) || data.niches.length > 200 || data.niches.some(n => !catalogUuid(n?.id) || typeof n.name !== 'string' || !n.name.trim() || n.name.length > 100 ||
              !/^#[a-fA-F0-9]{6}$/.test(n.color) || !Number.isSafeInteger(n.order) || n.order < 0 || typeof n.active !== 'boolean')) invalid();
          if(data.niches.some(n=>n.description!==undefined&&(typeof n.description!=='string'||n.description.length>1000)||n.version!==undefined&&(!Number.isSafeInteger(n.version)||n.version<0)||n.hasImage!==undefined&&typeof n.hasImage!=='boolean'))invalid();
          return { niches: data.niches.map(n => ({ id: n.id, name: n.name, color: n.color, order: n.order, active: n.active,description:typeof n.description==='string'&&n.description.length<=1000?n.description:'',version:Number.isSafeInteger(n.version)&&n.version>=0?n.version:0,hasImage:n.hasImage===true })) };
        }
        invalid();
      }
      if (action.startsWith('identity.access.')) {
        const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
        const untrusted = () => { throw new ApiError(502, 'UPSTREAM_UNTRUSTED'); };
        const flowResult=value=>{
          if(!uuid(value?.flowId)||!uuid(value.subjectId)||!Number.isSafeInteger(value.authorizationVersion)||value.authorizationVersion<1||!['ACTIVATE','LOGIN','RECOVER'].includes(value.purpose)||!['EMAIL','PIN','PASSKEY','COMMITTING','COMPLETE'].includes(value.state)||value.ceremonyId!==''&&!uuid(value.ceremonyId)||typeof value.proofReady!=='boolean'||typeof value.replacementAllowed!=='boolean')untrusted();
          return {flowId:value.flowId,subjectId:value.subjectId,authorizationVersion:value.authorizationVersion,purpose:value.purpose,state:value.state,ceremonyId:value.ceremonyId,proofReady:value.proofReady,replacementAllowed:value.replacementAllowed};
        };
        if(action==='identity.access.loginLookup'){
          if(data?.allowed===false&&Number.isSafeInteger(data.retryAfterSeconds)&&data.retryAfterSeconds>0&&data.retryAfterSeconds<=3600){const error=new ApiError(429,'AUTH_RATE_LIMITED');error.retryAfterSeconds=data.retryAfterSeconds;throw error;}
          if(data?.allowed!==true||!['OWNER','STAFF'].includes(data.kind)||!Object.hasOwn(data,'account'))untrusted();
          if(data.account===null)return {kind:data.kind,account:null};
          const a=data.account,r=a.record;
          if(!uuid(a.subjectId)||!Number.isSafeInteger(a.authorizationVersion)||a.authorizationVersion<1||r?.version!==1||r.algorithm!=='scrypt-N32768-r8-p1'||!/^[a-f0-9]{64}$/.test(r.salt)||!/^[a-f0-9]{64}$/.test(r.hash))untrusted();
          if(data.kind==='STAFF'&&(payload.staffLookup!==true||a.activated!==true||typeof a.contact!=='string'||a.contact.length>10000))untrusted();
          return {kind:data.kind,account:{subjectId:a.subjectId,authorizationVersion:a.authorizationVersion,record:{version:1,algorithm:r.algorithm,salt:r.salt,hash:r.hash},...(data.kind==='STAFF'?{contact:a.contact}: {})}};
        }
        if(action==='identity.access.prepareCompletion'){
          if(data?.allowed===false&&Number.isSafeInteger(data.retryAfterSeconds)&&data.retryAfterSeconds>0&&data.retryAfterSeconds<=3600){const error=new ApiError(429,'AUTH_RATE_LIMITED');error.retryAfterSeconds=data.retryAfterSeconds;throw error;}
          if(data?.allowed!==true||typeof data.done!=='boolean')untrusted();
          const flow=flowResult(data.flow);
          if(!['PASSKEY','COMMITTING','COMPLETE'].includes(flow.state)||!flow.ceremonyId)untrusted();
          if(data.done){
            const p=data.principal;
            if(!flow.proofReady||p?.id!==flow.subjectId||p.sessionId!==flow.flowId||p.authorizationVersion!==flow.authorizationVersion+(flow.purpose==='RECOVER'?1:0)||!['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(p.role)||p.assurance!=='passkey'||!Number.isSafeInteger(p.authenticatedAt)||!Number.isSafeInteger(p.expiresAt))untrusted();
            return {done:true,flow,principal:{id:p.id,sessionId:p.sessionId,authorizationVersion:p.authorizationVersion,role:p.role,assurance:p.assurance,authenticatedAt:p.authenticatedAt,expiresAt:p.expiresAt}};
          }
          const ceremony=data.ceremony,register=flow.purpose==='ACTIVATE'||flow.replacementAllowed;
          if(flow.state!=='PASSKEY'||flow.proofReady||payload.hasResponse!==true||typeof ceremony?.challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(ceremony.challenge)||ceremony.purpose!==(register?'REGISTER':'AUTHENTICATE'))untrusted();
          const k=ceremony.credential;
          if(register&&k!==null||!register&&(!k||k.id!==payload.credentialId||typeof k.publicKey!=='string'||!/^[A-Za-z0-9_-]{20,4096}$/.test(k.publicKey)||!Number.isSafeInteger(k.counter)||k.counter<0||k.counter>4294967295||!Array.isArray(k.transports)||k.transports.some(t=>!['ble','cable','hybrid','internal','nfc','smart-card','usb'].includes(t))))untrusted();
          return {done:false,flow,ceremony:{challenge:ceremony.challenge,purpose:ceremony.purpose,credential:k?{id:k.id,publicKey:k.publicKey,counter:k.counter,transports:k.transports}:null}};
        }
        if (['identity.access.start','identity.access.recover', 'identity.access.login'].includes(action)) {
          if (data?.accepted !== true || data.outcome!==undefined&&!['SENT','NOT_FOUND','ALREADY_ACTIVE','THROTTLED','DELIVERY_UNAVAILABLE'].includes(data.outcome)) untrusted(); return { accepted: true,...(data.outcome?{outcome:data.outcome}:{}) };
        }
        if (action === 'identity.access.ownerLookup') {
          if (!data || !Object.hasOwn(data,'email') || data.email!==null&&(typeof data.email!=='string'||data.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))) untrusted();
          return {email:data.email};
        }
        if (action === 'identity.access.lookup') {
          if (!data || !Object.hasOwn(data, 'account')) untrusted();
          if (data.account === null) return { account: null };
          const account = data.account, record = account.record;
          if (!uuid(account.subjectId) || !Number.isSafeInteger(account.authorizationVersion) || account.authorizationVersion < 1 ||
              record?.version !== 1 || record.algorithm !== 'scrypt-N32768-r8-p1' || !/^[a-f0-9]{64}$/.test(record.salt) || !/^[a-f0-9]{64}$/.test(record.hash)) untrusted();
          return { account: { subjectId: account.subjectId, authorizationVersion: account.authorizationVersion, record: { version: 1, algorithm: record.algorithm, salt: record.salt, hash: record.hash } } };
        }
        if (action === 'identity.access.email') {
          if (typeof data?.verified !== 'boolean') untrusted(); return { verified: data.verified };
        }
        if (['identity.access.pin', 'identity.access.bind'].includes(action)) {
          if (data?.stored !== true) untrusted(); return { stored: true };
        }
        if(action==='identity.access.rescue'){if(typeof data?.authorized!=='boolean')untrusted();return {authorized:data.authorized};}
        if(action==='identity.access.rescueBegin'){if(data?.ceremonyId!==payload.ceremonyId)untrusted();return {ceremonyId:data.ceremonyId};}
        if(action==='identity.access.rescueKey'){if(data?.stored!==true)untrusted();return {stored:true};}
        if (action === 'identity.access.read') {
          if (!uuid(data?.flowId) || !uuid(data.subjectId) || !Number.isSafeInteger(data.authorizationVersion) || data.authorizationVersion < 1 ||
              !['ACTIVATE', 'LOGIN','RECOVER'].includes(data.purpose) || !['EMAIL', 'PIN', 'PASSKEY', 'COMMITTING', 'COMPLETE'].includes(data.state) ||
              data.ceremonyId !== '' && !uuid(data.ceremonyId) || typeof data.proofReady !== 'boolean') untrusted();
          return { flowId: data.flowId, subjectId: data.subjectId, authorizationVersion: data.authorizationVersion,
            purpose: data.purpose, state: data.state, ceremonyId: data.ceremonyId, proofReady: data.proofReady,replacementAllowed:data.replacementAllowed===true };
        }
        if (action === 'identity.access.commit') {
          if (!uuid(data?.id) || !uuid(data.sessionId) || !['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(data.role) || data.assurance !== 'passkey' ||
              !Number.isSafeInteger(data.authenticatedAt) || !Number.isSafeInteger(data.expiresAt) || !Number.isSafeInteger(data.authorizationVersion)) untrusted();
          return { id: data.id, sessionId: data.sessionId, role: data.role, assurance: data.assurance,
            authenticatedAt: data.authenticatedAt, expiresAt: data.expiresAt, authorizationVersion: data.authorizationVersion };
        }
        untrusted();
      }
      if (action === 'system.ping') {
        if (!data || data.ready !== true || data.environment !== config.environment || data.schemaVersion !== 1) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { ready: true, environment: data.environment, schemaVersion: data.schemaVersion };
      }
      if (action === 'identity.passkey.list') {
        if (!data || !Array.isArray(data.credentials) || data.credentials.length > 5 || data.credentials.some(key => !key || typeof key.id !== 'string' || key.id.length > 1400 || !Array.isArray(key.transports))) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { credentials: data.credentials.map(key => ({ id: key.id, transports: key.transports })) };
      }
      if (action === 'identity.passkey.begin') {
        if (data?.ceremonyId !== payload.ceremonyId) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { ceremonyId: data.ceremonyId };
      }
      if (action === 'identity.passkey.take') {
        if (!data || typeof data.challenge !== 'string' || data.challenge.length !== 43 || !['REGISTER', 'AUTHENTICATE'].includes(data.purpose)) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        const key = data.credential;
        if (data.purpose === 'AUTHENTICATE' && (!key || key.id !== payload.credentialId || typeof key.publicKey !== 'string' || key.publicKey.length > 4096 || !Number.isSafeInteger(key.counter) || key.counter < 0 || !Array.isArray(key.transports))) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { challenge: data.challenge, purpose: data.purpose, credential: key ? { id: key.id, publicKey: key.publicKey, counter: key.counter, transports: key.transports } : null };
      }
      if (['identity.passkey.register', 'identity.passkey.counter'].includes(action)) {
        if (data?.stored !== true) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { stored: true };
      }
      if (action === 'identity.guard.attempt') {
        if (!data || typeof data.allowed !== 'boolean' || !Number.isSafeInteger(data.retryAfterSeconds) ||
            data.retryAfterSeconds < 0 || data.retryAfterSeconds > 3600 || (data.allowed ? data.retryAfterSeconds !== 0 : data.retryAfterSeconds < 1)) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { allowed: data.allowed, retryAfterSeconds: data.retryAfterSeconds };
      }
      if (action === 'identity.challenge.create') {
        if (!data || data.challengeId !== payload.challengeId || !Number.isSafeInteger(data.expiresAt) ||
            data.expiresAt <= signed.sentAt || data.expiresAt > signed.sentAt + 600_000) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { challengeId: data.challengeId, expiresAt: data.expiresAt };
      }
      if (action === 'identity.challenge.consume') {
        if (!data || typeof data.verified !== 'boolean') throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { verified: data.verified };
      }
      if (action === 'identity.session.read') {
        if (!data || typeof data !== 'object') throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        const { id, sessionId, role, assurance, authenticatedAt, expiresAt, authorizationVersion } = data;
        return { id, sessionId, role, assurance, authenticatedAt, expiresAt, authorizationVersion };
      }
      if (action.startsWith('identity.session.')) {
        if (data?.revoked !== true) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
        return { revoked: true };
      }
      if (!data || !Number.isSafeInteger(data.schemaVersion) || !Array.isArray(data.tables) || data.tables.some(t => typeof t !== 'string')) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
      return { schemaVersion: data.schemaVersion, tables: data.tables };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE');
    } finally { durationMs+=Math.max(0,now()-started); }
  }
  return { keys:(op,actor,payload)=>{if(!['list','state','start','authorize','register','cancel','codes'].includes(op))throw new ApiError(400,'INVALID_KEY_MANAGEMENT');return invoke('keys.'+op,actor,payload);},insights:(op,actor,payload)=>{if(!['source','record'].includes(op))throw new ApiError(400,'INVALID_REPORT');return invoke('insights.'+op,actor,payload);},reports:(op,actor,payload)=>{if(!['source','record'].includes(op))throw new ApiError(400,'INVALID_REPORT');return invoke('reports.'+op,actor,payload);},audit:(op,actor,payload)=>{if(!['list','export'].includes(op))throw new ApiError(400,'INVALID_AUDIT');return invoke('audit.'+op,actor,payload);},schedules:(op,actor,payload)=>{if(!['list','get','people','save','cancel'].includes(op))throw new ApiError(400,'INVALID_SCHEDULE');return invoke('schedules.'+op,actor,payload);},niches:(op,actor,payload)=>{if(!['list','save','image'].includes(op))throw new ApiError(400,'INVALID_NICHE');return invoke('niches.'+op,actor,payload);},schema: actor => invoke('system.schema', actor), ping: () => invoke('system.ping', null),
    profile:(operation,actor,payload)=>{if(!['get','save','photo','emailState','emailStart','emailConfirm','emailCancel'].includes(operation))throw new ApiError(400,'INVALID_PROFILE');return invoke('profile.'+operation,actor,payload);},
    operations:(operation,actor,payload)=>{if(!['list','get','adjust','reverse'].includes(operation))throw new ApiError(400,'INVALID_OPERATION');return invoke('operations.'+operation,actor,payload);},
    customers:(operation,actor,payload)=>{if(!['find','get','save'].includes(operation))throw new ApiError(400,'INVALID_CUSTOMER');return invoke('customers.'+operation,actor,payload);},
    staff:(operation,actor,payload)=> { if(!['list','get','save'].includes(operation))throw new ApiError(400,'INVALID_STAFF'); return invoke('staff.'+operation,actor,payload); },
    staffAccess:(operation,payload)=> { if(!['lookup','start','recover'].includes(operation))throw new ApiError(400,'INVALID_AUTH_REQUEST');return invoke('identity.staffAccess.'+operation,null,payload); },
    notifications: (operation, actor, payload) => {
      if (!['summary','list','read','state','report'].includes(operation)) throw new ApiError(400,'INVALID_NOTIFICATION');
      return invoke('notifications.' + operation, actor, payload);
    },
    checkoutReceipt:(actor,payload)=>invoke('sales.receipt',actor,payload),
    checkout: (actor, payload) => invoke('sales.checkout', actor, payload),
    catalog: (operation, actor, payload) => {
      if (!['list', 'get', 'niches', 'save', 'cover', 'receive', 'remove'].includes(operation)) throw new ApiError(400, 'INVALID_PRODUCT');
      return invoke('catalog.' + operation, actor, payload);
    },
    access: (operation, payload) => {
      if (!['rescue','rescueBegin','rescueKey','start','recover', 'lookup', 'ownerLookup', 'login', 'read', 'email', 'pin', 'bind', 'commit'].includes(operation)) throw new ApiError(400, 'INVALID_AUTH_REQUEST');
      return invoke('identity.access.' + operation, null, payload);
    },
    listPasskeys: payload => invoke('identity.passkey.list', null, payload),
    beginPasskey: payload => invoke('identity.passkey.begin', null, payload),
    takePasskey: payload => invoke('identity.passkey.take', null, payload),
    registerPasskey: payload => invoke('identity.passkey.register', null, payload),
    advancePasskeyCounter: payload => invoke('identity.passkey.counter', null, payload),
    recordSecurityEvent: payload => invoke('identity.security.record',null,payload),
    startOwnerAccess: payload => invoke('identity.access.startGuarded', null, payload),
    timings: () => Object.freeze({calls,durationMs:Math.round(durationMs)}),
    verifyAccessEmail: payload => invoke('identity.access.emailGuarded', null, payload),
    readAccessForPin: payload => invoke('identity.access.pinReadGuarded', null, payload),
    lookupAccessLogin: payload => invoke('identity.access.loginLookup', null, payload),
    prepareAccessOptions: payload => invoke('identity.access.options', null, payload),
    prepareAccessCompletion: payload => invoke('identity.access.prepareCompletion', null, payload),
    reserveAuthAttempt: payload => invoke('identity.guard.attempt', null, payload),
    createAuthChallenge: payload => invoke('identity.challenge.create', null, payload),
    consumeAuthChallenge: payload => invoke('identity.challenge.consume', null, payload),
    readSession: tokenHash => invoke('identity.session.read', null, { tokenHash }),
    revokeSession: tokenHash => invoke('identity.session.revoke', null, { tokenHash }),
    revokeOtherSessions: tokenHash => invoke('identity.session.revokeOthers', null, { tokenHash }),
  };
}
