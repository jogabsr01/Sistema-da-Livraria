import { randomUUID } from 'node:crypto';
import { ApiError, json, safeFailure } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { createSessionService } from './session-service.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { requirePermission, requireSameOriginMutation, requireCsrfToken } from './authorization.mjs';
import { normalizeCheckout } from './checkout-command.mjs';

const ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app';
export function loadCheckoutSettings(env = process.env) {
  if (env.WORKSPACE_CHECKOUT_ENABLED !== 'true' || env.WORKSPACE_CATALOG_ENABLED !== 'true') throw new ApiError(503, 'CHECKOUT_NOT_ACTIVATED');
  return loadSessionSettings(env);
}
export function createCheckoutHandler(dependencies = {}) {
  return async request => {
    const requestId = randomUUID();
    try {
      const url = new URL(request.url);
      if (url.origin !== ORIGIN) throw new ApiError(403, 'FORBIDDEN');
      if (url.pathname !== '/api/v1/checkout' || url.search) throw new ApiError(404, 'NOT_FOUND');
      if (request.method !== 'POST') { const response = json({ error: { code: 'METHOD_NOT_ALLOWED', requestId } }, 405); response.headers.set('allow', 'POST'); return response; }
      const settings = (dependencies.loadSettings || loadCheckoutSettings)();
      const client = (dependencies.createClient || createWorkspaceClient)(settings.config);
      const sessions = createSessionService(settings, { client });
      requireSameOriginMutation(request, ORIGIN);
      const principal = await sessions.authenticate(request);
      requirePermission(principal, 'sales.create');
      requireCsrfToken(request, (await sessions.current(request)).csrfToken);
      const reader = request.body?.getReader(); let content = '', size = 0;
      if (reader) {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        try {
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 16000) { await reader.cancel(); throw new ApiError(413, 'INVALID_SALE'); }
            content += decoder.decode(value, { stream: true });
          }
          content += decoder.decode();
        } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'INVALID_SALE'); }
      }
      let input; try { input = JSON.parse(content); } catch { throw new ApiError(400, 'INVALID_SALE'); }
      const command = normalizeCheckout(input);
      const data = await client.checkout({ sessionTokenHash: principal.sessionTokenHash }, command);
      return json({ data, requestId });
    } catch (error) { return safeFailure(error, requestId); }
  };
}
