import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createGasEmulator } from './gas-emulator.mjs';
import { properties, environment } from './fixtures.mjs';
import { createWorkspaceClient } from '../../backend/workspace-client.mjs';
import { createPasskeyService, loadPasskeySettings } from '../../backend/passkey-service.mjs';
function setup() {
  const gas = createGasEmulator({ ...properties, IDENTITY_PASSKEYS_ENABLED: 'true' });
  const install = gas.call('provisionDevelopment'); gas.call('provisionDevelopmentAuthControls');
  const settings = loadPasskeySettings(environment({ WORKSPACE_IDENTITY_PASSKEYS_ENABLED: 'true',
    WORKSPACE_SPREADSHEET_ID: install.spreadsheetId, WORKSPACE_DRIVE_ROOT_ID: install.driveRootId }));
  const main = gas.sheets.get(install.spreadsheetId), priv = gas.sheets.get(gas.props.IDENTITY_CONTROL_SPREADSHEET_ID), subjectId = randomUUID();
  for (const [name, fields] of [['Usuarios', { ID_Usuario: subjectId, Perfil: 'ADMIN', Status: 'ATIVO', Primeiro_Acesso_Concluido: false }], ['Configuracoes', { Chave: 'identity.version.' + subjectId, Valor: 1 }]]) {
    const sheet = main.getSheetByName(name); sheet.appendRow(sheet.rows[0].map(key => fields[key] ?? ''));
  }
  const client = createWorkspaceClient(settings.config, { fetchImpl: async (_url, options) => new Response(JSON.stringify(gas.post(JSON.parse(options.body)))) });
  const context = { subjectId, authorizationVersion: 1 };
  const execute = (action, payload) => gas.call('withLock_', () => gas.call('passkeyOperation_', { action, payload: { ...context, ...payload } }, gas.call('baseSettings_')));
  function begin(purpose) {
    const payload = { ceremonyId: randomUUID(), purpose, challenge: randomBytes(32).toString('base64url') };
    execute('identity.passkey.begin', payload); return payload.ceremonyId;
  }
  function register() {
    const ceremonyId = begin('REGISTER'); execute('identity.passkey.take', { ceremonyId, credentialId: '' });
    // Storage contract fixture only: real COSE/signature validation is in the Chromium suite.
    const value = { ceremonyId, credentialId: randomBytes(32).toString('base64url'), publicKey: randomBytes(77).toString('base64url'), counter: 0, transports: ['internal'] };
    execute('identity.passkey.register', value); return value;
  }
  return { gas, main, priv, settings, client, context, execute, begin, register, service: createPasskeyService(settings, { client }) };
}

test('private schema upgrades v1 to v2 with a prior backup, preserves controls and is idempotent', () => {
  const s = setup(), schema = s.gas.context.AUTH_CONTROL_SCHEMA;
  s.priv.tables.delete('_Passkeys'); s.priv.tables.delete('_Passkey_Ceremonies');
  const history = s.priv.getSheetByName('_Control_Migrations');
  history.rows[1][0] = 1; history.rows[1][1] = '357da73009e9d28b09650f78dbc8c59b2114ee13f23dbe5b6a2a6334b11d75f2';
  s.priv.getSheetByName('_Auth_Limits').appendRow(['preserved-counter-fixture']);
  const before = s.gas.backupCount;
  assert.equal(s.gas.call('provisionDevelopmentAuthControls').version, 2);
  assert.equal(s.gas.backupCount, before + 1); assert.equal(history.getLastRow(), 3);
  assert.equal(s.priv.getSheetByName('_Auth_Limits').rows[1][0], 'preserved-counter-fixture');
  assert.equal(s.gas.call('provisionDevelopmentAuthControls').changed, false);
  assert.equal(s.gas.backupCount, before + 1);
});

test('v2 upgrade resumes after interruption and refuses an unknown legacy hash before backup or mutation', () => {
  for (const mode of ['partial', 'hash']) {
    const s = setup(), schema = s.gas.context.AUTH_CONTROL_SCHEMA;
    s.priv.tables.delete('_Passkeys'); s.priv.tables.delete('_Passkey_Ceremonies');
    const row = s.priv.getSheetByName('_Control_Migrations').rows[1]; row[0] = 1;
    row[1] = mode === 'hash' ? 'corrupt' : '357da73009e9d28b09650f78dbc8c59b2114ee13f23dbe5b6a2a6334b11d75f2';
    const before = s.gas.writes, backups = s.gas.backupCount;
    if (mode === 'hash') {
      assert.throws(() => s.gas.call('provisionDevelopmentAuthControls'), /IDENTITY_UNAVAILABLE/);
      assert.equal(s.gas.writes, before); assert.equal(s.gas.backupCount, backups);
    } else {
      s.gas.failOnSheet = '_Passkeys'; assert.throws(() => s.gas.call('provisionDevelopmentAuthControls'), /INJECTED_STORAGE_FAILURE/);
      s.gas.failOnSheet = null; assert.equal(s.gas.call('provisionDevelopmentAuthControls').version, 2);
      assert.equal(s.priv.getSheetByName('_Control_Migrations').getLastRow(), 3);
    }
  }
});

