import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../../scripts/inventory-sheet-metadata.mjs';
import { consolidateFixture } from '../../scripts/inventory-consolidated.mjs';
import { dryRunFixture } from '../../scripts/inventory-dry-run.mjs';

const schema = await loadSchema();
const fixture = () => ({ sheets: schema.map(t => ({ name: t.name, headers: [...t.columns], rows: [] })) });
const add = (f, name, fields) => { const s = f.sheets.find(item => item.name === name); s.rows.push(s.headers.map(h => fields[h] ?? null)); };
const bytes = f => Buffer.from(JSON.stringify(f));
function valid() {
  const f = fixture();
  add(f, 'Nichos', { ID_Nicho: 'n1', Nome: 'Livro' });
  add(f, 'Produtos', { ID_Produto: 'p1', ISBN: '9780140328721', Titulo: 'Teste', Preco_Venda: 100, Estoque_Atual: 2 });
  add(f, 'Produto_Nichos', { ID_Produto: 'p1', ID_Nicho: 'n1' });
  add(f, 'Clientes', { ID_Cliente: 'c1', CPF: '12345678900', Email: 'privado@example.test', Whatsapp: '11999999999' });
  return f;
}

test('successful simulation checks real validator write flag and has no rejections', () => {
  const report = dryRunFixture(bytes(valid()), schema);
  assert.equal(report.validator.validatorAccepted, true);
  assert.equal(report.validator.writePerformed, false);
  assert.equal(report.writePerformed, false);
  assert.equal(report.validator.fullMigrationReady, false);
  assert.deepEqual(report.rejections, []);
  assert.equal(report.alerts.length, 2);
});

test('validator contract fails closed if write flag is true, absent or malformed', () => {
  for (const result of [{ writePerformed: true }, {}, null, undefined, { writePerformed: 'false' }]) {
    assert.throws(() => consolidateFixture(bytes(valid()), schema, { validator: () => result }), /VALIDATOR_WRITE_CONTRACT_VIOLATION/);
  }
});

test('multiple orphan relations produce aggregate rejections without exposing PII', () => {
  const f = valid();
  add(f, 'Produto_Nichos', { ID_Produto: 'p1', ID_Nicho: 'private-missing' });
  add(f, 'Itens_Venda', { ID_Venda: 'private-sale', ID_Produto: 'private-product', Quantidade: 1, Preco_Unitario: 5, Subtotal: 5 });
  const report = dryRunFixture(bytes(f), schema);
  assert.ok(report.rejections.some(r => r.code === 'RELATION_MISSING' && r.sheet === 'Produto_Nichos' && r.column === 'ID_Nicho'));
  assert.ok(report.rejections.some(r => r.code === 'RELATION_MISSING' && r.sheet === 'Itens_Venda' && r.column === 'ID_Produto'));
  assert.ok(report.rejections.some(r => r.code === 'RELATION_MISSING' && r.sheet === 'Itens_Venda' && r.column === 'ID_Venda'));
  assert.equal(report.validator.minimumReady, false);
  assert.equal(report.writePerformed, false);
  assert.doesNotMatch(JSON.stringify(report), /12345678900|privado@example|11999999999|private-missing|private-sale|private-product/);
});

test('validator errors are allowlisted and do not echo unknown error text', () => {
  const report = consolidateFixture(bytes(valid()), schema, { validator: () => { throw Error('IMPORT_SECRET_PERSONAL_DATA'); } });
  assert.equal(report.validator.validatorCode, 'IMPORT_INVALID');
  assert.equal(report.validator.writePerformed, null);
});

test('CLI reports issues without aborting, exits nonzero and preserves fixture', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'inventory-dry-run-'));
  try {
    const f = valid(); add(f, 'Itens_Venda', { ID_Venda: 'bad', ID_Produto: 'bad', Quantidade: 1, Preco_Unitario: 1, Subtotal: 1 });
    const input = bytes(f), path = join(dir, 'fixture.json'); await writeFile(path, input);
    const script = fileURLToPath(new URL('../../scripts/inventory-dry-run.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--fixture', path], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).rejections.some(r => r.code === 'RELATION_MISSING'));
    assert.doesNotMatch(result.stdout + result.stderr, /privado@example|12345678900/);
    assert.deepEqual(await readFile(path), input);
    const bad = spawnSync(process.execPath, [script, '--google', 'secret'], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.doesNotMatch(bad.stderr, /secret/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});