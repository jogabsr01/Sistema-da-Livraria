import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../../scripts/inventory-sheet-metadata.mjs';
import { inspectAndPlanFixture } from '../../scripts/firestore-import-runner.mjs';

const schema = await loadSchema();
function fixture() {
  const f = { sheets: schema.map(t => ({ name: t.name, headers: [...t.columns], rows: [] })), operationalOpeningStocks: { completeHistory: true, products: [{ id: 'p1', stock: 5 }] } };
  const add = (name, values) => { const s = f.sheets.find(x => x.name === name); s.rows.push(s.headers.map(h => values[h] ?? null)); };
  add('Nichos', { ID_Nicho: 'n1', Nome: 'Livros' });
  add('Produtos', { ID_Produto: 'p1', ISBN: '9780140328721', Titulo: 'Teste', Preco_Venda: 300, Estoque_Atual: 3 });
  add('Produto_Nichos', { ID_Produto: 'p1', ID_Nicho: 'n1' });
  add('Clientes', { ID_Cliente: 'c1', CPF: '529.982.247-25', Nome: 'Pessoa Privada', Email: 'pessoa@example.test', Preferencia_Contato: 'EMAIL', Consentimento_Marketing: false });
  add('Vendas', { ID_Venda: 's1', Idempotency_Key: 'k1', ID_Cliente: 'c1', Status: 'CONFIRMADA', Valor_Total: 600 });
  add('Itens_Venda', { ID_Venda: 's1', ID_Produto: 'p1', Quantidade: 2, Preco_Unitario: 300, Subtotal: 600 });
  add('Movimentacoes_Estoque', { ID_Movimentacao: 'k1:p1', Data_Hora: '2026-01-01T00:00:01.000Z', ID_Produto: 'p1', Tipo: 'SAIDA', Quantidade: 2, Saldo_Anterior: 5, Saldo_Posterior: 3, ID_Venda: 's1' });
  return f;
}
const bytes = f => Buffer.from(JSON.stringify(f));

async function setup(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'runner-'));
  const server = createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const input = bytes(fixture()), path = join(dir, 'fixture.json'), backup = join(dir, 'backup');
    await writeFile(path, input); await writeFile(backup, 'backup-synthetic');
    const env = { IMPORT_PREFLIGHT_MODE: 'emulator', IMPORT_PREFLIGHT_PROJECT_ID: 'demo-livraria-test', IMPORT_PREFLIGHT_EXPECTED_PROJECT_ID: 'demo-livraria-test',
      IMPORT_PREFLIGHT_CONFIRM_EMULATOR: 'YES', FIRESTORE_EMULATOR_HOST: `127.0.0.1:${server.address().port}`,
      IMPORT_PREFLIGHT_BACKUP_PATH: backup, IMPORT_PREFLIGHT_BACKUP_SHA256: createHash('sha256').update('backup-synthetic').digest('hex') };
    await fn({ path, input, env });
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
}

test('plans deterministic domain checkpoints only after preflight, without writing or PII', async () => setup(async ({ path, env }) => {
  const first = await inspectAndPlanFixture(path, { env, batchSize: 1 });
  assert.deepEqual(first, await inspectAndPlanFixture(path, { env, batchSize: 1 }));
  assert.deepEqual(first.domains.map(d => d.domain), ['niches', 'products', 'customers', 'stock', 'sales']);
  assert.ok(first.domains.every(d => d.batches.length === 1 && d.batches[0].count === 1 && d.audit.persistence === 'NONE'));
  assert.equal(first.writePerformed, false);
  assert.doesNotMatch(JSON.stringify(first), /529|Pessoa Privada|pessoa@example/);
  assert.notEqual(first.runId, (await inspectAndPlanFixture(path, { env, batchSize: 2 })).runId);
  assert.equal(first.preflight.simulationAuthorized, false);
}));

test('rejects bad batch limits and invalid fixtures with no checkpoint claims', async () => setup(async ({ path, env }) => {
  const f = fixture();
  for (const batchSize of [0, 101, 1.5]) await assert.rejects(inspectAndPlanFixture(path, { env, batchSize }), /IMPORT_PLAN_BATCH_INVALID/);
  delete f.operationalOpeningStocks;
  await writeFile(path, bytes(f));
  const result = await inspectAndPlanFixture(path, { env });
  assert.equal(result.status, 'VALIDATION_REJECTED'); assert.equal(result.writePerformed, false);
  assert.equal(result.domains, undefined);
}));

test('flag and credentials cannot unlock write mode; CLI planning preserves fixture', async () => setup(async ({ path, input, env }) => {
    const script = fileURLToPath(new URL('../../scripts/firestore-import-runner.mjs', import.meta.url));
    const run = args => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, ...args], { env }); let stdout = '', stderr = '';
      child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
      child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    });
    const result = await run(['--fixture', path]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).writePerformed, false);
    const blocked = await run(['--fixture', path, '--target-dev-project', 'private-project']);
    assert.equal(blocked.code, 2); assert.doesNotMatch(blocked.stderr + blocked.stdout, /private-project|secret/);
    assert.deepEqual(await readFile(path), input);
}));

test('preflight rejects unsafe environment before reading fixture or producing plan', async () => setup(async ({ path, env }) => {
  for (const change of [
    { IMPORT_PREFLIGHT_PROJECT_ID: 'production-project' },
    { IMPORT_PREFLIGHT_BACKUP_SHA256: '0'.repeat(64) },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' },
    { GOOGLE_APPLICATION_CREDENTIALS: '/secret' },
  ]) await assert.rejects(inspectAndPlanFixture(path, { env: { ...env, ...change } }));
  await assert.rejects(inspectAndPlanFixture('/nonexistent-fixture', { env: { ...env, IMPORT_PREFLIGHT_MODE: 'dev' } }), /PREFLIGHT_TARGET_DENIED/);
}));