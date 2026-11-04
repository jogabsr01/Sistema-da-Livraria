import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:https';
import { randomBytes, randomUUID } from 'node:crypto';
import { createLocalPreview } from '../../scripts/local-https-preview.mjs';

test('local HTTPS preview serves only permitted static files and refuses API and hostile host', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'local-https-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cert = join(dir, 'cert.pem'), key = join(dir, 'key.pem'), publicDir = join(dir, 'public');
  const { mkdir } = await import('node:fs/promises'); await mkdir(publicDir);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  await writeFile(join(publicDir, 'index.html'), 'synthetic');
  await writeFile(join(dir, 'secret.html'), 'secret'); await symlink(join(dir, 'secret.html'), join(publicDir, 'escape.html'));
  const server = await createLocalPreview({ certPath: cert, keyPath: key, directory: publicDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = (path, host = 'localhost:8443') => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, headers: { host }, ca: execFileSync('cat', [cert]), servername: 'localhost' }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    }); req.on('error', reject); req.end();
  });
  assert.deepEqual(await call('/'), { status: 200, body: 'synthetic' });
  assert.equal((await call('/api/v1/access/state')).status, 503);
  assert.equal((await call('/escape.html')).status, 404);
  assert.equal((await call('/', 'attacker.invalid')).status, 403);
});

test('laboratory routes real functions over HTTPS and rejects hostile hosts', async t => {
  const env = { WORKSPACE_LOCAL_LAB: 'YES', APP_ENV: 'dev', WORKSPACE_STORAGE_MODE: 'firestore', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', WORKSPACE_FIRESTORE_PROJECT_ID: 'demo-livraria', WORKSPACE_FIRESTORE_LOCATION: 'us-central1', WORKSPACE_BACKEND_ENABLED: 'true', WORKSPACE_IDENTITY_ACCESS_ENABLED: 'true', WORKSPACE_IDENTITY_SESSIONS_ENABLED: 'true', WORKSPACE_IDENTITY_GUARDS_ENABLED: 'true', WORKSPACE_IDENTITY_PASSKEYS_ENABLED: 'true', WORKSPACE_INSTALLATION_ID: randomUUID(), WORKSPACE_DRIVE_ROOT_ID: 'r'.repeat(30), WORKSPACE_HMAC_SECRET: randomBytes(32).toString('hex'), WORKSPACE_SESSION_TOKEN_KEY: randomBytes(32).toString('hex'), WORKSPACE_AUTH_GUARD_KEY: randomBytes(32).toString('hex'), WORKSPACE_PIN_PEPPER: randomBytes(32).toString('hex') };
  const old = {}; for (const [key, value] of Object.entries(env)) { old[key] = process.env[key]; process.env[key] = value; }
  t.after(() => { for (const key of Object.keys(env)) old[key] === undefined ? delete process.env[key] : process.env[key] = old[key]; });
  const dir = await mkdtemp(join(tmpdir(), 'lab-https-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const cert = join(dir, 'cert.pem'), key = join(dir, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  await writeFile(join(dir, 'index.html'), 'lab');
  const server = await createLocalPreview({ certPath: cert, keyPath: key, directory: dir, localLab: true, functionOverrides: {
    '/api/v1/health': async req => {
      if (req.method !== 'GET') return new Response('', { status: 405 });
      const headers = new Headers();
      headers.append('set-cookie', '__Host-livraria_access=synthetic; Path=/; Secure; HttpOnly; SameSite=Strict');
      headers.append('set-cookie', '__Host-livraria_session=synthetic; Path=/; Secure; HttpOnly; SameSite=Lax');
      return new Response('ok', { headers });
    },
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const call = (path, method = 'GET', host = 'localhost:8443', headers = {}, body = '') => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, method, headers: { host, ...headers }, ca: execFileSync('cat', [cert]), servername: 'localhost' }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }); req.on('error', reject); req.end(body);
  });
  const multiple = await call('/api/v1/health');
  assert.equal(multiple.status, 200); assert.equal(multiple.headers['set-cookie'].length, 2);
  assert.match(multiple.headers['set-cookie'][0], /^__Host-livraria_access=.*Secure; HttpOnly/);
  assert.match(multiple.headers['set-cookie'][1], /^__Host-livraria_session=.*Secure; HttpOnly/);
  assert.equal((await call('/api/v1/health', 'POST')).status, 405);
  assert.equal((await call('/api/v1/missing')).status, 404);
  assert.equal((await call('/api/v1/health', 'GET', '127.0.0.1:8443')).status, 403);
  const state = await call('/api/v1/access/state');
  assert.equal(state.status, 200, state.body);
  const cookie = state.headers['set-cookie'][0];
  assert.match(cookie, /Secure; HttpOnly/);
  const csrf = JSON.parse(state.body).data.csrfToken;
  const headers = { cookie: cookie.split(';')[0], origin: 'https://localhost:8443', 'content-type': 'application/json', 'x-csrf-token': csrf };
  assert.equal((await call('/api/v1/access/start', 'POST', 'localhost:8443', { ...headers, origin: 'https://attacker.invalid' }, '{}')).status, 403);
  assert.equal((await call('/api/v1/access/start', 'POST', 'localhost:8443', { ...headers, 'x-csrf-token': 'bad' }, '{}')).status, 403);
  assert.equal((await call('/api/v1/access/start', 'POST', 'localhost:8443', headers, '{')).status, 400);
  const unexpectedField = await call('/api/v1/access/start', 'POST', 'localhost:8443', headers, JSON.stringify({ email: 'test@example.invalid', unexpected: true }));
  assert.equal(unexpectedField.status, 400); assert.equal(JSON.parse(unexpectedField.body).error.code, 'INVALID_AUTH_REQUEST');
  assert.equal((await call('/api/v1/access/start', 'PUT', 'localhost:8443', headers, '{}')).status, 405);
  process.env.NETLIFY = 'true';
  assert.equal((await call('/api/v1/health')).status, 500);
  delete process.env.NETLIFY;
});