test('registration options pin exact DEV RP, demand user verification and contain no email or role', async () => {
  const s = setup(), result = await s.service.registrationOptions(s.context);
  assert.equal(result.options.rp.id, 'dev--merry-chimera-49a1f3.netlify.app');
  assert.equal(result.options.authenticatorSelection.userVerification, 'required');
  assert.equal(result.options.attestation, 'none'); assert.deepEqual(result.options.pubKeyCredParams.map(x => x.alg), [-7]);
  assert.ok(!JSON.stringify(result).includes('ADMIN')); assert.equal(s.priv.getSheetByName('_Passkey_Ceremonies').getLastRow(), 2);
  await assert.rejects(s.service.verifyRegistration({ ...s.context, ceremonyId: result.ceremonyId }, {}), { code: 'PASSKEY_REJECTED' });
  assert.equal(s.priv.getSheetByName('_Passkeys').getLastRow(), 1);
});

test('persistent ceremony take is one-time and a single registration cannot add multiple credentials', () => {
  const s = setup(), credential = s.register();
  assert.throws(() => s.execute('identity.passkey.take', { ceremonyId: credential.ceremonyId, credentialId: '' }), /PASSKEY_REJECTED/);
  assert.throws(() => s.execute('identity.passkey.register', { ...credential, credentialId: randomBytes(32).toString('base64url') }), /PASSKEY_REJECTED/);
  assert.equal(s.priv.getSheetByName('_Passkeys').getLastRow(), 2);
});

test('counter commits bind to selected credential and compare the stored counter atomically', () => {
  const s = setup(), first = s.register(), second = s.register();
  const a = s.begin('AUTHENTICATE'), b = s.begin('AUTHENTICATE');
  for (const ceremonyId of [a, b]) s.execute('identity.passkey.take', { ceremonyId, credentialId: first.credentialId });
  assert.throws(() => s.execute('identity.passkey.counter', { ceremonyId: a, credentialId: second.credentialId, expectedCounter: 0, newCounter: 1 }), /PASSKEY_REJECTED/);
  s.execute('identity.passkey.counter', { ceremonyId: a, credentialId: first.credentialId, expectedCounter: 0, newCounter: 1 });
  assert.throws(() => s.execute('identity.passkey.counter', { ceremonyId: b, credentialId: first.credentialId, expectedCounter: 0, newCounter: 2 }), /PASSKEY_REJECTED/);
  const c = s.begin('AUTHENTICATE'); s.execute('identity.passkey.take', { ceremonyId: c, credentialId: first.credentialId });
  assert.throws(() => s.execute('identity.passkey.counter', { ceremonyId: c, credentialId: first.credentialId, expectedCounter: 1, newCounter: 1 }), /PASSKEY_REJECTED/);
  s.execute('identity.passkey.counter', { ceremonyId: c, credentialId: first.credentialId, expectedCounter: 1, newCounter: 2 });
});

test('disabled account, revoked credential or epoch change rejects verification commit without another key write', () => {
  for (const mode of ['disabled', 'revoked', 'epoch']) {
    const s = setup(), key = s.register(), ceremonyId = s.begin('AUTHENTICATE');
    s.execute('identity.passkey.take', { ceremonyId, credentialId: key.credentialId });
    if (mode === 'disabled') { const table = s.main.getSheetByName('Usuarios'); table.rows[1][table.rows[0].indexOf('Status')] = 'INATIVO'; }
    if (mode === 'epoch') s.main.getSheetByName('Configuracoes').rows[1][1] = 2;
    if (mode === 'revoked') { const table = s.priv.getSheetByName('_Passkeys'); table.rows[1][table.rows[0].indexOf('Revoked_At')] = new Date().toISOString(); }
    const before = s.gas.writes;
    assert.throws(() => s.execute('identity.passkey.counter', { ceremonyId, credentialId: key.credentialId, expectedCounter: 0, newCounter: 1 }), /PASSKEY_REJECTED/);
    assert.equal(s.gas.writes, before);
  }
});

test('passkey settings remain closed, reject PROD and signed operations fail unless separately enabled', async () => {
  assert.throws(() => loadPasskeySettings(environment()), { code: 'IDENTITY_NOT_ACTIVATED' });
  assert.throws(() => loadPasskeySettings(environment({ WORKSPACE_IDENTITY_PASSKEYS_ENABLED: 'true', APP_ENV: 'prod', CONTEXT: 'production', BRANCH: 'main', DEPLOY_PRIME_URL: 'https://merry-chimera-49a1f3.netlify.app' })), { code: 'IDENTITY_CONFIGURATION_UNAVAILABLE' });
  const s = setup(); s.gas.props.IDENTITY_PASSKEYS_ENABLED = 'false';
  await assert.rejects(s.service.registrationOptions(s.context), { code: 'WORKSPACE_IDENTITY_UNAVAILABLE' });
  assert.throws(() => s.gas.call('passkeyOperation_', { action: 'identity.passkey.list', payload: s.context }, { ...s.gas.call('baseSettings_'), environment: 'prod' }), /FORBIDDEN/);
});


test('embedded-origin assertions and malformed responses are rejected before reading or consuming a stored ceremony', async () => {
  let reads = 0;
  const service = createPasskeyService({ config: { environment: 'dev' } }, { client: { takePasskey: async () => { reads++; throw Error('unexpected'); } } });
  const input = { subjectId: randomUUID(), authorizationVersion: 1, ceremonyId: randomUUID() };
  for (const data of [{ crossOrigin: true }, { topOrigin: 'https://attacker.invalid' }, { crossOrigin: 'false' }]) {
    const response = { response: { clientDataJSON: Buffer.from(JSON.stringify(data)).toString('base64url') } };
    await assert.rejects(service.verifyRegistration(input, response), { code: 'PASSKEY_REJECTED' });
  }
  assert.equal(reads, 0);
});
