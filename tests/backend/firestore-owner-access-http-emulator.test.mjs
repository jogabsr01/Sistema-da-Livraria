import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createFirestoreEmulatorDb } from '../helpers/firestore-emulator.mjs';
import { bootstrapOwner } from '../../scripts/firestore-bootstrap-owner.mjs';
import { createOwnerAccessHandler, ACCESS_ORIGIN } from '../../backend/owner-access.mjs';
import { createFirestoreWorkspaceClient } from '../../backend/firestore-client.mjs';
import { extractLocalCode } from '../../scripts/firestore-local-email-code.mjs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createPersonalDataVault } from '../../backend/personal-data.mjs';
import { openEmailDelivery } from '../../backend/email-delivery-crypto.mjs';

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
  const activeCookie = started.headers.get('set-cookie').split(';')[0];
  const startedData = (await started.json()).data;
  const postStep = (op, body, csrf) => fetch(`${base}/api/v1/access/${op}`, { method: 'POST', headers: { origin: ACCESS_ORIGIN,
    cookie: activeCookie, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
  const verified = await postStep('email', { code }, startedData.csrfToken);
  assert.equal(verified.status, 200, await verified.clone().text());
  const password = await postStep('password', { newPassword: 'Synthetic pass 123' }, (await verified.json()).data.csrfToken);
  assert.equal(password.status, 200, await password.clone().text());
  const options = await postStep('options', {}, (await password.json()).data.csrfToken);
  assert.equal(options.status, 200, await options.clone().text());
  assert.equal((await options.json()).data.kind, 'create');
  // Synthetic proof tests the Firestore transaction after WebAuthn verification;
  // it is not a substitute for a browser ceremony.
  const flows = await db.collection('authFlows').get();
  assert.equal(flows.size, 1);
  const flow = flows.docs[0].data();
  await client.access('saveProof', { tokenHash: flow.tokenHash, method: 'registerPasskey', command: {
    subjectId: flow.subjectId, authorizationVersion: flow.authorizationVersion, ceremonyId: flow.ceremonyId,
    credentialId: randomBytes(32).toString('base64url'), publicKey: randomBytes(65).toString('base64url'), counter: 0, transports: ['internal'],
  } });
  const sessionTokenHash = randomBytes(32).toString('hex');
  const principal = await client.access('commit', { tokenHash: flow.tokenHash, sessionTokenHash });
  assert.equal(principal.assurance, 'passkey');
  assert.equal((await db.collection('sessions').get()).size, 1);
  const actor = { sessionTokenHash };
  const bootstrap = await client.profile('bootstrap', actor, {});
  assert.equal(bootstrap.principal.id, principal.id);
  assert.equal(bootstrap.profile.email, 'owner@example.invalid');
  assert.equal(bootstrap.profile.owner, true);
  const profile = await client.profile('get', actor, {});
  assert.equal(profile.id, principal.id);
  assert.equal(profile.email, bootstrap.profile.email);
  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#557755' } }).jpeg().toBuffer();
  const photo = { bytes: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
  const command = { commandId: randomUUID(), expectedRevision: 0, contact: 'encrypted-contact', fingerprint: randomBytes(32).toString('hex'), cpf: '52998224725', ownerCpfIndex: randomBytes(32).toString('hex'), ownerEmailIndex: randomBytes(32).toString('hex'), photo };
  const originalEmailIndex = (await db.collection('users').doc(principal.id).get()).data().emailIndex;
  await db.collection('uniqueness').doc(`staff-cpf:${command.ownerCpfIndex}`).set({ ownerId: randomUUID() });
  await assert.rejects(client.profile('save', actor, command), { code: 'STAFF_CPF_DUPLICATE' });
  await db.collection('uniqueness').doc(`staff-cpf:${command.ownerCpfIndex}`).delete();
  assert.deepEqual(await client.profile('save', actor, command), { revision: 1 });
  assert.deepEqual(await client.profile('save', actor, command), { revision: 1 });
  assert.deepEqual(await client.profile('photo', actor, {}), photo);
  const saved = (await db.collection('users').doc(principal.id).get()).data();
  assert.equal(saved.emailIndex, originalEmailIndex);
  assert.equal(saved.cpfIndex, command.ownerCpfIndex);
  assert.equal((await db.collection('uniqueness').doc(`staff-cpf:${command.ownerCpfIndex}`).get()).data().ownerId, principal.id);
  await assert.rejects(client.profile('save', actor, { ...command, commandId: randomUUID(), expectedRevision: 1, ownerCpfIndex: randomBytes(32).toString('hex') }), { code: 'PROFILE_CPF_LOCKED' });
  assert.deepEqual(await client.profile('save', actor, { commandId: randomUUID(), expectedRevision: 1, contact: 'encrypted-contact', fingerprint: randomBytes(32).toString('hex'), photo: null }), { revision: 2 });
  await assert.rejects(client.profile('photo', actor, {}), { status: 404 });
  const vault = createPersonalDataVault({ config, dataKey: randomBytes(32), indexKey: randomBytes(32) });
  const staffId = randomUUID(), contact = { name: 'Pessoa de teste', email: 'staff@example.invalid', cpf: '52998224725', phone: '' };
  const staffCommand = { commandId: randomUUID(), id: staffId, expectedRevision: 0, role: 'ATENDENTE', status: 'ATIVO',
    contact: vault.seal('users', staffId, contact), emailIndex: vault.index('email', contact.email), cpfIndex: vault.index('cpf', contact.cpf),
    fingerprint: randomBytes(32).toString('hex'), reason: 'ciphertext', delivery: contact.email };
  assert.equal((await client.staff('save', actor, staffCommand)).reenrollmentRequired, true);
  assert.equal((await client.staff('get', actor, { id: staffId })).user.id, staffId);
  const invitation = (await db.collection('outbox').doc(`email:staff-invite:${staffCommand.commandId}`).get()).data();
  assert.equal(openEmailDelivery(config.firestore, 'recipient', invitation.idempotencyKey, invitation.payload.recipientCiphertext), contact.email);
  const account = (await client.staffAccess('lookup', { emailIndex: staffCommand.emailIndex })).account;
  assert.equal(account.subjectId, staffId);
  assert.equal(account.activated, false);
  const tokenHash = randomBytes(32).toString('hex'), codeHash = randomBytes(32).toString('hex');
  const start = { subjectId: staffId, contactHash: createHash('sha256').update(staffCommand.contact).digest('hex'), delivery: contact.email,
    flowId: randomUUID(), tokenHash, codeHash, code: 'ABCDEFG' };
  assert.equal((await client.staffAccess('start', start)).outcome, 'SENT');
  assert.equal((await client.access('email', { tokenHash, codeHash })).verified, true);
  await client.access('password', { tokenHash, record: JSON.stringify({ version: 1, credentialType: 'PASSWORD_V1', algorithm: 'scrypt-N32768-r8-p1', salt: randomBytes(32).toString('hex'), hash: randomBytes(32).toString('hex') }) });
  const ceremonyId = randomUUID();
  const prepared = await client.prepareAccessOptions({ tokenHash, ceremonyId, challenge: randomBytes(32).toString('base64url'), accountKey: randomBytes(32).toString('hex'), originKey: randomBytes(32).toString('hex') });
  assert.equal(prepared.kind, 'create');
  await client.access('saveProof', { tokenHash, method: 'registerPasskey', command: { subjectId: staffId, authorizationVersion: account.authorizationVersion, ceremonyId,
    credentialId: randomBytes(32).toString('base64url'), publicKey: randomBytes(65).toString('base64url'), counter: 0, transports: ['internal'] } });
  const staffPrincipal = await client.access('commit', { tokenHash, sessionTokenHash: randomBytes(32).toString('hex') });
  assert.equal(staffPrincipal.role, 'ATENDENTE');
  assert.equal((await client.lookupAccessLogin({ staffLookup: true, emailIndex: staffCommand.emailIndex })).account.subjectId, staffId);
});