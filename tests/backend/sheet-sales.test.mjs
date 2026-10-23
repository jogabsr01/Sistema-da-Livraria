import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createGasEmulator } from './gas-emulator.mjs';
import { properties } from './fixtures.mjs';
import { createSaleService } from '../../backend/sale-command.mjs';

// Node command + GAS projections in a contract double. Not live Google IO.
async function setup(quantity = 1) {
  const gas = createGasEmulator(properties), installation = gas.call('provisionDevelopment');
  const ss = gas.sheets.get(installation.spreadsheetId);
  const productId = randomUUID(), actor = { id: randomUUID(), role: 'ATENDENTE' };
  const products = ss.getSheetByName('Produtos');
  const columns = products.rows[0];
  const fields = { ID_Produto: productId, Titulo: 'Livro de teste descartável', Preco_Venda: 2500,
    Estoque_Atual: quantity, Versao_Registro: 0, Ativo: true };
  products.appendRow(columns.map(column => fields[column] ?? ''));
  const journal = ss.getSheetByName('_Eventos_Dominio');
  const command = { idempotencyKey: randomUUID(), items: [{ productId, quantity: 1 }] };
  let recorded;
  await createSaleService({
    withLock: fn => fn(), recoverPending: async () => {}, findEvent: async () => null,
    getProduct: async () => ({ stock: quantity, priceCents: 2500, version: 0, active: true }),
    appendEvent: async event => { recorded = event; },
  }).execute(command, actor);
  function append(event = recorded) {
    journal.appendRow([event.idempotencyKey, event.type, event.idempotencyKey, event.commandHash,
      JSON.stringify(event), 'PENDENTE', event.receipt.createdAt, 1]);
  }
  function stock() { return { stock: products.rows[1][columns.indexOf('Estoque_Atual')], version: products.rows[1][columns.indexOf('Versao_Registro')] }; }
  function count(name) { return ss.getSheetByName(name).getLastRow() - 1; }
  return { gas, ss, products, columns, journal, recorded, append, stock, count };
}

test('GAS journal projects sale, items, movement and stock once across repeated recovery', async () => {
  const s = await setup(); s.append();
  s.gas.call('recoverDevelopmentSales'); s.gas.call('recoverDevelopmentSales');
  assert.deepEqual(s.stock(), { stock: 0, version: 1 });
  for (const name of ['Vendas', 'Itens_Venda', 'Movimentacoes_Estoque']) assert.equal(s.count(name), 1);
  assert.equal(s.count('_Eventos_Dominio'), 1);
  assert.equal(s.ss.getSheetByName('Vendas').rows[1][4], 2500);
  assert.equal(s.ss.getSheetByName('Vendas').rows[1][2], '', 'no customer data is introduced');
});

test('GAS recovery tolerates interruption before/after every sale projection and product row write', async () => {
  for (const name of ['Vendas', 'Itens_Venda', 'Movimentacoes_Estoque', 'Produtos']) {
    for (const after of [false, true]) {
      const s = await setup(); s.append(); const sheet = s.ss.getSheetByName(name);
      if (name === 'Produtos') {
        const original = sheet.getRange.bind(sheet);
        let once = true;
        sheet.getRange = (...args) => {
          const range = original(...args), set = range.setValues;
          range.setValues = values => {
            if (!once) return set(values);
            once = false; if (after) set(values); throw Error('INJECTED_WRITE_FAILURE');
          }; return range;
        };
      } else {
        const original = sheet.appendRow.bind(sheet); let once = true;
        sheet.appendRow = values => {
          if (!once) return original(values);
          once = false; if (after) original(values); throw Error('INJECTED_WRITE_FAILURE');
        };
      }
      assert.throws(() => s.gas.call('recoverDevelopmentSales'), /INJECTED_WRITE_FAILURE/);
      s.gas.call('recoverDevelopmentSales'); s.gas.call('recoverDevelopmentSales');
      assert.deepEqual(s.stock(), { stock: 0, version: 1 }, name + ' after=' + after);
      for (const table of ['Vendas', 'Itens_Venda', 'Movimentacoes_Estoque']) assert.equal(s.count(table), 1);
    }
  }
});

