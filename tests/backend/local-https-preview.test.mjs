import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:https';
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
  const env = { WORKSPACE_LOCAL_LAB: 'YES', APP_ENV: 'dev', WORKSPACE_STORAGE_MODE: 'firestore', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', WORKSPACE_FIRESTORE_PROJECT_ID: 'demo-livraria' };
  const old = {}; for (const [key, value] of Object.entries(env)) { old[key] = process.env[key]; process.env[key] = value; }
  t.after(() => { for (const key of Object.keys(env)) old[key] === undefined ? delete process.env[key] : process.env[key] = old[key]; });
  const dir = await mkdtemp(join(tmpdir(), 'lab-https-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const cert = join(dir, 'cert.pem'), key = join(dir, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  await writeFile(join(dir, 'index.html'), 'lab');
  const server = await createLocalPreview({ certPath: cert, keyPath: key, directory: dir, localLab: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const call = (path, method = 'GET', host = 'localhost:8443') => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, method, headers: { host }, ca: execFileSync('cat', [cert]), servername: 'localhost' }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    }); req.on('error', reject); req.end();
  });
  assert.equal((await call('/api/v1/health')).status, 200);
  assert.equal((await call('/api/v1/health', 'POST')).status, 405);
  assert.equal((await call('/api/v1/missing')).status, 404);
  assert.equal((await call('/api/v1/health', 'GET', '127.0.0.1:8443')).status, 403);
  process.env.NETLIFY = 'true';
  assert.equal((await call('/api/v1/health')).status, 500);
  delete process.env.NETLIFY;
});