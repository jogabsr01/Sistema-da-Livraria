import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createGasEmulator } from './gas-emulator.mjs';
import { properties } from './fixtures.mjs';

// Contract double: fictional identities, synthetic assurance, no real enrollment.
function setup({ role = 'ATENDENTE', assurance = 'pin' } = {}) {
  const gas = createGasEmulator(properties), result = gas.call('provisionDevelopment');
  const spreadsheet = gas.sheets.get(result.spreadsheetId), c = gas.call('baseSettings_');
  const id = randomUUID(), sessionId = randomUUID(), tokenHash = randomBytes(32).toString('hex'), now = Date.now();
  const fields = {
    ID_Sessao: sessionId, ID_Usuario: id, Criado_Em: new Date(now - 120_000).toISOString(),
    Expira_Em: new Date(now + 4 * 3600_000).toISOString(), Revogado_Em: '',
    Dispositivo: 'Discardable browser fixture', Ultima_Atividade: new Date(now - 90_000).toISOString(),
    Token_Hash: tokenHash, Nivel_Autenticacao: assurance, Versao_Autorizacao: 1,
  };
  function append(name, object) {
    const sheet = spreadsheet.getSheetByName(name);
    sheet.appendRow(sheet.rows[0].map(key => object[key] ?? ''));
    return sheet.rows[sheet.getLastRow() - 1];
  }
  const user = append('Usuarios', { ID_Usuario: id, Nome: 'Pessoa Fictícia', CPF: '00000000000',
    Email: 'private-test@example.invalid', Perfil: role, Status: 'ATIVO', Primeiro_Acesso_Concluido: true });
  const version = append('Configuracoes', { Chave: 'identity.version.' + id, Valor: 1 });
  const session = append('Sessoes', fields);
  function change(name, row, values) {
    const columns = spreadsheet.getSheetByName(name).rows[0];
    for (const [key, value] of Object.entries(values)) row[columns.indexOf(key)] = value;
  }
  function call(action = 'identity.session.read', payload = { tokenHash }, settings = c) {
    return gas.call('withLock_', () => gas.call('identitySessionOperation_', { action, payload }, settings));
  }
  return { gas, spreadsheet, c, id, sessionId, tokenHash, now, fields, session, user, version, append, change, call };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('GAS persisted session yields current restricted principal and throttles last-activity writes', () => {
  const s = setup(), before = s.gas.writes;
  const principal = plain(s.call());
  assert.deepEqual(principal, { id: s.id, sessionId: s.sessionId, role: 'ATENDENTE', assurance: 'pin',
    authenticatedAt: Date.parse(s.fields.Criado_Em), expiresAt: Date.parse(s.fields.Expira_Em), authorizationVersion: 1 });
  assert.equal(s.gas.writes, before + 1, 'one shared activity update');
  assert.deepEqual(plain(s.call()), principal); assert.equal(s.gas.writes, before + 1, 'no write per interaction');
  assert.ok(!JSON.stringify(principal).includes('private-test')); assert.ok(!JSON.stringify(principal).includes('00000000000'));
  for (const name of ['Produtos', 'Vendas', 'Movimentacoes_Estoque']) assert.equal(s.spreadsheet.getSheetByName(name).getLastRow(), 1);
});

test('GAS session lookup refuses raw tokens, caller identity/role fields and unknown hashes without writes', () => {
  const s = setup();
  for (const payload of [null, {}, [], { tokenHash: 'A'.repeat(64) }, { tokenHash: 'raw-token' },
    { tokenHash: s.tokenHash, userId: s.id }, { tokenHash: s.tokenHash, role: 'SUPER_ADMIN' },
    { tokenHash: randomBytes(32).toString('hex') }]) {
    const before = s.gas.writes;
    assert.throws(() => s.call('identity.session.read', payload), /UNAUTHENTICATED/); assert.equal(s.gas.writes, before);
  }
  assert.throws(() => s.call('identity.session.issue'), /FORBIDDEN/);
});

test('GAS session timestamps enforce absolute expiration, idle timeout and valid canonical chronology', () => {
  const variants = [
    { Expira_Em: new Date(Date.now() - 1).toISOString() },
    { Criado_Em: new Date(Date.now() + 120_000).toISOString() },
    { Expira_Em: new Date(Date.now() + 9 * 3600_000).toISOString() },
    { Criado_Em: new Date(Date.now() - 3_600_000).toISOString(), Ultima_Atividade: new Date(Date.now() - 1_800_001).toISOString() },
    { Ultima_Atividade: new Date(Date.now() + 120_000).toISOString() },
    { Ultima_Atividade: new Date(Date.now() - 180_000).toISOString() },
    { Criado_Em: 'not-a-date' }, { Expira_Em: '2026-10-23' }, { Ultima_Atividade: 0 },
    { Revogado_Em: new Date().toISOString() }, { Versao_Autorizacao: 0 }, { Nivel_Autenticacao: 'caller-admin' },
  ];
  for (const fields of variants) {
    const s = setup(); s.change('Sessoes', s.session, fields); const before = s.gas.writes;
    assert.throws(() => s.call(), /UNAUTHENTICATED/); assert.equal(s.gas.writes, before);
  }
});

test('GAS reads authoritative user status, activation and authorization version on every call', () => {
  for (const fields of [{ Status: 'INATIVO' }, { Status: 'ATIVO ' }, { Primeiro_Acesso_Concluido: false },
    { Primeiro_Acesso_Concluido: 'true' }, { Perfil: 'OWNER' }]) {
    const s = setup(); s.change('Usuarios', s.user, fields); const before = s.gas.writes;
    assert.throws(() => s.call(), /UNAUTHENTICATED/); assert.equal(s.gas.writes, before);
  }
  const epoch = setup(); epoch.call(); epoch.change('Configuracoes', epoch.version, { Valor: 2 });
  assert.throws(() => epoch.call(), /UNAUTHENTICATED/);
  const missing = setup(); missing.change('Configuracoes', missing.version, { Chave: 'unrelated' });
  assert.throws(() => missing.call(), /IDENTITY_UNAVAILABLE/);
  const malformed = setup(); malformed.change('Configuracoes', malformed.version, { Valor: '1' });
  assert.throws(() => malformed.call(), /IDENTITY_UNAVAILABLE/);
});

test('GAS administrative identities require strong stored assurance and reflect current role', () => {
  for (const role of ['ADMIN', 'SUPER_ADMIN']) {
    const pin = setup({ role }); const before = pin.gas.writes;
    assert.throws(() => pin.call(), /UNAUTHENTICATED/); assert.equal(pin.gas.writes, before);
    for (const assurance of ['mfa', 'passkey']) assert.equal(setup({ role, assurance }).call().role, role);
  }
  const promoted = setup(); promoted.change('Usuarios', promoted.user, { Perfil: 'ADMIN' });
  assert.throws(() => promoted.call(), /UNAUTHENTICATED/);
  const downgraded = setup({ role: 'ADMIN', assurance: 'mfa' });
  downgraded.change('Usuarios', downgraded.user, { Perfil: 'ATENDENTE' });
  assert.equal(downgraded.call().role, 'ATENDENTE', 'no stale administrative role cached');
});

test('GAS fails closed on duplicated session keys, user identity or authorization epochs', () => {
  for (const kind of ['session-id', 'token-hash', 'user', 'epoch']) {
    const s = setup();
    if (kind === 'session-id') s.append('Sessoes', { ...s.fields, Token_Hash: randomBytes(32).toString('hex') });
    if (kind === 'token-hash') s.append('Sessoes', { ...s.fields, ID_Sessao: randomUUID() });
    if (kind === 'user') s.append('Usuarios', { ID_Usuario: s.id });
    if (kind === 'epoch') s.append('Configuracoes', { Chave: 'identity.version.' + s.id, Valor: 1 });
    const before = s.gas.writes;
    assert.throws(() => s.call(), /IDENTITY_UNAVAILABLE/); assert.equal(s.gas.writes, before);
  }
});

test('GAS logout revokes the stored token and remains revoked across later requests', () => {
  const s = setup(), activityColumn = s.spreadsheet.getSheetByName('Sessoes').rows[0].indexOf('Ultima_Atividade');
  assert.deepEqual(plain(s.call('identity.session.revoke')), { revoked: true });
  assert.equal(s.session[activityColumn], s.fields.Ultima_Atividade, 'logout does not refresh activity');
  const before = s.gas.writes;
  assert.throws(() => s.call(), /UNAUTHENTICATED/); assert.equal(s.gas.writes, before);
});

test('GAS revokes all other same-user sessions, preserves current/other-user sessions and permits retry', () => {
  const s = setup();
  const other = s.append('Sessoes', { ...s.fields, ID_Sessao: randomUUID(), Token_Hash: randomBytes(32).toString('hex') });
  const stale = s.append('Sessoes', { ...s.fields, ID_Sessao: randomUUID(), Token_Hash: randomBytes(32).toString('hex'), Expira_Em: new Date(s.now - 1).toISOString() });
  const outsider = s.append('Sessoes', { ...s.fields, ID_Sessao: randomUUID(), Token_Hash: randomBytes(32).toString('hex'), ID_Usuario: randomUUID() });
  const columns = s.spreadsheet.getSheetByName('Sessoes').rows[0], revoked = columns.indexOf('Revogado_Em');
  assert.deepEqual(plain(s.call('identity.session.revokeOthers')), { revoked: true });
  assert.ok(other[revoked]); assert.ok(stale[revoked]); assert.equal(outsider[revoked], ''); assert.equal(s.session[revoked], '');
  const before = s.gas.writes;
  assert.deepEqual(plain(s.call('identity.session.revokeOthers')), { revoked: true }); assert.equal(s.gas.writes, before);
  assert.equal(s.call().id, s.id);
});

test('GAS session operations refuse PROD or mismatched resource bindings before writes', () => {
  const s = setup(), before = s.gas.writes;
  assert.throws(() => s.call('identity.session.read', { tokenHash: s.tokenHash }, { ...s.c, environment: 'prod' }), /FORBIDDEN/);
  assert.equal(s.gas.writes, before);
  s.gas.resources.get(s.c.driveRootId).sharing = 'public';
  assert.throws(() => s.call(), /BINDING_MISMATCH/); assert.equal(s.gas.writes, before);
});

test('GAS revocation retries recover after interruption between distinct session rows', () => {
  const s = setup();
  const first = s.append('Sessoes', { ...s.fields, ID_Sessao: randomUUID(), Token_Hash: randomBytes(32).toString('hex') });
  const second = s.append('Sessoes', { ...s.fields, ID_Sessao: randomUUID(), Token_Hash: randomBytes(32).toString('hex') });
  const table = s.spreadsheet.getSheetByName('Sessoes'), revoked = table.rows[0].indexOf('Revogado_Em');
  const original = table.getRange.bind(table); let interrupt = true;
  table.getRange = (...args) => {
    const range = original(...args), write = range.setValues;
    range.setValues = values => {
      write(values);
      if (interrupt) { interrupt = false; throw new Error('INJECTED_REVOCATION_INTERRUPTION'); }
    };
    return range;
  };
  assert.throws(() => s.call('identity.session.revokeOthers'), /INJECTED_REVOCATION_INTERRUPTION/);
  assert.ok(first[revoked]); assert.equal(second[revoked], ''); assert.equal(s.session[revoked], '');
  assert.deepEqual(plain(s.call('identity.session.revokeOthers')), { revoked: true });
  assert.ok(second[revoked]); assert.equal(s.call().sessionId, s.sessionId);
});

test('GAS session lookups respect exclusive installation lock', () => {
  const s = setup(); s.gas.locked = true; const before = s.gas.writes;
  assert.throws(() => s.call(), /BUSY/); assert.equal(s.gas.writes, before);
});

test('GAS bounded session scans refuse unsupported headers and excessive rows before writes', () => {
  const broken = setup(), table = broken.spreadsheet.getSheetByName('Sessoes');
  table.rows[0][0] = 'unexpected'; const writes = broken.gas.writes;
  assert.throws(() => broken.call(), /IDENTITY_UNAVAILABLE/); assert.equal(broken.gas.writes, writes);
  const capacity = setup(), large = capacity.spreadsheet.getSheetByName('Sessoes');
  while (large.rows.length < 5002) large.rows.push([...large.rows[1]]);
  const before = capacity.gas.writes;
  assert.throws(() => capacity.call(), /IDENTITY_UNAVAILABLE/); assert.equal(capacity.gas.writes, before);
});
