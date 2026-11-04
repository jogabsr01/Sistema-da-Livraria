import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadSchema } from '../../scripts/inventory-sheet-metadata.mjs';
import { validateFirestoreBundle } from '../../backend/firestore-bundle-validator.mjs';

const schema = await loadSchema();
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', product = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  niche = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', customer = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  sale = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', time = '2026-01-01T00:00:00.000Z';

function fixture() {
  const f = { sheets: schema.map(t => ({ name: t.name, headers: [...t.columns], rows: [] })),
    operationalOpeningStocks: { completeHistory: true, products: [{ id: product, stock: 5 }] } };
  const add = (name, values) => { const s = f.sheets.find(x => x.name === name); s.rows.push(s.headers.map(h => values[h] ?? null)); };
  add('Nichos', { ID_Nicho: niche, Nome: 'Livros', Cor_Destaque: '#abcdef', Ordem_Exibicao: 1, Ativo: true, Criado_Em: time });
  add('Produtos', { ID_Produto: product, ISBN: '9780140328721', Titulo: 'Título atual', Preco_Venda: 300, Estoque_Atual: 3,
    Estoque_Minimo: 0, Ano_Publicacao: 0, Paginas: 0, Criado_Em: time, Versao_Registro: 2, Ativo: true });
  add('Produto_Nichos', { ID_Produto: product, ID_Nicho: niche });
  add('Clientes', { ID_Cliente: customer, CPF: '52998224725', Nome: 'Pessoa Teste', Preferencia_Contato: 'NONE',
    Consentimento_Marketing: false, Data_Cadastro: time });
  add('Vendas', { ID_Venda: 's1', Idempotency_Key: sale, ID_Cliente: customer, Status: 'CONFIRMADA', Valor_Total: 600,
    Data_Hora: time, Forma_Pagamento: 'PIX' });
  add('Itens_Venda', { ID_Venda: 's1', ID_Produto: product, Quantidade: 2, Preco_Unitario: 300, Subtotal: 600 });
  add('Movimentacoes_Estoque', { ID_Movimentacao: 'm1', Data_Hora: time, ID_Produto: product, Tipo: 'SAIDA',
    Quantidade: 2, Saldo_Anterior: 5, Saldo_Posterior: 3, ID_Venda: 's1', Motivo: 'VENDA' });
  return f;
}
function context() {
  const bytes = Buffer.from('synthetic-photo');
  return { syntheticActorId: actor, vaultSettings: { config: { installationId: actor, environment: 'dev' },
    dataKey: Buffer.alloc(32, 1), indexKey: Buffer.alloc(32, 2) },
    media: { niches: [{ id: niche, value: null }], products: [{ id: product,
      value: { bytes: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') } }] },
    historicalSales: [{ saleId: sale, items: [{ productId: product, title: 'Título histórico' }] }],
    movementCommandIds: [{ sourceId: 'm1', commandId: sale }] };
}
const bundle = (f, c) => validateFirestoreBundle(Buffer.from(JSON.stringify(f)), schema, c);

test('builds complete synthetic document groups from source and frozen titles', () => {
  const result = bundle(fixture(), context());
  assert.equal(result.writePerformed, false);
  const docs = Object.values(result.domains).flatMap(groups => groups.flatMap(group => group.documents));
  for (const path of [`niches/${niche}`, `products/${product}`, `products/${product}/media/cover`, `productSearch/${product}`,
    `customers/${customer}`, `stockMovements/${sale}:${product}`, `sales/${sale}`, `sales/${sale}/items/${product}`]) {
    assert.ok(docs.some(doc => doc.path === path), path);
  }
  assert.equal(docs.find(doc => doc.path === `sales/${sale}/items/${product}`).data.title, 'Título histórico');
  assert.equal(docs.filter(doc => doc.path.startsWith('uniqueness/')).length, 3);
});

test('rejects missing historical snapshots, corrupt media and invalid dates without leaking data', () => {
  const cases = [() => { const c = context(); c.historicalSales = []; return [fixture(), c]; },
    () => { const c = context(); c.media.products[0].value.sha256 = '0'.repeat(64); return [fixture(), c]; },
    () => { const f = fixture(), s = f.sheets.find(x => x.name === 'Clientes'); s.rows[0][s.headers.indexOf('Data_Cadastro')] = 'private-invalid-date'; return [f, context()]; }];
  for (const make of cases) assert.throws(() => bundle(...make()), { message: 'FIRESTORE_BUNDLE_INVALID' });
});

test('rejects duplicate paths, missing explicit media and inconsistent movement identifiers', () => {
  const c1 = context(); c1.media.niches = [];
  const c2 = context(); c2.movementCommandIds[0].commandId = actor;
  const c3 = context(); c3.media.products.push(c3.media.products[0]);
  for (const c of [c1, c2, c3]) assert.throws(() => bundle(fixture(), c), { message: 'FIRESTORE_BUNDLE_INVALID' });
});