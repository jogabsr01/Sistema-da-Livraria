import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createFirestoreEmulatorDb } from '../helpers/firestore-emulator.mjs';
import { createFirestoreWorkspaceClient } from '../../backend/firestore-client.mjs';
import { createProfileHandler } from '../../backend/profile-handler.mjs';
import { createSessionTokens } from '../../backend/credential-core.mjs';
import { createSessionService, sessionCookie } from '../../backend/session-service.mjs';
import { createPersonalDataVault } from '../../backend/personal-data.mjs';
import sharp from 'sharp';

const skip = process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080';
const origin = 'https://dev--merry-chimera-49a1f3.netlify.app';

test('local profile HTTP saves CPF with an older password session while retaining CSRF and account isolation', { skip }, async t => {
  const db = createFirestoreEmulatorDb({ namespace: 'profilelab', demo: true });
  t.after(() => db.terminate());
  const config = { environment: 'dev', storageMode: 'firestore', installationId: randomUUID(), secret: randomBytes(32).toString('hex'),
    adminPasswordLogin: true, localLab: true, firestore: { mode: 'firestore' } };
  const settings = { config, tokenKey: randomBytes(32), dataKey: randomBytes(32), indexKey: randomBytes(32) };
  const client = createFirestoreWorkspaceClient(config, { firestoreClient: db });
  const handler = createProfileHandler({ loadSettings: () => settings, createClient: () => client });
  const vault = createPersonalDataVault(settings), userId = randomUUID(), sessionId = randomUUID(), now = Date.now();
  const { rawToken, tokenHash } = createSessionTokens({ ...config, tokenKey: settings.tokenKey }).issue();
  await db.collection('users').doc(userId).set({ id: userId, role: 'SUPER_ADMIN', status: 'ATIVO', owner: true,
    authorizationVersion: 1, revision: 0, contact: '', email: 'owner@example.invalid', emailIndex: 'a'.repeat(64), hasPhoto: false });
  await db.collection('sessions').doc(sessionId).set({ sessionId, userId, assurance: 'password', authorizationVersion: 1,
    authenticatedAt: new Date(now - 600000), expiresAt: new Date(now + 3600000) });
  await db.collection('sessionTokenIndex').doc(tokenHash).set({ sessionId, userId });
  const cookie = sessionCookie(rawToken).split(';')[0];
  const current = await createSessionService(settings, { client }).current(new Request(`${origin}/api/v1/session`, { headers: { cookie } }));
  const photo = (await sharp({ create: { width: 32, height: 32, channels: 3, background: '#438063' } }).png().toBuffer()).toString('base64');
  const body = { commandId: randomUUID(), expectedRevision: 0, phone: '11988887777', displayName: 'Proprietário', cpf: '52998224725', photo };
  const call = (data, csrf = current.csrfToken) => handler(new Request(`${origin}/api/v1/profile/save`, { method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(data) }));
  assert.equal((await call(body, 'invalid')).status, 403);
  for (const cpf of ['11111111111', '52998224724', '123']) {
    assert.equal((await call({ ...body, cpf })).status, 400);
  }
  for (const cpf of ['11111111111', '52998224724']) {
    await assert.rejects(client.profile('save', { sessionTokenHash: tokenHash }, { commandId: randomUUID(), expectedRevision: 0,
      contact: 'encrypted', fingerprint: randomBytes(32).toString('hex'), ownerCpfIndex: randomBytes(32).toString('hex'), cpf }), { status: 400 });
  }
  const response = await call(body);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).data.revision, 1);
  const stored = (await db.collection('users').doc(userId).get()).data();
  assert.equal(vault.open('users', userId, stored.contact).cpf, body.cpf);
  assert.equal(stored.cpfIndex, vault.index('cpf', body.cpf));
  assert.equal(stored.hasPhoto, true);
  const bootstrap = await handler(new Request(`${origin}/api/v1/profile/bootstrap`, { headers: { cookie } }));
  assert.equal(bootstrap.status, 200);
  const data = (await bootstrap.json()).data;
  assert.equal(data.cpfMasked, '***.982.247-**');
  assert.equal(data.photoUrl, '/api/v1/profile/photo?v=1');
  const avatar = await handler(new Request(`${origin}${data.photoUrl}`, { headers: { cookie } }));
  assert.equal(avatar.status, 200);
  assert.equal(avatar.headers.get('content-type'), 'image/jpeg');
  const metadata = await sharp(Buffer.from(await avatar.arrayBuffer())).metadata();
  assert.equal(metadata.width, 256); assert.equal(metadata.height, 256);
  assert.equal((await call({ ...body, commandId: randomUUID(), expectedRevision: 1, userId: randomUUID() })).status, 400);
  await db.collection('sessions').doc(sessionId).update({ revokedAt: new Date() });
  assert.equal((await call({ ...body, commandId: randomUUID(), expectedRevision: 1 })).status, 401);
});