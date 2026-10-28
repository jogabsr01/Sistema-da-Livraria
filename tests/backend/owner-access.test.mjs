import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ownerFixture, injectAccessFault } from '../helpers/owner-access-fixture.mjs';
import { createGasEmulator } from './gas-emulator.mjs';
import { properties, environment } from './fixtures.mjs';
import { ACCESS_COOKIE, ACCESS_ORIGIN, accessCookie, createOwnerAccessHandler, loadOwnerAccessSettings } from '../../backend/owner-access.mjs';

const fakePin = '8274';
function code(s) { return s.gas.outbox.at(-1).body.match(/\n([A-Za-z0-9_-]{7}|[A-Za-z0-9_-]{43})\n/)[1]; }
function flowHash(s) { const sheet = s.priv.getSheetByName('_Identity_Flows'); return sheet.rows.at(-1)[sheet.rows[0].indexOf('Token_Hash')]; }
async function pending(s) {
  const service = s.service(), token = randomBytes(32).toString('base64url'), ip = '192.0.2.10';
  await service.execute('start', { email: properties.OWNER_EMAIL }, token, ip);
  await service.execute('email', { code: code(s) }, token, ip);
  await service.execute('pin', { pin: fakePin }, token, ip);
  s.storageProof(flowHash(s)); return { token, ip, service };
}
async function call(s, operation, { method = 'POST', body = {}, token, csrfToken, headers = {}, ip = '192.0.2.10', origin = ACCESS_ORIGIN } = {}) {
  const request = new Request(origin + '/api/v1/access/' + operation, { method,
    headers: { origin, 'content-type': 'application/json', ...(token ? { cookie: `${ACCESS_COOKIE}=${token}` } : {}), ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}), ...headers },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  const response = await s.handler(request, { ip }); return { response, data: await response.json() };
}

test('owner bootstrap is editor-only, resumable, private, creates one pending master without personal fields or a PIN', () => {
  const s = ownerFixture(), users = s.main.getSheetByName('Usuarios');
  assert.equal(s.gas.call('prepareDevelopmentOwnerAccess').prepared, true); assert.equal(users.getLastRow(), 2);
  for (const column of ['Nome', 'CPF', 'Email', 'CPF_Indice', 'Email_Indice', 'Whatsapp']) assert.equal(users.rows[1][users.rows[0].indexOf(column)], '');
  assert.equal(users.rows[1][users.rows[0].indexOf('Primeiro_Acesso_Concluido')], false);
  assert.equal(s.priv.getSheetByName('_Pin_Verifiers').getLastRow(), 1); assert.equal(s.main.getSheetByName('Sessoes').getLastRow(), 1);
  s.gas.owner = 'another@example.invalid'; assert.throws(() => s.gas.call('prepareDevelopmentOwnerAccess'), /FORBIDDEN/);
  s.gas.owner = properties.OWNER_EMAIL; s.gas.props.OWNER_EMAIL = 'changed@example.invalid'; assert.throws(() => s.gas.call('prepareDevelopmentOwnerAccess'), /FORBIDDEN|BINDING_MISMATCH/);
});

test('owner preparation refuses PROD, existing unrelated master, public store and resumes a partially written account intent', () => {
  for (const mode of ['prod', 'master', 'public', 'partial']) {
    const gas = createGasEmulator(properties), install = gas.call('provisionDevelopment'); gas.call('provisionDevelopmentAuthControls');
    const main = gas.sheets.get(install.spreadsheetId), users = main.getSheetByName('Usuarios');
    if (mode === 'prod') gas.props.APP_ENV = 'prod';
    if (mode === 'public') gas.resources.get(gas.props.IDENTITY_CONTROL_SPREADSHEET_ID).sharing = 'public';
    if (mode === 'master') { const fields = { ID_Usuario: '00000000-0000-4000-8000-000000000000', Perfil: 'SUPER_ADMIN' }; users.appendRow(users.rows[0].map(key => fields[key] ?? '')); }
    if (mode === 'partial') {
      const save = gas.context.accessSaveMain_; let once = true;
      gas.context.accessSaveMain_ = (table, row) => { if (table.sheet.name === 'Usuarios' && once) { once = false; throw Error('INJECTED'); } return save(table, row); };
      assert.throws(() => gas.call('prepareDevelopmentOwnerAccess'), /INJECTED/);
      assert.equal(gas.call('prepareDevelopmentOwnerAccess').prepared, true); assert.equal(users.getLastRow(), 2);
      assert.equal(main.getSheetByName('Configuracoes').getLastRow(), 2);
    } else { const before = gas.writes; assert.throws(() => gas.call('prepareDevelopmentOwnerAccess'), /FORBIDDEN|BINDING_MISMATCH/); assert.equal(gas.writes, before); }
  }
});

