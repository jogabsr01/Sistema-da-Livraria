import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../backend/config.mjs';
import { authenticate, requireSchemaPermission } from '../../backend/auth.mjs';
import health from '../../netlify/functions/health.mjs';
import schemaHandler, { createSchemaHandler } from '../../netlify/functions/schema.mjs';
import { properties, actor, environment } from './fixtures.mjs';

test('configuration accepts only the pinned context/branch/hostname and full bindings', () => {
  assert.equal(loadConfig(environment()).environment, 'dev');
  assert.equal(loadConfig(environment({ APP_ENV: 'prod', CONTEXT: 'production', BRANCH: 'main', DEPLOY_PRIME_URL: 'https://merry-chimera-49a1f3.netlify.app' })).environment, 'prod');
  for (const change of [{ APP_ENV: 'unknown' }, { CONTEXT: 'deploy-preview' }, { BRANCH: 'main' }, { APP_ENV: 'prod' }, { DEPLOY_PRIME_URL: 'https://dev--merry-chimera-49a1f3.netlify.app.attacker.invalid' }, { WORKSPACE_HMAC_SECRET: '2468' }, { WORKSPACE_INSTALLATION_ID: '' }, { WORKSPACE_DRIVE_ROOT_ID: '' }, { WORKSPACE_SCRIPT_URL: 'https://attacker.invalid/exec' }, { WORKSPACE_SCRIPT_URL: 'https://script.google.com/macros/s/test/exec?secret=x' }]) assert.throws(() => loadConfig(environment(change)));
});
test('foundation administrative API is not activated by default', async () => {
  const response = await schemaHandler(new Request('https://example.invalid/api/v1/schema', { headers: { authorization: 'Bearer 2468', 'x-role': 'SUPER_ADMIN' } }));
  assert.equal(response.status, 503);
  const body = await response.text(); assert.ok(!body.includes('2468')); assert.ok(!body.includes('spreadsheet'));
});
test('demo PINs and caller role claims never authenticate a real identity', async () => {
  for (const pin of ['1357', '2468']) await assert.rejects(authenticate(new Request('https://example.invalid/', { headers: { authorization: `Bearer ${pin}`, 'x-role': 'SUPER_ADMIN' } })), { code: 'IDENTITY_NOT_IMPLEMENTED' });
});
test('server authorization requires admin plus recent MFA/passkey', () => {
  assert.equal(requireSchemaPermission(actor()).role, 'ADMIN');
  for (const principal of [null, { ...actor(), id: 'demo' }, { ...actor(), id: '-'.repeat(36) }, { ...actor(), role: 'ATENDENTE' }, { ...actor(), assurance: 'pin' }, { ...actor(), authenticatedAt: Date.now() - 301_000 }]) assert.throws(() => requireSchemaPermission(principal));
});
test('unauthenticated/attendant/weak-auth requests never reach adapter', async () => {
  let calls = 0;
  for (const principal of [null, { ...actor(), role: 'ATENDENTE' }, { ...actor(), assurance: 'pin' }]) {
    const handler = createSchemaHandler({ loadConfig: () => loadConfig(environment()), authenticate: async () => principal, createWorkspaceClient: () => ({ schema: async () => { calls++; } }) });
    const response = await handler(new Request('https://example.invalid/api/v1/schema'));
    assert.ok([401, 403].includes(response.status));
  }
  assert.equal(calls, 0);
});
test('methods and errors do not leak private configuration or exception messages', async () => {
  const handler = createSchemaHandler({ loadConfig: () => { throw Error('secret-value / personal@example.invalid'); } });
  assert.equal((await handler(new Request('https://example.invalid/', { method: 'POST' }))).status, 405);
  const response = await handler(new Request('https://example.invalid/'));
  assert.equal(response.status, 500); assert.ok(!(await response.text()).includes('secret-value'));
  const healthy = await health(new Request('https://example.invalid/api/v1/health'));
  assert.deepEqual(await healthy.json(), { ok: true });
});
