import { randomUUID } from 'node:crypto';
import { ApiError, json, safeFailure } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { createSessionService } from './session-service.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { requirePermission, requireSameOriginMutation, requireCsrfToken } from './authorization.mjs';
import { catalogUuid, normalizeProduct } from './catalog-model.mjs';
const ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app';
export function loadCatalogSettings(env = process.env) {
  if (env.WORKSPACE_CATALOG_ENABLED !== 'true') throw new ApiError(503, 'CATALOG_NOT_ACTIVATED');
  return loadSessionSettings(env); // DEV-only, full bindings; independently gated.
}
export function createCatalogHandler(dependencies = {}) {
  return async request => {
    const requestId = randomUUID();
    try {
      if (new URL(request.url).origin !== ORIGIN) throw new ApiError(403, 'FORBIDDEN');
      const operation = new URL(request.url).pathname.split('/').at(-1), method = operation === 'save' ? 'POST' : 'GET';
      if (!['list', 'get', 'niches', 'save'].includes(operation)) throw new ApiError(404, 'NOT_FOUND');
      if (request.method !== method) { const response = json({ error: { code: 'METHOD_NOT_ALLOWED', requestId } }, 405); response.headers.set('allow', method); return response; }
      const settings = (dependencies.loadSettings || loadCatalogSettings)(), client = (dependencies.createClient || createWorkspaceClient)(settings.config);
      const sessions = createSessionService(settings, { client });
      if (method === 'POST') requireSameOriginMutation(request, ORIGIN);
      const principal = await sessions.authenticate(request);
      requirePermission(principal, operation === 'save' ? 'products.write' : 'products.read');
      // Resolve CSRF against the same authoritative cookie, never a caller role.
      if (method === 'POST') requireCsrfToken(request, (await sessions.current(request)).csrfToken);
      const actor = { sessionTokenHash: principal.sessionTokenHash };
      let payload;
      const query = new URL(request.url).searchParams;
      if (operation === 'get') { if ([...query.keys()].some(key => key !== 'id') || query.getAll('id').length !== 1 || !catalogUuid(query.get('id'))) throw new ApiError(400, 'INVALID_PRODUCT'); payload = { id: query.get('id') }; }
      if (operation === 'niches') { if (query.size) throw new ApiError(400, 'INVALID_PRODUCT'); payload = {}; }
      if (operation === 'list') {
        if ([...query.keys()].some(key => !['q', 'offset', 'niche', 'inactive'].includes(key) || query.getAll(key).length !== 1)) throw new ApiError(400, 'INVALID_PRODUCT');
        const offset = query.get('offset') || '0', search = (query.get('q') || '').trim(), nicheId = query.get('niche') || '';
        if (!/^\d{1,5}$/.test(offset) || Number(offset) > 5000 || search.length > 100 || nicheId && !catalogUuid(nicheId) || query.has('inactive') && !['true', 'false'].includes(query.get('inactive'))) throw new ApiError(400, 'INVALID_PRODUCT');
        payload = { search, offset: Number(offset), nicheId, includeInactive: query.get('inactive') === 'true' };
      }
      if (operation === 'save') {
        if (query.size) throw new ApiError(400, 'INVALID_PRODUCT');
        const reader = request.body?.getReader(); let size = 0, content = '';
        if (reader) { const decoder = new TextDecoder('utf-8', { fatal: true }); try {
          while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
            if (size > 40000) { await reader.cancel(); throw new ApiError(413, 'INVALID_PRODUCT'); } content += decoder.decode(value, { stream: true }); }
          content += decoder.decode();
        } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'INVALID_PRODUCT'); } }
        let input; try { input = JSON.parse(content); } catch { throw new ApiError(400, 'INVALID_PRODUCT'); }
        if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(['commandId', 'expectedVersion', 'id', 'record']) ||
            !catalogUuid(input.commandId) || !catalogUuid(input.id) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 1_000_000_000) throw new ApiError(400, 'INVALID_PRODUCT');
        payload = { commandId: input.commandId, id: input.id, expectedVersion: input.expectedVersion, record: normalizeProduct(input.record, input.id) };
      }
      return json({ data: await client.catalog(operation, actor, payload), requestId });
    } catch (error) { return safeFailure(error, requestId); }
  };
}
