import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeEmulatorImport } from '../../scripts/firestore-import-executor.mjs';
import { reconcileEmulatorImport } from '../../scripts/firestore-import-reconciler.mjs';
import { createFirestoreEmulatorDb } from '../helpers/firestore-emulator.mjs';
import { loadSchema } from '../../scripts/inventory-sheet-metadata.mjs';

test('executor fails closed before preflight without the exact execution flag', async () => {
  for (const args of [[], ['--execute-emulator-import', '--extra'], ['--execute-import']]) {
    assert.deepEqual(await executeEmulatorImport({ args, env: {} }), {
      status: 'BLOCKED', writePerformed: false, code: 'IMPORT_EXECUTION_FLAG_REQUIRED',
    });
  }
});

const host = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = typeof host === 'string' && /^127\.0\.0\.1:\d{1,5}$/.test(host) && Number(host.split(':')[1]) > 0 && Number(host.split(':')[1]) <= 65535;

test('official emulator imports, checkpoints, replays and reconciles a synthetic fixture', { skip: !enabled }, async t => {
  const db = createFirestoreEmulatorDb({ namespace: 'import', demo: true });
  const dir = await mkdtemp(join(tmpdir(), 'import-e2e-'));
  t.after(async () => { await db.terminate(); await rm(dir, { recursive: true, force: true }); });
  const backup = join(dir, 'backup'); await writeFile(backup, 'synthetic backup');
  const env = { IMPORT_PREFLIGHT_MODE: 'emulator', IMPORT_PREFLIGHT_PROJECT_ID: db.projectId,
    IMPORT_PREFLIGHT_EXPECTED_PROJECT_ID: db.projectId, IMPORT_PREFLIGHT_CONFIRM_EMULATOR: 'YES',
    FIRESTORE_EMULATOR_HOST: host, IMPORT_PREFLIGHT_BACKUP_PATH: backup,
    IMPORT_PREFLIGHT_BACKUP_SHA256: createHash('sha256').update('synthetic backup').digest('hex') };
  const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', product = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    niche = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', customer = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    sale = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', at = '2026-01-01T00:00:00.000Z';
  const schema = await loadSchema();
  const fixture = { sheets: schema.map(s => ({ name: s.name, headers: [...s.columns], rows: [] })),
    operationalOpeningStocks: { completeHistory: true, products: [{ id: product, stock: 5 }] } };
  const add = (name, row) => { const s = fixture.sheets.find(x => x.name === name); s.rows.push(s.headers.map(h => row[h] ?? null)); };
  add('Nichos', { ID_Nicho: niche, Nome: 'Livros', Cor_Destaque: '#abcdef', Ordem_Exibicao: 1, Ativo: true, Criado_Em: at });
  add('Produtos', { ID_Produto: product, ISBN: '9780140328721', Titulo: 'Livro atual', Preco_Venda: 300, Estoque_Atual: 3,
    Estoque_Minimo: 0, Ano_Publicacao: 0, Paginas: 0, Criado_Em: at, Versao_Registro: 2, Ativo: true });
  add('Produto_Nichos', { ID_Produto: product, ID_Nicho: niche });
  add('Clientes', { ID_Cliente: customer, CPF: '52998224725', Nome: 'Pessoa Teste', Preferencia_Contato: 'NONE', Consentimento_Marketing: false, Data_Cadastro: at });
  add('Vendas', { ID_Venda: 's1', Idempotency_Key: sale, ID_Cliente: customer, Status: 'CONFIRMADA', Valor_Total: 600, Data_Hora: at, Forma_Pagamento: 'PIX' });
  add('Itens_Venda', { ID_Venda: 's1', ID_Produto: product, Quantidade: 2, Preco_Unitario: 300, Subtotal: 600 });
  add('Movimentacoes_Estoque', { ID_Movimentacao: 'm1', Data_Hora: at, ID_Produto: product, Tipo: 'SAIDA', Quantidade: 2,
    Saldo_Anterior: 5, Saldo_Posterior: 3, ID_Venda: 's1', Motivo: 'VENDA' });
  const photo = Buffer.from('synthetic-photo');
  const context = { syntheticActorId: actor, vaultSettings: { config: { installationId: actor, environment: 'dev' },
    dataKey: Buffer.alloc(32, 1), indexKey: Buffer.alloc(32, 2) },
    media: { niches: [{ id: niche, value: null }], products: [{ id: product, value: {
      bytes: photo.toString('base64'), sha256: createHash('sha256').update(photo).digest('hex') } }] },
    historicalSales: [{ saleId: sale, items: [{ productId: product, title: 'Título histórico' }] }],
    movementCommandIds: [{ sourceId: 'm1', commandId: sale }] };
  const bytes = Buffer.from(JSON.stringify(fixture)), args = ['--execute-emulator-import'];
  const first = await executeEmulatorImport({ args, env, bytes, schema, context });
  assert.equal(first.status, 'COMPLETED', JSON.stringify(first));
  assert.equal(first.committedBatches, 5); assert.equal(first.writePerformed, true);
  const read = async path => (await db.doc(path).get()).data();
  const customerBefore = await read(`customers/${customer}`), mediaBefore = await read(`products/${product}/media/cover`);
  for (const domain of ['niches', 'products', 'customers', 'stockMovements', 'sales']) {
    const checkpoint = await read(`migrationRuns/${first.runId}/checkpoints/${domain}`);
    assert.equal(checkpoint.hashes.length, 1);
  }
  const second = await executeEmulatorImport({ args, env, bytes, schema, context });
  assert.equal(second.status, 'COMPLETED'); assert.equal(second.runId, first.runId);
  assert.equal(second.committedBatches, 0); assert.equal(second.writePerformed, false);
  assert.deepEqual(await read(`customers/${customer}`), customerBefore);
  assert.deepEqual(await read(`products/${product}/media/cover`), mediaBefore);
  const result = await reconcileEmulatorImport({ env, bytes, schema, context, destinationQuiescent: true });
  assert.deepEqual(result, { status: 'RECONCILED', divergences: [], writePerformed: false });
});

