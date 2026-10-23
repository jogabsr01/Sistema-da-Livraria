import { randomUUID } from 'node:crypto';
import { loadSessionSettings } from './session-config.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
import { createSessionService, clearSessionCookie } from './session-service.mjs';
import { json, safeFailure } from './errors.mjs';

// No login/issuance/bootstrap route: only existing, verified persistent sessions.
export function createSessionHandler(operation, dependencies = {}) {
  if (!['current', 'logout', 'revokeOthers'].includes(operation)) throw new Error('Unknown session operation');
  const readSettings = dependencies.loadSessionSettings || loadSessionSettings;
  const factory = dependencies.createWorkspaceClient || createWorkspaceClient;
  const requiredMethod = operation === 'current' ? 'GET' : 'POST';
  return async request => {
    const requestId = randomUUID();
    if (request.method !== requiredMethod) {
      const response = json({ error: { code: 'METHOD_NOT_ALLOWED', requestId } }, 405);
      response.headers.set('allow', requiredMethod);
      return response;
    }
    try {
      const settings = readSettings();
      const service = createSessionService(settings, { client: factory(settings.config) });
      const response = json({ data: await service[operation](request), requestId });
      if (operation === 'logout') response.headers.set('set-cookie', clearSessionCookie());
      return response;
    } catch (error) {
      const response = safeFailure(error, requestId);
      if (error?.code === 'UNAUTHENTICATED') response.headers.set('set-cookie', clearSessionCookie());
      return response;
    }
  };
}
