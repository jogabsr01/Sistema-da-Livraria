import { createHmac, randomUUID } from 'node:crypto';
import { ApiError, json, safeFailure } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { createSessionService } from './session-service.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { requirePermission, requireSameOriginMutation, requireCsrfToken } from './authorization.mjs';
import { catalogUuid, normalizeProduct, normalizedIsbn } from './catalog-model.mjs';
import { prepareCoverPhoto } from './cover-photo.mjs';
import { createIsbnLookupService } from './isbn-lookup.mjs';
import { loadLoginGuardSettings } from './login-guard.mjs';
import { normalizeStockReceipt } from './stock-command.mjs';
const ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app';
export function loadCatalogSettings(env = process.env) {
  if (env.WORKSPACE_CATALOG_ENABLED !== 'true') throw new ApiError(503, 'CATALOG_NOT_ACTIVATED');
  return {...loadSessionSettings(env),lookupEnabled:env.WORKSPACE_ISBN_LOOKUP_ENABLED === 'true',photosEnabled:env.WORKSPACE_COVER_PHOTOS_ENABLED === 'true',checkoutEnabled:env.WORKSPACE_CHECKOUT_ENABLED === 'true',customersEnabled:env.WORKSPACE_CUSTOMERS_ENABLED === 'true'}; // DEV-only, full bindings; independently gated.
}
export function loadIsbnLookupSettings(env = process.env) {
  if (env.WORKSPACE_ISBN_LOOKUP_ENABLED !== 'true') throw new ApiError(503,'ISBN_LOOKUP_NOT_ACTIVATED');
  return loadLoginGuardSettings(env);
}
export function createCatalogHandler(dependencies = {}) {
  const lookupService = dependencies.lookupService || createIsbnLookupService();
  return async request => {
    const requestId = randomUUID();
    try {
      if (new URL(request.url).origin !== ORIGIN) throw new ApiError(403, 'FORBIDDEN');
      const operation = new URL(request.url).pathname.split('/').at(-1), method = ['save','isbn','receive','remove'].includes(operation) ? 'POST' : 'GET';
      if (!['list', 'get', 'niches', 'save', 'isbn', 'cover', 'receive', 'remove'].includes(operation)) throw new ApiError(404, 'NOT_FOUND');
      if (request.method !== method) { const response = json({ error: { code: 'METHOD_NOT_ALLOWED', requestId } }, 405); response.headers.set('allow', method); return response; }
      const settings = (dependencies.loadSettings || loadCatalogSettings)(), client = (dependencies.createClient || createWorkspaceClient)(settings.config);
      const sessions = createSessionService(settings, { client });
      if (method === 'POST') requireSameOriginMutation(request, ORIGIN);
      const principal = await sessions.authenticate(request);
      requirePermission(principal, operation === 'remove' ? 'products.delete' : operation === 'receive' ? 'stock.receive' : ['save','isbn'].includes(operation) ? 'products.write' : 'products.read');
      // Resolve CSRF against the same authoritative cookie, never a caller role.
      if (method === 'POST') requireCsrfToken(request, (await sessions.current(request)).csrfToken);
      const actor = { sessionTokenHash: principal.sessionTokenHash };
      let payload;
      const query = new URL(request.url).searchParams;
      if (['get','cover'].includes(operation)) { if ([...query.keys()].some(key => !['id', ...(operation === 'cover' ? ['v']:[])].includes(key) || query.getAll(key).length !== 1) || query.getAll('id').length !== 1 || !catalogUuid(query.get('id')) || query.has('v') && !/^[1-9]\d{0,9}$/.test(query.get('v'))) throw new ApiError(400, 'INVALID_PRODUCT'); payload = { id: query.get('id') }; }
      if (operation === 'cover' && !settings.photosEnabled) throw new ApiError(503, 'COVER_PHOTOS_NOT_ACTIVATED');
      if (operation === 'niches') { if (query.size) throw new ApiError(400, 'INVALID_PRODUCT'); payload = {}; }
      if (operation === 'list') {
        if ([...query.keys()].some(key => !['q', 'offset', 'niche', 'inactive'].includes(key) || query.getAll(key).length !== 1)) throw new ApiError(400, 'INVALID_PRODUCT');
        const offset = query.get('offset') || '0', search = (query.get('q') || '').trim(), nicheId = query.get('niche') || '';
        if (!/^\d{1,5}$/.test(offset) || Number(offset) > 5000 || search.length > 100 || nicheId && !catalogUuid(nicheId) || query.has('inactive') && !['true', 'false'].includes(query.get('inactive'))) throw new ApiError(400, 'INVALID_PRODUCT');
        payload = { search, offset: Number(offset), nicheId, includeInactive: query.get('inactive') === 'true' };
      }
      if (['save','isbn','receive','remove'].includes(operation)) {
        if (query.size) throw new ApiError(400, 'INVALID_PRODUCT');
        const reader = request.body?.getReader(); let size = 0, content = '';
        if (reader) { const decoder = new TextDecoder('utf-8', { fatal: true }); try {
          while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
            if (size > (operation === 'isbn' ? 128 : ['receive','remove'].includes(operation) ? 2000 : 135000)) { await reader.cancel(); throw new ApiError(413, 'INVALID_PRODUCT'); } content += decoder.decode(value, { stream: true }); }
          content += decoder.decode();
        } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'INVALID_PRODUCT'); } }
        let input; try { input = JSON.parse(content); } catch { throw new ApiError(400, 'INVALID_PRODUCT'); }
        if (operation === 'receive') return json({ data: await client.catalog(operation, actor, normalizeStockReceipt(input)), requestId });
        if (operation === 'remove') {
          if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(['commandId','expectedVersion','id']) ||
              !catalogUuid(input.commandId) || !catalogUuid(input.id) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion >= 1_000_000_000) throw new ApiError(400, 'INVALID_PRODUCT');
          return json({ data: await client.catalog(operation, actor, input), requestId });
        }
        if (operation === 'isbn') {
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input,'isbn')) throw new ApiError(400,'INVALID_ISBN');
          let isbn;try { isbn=normalizedIsbn(input.isbn); } catch { throw new ApiError(400,'INVALID_ISBN'); } if (!isbn) throw new ApiError(400,'INVALID_ISBN');
          const lookupSettings=(dependencies.loadLookupSettings || loadIsbnLookupSettings)();
          if (lookupSettings.config.installationId !== settings.config.installationId || lookupSettings.config.environment !== 'dev') throw new ApiError(503,'ISBN_LOOKUP_NOT_ACTIVATED');
          // Existing durable counters, with separate HMAC domains. Bibliographic
          // requests never consume a user's login bucket or disclose the user.
          const digest=(kind,value)=>createHmac('sha256',lookupSettings.guardKey).update(JSON.stringify(['catalog.isbn.v1',settings.config.installationId,kind,value])).digest('hex');
          const limit=await client.reserveAuthAttempt({accountKey:digest('user',principal.id),originKey:digest('installation',settings.config.installationId)});
          if (!limit.allowed) { const response=json({error:{code:'ISBN_RATE_LIMITED',retryAfterSeconds:limit.retryAfterSeconds},requestId},429);response.headers.set('retry-after',String(limit.retryAfterSeconds));return response; }
          return json({data:await lookupService.lookup(isbn),requestId});
        }
        if (size > 40000 && (!input || typeof input !== 'object' || !Object.hasOwn(input,'photo'))) throw new ApiError(413,'INVALID_PRODUCT');
        if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(Object.keys(input).filter(key => key !== 'photo').sort()) !== JSON.stringify(['commandId', 'expectedVersion', 'id', 'record']) ||
            !catalogUuid(input.commandId) || !catalogUuid(input.id) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 1_000_000_000) throw new ApiError(400, 'INVALID_PRODUCT');
        payload = { commandId: input.commandId, id: input.id, expectedVersion: input.expectedVersion, record: normalizeProduct(input.record, input.id) };
        if (Object.hasOwn(input,'photo')) {
          if (!settings.photosEnabled) throw new ApiError(503, 'COVER_PHOTOS_NOT_ACTIVATED');
          if (input.photo !== null && payload.record.coverUrl) throw new ApiError(400, 'INVALID_COVER_PHOTO');
          payload.photo = await prepareCoverPhoto(input.photo);
        }
      }
      const data=await client.catalog(operation, actor, payload);
      if (operation === 'cover') return new Response(Buffer.from(data.bytes,'base64'), { status:200,headers:{ 'content-type':'image/jpeg','cache-control':'private, no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin','content-security-policy':"default-src 'none'; sandbox",'referrer-policy':'no-referrer' } });
      return json({ data:operation === 'niches'?{...data,lookupEnabled:settings.lookupEnabled === true,photosEnabled:settings.photosEnabled === true,checkoutEnabled:settings.checkoutEnabled === true,customersEnabled:settings.customersEnabled === true}:data, requestId });
    } catch (error) { return safeFailure(error, requestId); }
  };
}