test('v2 control schema upgrades to v3 with a prior backup and preserves counters and passkeys', () => {
  const s = ownerFixture(), history = s.priv.getSheetByName('_Control_Migrations');
  history.rows[1][0] = 2; history.rows[1][1] = '64f663ff15c59f2185c10ebd685ae9fbd15c088aecb60b1975fd0486a217de6c';
  s.priv.tables.delete('_Identity_Flows'); s.priv.tables.delete('_Pin_Verifiers');
  s.priv.getSheetByName('_Auth_Limits').appendRow(['preserved']);
  const before = s.gas.backupCount;
  assert.equal(s.gas.call('provisionDevelopmentAuthControls').version, 3); assert.equal(s.gas.backupCount, before + 1);
  assert.equal(s.priv.getSheetByName('_Auth_Limits').rows[1][0], 'preserved'); assert.equal(s.gas.call('provisionDevelopmentAuthControls').changed, false);
});

test('activation delivers only to the private owner address; raw code, email and flow bearer are not stored or returned', async () => {
  const s = ownerFixture(), token = randomBytes(32).toString('base64url');
  const result = await s.service().execute('start', { email: properties.OWNER_EMAIL.toUpperCase() }, token, '192.0.2.1');
  assert.equal(result.stage, 'EMAIL'); assert.equal(s.gas.outbox.length, 1); assert.equal(s.gas.outbox[0].to, properties.OWNER_EMAIL);
  const rawCode = code(s), persisted = JSON.stringify([...s.priv.tables].map(([_, table]) => table.rows));
  for (const privateValue of [rawCode, token, properties.OWNER_EMAIL]) { assert.ok(!JSON.stringify(result).includes(privateValue)); assert.ok(!persisted.includes(privateValue)); }
  assert.equal(s.gas.outbox[0].body.includes('/acesso-dev.html'), true);
});

test('first access reports unknown email, recent delivery and mail failure without granting proof or session', async () => {
  const s=ownerFixture(), start=email=>s.service().execute('start',{email},randomBytes(32).toString('base64url'),'192.0.2.1');
  await assert.rejects(start('unknown@example.invalid'),{status:404,code:'ACCESS_EMAIL_NOT_REGISTERED'});
  assert.equal((await start(properties.OWNER_EMAIL)).stage,'EMAIL');
  await assert.rejects(start(properties.OWNER_EMAIL),{status:429,code:'AUTH_DELIVERY_RATE_LIMITED',retryAfterSeconds:60});
  assert.equal(s.gas.outbox.length,1);
  for(const mode of ['failure','quota']){
    const f=ownerFixture();if(mode==='failure')f.gas.mailFailure=true;else f.gas.mailQuota=0;
    const token=randomBytes(32).toString('base64url');
    await assert.rejects(f.service().execute('start',{email:properties.OWNER_EMAIL},token,'192.0.2.2'),{status:503,code:'ACCESS_EMAIL_DELIVERY_UNAVAILABLE'});
    assert.equal(f.gas.outbox.length,0);
    await assert.rejects(f.service().execute('email',{code:randomBytes(32).toString('base64url')},token,'192.0.2.2'),{code:'WORKSPACE_ACCESS_REJECTED'});
    assert.equal(f.main.getSheetByName('Sessoes').getLastRow(),1);
  }
});

