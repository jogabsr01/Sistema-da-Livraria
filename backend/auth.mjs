import { ApiError } from './errors.mjs';
// Deliberately no demo PIN, caller header or localStorage authentication fallback.
// Phase C must supply and validate a real identity provider before this is activated.
export async function authenticate() { throw new ApiError(503, 'IDENTITY_NOT_IMPLEMENTED'); }
export function requireSchemaPermission(principal, now = Date.now()) {
  if (!principal || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal.id || '')) throw new ApiError(401, 'UNAUTHENTICATED');
  if (!['ADMIN', 'SUPER_ADMIN'].includes(principal.role)) throw new ApiError(403, 'FORBIDDEN');
  if (!['mfa', 'passkey'].includes(principal.assurance) || !Number.isSafeInteger(principal.authenticatedAt) || principal.authenticatedAt > now + 30_000 || now - principal.authenticatedAt > 300_000) throw new ApiError(401, 'REAUTHENTICATION_REQUIRED');
  return { id: principal.id, role: principal.role, assurance: principal.assurance, authenticatedAt: principal.authenticatedAt };
}
