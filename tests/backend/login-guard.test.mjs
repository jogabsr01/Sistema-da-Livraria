import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createGasEmulator } from './gas-emulator.mjs';
import { environment, properties } from './fixtures.mjs';
import { createWorkspaceClient } from '../../backend/workspace-client.mjs';
import { createLoginGuard, loadLoginGuardSettings } from '../../backend/login-guard.mjs';

function setup() {
  const gas = createGasEmulator({ ...properties, IDENTITY_GUARDS_ENABLED: 'true' });
  const install = gas.call('provisionDevelopment'); gas.call('provisionDevelopmentAuthControls');
  const settings = loadLoginGuardSettings(environment({ WORKSPACE_IDENTITY_GUARDS_ENABLED: 'true', WORKSPACE_AUTH_GUARD_KEY: randomBytes(32).toString('hex'),
    WORKSPACE_SPREADSHEET_ID: install.spreadsheetId, WORKSPACE_DRIVE_ROOT_ID: install.driveRootId }));
  const factory = config => createWorkspaceClient(config, { fetchImpl: async (_url, options) => new Response(JSON.stringify(gas.post(JSON.parse(options.body)))) });
  const ss = gas.sheets.get(install.spreadsheetId), privateStore = gas.sheets.get(gas.props.IDENTITY_CONTROL_SPREADSHEET_ID), subjectId = randomUUID();
  function add(name, fields) { const sheet = ss.getSheetByName(name); sheet.appendRow(sheet.rows[0].map(col => fields[col] ?? '')); }
  add('Usuarios', { ID_Usuario: subjectId, Perfil: 'ATENDENTE', Status: 'ATIVO', Primeiro_Acesso_Concluido: false });
  add('Configuracoes', { Chave: 'identity.version.' + subjectId, Valor: 1 });
  return { gas, settings, ss, privateStore, subjectId, factory, guard: createLoginGuard(settings, { client: factory(settings.config) }) };
}
const attempt = { identifier: 'fictional@example.invalid', originAddress: '192.0.2.10' };
const challenge = s => ({ subjectId: s.subjectId, purpose: 'ACTIVATE', authorizationVersion: 1 });

test('attempt limits persist across Node instances and never store identifiers or IPs', async () => {
  const s = setup();
  for (let i = 0; i < 5; i++) assert.deepEqual(await s.guard.reserveAttempt(attempt), { allowed: true });
  const other = createLoginGuard(s.settings, { client: s.factory(s.settings.config) });
  await assert.rejects(other.reserveAttempt(attempt), { code: 'AUTH_RATE_LIMITED', status: 429, retryAfterSeconds: 60 });
  const content = JSON.stringify([...s.privateStore.tables.values()].map(table => table.rows));
  for (const secret of [attempt.identifier, attempt.originAddress, s.settings.guardKey.toString('hex')]) assert.ok(!content.includes(secret));
});

test('origins are independently limited, mapped IPv4 and IPv6 /64 share consistent buckets', async () => {
  const s = setup();
  for (let i = 0; i < 30; i++) await s.guard.reserveAttempt({ identifier: `unknown-${i}@example.invalid`, originAddress: '192.0.2.30' });
  await assert.rejects(s.guard.reserveAttempt({ identifier: 'another@example.invalid', originAddress: '::ffff:192.0.2.30' }), { code: 'AUTH_RATE_LIMITED' });
  const v6 = setup();
  for (let i = 0; i < 30; i++) await v6.guard.reserveAttempt({ identifier: `unknown-${i}@example.invalid`, originAddress: `2001:db8:1234:5678::${i + 1}` });
  await assert.rejects(v6.guard.reserveAttempt({ identifier: 'another@example.invalid', originAddress: '2001:db8:1234:5678:ffff::1' }), { code: 'AUTH_RATE_LIMITED' });
});

