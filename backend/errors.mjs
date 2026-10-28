export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const inputFields = new Set(['cpf','email','phone','name','postalCode','state','isbn','title','priceCents','minimumStock','year','pages','nicheIds','date','start','end','reason','quantity','newStock','paymentMethod']);
export function invalidInput(code, field) {
  const error=new ApiError(400,code);
  if(inputFields.has(field))error.field=field;
  throw error;
}
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', ...(status === 405 ? { allow: 'GET' } : {}),
  } });
}
export function safeFailure(error, requestId) {
  const known = error instanceof ApiError && Number.isInteger(error.status) && error.status>=400 && error.status<=599 && typeof error.code==='string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code);
  const field = known && error.status===400 && error.code.startsWith('INVALID_') && inputFields.has(error.field) ? error.field : undefined;
  return json({ error: { code: known ? error.code : 'INTERNAL', requestId, ...(field ? {field} : {}) } }, known ? error.status : 500);
}
