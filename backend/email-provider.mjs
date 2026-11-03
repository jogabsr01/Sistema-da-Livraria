import { ApiError } from './errors.mjs';

function unavailable() { throw new ApiError(503, 'EMAIL_DELIVERY_UNAVAILABLE'); }
function uncertain() { throw new ApiError(503, 'EMAIL_DELIVERY_RESULT_UNKNOWN'); }
function quota() { throw new ApiError(503, 'EMAIL_DELIVERY_QUOTA'); }

function providerInput({ apiKey, from, to, subject, text, idempotencyKey } = {}) {
  if (typeof apiKey !== 'string' || !apiKey || typeof from !== 'string' || !from || typeof to !== 'string' || !to ||
      typeof subject !== 'string' || !subject || typeof text !== 'string' || !text ||
      typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 256) unavailable();
  return { apiKey, from, to, subject, text, idempotencyKey };
}

function headers(apiKey) {
  return { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
}

function jsonId(body) {
  if (typeof body?.id !== 'string' || !body.id) uncertain();
  return body.id;
}

export async function sendResendEmail({ apiKey, from, to, subject, text, idempotencyKey, fetchImpl = fetch } = {}) {
  const input = providerInput({ apiKey, from, to, subject, text, idempotencyKey });
  let response;
  try {
    response = await fetchImpl('https://api.resend.com/emails', { method: 'POST', redirect: 'manual',
      headers: { ...headers(input.apiKey), 'idempotency-key': input.idempotencyKey },
      body: JSON.stringify({ from: input.from, to: [input.to], subject: input.subject, text: input.text }), signal: AbortSignal.timeout(10000) });
  } catch {
    // A network failure does not prove that the provider rejected the request.
    uncertain();
  }
  if (!response) uncertain();
  if (response.status === 429) quota();
  if (response.status === 408 || response.status >= 500) uncertain();
  if (!response.ok) unavailable();
  let body;
  try { body = await response.json(); } catch { uncertain(); }
  return { id: jsonId(body) };
}

export async function lookupResendEmail({ apiKey, providerId, fetchImpl = fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey || typeof providerId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(providerId)) uncertain();
  let response;
  try {
    response = await fetchImpl(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`, {
      method: 'GET', redirect: 'manual', headers: headers(apiKey), signal: AbortSignal.timeout(10000),
    });
  } catch {
    uncertain();
  }
  if (!response) uncertain();
  if (response.status === 404) return { status: 'NOT_FOUND' };
  if (response.status === 429) quota();
  if (response.status === 408 || response.status >= 500) uncertain();
  if (!response.ok) unavailable();
  let body;
  try { body = await response.json(); } catch { uncertain(); }
  if (body?.id !== providerId) uncertain();
  return { status: 'FOUND', id: providerId, lastEvent: typeof body.last_event === 'string' ? body.last_event : null };
}
