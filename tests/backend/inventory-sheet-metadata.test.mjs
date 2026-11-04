import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeInventory, loadSchema, parseFixture, readGoogleSheets } from '../../scripts/inventory-sheet-metadata.mjs';

const schema = await loadSchema();
const fixture = () => schema.map(table => ({ name: table.name, headers: [...table.columns], rowCapacity: 100, columnCapacity: 40 }));

test('inventory reports only allowed metadata and never returns fixture cell data', () => {
  const sheets = fixture();
  sheets.push({ name: 'CPF-SECRET', rows: [['private']] });
  sheets[0].rows = [['SECRET-CUSTOMER']];
  const report = analyzeInventory(schema, parseFixture({ sheets }));
  assert.equal(report.compatible, true);
  assert.equal(report.unexpectedSheetCount, 1);
  assert.equal(report.recordCountsAvailable, false);
  assert.doesNotMatch(JSON.stringify(report), /SECRET|private/);
});

test('missing, duplicate, reordered, blank and unknown headers fail closed without leaking values', () => {
  const sheets = fixture();
  sheets[0].headers = ['CPF-SECRET', '', schema[0].columns[1], schema[0].columns[1]];
  sheets.splice(1, 1);
  const report = analyzeInventory(schema, sheets);
  assert.equal(report.compatible, false);
  assert.equal(report.sheets[1].present, false);
  assert.deepEqual(report.sheets[0].duplicateColumns, [schema[0].columns[1]]);
  assert.equal(report.sheets[0].unknownColumnCount, 1);
  assert.equal(report.sheets[0].blankHeaderCount, 1);
  assert.doesNotMatch(JSON.stringify(report), /CPF-SECRET/);
  assert.throws(() => analyzeInventory(schema, [...fixture(), fixture()[0]]));
});

test('Google adapter uses only fixed-origin GETs and requests only row one', async () => {
  const sheets = fixture(), id = 'sheet_id_12345678901234567890', calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    const range = parsed.searchParams.get('ranges');
    const body = range ? (() => {
      const index = sheets.findIndex(sheet => range === `'${sheet.name}'!1:1`);
      assert.ok(index >= 0);
      return { spreadsheetId: id, sheets: [{ properties: { sheetId: index }, data: [{ rowData: [{ values: sheets[index].headers.map(value => ({ userEnteredValue: { stringValue: value } })) }] }] }] };
    })() : { spreadsheetId: id, sheets: sheets.map((sheet, index) => ({ properties: { sheetId: index, title: sheet.name, gridProperties: { rowCount: 100, columnCount: 40 } } })) };
    return { ok: true, json: async () => body };
  };
  const result = await readGoogleSheets({ spreadsheetId: id, token: 'test-token-12345', fetchImpl });
  assert.equal(analyzeInventory(schema, result).compatible, true);
  assert.equal(calls.length, 8);
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, 'https://sheets.googleapis.com');
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.body, undefined);
  }
});

test('Google adapter fails closed on wrong spreadsheet or transport failure', async () => {
  const options = { spreadsheetId: 'sheet_id_12345678901234567890', token: 'test-token-12345' };
  await assert.rejects(readGoogleSheets({ ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ spreadsheetId: 'wrong', sheets: [] }) }) }));
  await assert.rejects(readGoogleSheets({ ...options, fetchImpl: async () => { throw Error('private token'); } }), /INVENTORY_INVALID/);
});

test('CLI reads JSON fixture and fails safely without explicit real-read consent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'inventory-test-'));
  try {
    const path = join(dir, 'fixture.json');
    await writeFile(path, JSON.stringify({ sheets: fixture() }));
    const script = fileURLToPath(new URL('../../scripts/inventory-sheet-metadata.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--fixture', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).compatible, true);
    const denied = spawnSync(process.execPath, [script, '--google-read-only'], { encoding: 'utf8', env: {} });
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /INVENTORY_FAILED/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});