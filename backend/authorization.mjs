import { timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles = new Set(['ATENDENTE', 'ADMIN', 'SUPER_ADMIN']);
const assurances = new Set(['pin', 'mfa', 'passkey']);
const strong = new Set(['mfa', 'passkey']);
const attendant = new Set([
  'sales.self.read', 'customers.read', 'customers.write', 'products.read', 'products.write', 'stock.receive', 'sales.create',
  'profile.self.read', 'profile.self.write', 'credentials.self.manage', 'schedule.self.read',
  'notifications.self.read', 'sessions.self.revoke',
]);
const admin = new Set([
  ...attendant, 'reports.read', 'audit.read', 'niches.write', 'schedule.write',
  'stock.adjust', 'sales.reverse', 'users.attendant.manage', 'products.delete', 'notifications.manage', 'schedule.all.read',
]);
const superAdmin = new Set([...admin, 'users.admin.manage', 'config.manage']);
const recent = new Set([
  'credentials.self.manage', 'schedule.write', 'niches.write', 'reports.read', 'audit.read', 'stock.adjust', 'sales.reverse', 'users.attendant.manage',
  'users.admin.manage', 'config.manage', 'profile.self.write',
]);
const selfOperations = new Set([
  'profile.self.read', 'profile.self.write', 'credentials.self.manage', 'schedule.self.read',
  'notifications.self.read', 'sessions.self.revoke',
]);
const permissions = { ATENDENTE: attendant, ADMIN: admin, SUPER_ADMIN: superAdmin };
function denied(status = 403, code = 'FORBIDDEN') { throw new ApiError(status, code); }
function isUuid(value) { return typeof value === 'string' && UUID.test(value); }

// Only call after the session was resolved from the authoritative server store.
// This policy never authenticates caller-provided role/user fields or creates users.
export function requirePermission(principal, operation, { targetUserId, targetRole, now = Date.now() } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || !principal ||
      !isUuid(principal.id) || !isUuid(principal.sessionId) ||
      !Number.isSafeInteger(principal.authenticatedAt) || principal.authenticatedAt < 0 ||
      principal.authenticatedAt > now + 30_000 ||
      !Number.isSafeInteger(principal.expiresAt) || principal.expiresAt <= now ||
      principal.expiresAt <= principal.authenticatedAt ||
      !Number.isSafeInteger(principal.authorizationVersion) || principal.authorizationVersion < 1) {
    denied(401, 'UNAUTHENTICATED');
  }
  if (!roles.has(principal.role) || !assurances.has(principal.assurance) ||
      typeof operation !== 'string' || !permissions[principal.role].has(operation)) denied();
  const businessPin=principal.assurance==='pin'&&principal.adminPinLogin===true;
  if (principal.role !== 'ATENDENTE' && !strong.has(principal.assurance)&&!businessPin) denied(401, 'REAUTHENTICATION_REQUIRED');
  if (recent.has(operation) && ((!strong.has(principal.assurance)&&!(businessPin&&operation!=='credentials.self.manage')) || now - principal.authenticatedAt > 300_000)) {
    denied(401, 'REAUTHENTICATION_REQUIRED');
  }
  if (selfOperations.has(operation) && targetUserId !== undefined &&
      (!isUuid(targetUserId) || targetUserId.toLowerCase() !== principal.id.toLowerCase())) denied();
  // Managing an attendant and managing an administrator are different capabilities.
  // Callers must resolve the current target role from trusted storage first.
  if (operation === 'users.attendant.manage' && targetRole !== 'ATENDENTE') denied();
  if (operation === 'users.admin.manage' && !['ADMIN', 'SUPER_ADMIN'].includes(targetRole)) denied();
  return principal;
}

function originSetting(expectedOrigin) {
  let url;
  try { url = new URL(expectedOrigin); } catch { denied(503, 'CONFIGURATION_UNAVAILABLE'); }
  if (typeof expectedOrigin !== 'string' || url.protocol !== 'https:' ||
      url.origin !== expectedOrigin || url.username || url.password || url.search || url.hash) {
    denied(503, 'CONFIGURATION_UNAVAILABLE');
  }
  return url.origin;
}

// Exact Origin, Fetch Metadata and JSON media type are defense in depth. Callers
// must also verify the session-bound CSRF token before executing a mutation.
export function requireSameOriginMutation(request, expectedOrigin) {
  const origin = originSetting(expectedOrigin);
  let requestUrl;
  try { requestUrl = new URL(request.url); } catch { denied(403, 'CSRF_REJECTED'); }
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) ||
      requestUrl.origin !== origin || request.headers.get('origin') !== origin) denied(403, 'CSRF_REJECTED');
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') denied(403, 'CSRF_REJECTED');
  const contentType = request.headers.get('content-type');
  if (typeof contentType !== 'string' ||
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)) denied(403, 'CSRF_REJECTED');
  return request;
}

function canonicalCsrfToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, 'base64url').toString('base64url') === value;
}
export function requireCsrfToken(request, expectedToken) {
  const received = request.headers.get('x-csrf-token');
  if (!canonicalCsrfToken(expectedToken) || !canonicalCsrfToken(received) ||
      !timingSafeEqual(Buffer.from(received, 'base64url'), Buffer.from(expectedToken, 'base64url'))) {
    denied(403, 'CSRF_REJECTED');
  }
  return request;
}