test('email verification is one-use, cookie-bound, expires in ten minutes and never sets PIN/first access/session alone', async () => {
  for (const mode of ['success', 'wrong-cookie', 'expired', 'disabled', 'epoch']) {
    const s = ownerFixture(), token = randomBytes(32).toString('base64url'), service = s.service(), ip = '192.0.2.2';
    await service.execute('start', { email: properties.OWNER_EMAIL }, token, ip); const rawCode = code(s);
    if (mode === 'expired') { const table = s.priv.getSheetByName('_Identity_Flows'); table.rows[1][5] = new Date(Date.now() - 700000).toISOString(); table.rows[1][6] = new Date(Date.parse(table.rows[1][5]) + 600000).toISOString(); }
    if (mode === 'disabled') { const users = s.main.getSheetByName('Usuarios'); users.rows[1][users.rows[0].indexOf('Status')] = 'INATIVO'; }
    if (mode === 'epoch') s.main.getSheetByName('Configuracoes').rows[1][1] = 2;
    const action = () => service.execute('email', { code: rawCode }, mode === 'wrong-cookie' ? randomBytes(32).toString('base64url') : token, ip);
    if (mode === 'success') { assert.equal((await action()).stage, 'PIN'); await assert.rejects(action(), { code: 'WORKSPACE_ACCESS_REJECTED' }); }
    else await assert.rejects(action(), { code: 'WORKSPACE_ACCESS_REJECTED' });
    assert.equal(s.priv.getSheetByName('_Pin_Verifiers').getLastRow(), 1); assert.equal(s.main.getSheetByName('Sessoes').getLastRow(), 1);
  }
});

test('five wrong email codes revoke the proof and a PIN cannot be set before email confirmation', async () => {
  const s = ownerFixture(), token = randomBytes(32).toString('base64url'), service = s.service(), ip = '192.0.2.2';
  await service.execute('start', { email: properties.OWNER_EMAIL }, token, ip); const rawCode = code(s), hash = flowHash(s);
  await assert.rejects(service.execute('pin', { pin: fakePin }, token, ip), { code: 'WORKSPACE_ACCESS_REJECTED' });
  // Storage-side five-attempt limit, independent of Node instances/IP limits.
  for (let i = 0; i < 5; i++) assert.equal((await s.client.access('email', { tokenHash: hash, codeHash: 'ff'.repeat(32) })).verified, false);
  await assert.rejects(service.execute('email', { code: rawCode }, token, ip), { code: 'WORKSPACE_ACCESS_REJECTED' });
});

test('PIN is salted scrypt in the private store; only verified passkey commits activation and issues a secure cookie', async () => {
  const s = ownerFixture(), { token, service, ip } = await pending(s);
  const result = await service.execute('complete', { response: null }, token, ip);
  assert.match(result.cookie, /^__Host-livraria_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800$/);
  assert.deepEqual(result.user, { role: 'SUPER_ADMIN', assurance: 'passkey' });
  const table = s.priv.getSheetByName('_Pin_Verifiers'), record = JSON.parse(table.rows[1][1]);
  assert.equal(record.algorithm, 'scrypt-N32768-r8-p1'); assert.notEqual(record.salt, record.hash);
  assert.equal(s.main.getSheetByName('Sessoes').getLastRow(), 2);
  assert.throws(() => s.gas.call('prepareDevelopmentOwnerAccess'), /FORBIDDEN/, 'activation can never be reset by bootstrap');
  const cookie = result.cookie.split(';')[0];
  const current = await s.sessions.current(new Request(ACCESS_ORIGIN + '/api/v1/session', { headers: { cookie } }));
  assert.equal(current.status, 200);
  const data = (await current.json()).data; assert.equal(data.user.role, 'SUPER_ADMIN'); assert.equal(data.user.assurance, 'passkey');
});

test('partial commit before/after each projection never grants a partial session; a fresh Node instance retries exactly one session', async () => {
  for (const stage of ['intent', 'pin', 'user', 'session', 'audit', 'marker']) for (const after of [false, true]) {
    const s = ownerFixture(), { token, service, ip } = await pending(s); injectAccessFault(s, stage, after);
    await assert.rejects(service.execute('complete', { response: null }, token, ip), { code: 'UPSTREAM_UNAVAILABLE' });
    const sessions = s.main.getSheetByName('Sessoes'), flows = s.priv.getSheetByName('_Identity_Flows'), state = flows.rows[1][4];
    if (sessions.getLastRow() > 1 && state !== 'COMPLETE') await assert.rejects(s.client.readSession(sessions.rows[1][sessions.rows[0].indexOf('Token_Hash')]), { code: 'UNAUTHENTICATED' });
    // If the final marker was acknowledged then the grant is complete, not partial.
    const done = await s.service().execute('complete', { response: null }, token, ip);
    assert.equal(done.stage, 'COMPLETE', stage); assert.equal(sessions.getLastRow(), 2); assert.equal(s.priv.getSheetByName('_Pin_Verifiers').getLastRow(), 2);
    assert.equal(s.main.getSheetByName('Logs_Auditoria').getLastRow(), 2);
    assert.equal((await s.service().execute('complete', { response: null }, token, ip)).cookie, done.cookie);
  }
});

