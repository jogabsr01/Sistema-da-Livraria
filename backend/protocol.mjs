import { createHmac, timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from './errors.mjs';
export function signature(message, secret, direction) {
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(`${direction}.v1.${message}`).digest('hex');
}
export function pack(value, secret, direction) {
  const message = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  return { message, signature: signature(message, secret, direction) };
}
export function unpack(envelope, secret, direction, maxMessageLength = 180_000) {
  if (!envelope || typeof envelope.message !== 'string' || envelope.message.length > maxMessageLength || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.message) || typeof envelope.signature !== 'string' || !/^[a-f0-9]{64}$/i.test(envelope.signature)) throw new ApiError(502, 'UPSTREAM_UNTRUSTED');
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
    Object.assign(allowed, { CHECKOUT_UNAVAILABLE: 503, INVALID_SALE: 400, IDEMPOTENCY_CONFLICT: 409, INSUFFICIENT_STOCK: 409, PRODUCT_UNAVAILABLE: 409, SALE_PRICE_CHANGED: 409, JOURNAL_CAPACITY: 503, JOURNAL_INVALID: 503, PROJECTION_CONFLICT: 503 });
    Object.assign(allowed, { INVALID_STOCK_RECEIPT: 400, STOCK_LIMIT: 409 });
    Object.assign(allowed, { NOTIFICATIONS_UNAVAILABLE: 503, INVALID_NOTIFICATION: 400, NOTIFICATION_NOT_FOUND: 404, NOTIFICATION_CONFLICT: 409, NOTIFICATION_CAPACITY: 503 });
    Object.assign(allowed,{STAFF_UNAVAILABLE:503,INVALID_STAFF:400,STAFF_CONFLICT:409,STAFF_DUPLICATE:409,STAFF_CAPACITY:503});
    Object.assign(allowed,{CUSTOMERS_UNAVAILABLE:503,INVALID_CUSTOMER:400,CUSTOMER_CONFLICT:409,CUSTOMER_DUPLICATE:409,CUSTOMER_CAPACITY:503,CUSTOMER_UNAVAILABLE:409});
    Object.assign(allowed,{OPERATIONS_UNAVAILABLE:503,INVALID_OPERATION:400,SALE_NOT_FOUND:404,OPERATION_CONFLICT:409,STOCK_NO_CHANGE:409});
    Object.assign(allowed,{EMAIL_CHANGE_UNAVAILABLE:503,EMAIL_CHANGE_REJECTED:400,EMAIL_CHANGE_CONFLICT:409,EMAIL_CHANGE_RATE_LIMITED:429,EMAIL_CHANGE_DELIVERY:503});
    Object.assign(allowed,{KEY_MANAGEMENT_RATE_LIMITED:429,KEY_MANAGEMENT_UNAVAILABLE:503,KEY_MANAGEMENT_REJECTED:401,KEY_MANAGEMENT_CONFLICT:409,KEY_MANAGEMENT_LAST_KEY:409,KEY_MANAGEMENT_CAPACITY:503});
    Object.assign(allowed,{CUSTOMER_NOT_FOUND:404,CUSTOMER_CONTACT_NOT_AUTHORIZED:403,REPORT_UNAVAILABLE:503,INVALID_REPORT:400,REPORT_CHANGED:409,REPORT_CONFLICT:409,REPORT_CAPACITY:413});
    Object.assign(allowed,{SECURITY_AUDIT_UNAVAILABLE:503});
    Object.assign(allowed,{AUDIT_UNAVAILABLE:503,INVALID_AUDIT:400,AUDIT_CHANGED:409,AUDIT_CONFLICT:409,AUDIT_CAPACITY:503,AUDIT_EXPORT_LIMIT:413});
    Object.assign(allowed,{SCHEDULE_UNAVAILABLE:503,INVALID_SCHEDULE:400,SCHEDULE_NOT_FOUND:404,SCHEDULE_CONFLICT:409,SCHEDULE_CAPACITY:503,SCHEDULE_EMPLOYEE_UNAVAILABLE:409,SCHEDULE_NO_CHANGE:409,SCHEDULE_OVERLAP:409});
    Object.assign(allowed,{NICHES_UNAVAILABLE:503,INVALID_NICHE:400,NICHE_CONFLICT:409,NICHE_DUPLICATE:409,NICHE_NOT_FOUND:404});
    Object.assign(allowed,{PROFILE_UNAVAILABLE:503,INVALID_PROFILE:400,PROFILE_CONFLICT:409,PROFILE_NOT_FOUND:404});
    const code = value.error?.code;
    throw new ApiError(allowed[code] || 502, code === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : Object.hasOwn(allowed, code) ? `WORKSPACE_${code}` : 'UPSTREAM_UNAVAILABLE');
  }
  return value.data;
}
