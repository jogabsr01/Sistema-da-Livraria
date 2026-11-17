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
    console.error(JSON.stringify({event:'email_provider_result',provider:'resend',operation:'send',outcome:'NETWORK_UNCERTAIN'}));
    uncertain();
  }
  if (!response) uncertain();
  console.info(JSON.stringify({event:'email_provider_result',provider:'resend',operation:'send',httpStatus:response.status,outcome:response.ok?'ACCEPTED':response.status===401||response.status===403?'AUTH_OR_SENDER_REJECTED':response.status===429?'RATE_LIMITED':response.status>=500||response.status===408?'UNCERTAIN':'REJECTED'}));
  if (!response.ok) {
    // Only retain known provider error categories; the response message may
    // contain the destination, sender or other private data.
    let name; try { name = (await response.json())?.name; } catch {}
    const allowed = new Set(['validation_error','invalid_api_key','restricted_api_key','invalid_access','missing_api_key','rate_limit_exceeded','daily_quota_exceeded','monthly_quota_exceeded']);
    console.error(JSON.stringify({ event:'email_provider_rejection', provider:'resend', httpStatus:response.status, category:allowed.has(name)?name:'OTHER' }));
  }
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
