import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createFirestoreEmulatorDb } from '../helpers/firestore-emulator.mjs';
import { bootstrapOwner } from '../../scripts/firestore-bootstrap-owner.mjs';
import { createOwnerAccessHandler, ACCESS_ORIGIN } from '../../backend/owner-access.mjs';
import { createFirestoreWorkspaceClient } from '../../backend/firestore-client.mjs';
import { extractLocalCode } from '../../scripts/firestore-local-email-code.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !/^127\.0\.0\.1:\d{1,5}$/.test(host || '') || Number(host?.split(':')[1]) < 1 || Number(host?.split(':')[1]) > 65535;

test('HTTP handler accepts first-access proof and queues encrypted email in official emulator', { skip }, async t => {
  const db = createFirestoreEmulatorDb({ namespace: 'auth-http', demo: true });
  t.after(() => db.terminate());
  const secret = randomBytes(32).toString('hex'), installationId = randomUUID();
  const config = { environment: 'dev', storageMode: 'firestore', installationId, secret, adminPasswordLogin: true,
    firestore: { mode: 'firestore', emailDeliveryKey: randomBytes(32) } };
  const settings = { config, tokenKey: randomBytes(32), guardKey: randomBytes(32), pepper: randomBytes(32), staffEnabled: false };
  const client = createFirestoreWorkspaceClient(config, { firestoreClient: db });
  const handler = createOwnerAccessHandler({ loadSettings: () => settings, createClient: () => client });
  await bootstrapOwner({ db, email: 'owner@example.invalid', environment: 'dev', installationId, secret });
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request(ACCESS_ORIGIN + req.url, { method: req.method, headers: req.headers,
        ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }) });
      const response = await handler(request, { ip: '127.0.0.1' });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = await fetch(`${base}/api/v1/access/state`);
  assert.equal(state.status, 200);
  const cookie = state.headers.get('set-cookie').split(';')[0], csrfToken = (await state.json()).data.csrfToken;
  const post = headers => fetch(`${base}/api/v1/access/start`, { method: 'POST', headers: { origin: ACCESS_ORIGIN,
    cookie, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ email: 'owner@example.invalid' }) });
  assert.equal((await post({ 'x-csrf-token': 'invalid' })).status, 403);
  const started = await post({ 'x-csrf-token': csrfToken });
  assert.equal(started.status, 202, await started.clone().text());
  const outbox = await db.collection('outbox').where('type', '==', 'EMAIL_DELIVERY').get();
  assert.equal(outbox.size, 1);
  const entry = outbox.docs[0].data(), code = extractLocalCode(entry, config.firestore);
  assert.match(code, /^[A-HJ-NP-Z2-9]{7}$/);
  assert.equal(JSON.stringify(entry).includes(code), false);
  assert.equal(entry.state, 'PENDING');
});