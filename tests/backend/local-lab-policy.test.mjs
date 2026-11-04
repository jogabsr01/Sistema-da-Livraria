import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLocalLabPolicy, devOrigin, devRpId } from '../../backend/local-lab-policy.mjs';

const good = () => ({ WORKSPACE_LOCAL_LAB: 'YES', APP_ENV: 'dev', WORKSPACE_STORAGE_MODE: 'firestore',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', WORKSPACE_FIRESTORE_PROJECT_ID: 'demo-livraria' });

test('local laboratory policy returns a fixed immutable origin and RP ID', () => {
  const policy = loadLocalLabPolicy(good());
  assert.deepEqual(policy, { origin: 'https://localhost:8443', rpId: 'localhost', projectId: 'demo-livraria', emulatorHost: '127.0.0.1:8080' });
  assert.equal(Object.isFrozen(policy), true);
});

test('local laboratory policy rejects remote, deployed and credential-bearing configurations', () => {
  for (const change of [{ WORKSPACE_LOCAL_LAB: '' }, { APP_ENV: 'prod' }, { WORKSPACE_STORAGE_MODE: 'shadow' },
    { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8081' },
    { WORKSPACE_FIRESTORE_PROJECT_ID: 'production-project' }, { WORKSPACE_FIRESTORE_PROJECT_ID: 'demo-bad/' },
    { NETLIFY: 'true' }, { NETLIFY_LOCAL: 'true' }, { CONTEXT: 'production' }, { BRANCH: 'dev' }, { SITE_ID: 'x' }, { DEPLOY_URL: 'https://example.test' }, { URL: 'https://example.test' },
    { GOOGLE_APPLICATION_CREDENTIALS: '/private' }, { WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON: '{}' },
    { WORKSPACE_EMAIL_PROVIDER: 'resend' }, { WORKSPACE_EMAIL_PROVIDER_KEY: 'secret' }]) {
    assert.throws(() => loadLocalLabPolicy({ ...good(), ...change }), { message: 'LOCAL_LAB_DENIED' });
  }
  assert.throws(() => loadLocalLabPolicy({}), { message: 'LOCAL_LAB_DENIED' });
});

test('origin and RP selection fail closed and preserve the published default', () => {
  assert.equal(devOrigin({}), 'https://dev--merry-chimera-49a1f3.netlify.app');
  assert.equal(devRpId(good()), 'localhost');
  assert.equal(devOrigin(good()), 'https://localhost:8443');
  assert.throws(() => devOrigin({ ...good(), NETLIFY: 'true' }), { message: 'LOCAL_LAB_DENIED' });
  assert.throws(() => devRpId({ ...good(), APP_ENV: 'prod' }), { message: 'LOCAL_LAB_DENIED' });
});