test('an expired browser cannot collect its old cookie; a durable activation intent recovers before a new PIN/passkey login', async () => {
  for (const elapsed of [601000, 28800001]) {
  const s = ownerFixture(), { token, service, ip } = await pending(s); injectAccessFault(s, 'user', true);
  await assert.rejects(service.execute('complete', { response: null }, token, ip));
  // Move both trusted clocks past the flow lifetime without altering its intent.
  const original = Date.now, future = Date.now() + elapsed;
  s.gas.context.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [future])); } static now() { return future; } };
  try {
    Date.now = () => future;
    await assert.rejects(s.service().execute('complete', { response: null }, token, '192.0.2.4'), { code: 'WORKSPACE_ACCESS_REJECTED' });
    const result = await s.service().execute('login', { email: properties.OWNER_EMAIL, pin: fakePin }, randomBytes(32).toString('base64url'), '192.0.2.4');
    assert.equal(result.stage, 'PASSKEY'); assert.equal(s.priv.getSheetByName('_Identity_Flows').rows[1][4], 'COMPLETE');
    assert.equal(s.main.getSheetByName('Sessoes').getLastRow(), 2);
  } finally { Date.now = original; }
  }
});

test('fresh verified email replaces abandoned pending keys without activating or resetting an account', async () => {
  const s = ownerFixture(), first = await pending(s), now = Date.now() + 61000;
  s.gas.context.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  const original = Date.now;
  try {
    Date.now = () => now;
    const token = randomBytes(32).toString('base64url'), service = s.service(), ip = '192.0.2.3';
    await service.execute('start', { email: properties.OWNER_EMAIL }, token, ip);
    await service.execute('email', { code: code(s) }, token, ip);
    const keys = s.priv.getSheetByName('_Passkeys'); assert.notEqual(keys.rows[1][keys.rows[0].indexOf('Revoked_At')], '');
    assert.equal((await service.state(token)).stage, 'PIN');
    await assert.rejects(first.service.execute('complete', { response: null }, first.token, ip), { code: 'WORKSPACE_ACCESS_REJECTED' });
    assert.equal(s.main.getSheetByName('Sessoes').getLastRow(), 1);
  } finally { Date.now = original; }
});

test('commit refuses a missing proof, wrong epoch, changed role, disabled account and revoked key', async () => {
  for (const mode of ['proof', 'epoch', 'role', 'disabled', 'key']) {
    const s = ownerFixture(), { token, service, ip } = await pending(s);
    if (mode === 'proof') { const table = s.priv.getSheetByName('_Passkey_Ceremonies'); table.rows[1][table.rows[0].indexOf('Completed_At')] = ''; }
    if (mode === 'epoch') s.main.getSheetByName('Configuracoes').rows[1][1] = 2;
    if (['role', 'disabled'].includes(mode)) { const table = s.main.getSheetByName('Usuarios'); table.rows[1][table.rows[0].indexOf(mode === 'role' ? 'Perfil' : 'Status')] = mode === 'role' ? 'ADMIN' : 'INATIVO'; }
    if (mode === 'key') { const table = s.priv.getSheetByName('_Passkeys'); table.rows[1][table.rows[0].indexOf('Revoked_At')] = new Date().toISOString(); }
    await assert.rejects(service.execute('complete', { response: null }, token, ip)); assert.equal(s.main.getSheetByName('Sessoes').getLastRow(), 1);
  }
});

test('activated account login requires its PIN, unknown accounts get the same rejection and PIN alone never issues a session', async () => {
  const s = ownerFixture(), prepared = await pending(s); await prepared.service.execute('complete', { response: null }, prepared.token, prepared.ip);
  for (const input of [{ email: properties.OWNER_EMAIL, pin: '0193' }, { email: 'unknown@example.invalid', pin: fakePin }]) await assert.rejects(s.service().execute('login', input, randomBytes(32).toString('base64url'), '192.0.2.3'), { code: 'ACCESS_REJECTED' });
  const token = randomBytes(32).toString('base64url'); assert.equal((await s.service().execute('login', { email: properties.OWNER_EMAIL, pin: fakePin }, token, '192.0.2.3')).stage, 'PASSKEY');
  assert.equal(s.main.getSheetByName('Sessoes').getLastRow(), 2); await assert.rejects(s.service().execute('complete', { response: null }, token, '192.0.2.3'), { code: 'ACCESS_REJECTED' });
});

