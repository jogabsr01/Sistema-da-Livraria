import { createHmac, timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from './errors.mjs';
export function signature(message, secret, direction) {
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(`${direction}.v1.${message}`).digest('hex');
}
export function pack(value, secret, direction) {
  const message = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  return { message, signature: signature(message, secret, direction) };
}
export function unpack(envelope, secret, direction) {
  if (!envelope || typeof envelope.message !== 'string' || envelope.message.length > 180_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.message) || typeof envelope.signature !== 'string' || !/^[a-f0-9]{64}$/i.test(envelope.signature)) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
  const expected = Buffer.from(signature(envelope.message, secret, direction), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(envelope.signature, 'hex'))) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
  try { return JSON.parse(Buffer.from(envelope.message, 'base64').toString('utf8')); }
  catch { throw new ApiError(502, 'UPSTREAM_UNTRUSTED'); }
}
export function requestMessage(config, actor, now = Date.now()) {
  return { version: 1, environment: config.environment, installationId: config.installationId,
    resources: { spreadsheetId: config.spreadsheetId, driveRootId: config.driveRootId },
    requestId: randomUUID(), issuedAt: now, nonce: randomBytes(32).toString('hex'),
    action: 'system.schema', actor, payload: {} };
}
export function verifyResponse(value, request, now = Date.now()) {
  if (!value || value.version !== 1 || value.environment !== request.environment || value.installationId !== request.installationId || value.requestId !== request.requestId || value.nonce !== request.nonce || !Number.isSafeInteger(value.sentAt) || Math.abs(now - value.sentAt) > 120_000 || typeof value.ok !== 'boolean') throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
  if (!value.ok) {
    const allowed = { REPLAY: 409, BUSY: 503, SCHEMA_REQUIRED: 503, FORBIDDEN: 403, BINDING_MISMATCH: 503, UNAUTHENTICATED: 401, IDENTITY_UNAVAILABLE: 503, CHALLENGE_REJECTED: 400, PASSKEY_REJECTED: 401, ACCESS_REJECTED: 401 };
    Object.assign(allowed, { CATALOG_UNAVAILABLE: 503, CATALOG_INVALID: 400, CATALOG_CONFLICT: 409, CATALOG_DUPLICATE: 409, CATALOG_NOT_FOUND: 404, CATALOG_STOCK_HISTORY: 409, COVER_PHOTOS_UNAVAILABLE:503,COVER_PHOTO_INVALID:400 });
    const code = value.error?.code;
    throw new ApiError(allowed[code] || 502, code === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : Object.hasOwn(allowed, code) ? `WORKSPACE_${code}` : 'UPSTREAM_UNAVAILABLE');
  }
  return value.data;
}
