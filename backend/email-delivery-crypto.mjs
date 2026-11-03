import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ApiError } from './errors.mjs';

function unavailable() { throw new ApiError(503, 'EMAIL_DELIVERY_UNAVAILABLE'); }
function key(settings) {
  const value = settings?.emailDeliveryKey;
  if (!Buffer.isBuffer(value) || value.length !== 32) unavailable();
  return value;
}
function aad(settings, kind, id) {
  if (typeof kind !== 'string' || typeof id !== 'string' || !kind || !id) unavailable();
  return Buffer.from(JSON.stringify(['email.delivery.v1', settings.mode || 'firestore', kind, id]));
}
export function sealEmailDelivery(settings, kind, id, value) {
  if (typeof value !== 'string' || !value) unavailable();
  return sealWithCipher(settings, kind, id, value);
}
function sealWithCipher(settings, kind, id, value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(settings), iv);
  cipher.setAAD(aad(settings, kind, id));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['ed1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}
export function openEmailDelivery(settings, kind, id, value) {
  try {
    if (typeof value !== 'string' || !/^ed1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(value)) unavailable();
    const [, iv, tag, body] = value.split('.'), decipher = createDecipheriv('aes-256-gcm', key(settings), Buffer.from(iv, 'base64url'));
    decipher.setAAD(aad(settings, kind, id)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch { unavailable(); }
}
