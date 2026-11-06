import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSchema } from '../../scripts/inventory-sheet-metadata.mjs';
import { validateMappedOperationalFixture, projectOperationalFixture } from '../../scripts/inventory-operational-mapper.mjs';
import { dryRunFixture } from '../../scripts/inventory-dry-run.mjs';

const schema = await loadSchema();
const add = (f, name, values) => { const sheet = f.sheets.find(s => s.name === name); sheet.rows.push(sheet.headers.map(h => values[h] ?? null)); };
const bytes = f => Buffer.from(JSON.stringify(f));
function valid() {
  const f = { sheets: schema.map(t => ({ name: t.name, headers: [...t.columns], rows: [] })), operationalOpeningStocks: { completeHistory: true, products: [{ id: 'p1', stock: 5 }] } };
  add(f, 'Nichos', { ID_Nicho: 'n1', Nome: 'Livros' });
  add(f, 'Produtos', { ID_Produto: 'p1', ISBN: '9780140328721', Titulo: 'Livro', Preco_Venda: 300, Estoque_Atual: 3 });
  add(f, 'Produto_Nichos', { ID_Produto: 'p1', ID_Nicho: 'n1' });
  add(f, 'Clientes', { ID_Cliente: 'c1', CPF: '529.982.247-25', Nome: 'Pessoa Privada', Email: 'pessoa@example.test', Whatsapp: '11999999999', Preferencia_Contato: 'EMAIL', Consentimento_Marketing: true, Data_Consentimento: '2026-01-01T00:00:00.000Z' });
  add(f, 'Vendas', { ID_Venda: 's1', Idempotency_Key: 'k1', ID_Cliente: 'c1', Status: 'CONFIRMADA', Valor_Total: 600 });
  add(f, 'Itens_Venda', { ID_Venda: 's1', ID_Produto: 'p1', Quantidade: 2, Preco_Unitario: 300, Subtotal: 600 });
  add(f, 'Movimentacoes_Estoque', { ID_Movimentacao: 'k1:p1', Data_Hora: '2026-01-01T00:00:01.000Z', ID_Produto: 'p1', Tipo: 'SAIDA', Quantidade: 2, Saldo_Anterior: 5, Saldo_Posterior: 3, ID_Venda: 's1' });
  return f;
}
const set = (f, sheet, column, value) => { const s = f.sheets.find(x => x.name === sheet); s.rows[0][s.headers.indexOf(column)] = value; };

test('maps distinct sale and idempotency keys, uses explicit opening and returns only counts', () => {
  const f = valid(), before = structuredClone(f), result = validateMappedOperationalFixture(bytes(f), schema);
  assert.deepEqual(f, before); assert.equal(result.writePerformed, false); assert.equal(result.sales, 1);
  assert.doesNotMatch(JSON.stringify(result), /529|Pessoa|pessoa@example|119999/);
  const report = dryRunFixture(bytes(f), schema, { operational: true });
  assert.equal(report.operationalValidation.status, 'ACCEPTED');
  assert.equal(report.operationalValidation.writePerformed, false);
  assert.doesNotMatch(JSON.stringify(report), /529|Pessoa|pessoa@example|119999/);
});

test('rejects absent or inconsistent opening evidence without inferring from first movement', () => {
  let f = valid(); delete f.operationalOpeningStocks;
  assert.throws(() => validateMappedOperationalFixture(bytes(f), schema), /MAPPING_OPENING_EVIDENCE_REQUIRED/);
  f = valid(); f.operationalOpeningStocks.products[0].stock = 4;
  assert.throws(() => validateMappedOperationalFixture(bytes(f), schema), /OPERATIONAL_STOCK_CHAIN_INVALID/);
  f = valid(); f.operationalOpeningStocks.products.push({ id: 'p1', stock: 5 });
  assert.throws(() => validateMappedOperationalFixture(bytes(f), schema), /MAPPING_OPENING_EVIDENCE_INVALID/);
});