test('canonical account identifiers share limits while unrelated origins remain independent', async () => {
  const s = setup();
  for (let i = 0; i < 5; i++) await s.guard.reserveAttempt({ ...attempt, identifier: i % 2 ? ' FICTIONAL@EXAMPLE.INVALID ' : attempt.identifier });
  await assert.rejects(s.guard.reserveAttempt(attempt), { code: 'AUTH_RATE_LIMITED' });
  for (const value of [null, '', 'not-an-ip', '198.51.100.1, 192.0.2.1']) await assert.rejects(s.guard.reserveAttempt({ ...attempt, originAddress: value }), { code: 'INVALID_AUTH_REQUEST' });
});

test('challenge is high entropy, stores hash only, and permits exactly one successful consumption', async () => {
  const s = setup(), issued = await s.guard.createChallenge(challenge(s));
  assert.equal(issued.rawToken.length, 43);
  assert.ok(!JSON.stringify(s.privateStore.getSheetByName('_Auth_Challenges').rows).includes(issued.rawToken));
  const input = { ...challenge(s), ...issued };
  assert.deepEqual(await s.guard.consumeChallenge(input), { verified: true });
  const other = createLoginGuard(s.settings, { client: s.factory(s.settings.config) });
  assert.deepEqual(await other.consumeChallenge(input), { verified: false });
  assert.equal(s.ss.getSheetByName('Sessoes').getLastRow(), 1, 'consuming an email proof does not issue a session');
});

test('reissuing invalidates previous tokens; wrong token attempts revoke the challenge after five failures', async () => {
  const s = setup(), first = await s.guard.createChallenge(challenge(s)), second = await s.guard.createChallenge(challenge(s));
  assert.deepEqual(await s.guard.consumeChallenge({ ...challenge(s), ...first }), { verified: false });
  const bad = { ...challenge(s), ...second, rawToken: randomBytes(32).toString('base64url') };
  for (let i = 0; i < 5; i++) assert.deepEqual(await s.guard.consumeChallenge(bad), { verified: false });
  assert.deepEqual(await s.guard.consumeChallenge({ ...challenge(s), ...second }), { verified: false });
});

test('disabled user and authorization changes invalidate even the correct email token', async () => {
  for (const mutation of ['disable', 'epoch']) {
    const s = setup(), issued = await s.guard.createChallenge(challenge(s));
    const table = s.ss.getSheetByName(mutation === 'disable' ? 'Usuarios' : 'Configuracoes');
    table.rows[1][table.rows[0].indexOf(mutation === 'disable' ? 'Status' : 'Valor')] = mutation === 'disable' ? 'INATIVO' : 2;
    assert.deepEqual(await s.guard.consumeChallenge({ ...challenge(s), ...issued }), { verified: false });
  }
});

test('guard service and signed operation refuse activation by default and key reuse', async () => {
  assert.throws(() => loadLoginGuardSettings(environment()), { code: 'IDENTITY_NOT_ACTIVATED' });
  assert.throws(() => loadLoginGuardSettings(environment({ WORKSPACE_IDENTITY_GUARDS_ENABLED: 'true', WORKSPACE_AUTH_GUARD_KEY: properties.SIGNING_SECRET })), { code: 'IDENTITY_CONFIGURATION_UNAVAILABLE' });
  const s = setup(); s.gas.props.IDENTITY_GUARDS_ENABLED = 'false';
  await assert.rejects(s.guard.reserveAttempt(attempt), { code: 'WORKSPACE_IDENTITY_UNAVAILABLE' });
});

test('actual local HTTP carries signed hashes only and returns no account metadata', async t => {
  const s = setup(), requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk; requests.push(body);
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(s.gas.post(JSON.parse(body))));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const client = createWorkspaceClient(s.settings.config, { fetchImpl: (_url, options) => fetch(`http://127.0.0.1:${server.address().port}/exec`, options) });
  const guard = createLoginGuard(s.settings, { client });
  await guard.reserveAttempt(attempt); const issued = await guard.createChallenge(challenge(s));
  assert.deepEqual(await guard.consumeChallenge({ ...challenge(s), ...issued }), { verified: true });
  for (const body of requests) {
    const plain = Buffer.from(JSON.parse(body).message, 'base64').toString('utf8');
    for (const raw of [attempt.identifier, attempt.originAddress, issued.rawToken]) assert.ok(!plain.includes(raw));
  }
});
