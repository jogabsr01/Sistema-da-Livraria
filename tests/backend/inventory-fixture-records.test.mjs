import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../../scripts/inventory-sheet-metadata.mjs';
import { analyzeFixtureRecords } from '../../scripts/inventory-fixture-records.mjs';

const schema = await loadSchema();
const fixture = () => ({ sheets: schema.map(table => ({ name: table.name, headers: [...table.columns], rows: [] })) });
const encode = value => Buffer.from(JSON.stringify(value));
const add = (value, name, fields) => {
  const sheet = value.sheets.find(item => item.name === name);
  sheet.rows.push(sheet.headers.map(column => fields[column] ?? null));
};

test('counts records, blank rows, nulls and numeric or formula invalids without row contents', () => {
  const value = fixture();
  add(value, 'Produtos', { ID_Produto: 'product-private', Titulo: '=formula', Preco_Venda: -1, Estoque_Atual: 3 });
  add(value, 'Produtos', {});
  add(value, 'Clientes', { ID_Cliente: 'customer-private', CPF: '123.456.789-00', Email: 'pessoa@example.test', Whatsapp: '11999999999', Nome: 'PRIVATE-NAME' });
  const bytes = encode(value), report = analyzeFixtureRecords(bytes, schema);
  const products = report.sheets.find(sheet => sheet.sheet === 'Produtos');
  assert.equal(products.recordCount, 1);
  assert.equal(products.blankRowCount, 1);
  assert.equal(products.invalidRowCount, 1);
  assert.equal(products.fields.find(field => field.column === 'Titulo').invalid, 1);
  assert.equal(products.fields.find(field => field.column === 'Preco_Venda').invalid, 1);
  assert.equal(products.fields.find(field => field.column === 'Autor').nullOrBlank, 1);
  assert.equal(report.snapshotSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(report.importReady, false);
  assert.doesNotMatch(JSON.stringify(report), /123\.456|pessoa@example|11999999999|PRIVATE-NAME|product-private|customer-private|=formula/);
});

test('hash reflects exact bytes even when JSON data is identical', () => {
  const value = fixture(), bytes = encode(value);
  const other = Buffer.from(JSON.stringify(value, null, 2));
  assert.notEqual(analyzeFixtureRecords(bytes, schema).snapshotSha256, analyzeFixtureRecords(other, schema).snapshotSha256);
});

test('rejects missing, duplicate or mismatched sheets and malformed rows without echoing data', () => {
  for (const mutate of [
    v => v.sheets.pop(),
    v => { v.sheets[1] = structuredClone(v.sheets[0]); },
    v => { v.sheets[0].headers[0] = 'private-header'; },
    v => { v.sheets[0].rows.push(['private-value']); },
    v => { v.sheets[0].rows.push(v.sheets[0].headers.map(() => ({ secret: 'private-value' }))); },
  ]) {
    const value = fixture(); mutate(value);
    assert.throws(() => analyzeFixtureRecords(encode(value), schema), error => error.message === 'RECORD_INVENTORY_INVALID');
  }
  assert.throws(() => analyzeFixtureRecords(Buffer.from('private-value'), schema), /RECORD_INVENTORY_INVALID/);
});

test('CLI processes fixture only, does not alter it, and hides PII and errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'records-inventory-'));
  try {
    const value = fixture(); add(value, 'Clientes', { CPF: '12345678900', Email: 'person@example.test', Whatsapp: '11999999999' });
    const bytes = encode(value), path = join(dir, 'fixture.json');
    await writeFile(path, bytes);
    const script = fileURLToPath(new URL('../../scripts/inventory-fixture-records.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--fixture', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).sheets.find(sheet => sheet.sheet === 'Clientes').recordCount, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /12345678900|person@example|11999999999/);
    assert.deepEqual(await readFile(path), bytes);
    const bad = spawnSync(process.execPath, [script, '--google-read-only', 'private-value'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.doesNotMatch(bad.stdout + bad.stderr, /private-value/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects oversize fixture and marks positive quantities invalid', () => {
  assert.throws(() => analyzeFixtureRecords(Buffer.alloc(2_000_001), schema), /RECORD_INVENTORY_INVALID/);
  const value = fixture(); add(value, 'Itens_Venda', { Quantidade: 0, Preco_Unitario: 100, Subtotal: 0 });
  const sheet = analyzeFixtureRecords(encode(value), schema).sheets.find(item => item.sheet === 'Itens_Venda');
  assert.equal(sheet.fields.find(field => field.column === 'Quantidade').invalid, 1);
  assert.equal(sheet.invalidRowCount, 1);
});