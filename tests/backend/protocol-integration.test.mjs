import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createGasEmulator } from './gas-emulator.mjs';
import { properties, actor, environment } from './fixtures.mjs';
import { loadConfig } from '../../backend/config.mjs';
import { pack, unpack, requestMessage, verifyResponse } from '../../backend/protocol.mjs';
import { createWorkspaceClient } from '../../backend/workspace-client.mjs';
import { createSchemaHandler } from '../../netlify/functions/schema.mjs';
function setup() {
  const gas = createGasEmulator(properties), result = gas.call('provisionDevelopment');
  const config = loadConfig(environment({ WORKSPACE_SPREADSHEET_ID: result.spreadsheetId, WORKSPACE_DRIVE_ROOT_ID: result.driveRootId }));
  return { gas, config };
}
function send(gas, config, request) { return gas.post(pack(request, config.secret, 'request')); }

test('real local HTTP: Function authorization -> signed adapter -> Apps Script contract -> signed response', async t => {
  const { gas, config } = setup();
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(gas.post(JSON.parse(raw))));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const client = createWorkspaceClient(config, { fetchImpl: (_url, options) => fetch(`http://127.0.0.1:${port}/exec`, options) });
  const handler = createSchemaHandler({ loadConfig: () => config, authenticate: async () => actor(), createWorkspaceClient: () => client });
  const response = await handler(new Request('https://example.invalid/api/v1/schema'));
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.data.schemaVersion, 1); assert.ok(body.data.tables.includes('Produtos'));
  assert.ok(!JSON.stringify(body).includes(config.secret)); assert.ok(!JSON.stringify(body).includes(config.spreadsheetId));
});
test('tampering, wrong key, expiration, future timestamps and cross-environment bindings are refused', () => {
  const { gas, config } = setup();
  for (const mutate of [r => { r.issuedAt -= 121_000; }, r => { r.issuedAt += 31_000; }, r => { r.environment = 'prod'; }, r => { r.installationId = 'other'; }, r => { r.resources.spreadsheetId = 'other'; }]) {
    const request = requestMessage(config, actor()); mutate(request);
    assert.equal(send(gas, config, request).error.code, 'UNAUTHORIZED');
  }
  const envelope = pack(requestMessage(config, actor()), 'cd'.repeat(32), 'request');
  assert.equal(gas.post(envelope).error.code, 'UNAUTHORIZED');
  const tampered = pack(requestMessage(config, actor()), config.secret, 'request'); tampered.message = tampered.message.slice(0, -4) + 'AAAA';
  assert.equal(gas.post(tampered).error.code, 'UNAUTHORIZED');
});
test('durable nonce prevents replay; old nonce rows are removed safely', () => {
  const { gas, config } = setup(), request = requestMessage(config, actor());
  const first = unpack(send(gas, config, request), config.secret, 'response');
  assert.equal(first.ok, true);
  const replay = unpack(send(gas, config, request), config.secret, 'response');
  assert.equal(replay.error.code, 'REPLAY');
  const rows = gas.sheets.get(config.spreadsheetId).getSheetByName('_Requisicoes');
  assert.ok(!JSON.stringify(rows.rows).includes(request.nonce), 'nonce is hashed');
  rows.rows[1][2] = new Date(Date.now() - 1000).toISOString();
  assert.equal(unpack(send(gas, config, requestMessage(config, actor())), config.secret, 'response').ok, true);
  assert.equal(rows.getLastRow(), 2);
});
test('Apps Script independently enforces authorization and does not expose bootstrap/business writes over HTTP', () => {
  const { gas, config } = setup();
  for (const change of [{ action: 'provisionDevelopment' }, { action: 'checkout' }, { actor: { ...actor(), role: 'ATENDENTE' } }, { actor: { ...actor(), assurance: 'pin' } }]) {
    const request = { ...requestMessage(config, actor()), ...change };
    const result = unpack(send(gas, config, request), config.secret, 'response');
    assert.equal(result.error.code, 'FORBIDDEN');
  }
});
test('response signatures, domain separation and correlation reject spoofed or reflected results', () => {
  const { gas, config } = setup(), request = requestMessage(config, actor());
  const envelope = send(gas, config, request), response = unpack(envelope, config.secret, 'response');
  assert.equal(verifyResponse(response, request).schemaVersion, 1);
  assert.throws(() => unpack(envelope, config.secret, 'request'));
  assert.throws(() => unpack(pack(response, 'cd'.repeat(32), 'response'), config.secret, 'response'));
  assert.throws(() => verifyResponse({ ...response, requestId: 'another' }, request));
});
test('adapter follows only a content-service GET and rejects 307 and untrusted redirects', async () => {
  const { gas, config } = setup(); let calls = [];
  const client = createWorkspaceClient(config, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://script.googleusercontent.com/macros/echo?temporary=opaque' } });
    const request = JSON.parse(calls[0].options.body);
    return new Response(JSON.stringify(gas.post(request)));
  } });
  assert.equal((await client.schema(actor())).schemaVersion, 1);
  assert.equal(calls[1].options.method, 'GET'); assert.equal(calls[1].options.body, undefined);
  for (const [status, location] of [[307, 'https://script.googleusercontent.com/'], [302, 'https://attacker.invalid/']]) {
    let requests = 0;
    const rejected = createWorkspaceClient(config, { fetchImpl: async () => { requests++; return new Response(null, { status, headers: { location } }); } });
    await assert.rejects(rejected.schema(actor())); assert.equal(requests, 1);
  }
});
test('timeouts and unexpected upstream content fail closed without leaking messages', async () => {
  const { config } = setup();
  const timeout = createWorkspaceClient(config, { timeoutMs: 5, fetchImpl: async (_, { signal }) => { await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } });
  // Keep a timer referenced: AbortSignal.timeout uses an unreferenced timer in Node.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timeout.schema(actor()), { code: 'UPSTREAM_TIMEOUT' }); } finally { clearTimeout(keepAlive); }
  const malformed = createWorkspaceClient(config, { fetchImpl: async () => new Response('not-json-and-private-data') });
  await assert.rejects(malformed.schema(actor()), { code: 'UPSTREAM_UNAVAILABLE' });
});