test('executor denies invalid targets and remains blocked even after a successful TCP preflight', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'import-executor-'));
  const server = createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const backup = join(dir, 'backup');
    await writeFile(backup, 'synthetic backup');
    const env = { IMPORT_PREFLIGHT_MODE: 'emulator', IMPORT_PREFLIGHT_PROJECT_ID: 'demo-import-test',
      IMPORT_PREFLIGHT_EXPECTED_PROJECT_ID: 'demo-import-test', IMPORT_PREFLIGHT_CONFIRM_EMULATOR: 'YES',
      FIRESTORE_EMULATOR_HOST: `127.0.0.1:${server.address().port}`, IMPORT_PREFLIGHT_BACKUP_PATH: backup,
      IMPORT_PREFLIGHT_BACKUP_SHA256: createHash('sha256').update('synthetic backup').digest('hex') };
    const args = ['--execute-emulator-import'];
    for (const change of [{ FIRESTORE_EMULATOR_HOST: 'localhost:8080' },
      { IMPORT_PREFLIGHT_PROJECT_ID: 'production-project' }, { GOOGLE_APPLICATION_CREDENTIALS: '/secret' },
      { IMPORT_PREFLIGHT_BACKUP_SHA256: '0'.repeat(64) }]) {
      assert.deepEqual(await executeEmulatorImport({ args, env: { ...env, ...change } }),
        { status: 'BLOCKED', writePerformed: false, code: 'IMPORT_PREFLIGHT_FAILED' });
    }
    assert.deepEqual(await executeEmulatorImport({ args, env }),
      { status: 'BLOCKED', writePerformed: false, code: 'IMPORT_DOCUMENT_CONTRACT_NOT_READY' });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});