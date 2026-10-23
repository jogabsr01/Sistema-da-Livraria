import test from 'node:test';
import assert from 'node:assert/strict';
import { createGasEmulator } from './gas-emulator.mjs';
import { properties, environment } from './fixtures.mjs';
import { loadConfig } from '../../backend/config.mjs';
import { pack, unpack, requestMessage, verifyResponse } from '../../backend/protocol.mjs';
import { createWorkspaceClient } from '../../backend/workspace-client.mjs';
import { checkDevelopmentConnection } from '../../backend/connection-check.mjs';
import { runCheck } from '../../scripts/check-google-dev.mjs';

function setup() {
  const gas = createGasEmulator(properties), result = gas.call('provisionDevelopment');
  const env = environment({ WORKSPACE_VERIFY_CONNECTION: 'true', WORKSPACE_BACKEND_ENABLED: 'false',
    WORKSPACE_SPREADSHEET_ID: result.spreadsheetId, WORKSPACE_DRIVE_ROOT_ID: result.driveRootId });
  const config = loadConfig({ ...env, WORKSPACE_BACKEND_ENABLED: 'true' });
  const factory = settings => createWorkspaceClient(settings, { fetchImpl: async (_url, options) => {
    return new Response(JSON.stringify(gas.post(JSON.parse(options.body))), { status: 200 });
  } });
  return { gas, env, config, factory };
}

test('explicit DEV handshake verifies signed GAS response without activating routes or business writes', async () => {
  const { gas, env, factory } = setup();
  const before = gas.sheets.get(env.WORKSPACE_SPREADSHEET_ID).getSheetByName('Produtos').rows.length;
  assert.deepEqual(await checkDevelopmentConnection(env, { createWorkspaceClient: factory }), { checked: true, environment: 'dev', schemaVersion: 1 });
  assert.equal(env.WORKSPACE_BACKEND_ENABLED, 'false');
  assert.throws(() => loadConfig(env), { code: 'SERVICE_NOT_ACTIVATED' });
  const ss = gas.sheets.get(env.WORKSPACE_SPREADSHEET_ID);
  assert.equal(ss.getSheetByName('Produtos').rows.length, before);
  assert.equal(ss.getSheetByName('Vendas').rows.length, 1);
  assert.equal(ss.getSheetByName('_Requisicoes').getLastRow(), 2, 'only replay-protection nonce is recorded');
});

test('handshake is opt-in and refuses production, previews, other branches and activated backend before IO', async () => {
  const { env } = setup(); let calls = 0;
  const dependencies = { createWorkspaceClient: () => { calls++; throw Error('unexpected IO'); } };
  assert.deepEqual(await checkDevelopmentConnection({ ...env, WORKSPACE_VERIFY_CONNECTION: 'false' }, dependencies), { checked: false });
  for (const change of [{ APP_ENV: 'prod' }, { BRANCH: 'main' }, { BRANCH: 'feature/example' }, { CONTEXT: 'deploy-preview' },
    { WORKSPACE_BACKEND_ENABLED: 'true' }, { DEPLOY_PRIME_URL: 'https://merry-chimera-49a1f3.netlify.app' }, { WORKSPACE_HMAC_SECRET: '' }]) {
    await assert.rejects(checkDevelopmentConnection({ ...env, ...change }, dependencies));
  }
  assert.equal(calls, 0);
});

test('GAS readiness requires signature, nonce and bindings, never grants a user identity', () => {
  const { gas, config } = setup();
  const message = requestMessage(config, null); message.action = 'system.ping';
  const envelope = pack(message, config.secret, 'request');
  const data = verifyResponse(unpack(gas.post(envelope), config.secret, 'response'), message);
  assert.deepEqual(data, { ready: true, environment: 'dev', schemaVersion: 1 });
  assert.equal(unpack(gas.post(envelope), config.secret, 'response').error.code, 'REPLAY');
  const schema = requestMessage(config, null);
  assert.equal(unpack(gas.post(pack(schema, config.secret, 'request')), config.secret, 'response').error.code, 'FORBIDDEN');
  assert.equal(gas.post(pack({ ...message, nonce: 'a'.repeat(64) }, '00'.repeat(32), 'request')).error.code, 'UNAUTHORIZED');
});

test('handshake fails on wrong key, missing schema and mismatched bindings', async () => {
  for (const kind of ['key', 'schema', 'binding']) {
    const s = setup();
    if (kind === 'key') s.env.WORKSPACE_HMAC_SECRET = 'ab'.repeat(32);
    if (kind === 'schema') s.gas.sheets.get(s.env.WORKSPACE_SPREADSHEET_ID).tables.delete('Vendas');
    if (kind === 'binding') s.env.WORKSPACE_DRIVE_ROOT_ID = 'incorrect-binding'.padEnd(30, 'x');
    await assert.rejects(checkDevelopmentConnection(s.env, { createWorkspaceClient: s.factory }));
  }
});

test('diagnostic build output contains only fixed result codes, never private exception values', async () => {
  const messages = [];
  assert.equal(await runCheck({}, { check: async () => { throw Error('private key or personal information'); }, log: text => messages.push(text) }), 1);
  assert.deepEqual(messages, ['GOOGLE_DEV_CONNECTION_FAILED DEV_CHECK_FAILED; operational backend remains disabled.']);
  assert.equal(await runCheck({}, { check: async () => ({ checked: false }), log: () => assert.fail('must be silent') }), 0);
});
