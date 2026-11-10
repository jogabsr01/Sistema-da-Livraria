import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, selectHandler } from '../../api/v1/[...slug].js';
import health from '../../netlify/functions/health.mjs';
import session from '../../netlify/functions/session.mjs';
import logout from '../../netlify/functions/session-logout.mjs';
import access from '../../netlify/functions/owner-access.mjs';
import customers from '../../netlify/functions/customers.mjs';
import catalog from '../../netlify/functions/catalog.mjs';
import { spawnSync } from 'node:child_process';

test('dispatcher resolves exact, parameterized and nested routes without exposing the outbox', () => {
  for (const [path, expected] of [
    ['/api/v1/health', health], ['/api/v1/session', session],
    ['/api/v1/session/logout', logout], ['/api/v1/access/state', access],
    ['/api/v1/customers/find', customers], ['/api/v1/catalog/list', catalog],
    ['/api/v1/customers/nested/example', customers], ['/api/v1/access/state/extra', null],
    ['/api/v1/firestore-outbox', null], ['/api/v1/unknown', null],
  ]) assert.equal(selectHandler(path), expected, path);
});

test('Vercel production accepts its exact origin but rejects a foreign origin', () => {
  const script = `
    const { dispatch } = await import('./api/v1/[...slug].js');
    for (const [origin, expected] of [['https://livrariaipjb.vercel.app', 503], ['https://attacker.example', 403]]) {
      const response = await dispatch(new Request(origin + '/api/v1/access/state', { headers: { origin } }));
      const body = await response.json();
      const code = origin === 'https://livrariaipjb.vercel.app' ? 'IDENTITY_NOT_ACTIVATED' : 'FORBIDDEN';
      if (response.status !== expected || body.error?.code !== code) throw new Error(origin + ': ' + response.status + ' ' + body.error?.code);
    }
    const { requireSameOriginMutation } = await import('./backend/authorization.mjs');
    const origin = 'https://livrariaipjb.vercel.app';
    const request = header => new Request(origin + '/api/v1/access/login', { method: 'POST', headers: { origin: header, 'content-type': 'application/json' }, body: '{}' });
    requireSameOriginMutation(request(origin), origin);
    try { requireSameOriginMutation(request('https://attacker.example'), origin); throw Error('foreign origin accepted'); }
    catch (error) { if (error.code !== 'CSRF_REJECTED') throw error; }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, APP_ENV: 'prod', VERCEL: '1', WORKSPACE_IDENTITY_ACCESS_ENABLED: 'false', WORKSPACE_LOCAL_LAB: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});

test('Vercel owner access passes both origin checks after settings load', () => {
  const script = `
    const { createOwnerAccessHandler } = await import('./backend/owner-access.mjs');
    let reachedClient = false;
    const handler = createOwnerAccessHandler({
      loadSettings: () => ({ config: { environment: 'prod' } }),
      createClient: () => { reachedClient = true; throw new Error('STOP_AFTER_ORIGIN_CHECK'); },
    });
    const url = 'https://livrariaipjb.vercel.app/api/v1/access/state';
    const response = await handler(new Request(url, { headers: { origin: 'https://livrariaipjb.vercel.app' } }));
    if (!reachedClient || response.status === 403) throw new Error('production origin rejected');
    reachedClient = false;
    const rejected = await handler(new Request('https://attacker.example/api/v1/access/state'));
    if (rejected.status !== 403 || reachedClient) throw new Error('foreign origin accepted');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, APP_ENV: 'prod', VERCEL: '1', WORKSPACE_LOCAL_LAB: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});

test('prepared production WebAuthn registration uses the hosting provider rpId', () => {
  const script = `
    const { preparedAccessOptions } = await import('./backend/passkey-service.mjs');
    const input = { subjectId: '11111111-1111-4111-8111-111111111111', authorizationVersion: 1,
      kind: 'create', credentials: [], challenge: 'A'.repeat(43) };
    const result = await preparedAccessOptions(input, 'prod');
    if (result.options.rp.id !== process.env.EXPECTED_RP_ID) throw Error('Unexpected rpId: ' + result.options.rp.id);
  `;
  for (const [vercel, expected] of [['1', 'livrariaipjb.vercel.app'], ['', 'merry-chimera-49a1f3.netlify.app']]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../../', import.meta.url),
      env: { ...process.env, APP_ENV: 'prod', VERCEL: vercel, WORKSPACE_LOCAL_LAB: '', EXPECTED_RP_ID: expected },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('health and unknown routes retain status and JSON responses', async () => {
  for (const [path, method, status, body] of [
    ['/api/v1/health', 'GET', 200, { ok: true }],
    ['/api/v1/health', 'POST', 405, { error: { code: 'METHOD_NOT_ALLOWED' } }],
    ['/api/v1/no-such-route', 'GET', 404, { error: { code: 'NOT_FOUND' } }],
  ]) {
    const response = await dispatch(new Request('https://livrariaipjb.vercel.app' + path, { method }));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
  }
});