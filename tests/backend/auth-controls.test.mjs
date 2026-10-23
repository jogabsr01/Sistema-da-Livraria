import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createGasEmulator } from './gas-emulator.mjs';
import { properties } from './fixtures.mjs';

function setup() {
  const gas = createGasEmulator(properties), install = gas.call('provisionDevelopment');
  gas.call('provisionDevelopmentAuthControls');
  const main = gas.sheets.get(install.spreadsheetId), ss = gas.sheets.get(gas.props.IDENTITY_CONTROL_SPREADSHEET_ID);
  const subjectId = randomUUID();
  function add(table, fields) { const sheet = main.getSheetByName(table); sheet.appendRow(sheet.rows[0].map(key => fields[key] ?? '')); }
  add('Usuarios', { ID_Usuario: subjectId, Perfil: 'ATENDENTE', Status: 'ATIVO', Primeiro_Acesso_Concluido: false });
  add('Configuracoes', { Chave: 'identity.version.' + subjectId, Valor: 1 });
  const config = gas.call('baseSettings_'); let now = Date.now();
  gas.context.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  function run(action, payload) { return gas.call('withLock_', () => gas.call('authControlOperation_', { action, payload }, config)); }
  return { gas, main, ss, config, subjectId, run, advance: milliseconds => { now += milliseconds; },
    attempt: (accountKey = 'a'.repeat(64), originKey = 'b'.repeat(64)) => run('identity.guard.attempt', { accountKey, originKey }),
    challenge: () => ({ challengeId: randomUUID(), subjectId, purpose: 'ACTIVATE', authorizationVersion: 1, tokenHash: randomUUID().replaceAll('-', '').repeat(2) }) };
}

test('private auth controls provision with pre-migration backup, are idempotent and leave business schema unchanged', () => {
  const gas = createGasEmulator(properties), business = gas.call('provisionDevelopment');
  assert.equal(gas.backupCount, 1);
  const first = gas.call('provisionDevelopmentAuthControls'); assert.equal(first.changed, true);
  const id = gas.props.IDENTITY_CONTROL_SPREADSHEET_ID;
  assert.notEqual(id, business.spreadsheetId); assert.equal(gas.backupCount, 2);
  const backups = [...gas.resources.values()].filter(resource => resource.kind === 'backup');
  assert.equal(backups[1].snapshot.length, 0, 'backup precedes private schema creation');
  assert.equal(gas.sheets.get(id).tables.size, 5);
  assert.equal(gas.sheets.get(business.spreadsheetId).tables.size, 17);
  assert.equal(gas.call('provisionDevelopmentAuthControls').changed, false);
  assert.equal(gas.props.IDENTITY_CONTROL_SPREADSHEET_ID, id); assert.equal(gas.backupCount, 2);
});

test('partial private schema provisioning resumes without dropping preserved rows', () => {
  const gas = createGasEmulator(properties); gas.call('provisionDevelopment'); gas.failOnSheet = '_Auth_Challenges';
  assert.throws(() => gas.call('provisionDevelopmentAuthControls'), /INJECTED_STORAGE_FAILURE/);
  const ss = gas.sheets.get(gas.props.IDENTITY_CONTROL_SPREADSHEET_ID);
  ss.getSheetByName('_Auth_Limits').appendRow(['preserved-test-marker']);
  gas.failOnSheet = null; gas.call('provisionDevelopmentAuthControls');
  assert.equal(ss.getSheetByName('_Auth_Limits').rows[1][0], 'preserved-test-marker');
  assert.equal(ss.getSheetByName('_Control_Migrations').getLastRow(), 2);
});

test('owner, DEV, resource privacy and marker checks prevent writes on wrong resources', () => {
  for (const kind of ['prod', 'owner', 'public', 'marker', 'lock']) {
    const s = setup();
    if (kind === 'prod') s.gas.props.APP_ENV = 'prod';
    if (kind === 'owner') s.gas.owner = 'other@example.invalid';
    if (kind === 'public') s.gas.resources.get(s.gas.props.IDENTITY_CONTROL_SPREADSHEET_ID).sharing = 'public';
    if (kind === 'marker') s.gas.props.IDENTITY_CONTROL_SPREADSHEET_ID = s.gas.props.SPREADSHEET_ID;
    if (kind === 'lock') s.gas.locked = true;
    const writes = s.gas.writes;
    assert.throws(() => s.gas.call('provisionDevelopmentAuthControls'), /FORBIDDEN|BINDING_MISMATCH|BUSY/);
    assert.equal(s.gas.writes, writes, kind);
  }
});

