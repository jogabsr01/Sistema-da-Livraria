import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { loadConfig } from '../../backend/config.mjs';
import { environment } from './fixtures.mjs';

test('production password-only login is explicitly enabled only for Firestore, never for legacy PIN', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const base = environment({ APP_ENV: 'prod', CONTEXT: 'production', BRANCH: 'main', DEPLOY_PRIME_URL: 'https://merry-chimera-49a1f3.netlify.app',
    WORKSPACE_STORAGE_MODE: 'firestore', WORKSPACE_FIRESTORE_PROJECT_ID: 'livraria-ipb-dev', WORKSPACE_FIRESTORE_LOCATION: 'southamerica-east1',
    WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'livraria-ipb-dev', client_email: 'test@livraria-ipb-dev.iam.gserviceaccount.com', private_key: privateKey }) });
  for (const [flag, expected] of [[undefined, false], ['false', false], ['true', true]]) {
    const config = loadConfig({ ...base, WORKSPACE_ADMIN_PASSWORD_LOGIN_ENABLED: flag });
    assert.equal(config.adminPasswordLogin, expected);
    assert.equal(config.adminPinLogin, false);
  }
  assert.throws(() => loadConfig({ ...base, WORKSPACE_ADMIN_PASSWORD_LOGIN_ENABLED: 'invalid' }), { code: 'CONFIGURATION_UNAVAILABLE' });
  assert.equal(loadConfig({ ...base, WORKSPACE_STORAGE_MODE: 'gas', WORKSPACE_ADMIN_PASSWORD_LOGIN_ENABLED: 'true' }).adminPasswordLogin, false);
});