test('fails closed for absent idempotency, unsupported status and orphan items', () => {
  for (const [sheet, column, value, code] of [['Vendas', 'Idempotency_Key', '', 'MAPPING_SALE_UNSUPPORTED'], ['Vendas', 'Status', 'ESTORNADA', 'MAPPING_SALE_UNSUPPORTED'], ['Itens_Venda', 'ID_Venda', 'orphan', 'MAPPING_ORPHAN_ITEM']]) {
    const f = valid(); set(f, sheet, column, value);
    assert.throws(() => validateMappedOperationalFixture(bytes(f), schema), new RegExp(code));
  }
});

test('rejects ambiguous timestamp ties and bad dates rather than choosing an ordering', () => {
  let f = valid(); set(f, 'Movimentacoes_Estoque', 'Data_Hora', 'invalid');
  assert.throws(() => validateMappedOperationalFixture(bytes(f), schema), /MAPPING_MOVEMENT_TIME_INVALID/);
  f = valid(); add(f, 'Movimentacoes_Estoque', { ID_Movimentacao: 'm2', Data_Hora: '2026-01-01T00:00:01.000Z', ID_Produto: 'p1', Tipo: 'ENTRADA', Quantidade: 1, Saldo_Anterior: 3, Saldo_Posterior: 4 });
  assert.throws(() => validateMappedOperationalFixture(bytes(f), schema), /MAPPING_MOVEMENT_ORDER_AMBIGUOUS/);
});

test('dry run keeps catalog result and sanitized operational rejection when CPF is unusable', () => {
  const f = valid(); set(f, 'Clientes', 'CPF', 'private-secret');
  const report = dryRunFixture(bytes(f), schema, { operational: true });
  assert.equal(report.validator.validatorAccepted, true);
  assert.equal(report.operationalValidation.status, 'REJECTED');
  assert.equal(report.operationalValidation.code, 'OPERATIONAL_CUSTOMERS_INVALID');
  assert.doesNotMatch(JSON.stringify(report), /private-secret|pessoa@example/);
});

test('detailed projection requires explicit UUIDs and exposes synthetic provenance only in memory', () => {
  const f = valid(), actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', product = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    niche = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', customer = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sale = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  assert.throws(() => projectOperationalFixture(bytes(f), schema, { syntheticActorId: actor, allowSyntheticActor: true }), /MAPPING_UUID_REQUIRED/);
  set(f, 'Produtos', 'ID_Produto', product); f.operationalOpeningStocks.products[0].id = product;
  set(f, 'Nichos', 'ID_Nicho', niche); set(f, 'Produto_Nichos', 'ID_Produto', product); set(f, 'Produto_Nichos', 'ID_Nicho', niche);
  set(f, 'Clientes', 'ID_Cliente', customer); set(f, 'Vendas', 'ID_Cliente', customer); set(f, 'Vendas', 'Idempotency_Key', sale);
  set(f, 'Itens_Venda', 'ID_Produto', product); set(f, 'Movimentacoes_Estoque', 'ID_Produto', product);
  assert.throws(() => projectOperationalFixture(bytes(f), schema, { syntheticActorId: actor, allowSyntheticActor: true }), /MAPPING_PRODUCT_VERSION_CONFLICT/);
  set(f, 'Produtos', 'Versao_Registro', 2);
  const result = projectOperationalFixture(bytes(f), schema, { syntheticActorId: actor, allowSyntheticActor: true });
  assert.equal(result.sales[0].id, sale); assert.equal(result.movements[0].saleId, sale);
  assert.equal(result.movements[0].versionBefore, 1); assert.equal(result.movements[0].versionAfter, 2);
  assert.equal(result.products[0].metadata.provenance.actor, 'SYNTHETIC_MIGRATION_ACTOR');
  assert.equal(result.sales[0].metadata.provenance.version, 'NEW_DOCUMENT_INITIAL_VERSION');
  assert.equal(result.writePerformed, false);
  assert.throws(() => projectOperationalFixture(bytes(f), schema, { syntheticActorId: actor }), /IMPORT_CONTEXT_INVALID/);
});