test('public HTTP requires CSRF, exact DEV origin, trusted context IP, bounded JSON and forbids caller role/subject claims', async () => {
  const s = ownerFixture(), state = await call(s, 'state', { method: 'GET' }), token = state.response.headers.get('set-cookie').split('=')[1].split(';')[0], csrfToken = state.data.data.csrfToken;
  assert.match(state.response.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
  for (const extra of [ { csrfToken: undefined }, { headers: { origin: 'https://evil.invalid' } }, { headers: { 'content-type': 'text/plain' } }, { headers: { 'sec-fetch-site': 'cross-site' } } ]) {
    const result = await call(s, 'start', { token, csrfToken, body: { email: properties.OWNER_EMAIL }, ...extra }); assert.equal(result.response.status, 403);
  }
  const injected = await call(s, 'start', { token, csrfToken, body: { email: properties.OWNER_EMAIL, role: 'SUPER_ADMIN' } }); assert.equal(injected.response.status, 400);
  assert.equal((await call(s, 'start', { token, csrfToken, body: 'x'.repeat(20001) })).response.status, 413);
  // Forwarded headers cannot supply a missing trusted platform context.
  const request = new Request(ACCESS_ORIGIN + '/api/v1/access/start', { method: 'POST', headers: { origin: ACCESS_ORIGIN, cookie: `${ACCESS_COOKIE}=${token}`, 'content-type': 'application/json', 'x-csrf-token': csrfToken, 'x-forwarded-for': '192.0.2.1' }, body: JSON.stringify({ email: properties.OWNER_EMAIL }) });
  assert.equal((await s.handler(request, {})).status, 400);
  assert.equal((await call(s, 'state', { method: 'GET', origin: 'https://merry-chimera-49a1f3.netlify.app' })).response.status, 403);
});

test('default and partial flags, wrong context and reused keys keep real identity routes closed; start never returns code/PII', async () => {
  assert.throws(() => loadOwnerAccessSettings(environment()), { code: 'IDENTITY_NOT_ACTIVATED' });
  const s = ownerFixture();
  for (const flag of ['WORKSPACE_IDENTITY_ACCESS_ENABLED', 'WORKSPACE_IDENTITY_SESSIONS_ENABLED', 'WORKSPACE_IDENTITY_GUARDS_ENABLED', 'WORKSPACE_IDENTITY_PASSKEYS_ENABLED', 'WORKSPACE_BACKEND_ENABLED']) assert.throws(() => loadOwnerAccessSettings({ ...s.env, [flag]: 'false' }));
  for (const key of ['WORKSPACE_HMAC_SECRET', 'WORKSPACE_SESSION_TOKEN_KEY', 'WORKSPACE_AUTH_GUARD_KEY']) assert.throws(() => loadOwnerAccessSettings({ ...s.env, WORKSPACE_PIN_PEPPER: s.env[key] }), { code: 'IDENTITY_CONFIGURATION_UNAVAILABLE' });
  assert.throws(() => loadOwnerAccessSettings({ ...s.env, BRANCH: 'main' }));
  assert.throws(() => loadOwnerAccessSettings({ ...s.env, APP_ENV: 'prod', CONTEXT: 'production', BRANCH: 'main', DEPLOY_PRIME_URL: 'https://merry-chimera-49a1f3.netlify.app' }));
  const handler = createOwnerAccessHandler(); assert.equal((await handler(new Request(ACCESS_ORIGIN + '/api/v1/access/state'))).status, 503);
  const token = randomBytes(32).toString('base64url'), csrfToken = s.service().csrf(token);
  const result = await call(s, 'start', { token, csrfToken, body: { email: properties.OWNER_EMAIL } });
  assert.equal(result.response.status, 202); assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.ok(!JSON.stringify(result.data).includes(properties.OWNER_EMAIL)); assert.ok(!JSON.stringify(result.data).includes(code(s)));
  assert.throws(() => accessCookie('invalid'));
});

test('failed email codes consume a shared durable budget before verification; rate response includes retry time', async () => {
  const s = ownerFixture(), token = randomBytes(32).toString('base64url'), csrfToken = s.service().csrf(token);
  for (let i = 0; i < 5; i++) await call(s, 'email', { token, csrfToken, body: { code: randomBytes(32).toString('base64url') } });
  const blocked = await call(s, 'email', { token, csrfToken, body: { code: randomBytes(32).toString('base64url') } });
  assert.equal(blocked.response.status, 429); assert.equal(blocked.response.headers.get('retry-after'), '60');
});


test('PIN enrollment API rejects adjacent repeats without advancing or granting a session', async () => {
  const s = ownerFixture(), service = s.service(), token = randomBytes(32).toString('base64url'), ip = '192.0.2.10';
  await service.execute('start', {email: properties.OWNER_EMAIL}, token, ip);
  await service.execute('email', {code: code(s)}, token, ip);
  const result = await call(s, 'pin', {token, csrfToken: service.csrf(token), body: {pin:'1123'}});
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error.code, 'PIN_ADJACENT_REPETITION');
  assert.equal((await service.state(token)).stage, 'PIN');
  assert.equal(s.main.getSheetByName('Sessoes').getLastRow(), 1);
  const accepted = await call(s, 'pin', {token, csrfToken: service.csrf(token), body:{pin:fakePin}});
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.data.data.stage, 'PASSKEY');
});

