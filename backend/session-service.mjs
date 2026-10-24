import { createHmac } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { createSessionTokens } from './credential-core.mjs';
import { requireSameOriginMutation, requireCsrfToken } from './authorization.mjs';

export const SESSION_COOKIE = '__Host-livraria_session';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_AGE_SECONDS = 8 * 60 * 60;
const denied = () => { throw new ApiError(401, 'UNAUTHENTICATED'); };
function validToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, 'base64url').toString('base64url') === value;
}
export function sessionCookie(rawToken, maxAgeSeconds = MAX_AGE_SECONDS) {
  if (!validToken(rawToken) || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > MAX_AGE_SECONDS) throw new ApiError(400, 'INVALID_SESSION_TOKEN');
  return `${SESSION_COOKIE}=${rawToken}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}
export function readSessionToken(request) {
  const header = request.headers.get('cookie');
  if (!header || header.length > 4096) denied();
  const matches = header.split(';').map(value => value.trim()).filter(value => value.split('=', 1)[0] === SESSION_COOKIE);
  if (matches.length !== 1) denied();
  const token = matches[0].slice(SESSION_COOKIE.length + 1);
  if (!validToken(token)) denied();
  return token;
}
export function validateSessionPrincipal(value, now = Date.now()) {
  if (!value || !uuid.test(value.id) || !uuid.test(value.sessionId) ||
      !['SUPER_ADMIN', 'ADMIN', 'ATENDENTE'].includes(value.role) || !['pin', 'mfa', 'passkey'].includes(value.assurance) ||
      !Number.isSafeInteger(value.authenticatedAt) || value.authenticatedAt > now ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt <= value.authenticatedAt ||
      value.expiresAt - value.authenticatedAt > MAX_AGE_SECONDS * 1000 ||
      !Number.isSafeInteger(value.authorizationVersion) || value.authorizationVersion < 1 ||
      (value.role !== 'ATENDENTE' && value.assurance === 'pin')) denied();
  return Object.freeze({ id: value.id, sessionId: value.sessionId, role: value.role, assurance: value.assurance,
    authenticatedAt: value.authenticatedAt, expiresAt: value.expiresAt, authorizationVersion: value.authorizationVersion });
}
export function createSessionService(settings, { client, now = () => Date.now() }) {
  const { config, tokenKey } = settings;
  // Constructor validates the private key/bindings, without issuing any session.
  const tokens = createSessionTokens({ environment: config.environment, installationId: config.installationId, tokenKey });
  const csrfKey = Buffer.from(tokenKey);
  const origin = config.environment === 'dev' ? 'https://dev--merry-chimera-49a1f3.netlify.app' : 'https://merry-chimera-49a1f3.netlify.app';
  if (config.environment !== 'dev') throw new ApiError(503, 'IDENTITY_NOT_ACTIVATED');
  function csrf(rawToken) {
    return createHmac('sha256', csrfKey).update(JSON.stringify(['csrf.v1', config.environment, config.installationId, rawToken])).digest('base64url');
  }
  function checkHost(request) { if (new URL(request.url).origin !== origin) denied(); }
  async function resolve(request) {
    checkHost(request);
    const rawToken = readSessionToken(request), tokenHash = tokens.hash(rawToken);
    const principal = validateSessionPrincipal(await client.readSession(tokenHash), now());
    return { principal, rawToken, tokenHash };
  }
  async function mutation(request) {
    requireSameOriginMutation(request, origin);
    const session = await resolve(request);
    requireCsrfToken(request, csrf(session.rawToken));
    return session;
  }
  return {
    async authenticate(request) {
      const { principal, tokenHash } = await resolve(request);
      return Object.freeze({ ...principal, sessionTokenHash: tokenHash });
    },
    async current(request) {
      const { principal, rawToken } = await resolve(request);
      return { user: { id: principal.id, role: principal.role, assurance: principal.assurance, expiresAt: principal.expiresAt }, csrfToken: csrf(rawToken) };
    },
    async logout(request) {
      requireSameOriginMutation(request,origin);checkHost(request);const rawToken=readSessionToken(request);requireCsrfToken(request,csrf(rawToken));
      await client.revokeSession(tokens.hash(rawToken));
      return { revoked: true };
    },
    async revokeOthers(request) {
      const { tokenHash } = await mutation(request);
      await client.revokeOtherSessions(tokenHash);
      return { revoked: true };
    },
  };
}
