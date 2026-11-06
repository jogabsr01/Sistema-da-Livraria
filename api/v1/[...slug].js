import audit from '../../netlify/functions/audit.mjs';
import catalog from '../../netlify/functions/catalog.mjs';
import checkout from '../../netlify/functions/checkout.mjs';
import customerInsights from '../../netlify/functions/customer-insights.mjs';
import customers from '../../netlify/functions/customers.mjs';
import emailChange from '../../netlify/functions/email-change.mjs';
import health from '../../netlify/functions/health.mjs';
import keys from '../../netlify/functions/keys.mjs';
import niches from '../../netlify/functions/niches.mjs';
import notifications from '../../netlify/functions/notifications.mjs';
import operations from '../../netlify/functions/operations.mjs';
import access from '../../netlify/functions/owner-access.mjs';
import profile from '../../netlify/functions/profile.mjs';
import reports from '../../netlify/functions/reports.mjs';
import schedules from '../../netlify/functions/schedules.mjs';
import schema from '../../netlify/functions/schema.mjs';
import logout from '../../netlify/functions/session-logout.mjs';
import revokeOthers from '../../netlify/functions/session-revoke-others.mjs';
import session from '../../netlify/functions/session.mjs';
import staff from '../../netlify/functions/staff.mjs';

const exact = new Map([
  ['/api/v1/health', health], ['/api/v1/schema', schema],
  ['/api/v1/checkout', checkout], ['/api/v1/session', session],
  ['/api/v1/session/logout', logout], ['/api/v1/session/revoke-others', revokeOthers],
]);
const single = new Map(Object.entries({ audit, catalog, 'customer-insights': customerInsights,
  keys, notifications, access, reports }));
const nested = new Map(Object.entries({ customers, 'email-change': emailChange, niches,
  operations, profile, schedules, staff }));

export function selectHandler(pathname) {
  if (exact.has(pathname)) return exact.get(pathname);
  const match = /^\/api\/v1\/([^/]+)\/(.+)$/.exec(pathname);
  if (!match) return null;
  if (single.has(match[1]) && !match[2].includes('/')) return single.get(match[1]);
  return nested.get(match[1]) || null;
}

export async function dispatch(request) {
  const handler = selectHandler(new URL(request.url).pathname);
  return handler ? handler(request) : Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
}

export default { fetch: dispatch };