test('expired pre-auth cookie is distinguished from credentials before any Google command or mail delivery',async()=>{
 const s=ownerFixture();let calls=0;
 const original=s.gas.post;s.gas.post=(...args)=>{calls++;return original(...args);};
 const response=await call(s,'start',{body:{email:properties.OWNER_EMAIL},csrfToken:'stale'});
 assert.equal(response.response.status,401);
 assert.equal(response.data.error.code,'ACCESS_CONTEXT_EXPIRED');
 assert.equal(calls,0);assert.equal(s.gas.outbox.length,0);
});

test('invalid or duplicate access cookies fail before commands while origin and CSRF remain mandatory',async()=>{
 const s=ownerFixture();let calls=0;
 const original=s.gas.post;s.gas.post=(...args)=>{calls++;return original(...args);};
 const t=randomBytes(32).toString('base64url'),csrf=s.service().csrf(t);
 for(const cookie of ['',ACCESS_COOKIE+'=invalid',ACCESS_COOKIE+'='+t+'; '+ACCESS_COOKIE+'='+t]){
  for(const operation of ['start','login','recover','email','pin','options','complete']){
   const r=await call(s,operation,{headers:{cookie},csrfToken:csrf});
   assert.equal(r.response.status,401);assert.equal(r.data.error.code,'ACCESS_CONTEXT_EXPIRED');
   assert.equal(r.response.headers.get('set-cookie'),null);
  }
 }
 assert.equal((await call(s,'start',{headers:{origin:'https://evil.invalid'}})).response.status,403);
 const mismatch=await call(s,'start',{token:t,csrfToken:'invalid'});
 assert.equal(mismatch.response.status,403);assert.equal(mismatch.data.error.code,'CSRF_REJECTED');
 assert.equal(calls,0);assert.equal(s.gas.outbox.length,0);
});
test('fresh context after a preflight rejection still requires its new CSRF and delivers exactly one code',async()=>{
 const s=ownerFixture();let calls=0;
 const original=s.gas.post;s.gas.post=(...args)=>{calls++;return original(...args);};
 assert.equal((await call(s,'start',{body:{email:properties.OWNER_EMAIL}})).data.error.code,'ACCESS_CONTEXT_EXPIRED');
 const state=await call(s,'state',{method:'GET'});
 assert.equal(calls,0);assert.equal(state.data.data.stage,'INITIAL');
 const cookie=state.response.headers.get('set-cookie'),token=cookie.split('=')[1].split(';')[0];
 assert.match(cookie,/Secure; HttpOnly; SameSite=Strict; Max-Age=600/);
 const r=await call(s,'start',{body:{email:properties.OWNER_EMAIL},token,csrfToken:state.data.data.csrfToken});
 assert.equal(r.response.status,202);assert.equal(calls,1);
 assert.equal(s.gas.outbox.length,1);assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
});
