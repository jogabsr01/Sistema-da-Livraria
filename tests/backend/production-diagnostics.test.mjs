import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { environment } from './fixtures.mjs';
import { loadConfig } from '../../backend/config.mjs';
import { loadFirestoreSettings } from '../../backend/firestore-config.mjs';
import { safeFailure } from '../../backend/errors.mjs';

const prod = () => environment({ APP_ENV: 'prod', CONTEXT: 'production', BRANCH: 'main', DEPLOY_PRIME_URL: 'https://merry-chimera-49a1f3.netlify.app' });
test('production diagnostics log fixed missing and invalid variable names, never values or HTTP details', async () => {
  const original = console.error, messages = []; console.error = message => messages.push(JSON.parse(message));
  try {
    let caught;
    try { loadConfig({ ...prod(), WORKSPACE_INSTALLATION_ID: '', WORKSPACE_HMAC_SECRET: 'private-invalid-value' }); } catch (error) { caught = error; }
    assert.equal(caught.code, 'CONFIGURATION_UNAVAILABLE');
    assert.deepEqual(messages.map(({variable, issue}) => ({variable, issue})), [
      { variable: 'WORKSPACE_INSTALLATION_ID', issue: 'MISSING' }, { variable: 'WORKSPACE_HMAC_SECRET', issue: 'INVALID' }]);
    const body = await safeFailure(caught, 'request-id').text();
    for (const text of [JSON.stringify(messages), body]) assert.ok(!text.includes('private-invalid-value'));
    assert.ok(!body.includes('WORKSPACE_HMAC_SECRET'));
    messages.length = 0;
    assert.throws(() => loadConfig(prod(), { version: 1, siteId: 'expected', context: 'production', branch: 'main', deploymentUrl: 'https://merry-chimera-49a1f3.netlify.app/' }), { code: 'CONFIGURATION_UNAVAILABLE' });
    assert.equal(messages[0].variable, 'SITE_ID'); assert.equal(messages[0].issue, 'MISSING');
    messages.length = 0;
    assert.throws(() => loadFirestoreSettings({ APP_ENV: 'prod', WORKSPACE_STORAGE_MODE: 'firestore' }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
    assert.deepEqual(messages.map(entry => entry.variable), ['WORKSPACE_FIRESTORE_PROJECT_ID', 'WORKSPACE_FIRESTORE_LOCATION', 'WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON', 'GOOGLE_APPLICATION_CREDENTIALS']);
    messages.length = 0; assert.throws(() => loadConfig(environment({ WORKSPACE_INSTALLATION_ID: '' })));
    assert.equal(messages.length, 0);
  } finally { console.error = original; }
});
test('Firestore production diagnostics respect project aliases and report conflicts without values', () => {
  const original = console.error, messages = [];
  console.error = message => messages.push(JSON.parse(message));
  try {
    const base = { APP_ENV: 'prod', WORKSPACE_STORAGE_MODE: 'firestore', GOOGLE_CLOUD_PROJECT: 'valid-project', WORKSPACE_FIRESTORE_LOCATION: 'us-central1' };
    assert.throws(() => loadFirestoreSettings(base), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
    assert.ok(!messages.some(entry => entry.variable === 'WORKSPACE_FIRESTORE_PROJECT_ID'));
    messages.length = 0;
    assert.throws(() => loadFirestoreSettings({ ...base, GCLOUD_PROJECT: 'different-project' }), { code: 'FIRESTORE_CONFIGURATION_UNAVAILABLE' });
    assert.deepEqual(messages.slice(0, 2).map(entry => entry.variable), ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']);
    assert.ok(!JSON.stringify(messages).includes('different-project'));
  } finally { console.error = original; }
});
test('Linux sharp packages are pinned and explicitly included in functions', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const netlify = await readFile(new URL('../../netlify.toml', import.meta.url), 'utf8');
  for (const [name, version] of [['@img/sharp-linux-x64','0.35.5'], ['@img/sharp-libvips-linux-x64','1.3.4']]) {
    assert.equal(pkg.optionalDependencies[name], version);
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
    assert.ok(netlify.includes(`node_modules/${name}/**`));
  }
  assert.match(netlify, /external_node_modules\s*=\s*\["sharp"\]/);
});