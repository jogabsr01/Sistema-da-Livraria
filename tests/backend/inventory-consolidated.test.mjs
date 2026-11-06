import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../../scripts/inventory-sheet-metadata.mjs';
import { consolidateFixture } from '../../scripts/inventory-consolidated.mjs';

const schema = await loadSchema();
const fixture = () => ({ sheets: schema.map(table => ({ name: table.name, headers: [...table.columns], rows: [] })) });
const add = (fixture, name, values) => {
  const sheet = fixture.sheets.find(s => s.name === name);
  sheet.rows.push(sheet.headers.map(header => values[header] ?? null));
};
const run = value => consolidateFixture(Buffer.from(JSON.stringify(value)), schema);
function valid() {
  const value = fixture();
  add(value, 'Nichos', { ID_Nicho: 'n1', Nome: 'Livros' });
  add(value, 'Produtos', { ID_Produto: 'p1', ISBN: '9780140328721', Titulo: 'Exemplo', Preco_Venda: 500, Estoque_Atual: 2 });
  add(value, 'Produto_Nichos', { ID_Produto: 'p1', ID_Nicho: 'n1' });
  add(value, 'Clientes', { ID_Cliente: 'c1', CPF: '12345678900', Email: 'private@example.test', Whatsapp: '11999999999' });
  add(value, 'Vendas', { ID_Venda: 'v1', ID_Cliente: 'c1', Valor_Total: 500 });
  add(value, 'Itens_Venda', { ID_Venda: 'v1', ID_Produto: 'p1', Quantidade: 1, Preco_Unitario: 500, Subtotal: 500 });
  add(value, 'Movimentacoes_Estoque', { ID_Movimentacao: 'm1', ID_Produto: 'p1', ID_Venda: 'v1', Quantidade: 1, Saldo_Anterior: 3, Saldo_Posterior: 2 });
  return value;
}

test('consolidates seven sheets and invokes product validator without exposing input', () => {
  const report = run(valid());
  assert.equal(report.sheets.length, 7);
  assert.ok(report.sheets.every(sheet => sheet.passedPreliminaryChecks === 1 && sheet.pendingReview === 0));
  assert.equal(report.validator.validatorAccepted, true);
  assert.equal(report.validator.minimumReady, true);
  assert.equal(report.validator.fullMigrationReady, false);
  assert.doesNotMatch(JSON.stringify(report), /12345678900|private@example|11999999999|Exemplo|"p1"/);
});

test('flags dangling product and niche references and missing sales links without exposing identifiers', () => {
  const value = valid(); add(value, 'Produto_Nichos', { ID_Produto: 'missing-secret', ID_Nicho: 'bad-secret' });
  add(value, 'Itens_Venda', { ID_Venda: 'absent-secret', ID_Produto: 'missing-secret', Quantidade: 1, Preco_Unitario: 2, Subtotal: 2 });
  const report = run(value);
  assert.equal(report.relations.find(r => r.source === 'Produto_Nichos' && r.column === 'ID_Nicho').missing, 1);
  assert.equal(report.relations.find(r => r.source === 'Itens_Venda' && r.column === 'ID_Produto').missing, 1);
  assert.equal(report.sheets.find(s => s.sheet === 'Itens_Venda').pendingReview, 1);
  assert.equal(report.validator.minimumReady, false);
  assert.doesNotMatch(JSON.stringify(report), /missing-secret|bad-secret|absent-secret/);
});

test('duplicates, blank keys and ambiguous targets mark affected rows pending', () => {
  const value = valid(); add(value, 'Nichos', { ID_Nicho: 'n1', Nome: 'Outro' });
  add(value, 'Clientes', { Nome: 'private' });
  const report = run(value);
  assert.equal(report.keyProblems.find(k => k.sheet === 'Nichos').duplicateOccurrences, 1);
  assert.equal(report.sheets.find(s => s.sheet === 'Nichos').pendingReview, 2);
  assert.equal(report.relations.find(r => r.source === 'Produto_Nichos' && r.column === 'ID_Nicho').ambiguous, 1);
  assert.equal(report.keyProblems.find(k => k.sheet === 'Clientes').missingOrInvalid, 1);
  assert.equal(report.validator.minimumReady, false);
});

test('validator rejection and preliminary invalid cells are distinguished', () => {
  const value = valid();
  const product = value.sheets.find(s => s.name === 'Produtos');
  product.rows[0][product.headers.indexOf('ISBN')] = 'bad-isbn';
  let report = run(value);
  assert.equal(report.validator.validatorAccepted, false);
  assert.equal(report.validator.validatorCode, 'IMPORT_IDENTIFIER_INVALID');
  assert.equal(report.validator.minimumReady, false);
  product.rows[0][product.headers.indexOf('ISBN')] = '9780140328721';
  product.rows[0][product.headers.indexOf('Titulo')] = '=private';
  report = run(value);
  assert.equal(report.sheets.find(s => s.sheet === 'Produtos').pendingReview, 1);
  assert.equal(report.validator.minimumReady, false);
});

test('malformed metadata is rejected and CLI stays local and sanitizes failures', async () => {
  const value = valid(); value.sheets[0].headers[0] = 'secret-header';
  assert.throws(() => run(value));
  const dir = await mkdtemp(join(tmpdir(), 'consolidated-inventory-'));
  try {
    const path = join(dir, 'fixture.json'); await writeFile(path, JSON.stringify(valid()));
    const script = fileURLToPath(new URL('../../scripts/inventory-consolidated.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--fixture', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).validator.minimumReady, true);
    const invalid = spawnSync(process.execPath, [script, '--google-read-only', 'private-value'], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.doesNotMatch(invalid.stdout + invalid.stderr, /private-value/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});