test('persistent attempt limiter enforces cooldown without extending it on blocked requests', () => {
  const s = setup(); for (let i = 0; i < 5; i++) assert.equal(s.attempt().allowed, true);
  assert.equal(s.attempt().retryAfterSeconds, 60);
  const writes = s.gas.writes; s.advance(30_000);
  assert.equal(s.attempt().retryAfterSeconds, 30); assert.equal(s.gas.writes, writes);
  s.advance(30_001); for (let i = 0; i < 5; i++) assert.equal(s.attempt().allowed, true);
  assert.equal(s.attempt().retryAfterSeconds, 120, 'repeated excessive attempts increase cooldown');
  s.advance(86_400_001); for (let i = 0; i < 5; i++) assert.equal(s.attempt().allowed, true);
  assert.equal(s.attempt().retryAfterSeconds, 60, 'quiet day resets penalty level');
});

test('partial counter write fails closed and subsequent calls cannot regain consumed attempts', () => {
  const s = setup(); const table = s.ss.getSheetByName('_Auth_Limits'), append = table.appendRow.bind(table); let fail = true;
  table.appendRow = values => { if (values[0].startsWith('origin:') && fail) { fail = false; throw Error('INJECTED_COUNTER_FAILURE'); } return append(values); };
  assert.throws(() => s.attempt(), /INJECTED_COUNTER_FAILURE/);
  assert.equal(table.getLastRow(), 2, 'account reservation already persisted');
  for (let i = 0; i < 4; i++) assert.equal(s.attempt().allowed, true);
  assert.equal(s.attempt().allowed, false);
});

test('challenge expires after ten minutes, is purpose-bound and cannot verify a different user', () => {
  for (const kind of ['expiry', 'purpose', 'subject']) {
    const s = setup(), payload = s.challenge(); s.run('identity.challenge.create', payload);
    if (kind === 'expiry') s.advance(600_000);
    if (kind === 'purpose') payload.purpose = 'DEVICE';
    if (kind === 'subject') payload.subjectId = randomUUID();
    assert.equal(s.run('identity.challenge.consume', payload).verified, false, kind);
  }
});

test('retries preserve challenge expiry and a write acknowledged before interruption never verifies twice', () => {
  const s = setup(), payload = s.challenge();
  const first = s.run('identity.challenge.create', payload); s.advance(1000);
  assert.equal(s.run('identity.challenge.create', payload).expiresAt, first.expiresAt);
  const table = s.ss.getSheetByName('_Auth_Challenges'), original = table.getRange.bind(table); let fail = true;
  table.getRange = (...args) => { const range = original(...args), set = range.setValues;
    range.setValues = values => { set(values); if (fail) { fail = false; throw Error('INJECTED_AFTER_CONSUME'); } }; return range; };
  assert.throws(() => s.run('identity.challenge.consume', payload), /INJECTED_AFTER_CONSUME/);
  assert.equal(s.run('identity.challenge.consume', payload).verified, false);
});

test('duplicate records, corrupted schema and capacity limits refuse mutation before writes', () => {
  for (const kind of ['duplicate', 'header', 'hash', 'capacity']) {
    const s = setup(); s.attempt(); const table = s.ss.getSheetByName('_Auth_Limits');
    if (kind === 'duplicate') table.appendRow(table.rows[1]);
    if (kind === 'header') table.rows[0][0] = 'unexpected-column';
    if (kind === 'hash') s.ss.getSheetByName('_Control_Migrations').rows[1][1] = 'corrupt';
    if (kind === 'capacity') {
      const template = table.rows[1].slice();
      while (table.getLastRow() < 3001) { const row = template.slice(); row[0] = 'account:' + table.getLastRow().toString(16).padStart(64, '0'); table.appendRow(row); }
    }
    const before = s.gas.writes;
    assert.throws(() => s.attempt('c'.repeat(64), 'd'.repeat(64)), /IDENTITY_UNAVAILABLE/);
    assert.equal(s.gas.writes, before, kind);
  }
});