test('GAS rejects corrupted journal and duplicated IDs before projection writes', async () => {
  for (const kind of ['hash', 'total', 'negative-stock', 'version', 'duplicate', 'unknown-event']) {
    const s = await setup();
    if (kind === 'hash') s.recorded.commandHash = '0'.repeat(64);
    if (kind === 'total') s.recorded.receipt.totalCents++;
    if (kind === 'negative-stock') s.recorded.lines[0].stockAfter = -1;
    if (kind === 'version') s.recorded.lines[0].expectedVersion = 99;
    s.append();
    if (kind === 'duplicate') s.append();
    if (kind === 'unknown-event') s.journal.rows[1][1] = 'UNKNOWN';
    const writes = s.gas.writes;
    assert.throws(() => s.gas.call('recoverDevelopmentSales'), /JOURNAL_INVALID|PROJECTION_CONFLICT/);
    assert.equal(s.gas.writes, writes, kind);
  }
});

test('GAS refuses conflicting projections or unrecognized stock checkpoints before writes', async () => {
  for (const kind of ['sale', 'stock', 'checkpoint']) {
    const s = await setup(); s.append();
    if (kind === 'sale') {
      const table = s.ss.getSheetByName('Vendas');
      table.appendRow(table.rows[0].map(column => column === 'ID_Venda' ? s.recorded.idempotencyKey : 'conflicting-test-value'));
    }
    if (kind === 'stock') s.products.rows[1][s.columns.indexOf('Estoque_Atual')] = 30;
    if (kind === 'checkpoint') s.products.rows[1][s.columns.indexOf('Versao_Registro')] = 50;
    const writes = s.gas.writes;
    assert.throws(() => s.gas.call('recoverDevelopmentSales'), /PROJECTION_CONFLICT/);
    assert.equal(s.gas.writes, writes);
  }
});

test('GAS checks all journal events before writing earlier valid sales', async () => {
  const s = await setup(); s.append(); s.journal.appendRow(['malformed', 'SALE_COMMITTED']);
  const writes = s.gas.writes;
  assert.throws(() => s.gas.call('recoverDevelopmentSales'), /JOURNAL_INVALID/);
  assert.equal(s.gas.writes, writes); assert.equal(s.count('Vendas'), 0);
});

test('GAS owner recovery refuses PROD, wrong owner, public resources and occupied lock', async () => {
  for (const kind of ['prod', 'owner', 'public', 'lock']) {
    const s = await setup(); s.append();
    if (kind === 'prod') s.gas.props.APP_ENV = 'prod';
    if (kind === 'owner') s.gas.owner = 'unverified@example.invalid';
    if (kind === 'public') s.gas.resources.get(s.gas.props.DRIVE_ROOT_ID).sharing = 'public';
    if (kind === 'lock') s.gas.locked = true;
    const writes = s.gas.writes;
    assert.throws(() => s.gas.call('recoverDevelopmentSales'), /FORBIDDEN|BINDING_MISMATCH|BUSY/);
    assert.equal(s.gas.writes, writes);
  }
});

 test('GAS preserves chain checkpoints when replaying two sales already partially projected', async () => {
  const s = await setup(2); s.append(); s.gas.call('recoverDevelopmentSales');
  const second = structuredClone(s.recorded);
  second.idempotencyKey = randomUUID(); second.receipt.saleId = second.idempotencyKey;
  second.lines[0].expectedVersion = 1; second.lines[0].stockAfter = 0;
  second.commandHash = createHash('sha256').update(JSON.stringify({ idempotencyKey: second.idempotencyKey,
    items: [{ productId: second.lines[0].productId, quantity: 1 }] })).digest('hex');
  s.append(second); s.gas.call('recoverDevelopmentSales'); s.gas.call('recoverDevelopmentSales');
  assert.deepEqual(s.stock(), { stock: 0, version: 2 });
  for (const name of ['Vendas', 'Itens_Venda', 'Movimentacoes_Estoque']) assert.equal(s.count(name), 2);
});
