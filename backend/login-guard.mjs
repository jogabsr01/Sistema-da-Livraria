import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { ApiError } from './errors.mjs';
import { loadConfig } from './config.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const purposes = new Set(['ACTIVATE', 'RECOVER', 'DEVICE']);
function invalid() { throw new ApiError(400, 'INVALID_AUTH_REQUEST'); }
export function loadLoginGuardSettings(env = process.env) {
  if (env.WORKSPACE_IDENTITY_GUARDS_ENABLED !== 'true') throw new ApiError(503, 'IDENTITY_NOT_ACTIVATED');
  const config = loadConfig(env), key = env.WORKSPACE_AUTH_GUARD_KEY;
  const otherKeys = [config.secret, env.WORKSPACE_SESSION_TOKEN_KEY, env.WORKSPACE_PIN_PEPPER];
  if (config.environment !== 'dev' || typeof key !== 'string' || !/^[a-f0-9]{64}$/i.test(key) ||
      otherKeys.some(other => typeof other === 'string' && other.toLowerCase() === key.toLowerCase())) throw new ApiError(503, 'IDENTITY_CONFIGURATION_UNAVAILABLE');
  return { config, guardKey: Buffer.from(key, 'hex') };
}
function account(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 254 || /[\x00-\x1f\x7f]/.test(value)) invalid();
  const normalized = value.trim().toLowerCase();
  const digits = normalized.replace(/[.\-\s]/g, '');
  return /^\d{11}$/.test(digits) ? `cpf:${digits}` : `email:${normalized}`;
}
function originAddress(value) {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) invalid();
  if (isIP(value) === 4) return value;
  const normalized = new URL(`https://[${value}]/`).hostname.slice(1, -1);
  const [left, right = ''] = normalized.split('::');
  const before = left ? left.split(':') : [], after = right ? right.split(':') : [];
  const words = normalized.includes('::') ? [...before, ...Array(8 - before.length - after.length).fill('0'), ...after] : before;
  const numbers = words.map(word => parseInt(word, 16));
  if (numbers.slice(0, 5).every(n => n === 0) && numbers[5] === 65535) return [numbers[6] >> 8, numbers[6] & 255, numbers[7] >> 8, numbers[7] & 255].join('.');
  return numbers.slice(0, 4).map(n => n.toString(16)).join(':') + '::/64';
}
function proof(value) {
  if (!value || typeof value.subjectId !== 'string' || !UUID.test(value.subjectId) ||
      typeof value.challengeId !== 'string' || !UUID.test(value.challengeId) || !purposes.has(value.purpose) ||
      !Number.isSafeInteger(value.authorizationVersion) || value.authorizationVersion < 1) invalid();
}
function canonicalToken(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value; }

// Server-only building blocks. No public login route, email sender or issuer.
// originAddress MUST come from the platform's trusted context.ip, not headers.
export function createLoginGuard(settings, { client }) {
  const { config, guardKey } = settings;
  if (config.environment !== 'dev' || !Buffer.isBuffer(guardKey) || guardKey.length !== 32 || !UUID.test(config.installationId)) throw new ApiError(503, 'IDENTITY_CONFIGURATION_UNAVAILABLE');
  const key = Buffer.from(guardKey), scope = [config.environment, config.installationId];
  const digest = (kind, ...values) => createHmac('sha256', key).update(JSON.stringify([kind, scope, ...values])).digest('hex');
  const tokenHash = value => digest('challenge.v1', value.challengeId, value.subjectId, value.purpose, value.authorizationVersion, value.rawToken);
  return {
    async reserveAttempt({ identifier, originAddress: address }) {
      const result = await client.reserveAuthAttempt({ accountKey: digest('account.v1', account(identifier)), originKey: digest('origin.v1', originAddress(address)) });
      if (!result.allowed) {
        const error = new ApiError(429, 'AUTH_RATE_LIMITED'); error.retryAfterSeconds = result.retryAfterSeconds; throw error;
      }
      return { allowed: true };
    },
    async createChallenge({ subjectId, purpose, authorizationVersion }) {
      const value = { subjectId, purpose, authorizationVersion, challengeId: randomUUID(), rawToken: randomBytes(32).toString('base64url') };
      proof(value);
      const result = await client.createAuthChallenge({ challengeId: value.challengeId, subjectId, purpose, authorizationVersion, tokenHash: tokenHash(value) });
      // Return ONLY to a future private delivery controller, never public JSON/logs.
      return { challengeId: result.challengeId, rawToken: value.rawToken, expiresAt: result.expiresAt };
    },
    async consumeChallenge(value) {
      proof(value);
      if (!canonicalToken(value.rawToken)) return { verified: false };
      return client.consumeAuthChallenge({ challengeId: value.challengeId, subjectId: value.subjectId, purpose: value.purpose,
        authorizationVersion: value.authorizationVersion, tokenHash: tokenHash(value) });
    },
  };
}
