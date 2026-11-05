import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError } from './errors.mjs';
const scrypt = promisify(scryptCallback);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const options = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const invalid = () => { throw new ApiError(503, 'CREDENTIAL_CONFIGURATION_UNAVAILABLE'); };
function binding(configuration, key) {
  if (!configuration || !Buffer.isBuffer(configuration[key]) || configuration[key].length !== 32 ||
      !['dev', 'prod'].includes(configuration.environment) || !uuid.test(configuration.installationId)) invalid();
  return JSON.stringify([configuration.environment, configuration.installationId]);
}
function subject(value) { if (typeof value !== 'string' || !uuid.test(value)) throw new ApiError(400, 'INVALID_SUBJECT'); }
const validPin = value => typeof value === 'string' && /^[0-9]{4}$/.test(value);

// This is a verifier primitive for imported credentials only. New enrollment and
// login use PASSWORD_V1; PIN_LEGACY remains readable solely during transition.
export function createPinHasher(configuration) {
  const scope = binding(configuration, 'pepper'), pepper = Buffer.from(configuration.pepper);
  async function derive(pin, subjectId, salt) {
    const input = createHmac('sha256', pepper).update(JSON.stringify(['pin.v1', scope, subjectId, pin])).digest();
    try { return await scrypt(input, salt, 32, options); } finally { input.fill(0); }
  }
  return {
    async hash(pin, subjectId) {
      subject(subjectId);
      if (!validPin(pin)) throw new ApiError(400, 'INVALID_PIN');
      if (/([0-9])\1/.test(pin)) throw new ApiError(400, 'PIN_ADJACENT_REPETITION');
      const salt = randomBytes(32);
      const hash = await derive(pin, subjectId, salt);
      return { version: 1, credentialType: 'PIN_LEGACY', algorithm: 'scrypt-N32768-r8-p1', salt: salt.toString('hex'), hash: hash.toString('hex') };
    },
    async verify(pin, subjectId, record) {
      subject(subjectId);
      if (!validPin(pin) || !record || record.version !== 1 || record.credentialType !== undefined && record.credentialType !== 'PIN_LEGACY' || record.algorithm !== 'scrypt-N32768-r8-p1' ||
          typeof record.salt !== 'string' || !/^[a-f0-9]{64}$/.test(record.salt) ||
          typeof record.hash !== 'string' || !/^[a-f0-9]{64}$/.test(record.hash)) return false;
      // Never accept KDF parameters from the record or HTTP caller.
      const actual = await derive(pin, subjectId, Buffer.from(record.salt, 'hex'));
      try { return timingSafeEqual(actual, Buffer.from(record.hash, 'hex')); } finally { actual.fill(0); }
    },
  };
}

// Store only tokenHash in Sessoes; rawToken is returned once to the future
// Secure/HttpOnly cookie issuer. This module does not issue authenticated cookies.
export function createSessionTokens(configuration) {
  const scope = binding(configuration, 'tokenKey'), key = Buffer.from(configuration.tokenKey);
  function hash(rawToken) {
    if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken) ||
        Buffer.from(rawToken, 'base64url').toString('base64url') !== rawToken) throw new ApiError(400, 'INVALID_SESSION_TOKEN');
    return createHmac('sha256', key).update(JSON.stringify(['session.v1', scope, rawToken])).digest('hex');
  }
  return { hash, issue() { const rawToken = randomBytes(32).toString('base64url'); return { rawToken, tokenHash: hash(rawToken) }; } };
}

const validPassword = value => typeof value === 'string' && Array.from(value).length >= 8 && Array.from(value).length <= 40;
export function createPasswordHasher(configuration) {
  const scope = binding(configuration, 'pepper'), pepper = Buffer.from(configuration.pepper);
  async function derive(password, subjectId, salt) {
    const input = createHmac('sha256', pepper).update(JSON.stringify(['password.v1', scope, subjectId, password])).digest();
    try { return await scrypt(input, salt, 32, options); } finally { input.fill(0); }
  }
  return {
    valid(value) { return validPassword(value); },
    async hash(password, subjectId) {
      subject(subjectId);
      if (!validPassword(password)) throw new ApiError(400, 'INVALID_PASSWORD');
      const salt = randomBytes(32), digest = await derive(password, subjectId, salt);
      return { version: 1, credentialType: 'PASSWORD_V1', algorithm: 'scrypt-N32768-r8-p1', salt: salt.toString('hex'), hash: digest.toString('hex') };
    },
    async verify(password, subjectId, record) {
      subject(subjectId);
      if (!validPassword(password) || !record || record.version !== 1 || record.credentialType !== 'PASSWORD_V1' || record.algorithm !== 'scrypt-N32768-r8-p1' ||
          typeof record.salt !== 'string' || !/^[a-f0-9]{64}$/.test(record.salt) || typeof record.hash !== 'string' || !/^[a-f0-9]{64}$/.test(record.hash)) return false;
      const actual = await derive(password, subjectId, Buffer.from(record.salt, 'hex'));
      try { return timingSafeEqual(actual, Buffer.from(record.hash, 'hex')); } finally { actual.fill(0); }
    },
  };
}
