import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { environment } from './fixtures.mjs';
import { loadOwnerAccessSettings, createOwnerAccessService } from '../../backend/owner-access.mjs';
import { loadSessionSettings } from '../../backend/session-config.mjs';
import { createSessionService } from '../../backend/session-service.mjs';
import { createPersonalDataVault } from '../../backend/personal-data.mjs';
import { loadLoginGuardSettings, createLoginGuard } from '../../backend/login-guard.mjs';
import { loadPasskeySettings, createPasskeyService } from '../../backend/passkey-service.mjs';

const keys = ['WORKSPACE_SESSION_TOKEN_KEY', 'WORKSPACE_AUTH_GUARD_KEY', 'WORKSPACE_PIN_PEPPER'];
function production() {
  return environment({ APP_ENV: 'prod', CONTEXT: 'production', BRANCH: 'main',
    DEPLOY_PRIME_URL: 'https://merry-chimera-49a1f3.netlify.app',
    WORKSPACE_IDENTITY_ACCESS_ENABLED: 'true', WORKSPACE_IDENTITY_SESSIONS_ENABLED: 'true',
    WORKSPACE_IDENTITY_GUARDS_ENABLED: 'true', WORKSPACE_IDENTITY_PASSKEYS_ENABLED: 'true',
    ...Object.fromEntries(keys.map(key => [key, randomBytes(32).toString('hex')])) });
}
test('production identity services instantiate with valid independent credentials', () => {
  const env = production(), client = {};
  assert.ok(createOwnerAccessService(loadOwnerAccessSettings(env), { client }));
  assert.ok(createSessionService(loadSessionSettings(env), { client }));
  assert.ok(createLoginGuard(loadLoginGuardSettings(env), { client }));
  assert.ok(createPasskeyService(loadPasskeySettings(env), { client }));
});
test('production session service accepts an uppercase installation UUID without changing its binding', () => {
  const env = production();
  env.WORKSPACE_INSTALLATION_ID = env.WORKSPACE_INSTALLATION_ID.toUpperCase();
  const settings = loadSessionSettings(env);
  assert.equal(settings.config.installationId, env.WORKSPACE_INSTALLATION_ID);
  assert.ok(createSessionService(settings, { client: {} }));
  assert.ok(createLoginGuard(loadLoginGuardSettings(env), { client: {} }));
  assert.ok(createOwnerAccessService(loadOwnerAccessSettings(env), { client: {} }));
  assert.ok(createPersonalDataVault({ config: settings.config, dataKey: randomBytes(32), indexKey: randomBytes(32) }));
});
test('production services fail closed and identify missing or invalid credentials', () => {
  for (const load of [loadOwnerAccessSettings, loadSessionSettings, loadLoginGuardSettings, loadPasskeySettings]) {
    for (const key of keys) for (const value of [undefined, '', 'invalid']) {
      const env = production(); if (value === undefined) delete env[key]; else env[key] = value;
      assert.throws(() => load(env), error => error.code === 'IDENTITY_CONFIGURATION_UNAVAILABLE' && error.variable === key && error.issue === (value ? 'INVALID_FORMAT' : 'MISSING'));
    }
    const env = production(); env[keys[1]] = env[keys[0]];
    assert.throws(() => load(env), { code: 'IDENTITY_CONFIGURATION_UNAVAILABLE', issue: 'REUSED' });
  }
});