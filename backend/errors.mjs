export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', ...(status === 405 ? { allow: 'GET' } : {}),
  } });
}
export function safeFailure(error, requestId) {
  const known = error instanceof ApiError;
  return json({ error: { code: known ? error.code : 'INTERNAL', requestId } }, known ? error.status : 500);
}
