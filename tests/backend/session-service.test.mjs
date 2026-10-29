import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createGasEmulator } from './gas-emulator.mjs';
import { environment, properties } from './fixtures.mjs';
import { loadSessionSettings } from '../../backend/session-config.mjs';
import { createSessionTokens } from '../../backend/credential-core.mjs';
import { createWorkspaceClient } from '../../backend/workspace-client.mjs';
import { createSessionService, sessionCookie, readSessionToken, SESSION_COOKIE } from '../../backend/session-service.mjs';
import { createSessionHandler } from '../../backend/session-handler.mjs';
import sessionHandler from '../../netlify/functions/session.mjs';
import logoutHandler from '../../netlify/functions/session-logout.mjs';
import revokeOthersHandler from '../../netlify/functions/session-revoke-others.mjs';
import { requireSchemaPermission } from '../../backend/auth.mjs';

const origin = 'https://dev--merry-chimera-49a1f3.netlify.app';
function setup() {
  const gas = createGasEmulator({ ...properties, IDENTITY_SESSIONS_ENABLED: 'true' });
  const provision = gas.call('provisionDevelopment');
  const settings = loadSessionSettings(environment({ WORKSPACE_IDENTITY_SESSIONS_ENABLED: 'true',
    WORKSPACE_SESSION_TOKEN_KEY: randomBytes(32).toString('hex'),
    WORKSPACE_SPREADSHEET_ID: provision.spreadsheetId, WORKSPACE_DRIVE_ROOT_ID: provision.driveRootId }));
  const ss = gas.sheets.get(provision.spreadsheetId), userId = randomUUID();
  const tokens = createSessionTokens({ ...settings.config, tokenKey: settings.tokenKey });
  const first = tokens.issue(), second = tokens.issue();
  const created = new Date(Date.now() - 1000).toISOString(), expires = new Date(Date.now() + 3_600_000).toISOString();
  function row(name, fields) {
    const sheet = ss.getSheetByName(name);
    sheet.appendRow(sheet.rows[0].map(column => fields[column] ?? ''));
  }
  row('Usuarios', { ID_Usuario: userId, Nome: 'Operador fictício', Email: 'operator@example.invalid',
    Perfil: 'ATENDENTE', Status: 'ATIVO', Primeiro_Acesso_Concluido: true });
  row('Configuracoes', { Chave: 'identity.version.' + userId, Valor: 1 });
  for (const issued of [first, second]) row('Sessoes', { ID_Sessao: randomUUID(), ID_Usuario: userId,
    Criado_Em: created, Expira_Em: expires, Ultima_Atividade: created, Token_Hash: issued.tokenHash,
    Nivel_Autenticacao: 'pin', Versao_Autorizacao: 1 });
  const factory = config => createWorkspaceClient(config, { fetchImpl: async (_url, options) =>
    new Response(JSON.stringify(gas.post(JSON.parse(options.body))), { status: 200 }) });
  return { gas, settings, ss, first, second, userId, factory, row,
    service: createSessionService(settings, { client: factory(settings.config) }) };
}
function request(rawToken, { method = 'GET', path = '/api/v1/session', csrf, site = origin, extra = {} } = {}) {
  return new Request(origin + path, { method, headers: { cookie: `${SESSION_COOKIE}=${rawToken}`,
    ...(method !== 'GET' ? { origin: site, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-csrf-token': csrf || '' } : {}), ...extra } });
}

test('signed persistent session resolves authoritative role and never exports raw tokens, hashes or PII', async () => {
  const s = setup();
  const current = await s.service.current(request(s.first.rawToken, { extra: { authorization: 'Bearer 1357', 'x-role': 'SUPER_ADMIN' } }));
  assert.equal(current.user.id, s.userId); assert.equal(current.user.role, 'ATENDENTE'); assert.equal(current.csrfToken.length, 43);
  const serialized = JSON.stringify(current);
  for (const secret of [s.first.rawToken, s.first.tokenHash, 'operator@example.invalid', 'Operador fictício', 'sessionId', 'authorizationVersion']) assert.ok(!serialized.includes(secret));
  const principal = await s.service.authenticate(request(s.first.rawToken));
  assert.throws(() => requireSchemaPermission(principal), { code: 'FORBIDDEN' });
});

test('revocation persists between services and only other sessions are revoked by revokeOthers', async () => {
  const s = setup(), current = await s.service.current(request(s.first.rawToken));
  await s.service.revokeOthers(request(s.first.rawToken, { method: 'POST', csrf: current.csrfToken }));
  const another = createSessionService(s.settings, { client: s.factory(s.settings.config) });
  await assert.rejects(another.authenticate(request(s.second.rawToken)), { code: 'UNAUTHENTICATED' });
  assert.equal((await another.authenticate(request(s.first.rawToken))).id, s.userId);
  await another.logout(request(s.first.rawToken, { method: 'POST', csrf: current.csrfToken }));
  await assert.rejects(s.service.authenticate(request(s.first.rawToken)), { code: 'UNAUTHENTICATED' });
});

test('csrf is session-bound and cross-origin/form requests do not revoke a valid session', async () => {
  const s = setup(), a = await s.service.current(request(s.first.rawToken)), b = await s.service.current(request(s.second.rawToken));
  for (const options of [{ csrf: b.csrfToken }, { csrf: a.csrfToken, site: 'https://attacker.invalid' },
    { csrf: a.csrfToken, extra: { 'content-type': 'application/x-www-form-urlencoded' } }]) {
    await assert.rejects(s.service.logout(request(s.first.rawToken, { method: 'POST', ...options })), { code: 'CSRF_REJECTED' });
  }
  assert.equal((await s.service.authenticate(request(s.first.rawToken))).id, s.userId);
});

test('cookie format is host-only, secure, HttpOnly and rejects duplicates or PIN bearer fallback', async () => {
  const s = setup(), cookie = sessionCookie(s.first.rawToken);
  for (const flag of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax', 'Max-Age=28800']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  assert.throws(() => sessionCookie('1357'));
  for (const header of ['', `${SESSION_COOKIE}=1357`, `${SESSION_COOKIE}=${s.first.rawToken}; ${SESSION_COOKIE}=${s.second.rawToken}`, `${SESSION_COOKIE}=${'x'.repeat(5000)}`]) {
    assert.throws(() => readSessionToken(new Request(origin, { headers: { cookie: header, authorization: 'Bearer 1357' } })), { code: 'UNAUTHENTICATED' });
  }
  await assert.rejects(s.service.authenticate(new Request('https://attacker.invalid', { headers: { cookie: `${SESSION_COOKIE}=${s.first.rawToken}` } })), { code: 'UNAUTHENTICATED' });
});

test('configuration stays closed by default, refuses PROD and disallows bridge key reuse', async () => {
  const s = setup();
  assert.throws(() => loadSessionSettings(environment()), { code: 'IDENTITY_NOT_ACTIVATED' });
  assert.throws(() => loadSessionSettings(environment({ WORKSPACE_IDENTITY_SESSIONS_ENABLED: 'true', WORKSPACE_SESSION_TOKEN_KEY: properties.SIGNING_SECRET })), { code: 'IDENTITY_CONFIGURATION_UNAVAILABLE' });
  assert.throws(() => loadSessionSettings(environment({ WORKSPACE_IDENTITY_SESSIONS_ENABLED: 'true', WORKSPACE_SESSION_TOKEN_KEY: randomBytes(32).toString('hex'),
    APP_ENV: 'prod', CONTEXT: 'production', BRANCH: 'main', DEPLOY_PRIME_URL: 'https://merry-chimera-49a1f3.netlify.app' })), { code: 'IDENTITY_CONFIGURATION_UNAVAILABLE' });
  s.gas.props.IDENTITY_SESSIONS_ENABLED = 'false';
  await assert.rejects(s.service.authenticate(request(s.first.rawToken)), { code: 'WORKSPACE_IDENTITY_UNAVAILABLE' });
  for (const handler of [sessionHandler, logoutHandler, revokeOthersHandler]) {
    const response = await handler(request(s.first.rawToken, { method: handler === sessionHandler ? 'GET' : 'POST' }));
    assert.equal(response.status, 503);
  }
});

test('session API methods, logout cookie clearing and no-store responses are correct', async () => {
  const s = setup(), deps = { loadSessionSettings: () => s.settings, createWorkspaceClient: s.factory };
  const get = createSessionHandler('current', deps), logout = createSessionHandler('logout', deps);
  const current = await get(request(s.first.rawToken));
  assert.equal(current.status, 200); assert.equal(current.headers.get('cache-control'), 'no-store');
  const body = await current.json();
  const wrongMethod = await logout(request(s.first.rawToken));
  assert.equal(wrongMethod.status, 405); assert.equal(wrongMethod.headers.get('allow'), 'POST');
  const response = await logout(request(s.first.rawToken, { method: 'POST', csrf: body.data.csrfToken }));
  assert.equal(response.status, 200); assert.ok(response.headers.get('set-cookie').includes('Max-Age=0'));
  const denied = await get(request(s.first.rawToken));
  assert.equal(denied.status, 401); assert.equal(denied.headers.get('set-cookie'),null,'a stale read cannot erase a newer login cookie');
});

test('real local HTTP roundtrip Node service to signed GAS contract resolves session without exposing token upstream', async t => {
  const s = setup(); const bodies = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; bodies.push(raw);
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(s.gas.post(JSON.parse(raw))));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const client = createWorkspaceClient(s.settings.config, { fetchImpl: (_url, options) => fetch(`http://127.0.0.1:${server.address().port}/exec`, options) });
  const service = createSessionService(s.settings, { client });
  assert.equal((await service.authenticate(request(s.first.rawToken))).role, 'ATENDENTE');
  assert.equal(bodies.length, 1); assert.ok(!bodies[0].includes(s.first.rawToken));
  const decoded = Buffer.from(JSON.parse(bodies[0]).message, 'base64').toString('utf8');
  assert.ok(decoded.includes(s.first.tokenHash)); assert.ok(!decoded.includes(s.first.rawToken));
});
