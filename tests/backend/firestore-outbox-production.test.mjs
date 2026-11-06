import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { environment } from './fixtures.mjs';
import { loadConfig } from '../../backend/config.mjs';
import { runOutbox } from '../../netlify/functions/firestore-outbox.mjs';
import { originBootstrap } from '../../scripts/build-public.mjs';
import { sessionTransportContext, SESSION_COOKIE } from '../../backend/session-service.mjs';
import { loadSessionSettings } from '../../backend/session-config.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
function production() {
  return environment({ APP_ENV: 'prod', CONTEXT: 'production', BRANCH: 'main', DEPLOY_PRIME_URL: 'https://merry-chimera-49a1f3.netlify.app',
    WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-prod', WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1',
    WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'livraria-prod', client_email: 'worker@livraria-prod.iam.gserviceaccount.com', private_key: privateKey }) });
}
test('production scheduled outbox processes using validated remote Firestore settings', async () => {
  const env = production(), db = {}, result = { processed: true };
  assert.equal(await runOutbox({ load: () => loadConfig(env), createDb: config => { assert.equal(config.firestore.projectId, 'livraria-prod'); return db; },
    process: async input => { assert.equal(input.db, db); assert.equal(input.config.environment, 'prod'); return result; } }), result);
});
test('production outbox refuses missing, malformed and emulator credentials before processing', async () => {
  for (const changes of [{ WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: '' }, { WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: '{}' },
    { WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'livraria-prod', client_email: 'worker@livraria-prod.iam.gserviceaccount.com', private_key: 'invalid' }) },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }]) {
    await assert.rejects(runOutbox({ load: () => loadConfig({ ...production(), ...changes }), createDb: () => assert.fail('database must not open') }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
  }
});
test('public origin policy accepts only the configured same-origin deployments', () => {
  const context = {}; runInNewContext(originBootstrap, context);
  const policy = context.LivrariaOrigin;
  assert.equal(policy.current(policy.production), policy.production);
  assert.equal(policy.current(policy.development), policy.development);
  assert.equal(policy.current('https://attacker.invalid'), null);
  assert.equal(policy.current('https://merry-chimera-49a1f3.netlify.app.attacker.invalid'), null);
});
test('production session bootstrap binds transport to the production origin', () => {
  const env = { ...production(), WORKSPACE_IDENTITY_SESSIONS_ENABLED: 'true', WORKSPACE_SESSION_TOKEN_KEY: '11'.repeat(32), WORKSPACE_AUTH_GUARD_KEY: '22'.repeat(32), WORKSPACE_PIN_PEPPER: '33'.repeat(32) };
  const settings = loadSessionSettings(env), headers = { cookie: `${SESSION_COOKIE}=${Buffer.alloc(32, 7).toString('base64url')}` };
  assert.equal(sessionTransportContext(new Request('https://merry-chimera-49a1f3.netlify.app/api/v1/profile/bootstrap', { headers }), settings).csrfToken.length, 43);
  assert.throws(() => sessionTransportContext(new Request('https://attacker.invalid/api/v1/profile/bootstrap', { headers }), settings), { code: 'UNAUTHENTICATED' });
});