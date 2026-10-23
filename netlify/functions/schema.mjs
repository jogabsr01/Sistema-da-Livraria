import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../backend/config.mjs';
import { authenticate, requireSchemaPermission } from '../../backend/auth.mjs';
import { createWorkspaceClient } from '../../backend/workspace-client.mjs';
import { json, safeFailure } from '../../backend/errors.mjs';
export const config = { path: '/api/v1/schema' };
export function createSchemaHandler(dependencies = {}) {
  const readConfig = dependencies.loadConfig || loadConfig;
  const identify = dependencies.authenticate || authenticate;
  const adapter = dependencies.createWorkspaceClient || createWorkspaceClient;
  return async request => {
    const requestId = randomUUID();
    if (request.method !== 'GET') return json({ error: { code: 'METHOD_NOT_ALLOWED', requestId } }, 405);
    try {
      const settings = readConfig();
      const actor = requireSchemaPermission(await identify(request));
      return json({ data: await adapter(settings).schema(actor), requestId });
    } catch (error) { return safeFailure(error, requestId); }
  };
}
export default createSchemaHandler();
