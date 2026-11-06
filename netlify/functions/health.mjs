import { json } from '../../backend/errors.mjs';
export const config = { path: '/api/v1/health' };
export default async function handler(request) {
  if (request.method !== 'GET') return json({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405);
  return json({ ok: true }); // Liveness only, never a claim of Google readiness.
}
