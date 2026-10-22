import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGasEmulator } from './gas-emulator.mjs';
import { properties } from './fixtures.mjs';
const schema = JSON.parse(readFileSync(new URL('../../schema/workspace-v1.json', import.meta.url)));

test('DEV provisioning creates all requested schemas and private-folder bindings, twice without data loss or extra backup', () => {
  const gas = createGasEmulator(properties), result = gas.call('provisionDevelopment');
  const ss = gas.sheets.get(result.spreadsheetId);
  assert.equal(result.environment, 'dev'); assert.equal(gas.backupCount, 1);
  for (const table of schema.tables) {
    assert.deepEqual(ss.getSheetByName(table.name).rows[0], table.columns);
    if (table.text_columns.length) assert.ok(ss.getSheetByName(table.name).formats.length);
  }
  ss.getSheetByName('Produtos').appendRow(['local-test-product']);
  assert.equal(gas.call('inspectDevelopmentSchema').tables, 17);
  const second = gas.call('provisionDevelopment');
  assert.equal(second.spreadsheetId, result.spreadsheetId);
  assert.equal(gas.backupCount, 1); assert.equal(ss.getSheetByName('Produtos').rows[1][0], 'local-test-product');
  const backup = [...gas.resources.values()].find(r => r.kind === 'backup');
  assert.equal(backup.snapshot.length, 0, 'backup predates first schema write');
  for (const folder of ['COVERS_FOLDER_ID', 'PROFILES_FOLDER_ID', 'DOCUMENTS_FOLDER_ID', 'EXPORTS_FOLDER_ID', 'BACKUPS_FOLDER_ID']) assert.ok(gas.props[folder]);
});
test('migration refuses mismatched headers and performs no further writes', () => {
  const gas = createGasEmulator(properties), result = gas.call('provisionDevelopment');
  gas.sheets.get(result.spreadsheetId).getSheetByName('Produtos').rows[0][0] = 'Unrecognized';
  const before = gas.writes;
  assert.throws(() => gas.call('migrateDevelopmentSchema'), /SCHEMA_CONFLICT/);
  assert.equal(gas.writes, before);
});
test('interrupted initial migration is recoverable without dropping already written rows', () => {
  const gas = createGasEmulator(properties); gas.failOnSheet = 'Vendas';
  assert.throws(() => gas.call('provisionDevelopment'), /INJECTED_STORAGE_FAILURE/);
  const ss = gas.sheets.get(gas.props.SPREADSHEET_ID);
  ss.getSheetByName('Produtos').appendRow(['preserved-after-interruption']);
  gas.failOnSheet = null; gas.call('provisionDevelopment');
  assert.equal(ss.getSheetByName('Produtos').rows[1][0], 'preserved-after-interruption');
  assert.equal(ss.getSheetByName('_Migracoes').getLastRow(), 2);
  assert.equal(gas.backupCount, 2, 'each attempted migration backs up before writes');
});
test('DEV refuses a resource relabeled as PROD, and wrong operator cannot provision', () => {
  const gas = createGasEmulator(properties), result = gas.call('provisionDevelopment');
  const resource = gas.resources.get(result.spreadsheetId), marker = JSON.parse(resource.description);
  marker.environment = 'prod'; resource.description = JSON.stringify(marker);
  const before = gas.writes;
  assert.throws(() => gas.call('migrateDevelopmentSchema'), /BINDING_MISMATCH/);
  assert.equal(gas.writes, before);
  const prod = createGasEmulator({ ...properties, APP_ENV: 'prod' });
  assert.throws(() => prod.call('provisionDevelopment'), /FORBIDDEN/); assert.equal(prod.resources.size, 0);
  const wrong = createGasEmulator(properties); wrong.owner = 'someone@example.invalid';
  assert.throws(() => wrong.call('provisionDevelopment'), /FORBIDDEN/); assert.equal(wrong.resources.size, 0);
});
test('lock refusal does not create or mutate resources', () => {
  const gas = createGasEmulator(properties); gas.locked = true;
  assert.throws(() => gas.call('provisionDevelopment'), /BUSY/); assert.equal(gas.writes, 0);
});
test('schema hash corruption and missing tables are not accepted as a completed migration', () => {
  const gas = createGasEmulator(properties), result = gas.call('provisionDevelopment');
  const ss = gas.sheets.get(result.spreadsheetId), log = ss.getSheetByName('_Migracoes');
  log.rows[1][3] = 'corrupted';
  assert.throws(() => gas.call('migrateDevelopmentSchema'), /SCHEMA_REQUIRED/);
});

test('public/domain sharing refuses migration without changing data or permissions', () => {
  const gas = createGasEmulator(properties), result = gas.call('provisionDevelopment');
  const folder = gas.resources.get(result.driveRootId); folder.sharing = 'domain';
  const before = gas.writes;
  assert.throws(() => gas.call('migrateDevelopmentSchema'), /BINDING_MISMATCH/);
  assert.equal(gas.writes, before); assert.equal(folder.sharing, 'domain');
});
