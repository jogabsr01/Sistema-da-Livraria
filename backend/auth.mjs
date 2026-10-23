import { ApiError } from './errors.mjs';
import { loadSessionSettings } from './session-config.mjs';
import { createSessionService } from './session-service.mjs';
import { createWorkspaceClient } from './workspace-client.mjs';
// Cookie-only resolution of sessions issued by the future verified enrollment.
// No PIN/header/localStorage fallback and disabled independently by default.
export async function authenticate(request) {
  const settings = loadSessionSettings();
  return createSessionService(settings, { client: createWorkspaceClient(settings.config) }).authenticate(request);
}
export function requireSchemaPermission(principal, now = Date.now()) {
  if (!principal || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal.id || '')) throw new ApiError(401, 'UNAUTHENTICATED');
  if (!['ADMIN', 'SUPER_ADMIN'].includes(principal.role)) throw new ApiError(403, 'FORBIDDEN');
  if (!['mfa', 'passkey'].includes(principal.assurance) || !Number.isSafeInteger(principal.authenticatedAt) || principal.authenticatedAt > now + 30_000 || now - principal.authenticatedAt > 300_000) throw new ApiError(401, 'REAUTHENTICATION_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(principal.sessionTokenHash || '')) throw new ApiError(401, 'UNAUTHENTICATED');
  return { sessionTokenHash: principal.sessionTokenHash, id: principal.id, role: principal.role, assurance: principal.assurance, authenticatedAt: principal.authenticatedAt };
}
