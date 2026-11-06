import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { catalogFixture, injectCatalogFault } from '../helpers/catalog-fixture.mjs';
import { normalizeStockReceipt } from '../../backend/stock-command.mjs';
import sharp from 'sharp';

async function setup() {
  const s = catalogFixture(), attendant = s.session(), admin = s.session('ADMIN'), owner = s.session('SUPER_ADMIN'), created = s.command();
  s.env.WORKSPACE_CHECKOUT_ENABLED = 'true'; s.gas.props.CHECKOUT_ENABLED = 'true';
  await s.client.catalog('save', attendant.actor, created);
  const get = async () => (await s.client.catalog('get', attendant.actor, { id: created.id })).product;
  const stockCommand = async (quantity = 1, extra = {}) => ({ commandId: randomUUID(), id: created.id, expectedVersion: (await get()).version, quantity, reason: 'REPOSICAO', ...extra });
  const receive = async (quantity = 1, actor = attendant) => s.client.catalog('receive', actor.actor, await stockCommand(quantity));
  const edit = async (record = {}, actor = attendant) => s.client.catalog('save', actor.actor, { ...created, commandId: randomUUID(), expectedVersion: (await get()).version, record: { ...created.record, ...record } });
  const sell = async (quantity = 1) => {
    const p = await get(); return s.client.checkout(attendant.actor, { idempotencyKey: randomUUID(), items: [{ productId: created.id, quantity }], paymentMethod: 'PIX', customerId: null, expectedTotalCents: p.priceCents * quantity });
  };
  return { ...s, attendant, admin, owner, created, get, stockCommand, receive, edit, sell, count: name => s.main.getSheetByName(name).getLastRow() - 1 };
}

test('sell out, edit, replenish the same product and sell again without losing metadata, stock or history', async () => {
  const s = await setup(); await s.receive(2); await s.sell(2);
  assert.equal((await s.get()).stock, 0); assert.equal((await s.get()).active, true);
  await assert.rejects(s.sell(), { code: 'WORKSPACE_INSUFFICIENT_STOCK' });
  await s.edit({ title: 'Livro atualizado esgotado', priceCents: 4500 });
  assert.equal((await s.get()).title, 'Livro atualizado esgotado');
  await s.receive(3); const receipt = await s.sell(); assert.equal(receipt.totalCents, 4500);
  const current = await s.get(); assert.equal(current.id, s.created.id); assert.equal(current.stock, 2); assert.equal(current.version, 6); assert.equal(current.title, 'Livro atualizado esgotado');
  for (let i = 0; i < 3; i++) { s.gas.call('recoverDevelopmentSales'); assert.deepEqual(await s.get(), current); }
  assert.equal(s.count('Produtos'), 1); assert.equal(s.count('Vendas'), 2); assert.equal(s.count('Movimentacoes_Estoque'), 4);
});

test('stock receipt is idempotent even after later metadata edits and refuses changed content or operator', async () => {
  const s = await setup(), command = await s.stockCommand(3), receipt = await s.client.catalog('receive', s.attendant.actor, command);
  await s.edit({ title: 'Metadados posteriores à entrada' });
  assert.deepEqual(await s.client.catalog('receive', s.attendant.actor, command), receipt);
  for (const patch of [{ quantity: 4 }, { reason: 'OUTRO_MOTIVO' }]) await assert.rejects(s.client.catalog('receive', s.attendant.actor, { ...command, ...patch }), { code: 'WORKSPACE_IDEMPOTENCY_CONFLICT' });
  await assert.rejects(s.client.catalog('receive', s.admin.actor, command), { code: 'WORKSPACE_IDEMPOTENCY_CONFLICT' });
  assert.equal((await s.get()).stock, 3); assert.equal(s.count('Movimentacoes_Estoque'), 1);
});

test('two sessions receiving against the same version cannot overwrite one another', async () => {
  const s = await setup(), a = await s.stockCommand(2), b = await s.stockCommand(5);
  const results = await Promise.allSettled([s.client.catalog('receive', s.attendant.actor, a), s.client.catalog('receive', s.admin.actor, b)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'WORKSPACE_CATALOG_CONFLICT');
  assert.ok([2, 5].includes((await s.get()).stock)); assert.equal(s.count('Movimentacoes_Estoque'), 1);
});

test('stock failures before/after journal, movement, audit and stock writes recover one positive entry', async () => {
  for (const name of ['_Eventos_Dominio', 'Movimentacoes_Estoque', 'Logs_Auditoria', 'Produtos']) for (const after of [false, true]) {
    const s = await setup(), command = await s.stockCommand(4), sheet = s.main.getSheetByName(name); let once = true;
    if (name === 'Produtos') {
      const get = sheet.getRange.bind(sheet); sheet.getRange = (...args) => { const range = get(...args), set = range.setValues; range.setValues = values => {
        if (!once) return set(values); once = false; if (after) set(values); throw Error('INJECTED_RECEIPT_FAILURE');
      }; return range; };
    } else {
      const append = sheet.appendRow.bind(sheet); sheet.appendRow = values => { if (!once) return append(values); once = false; if (after) append(values); throw Error('INJECTED_RECEIPT_FAILURE'); };
    }
    await assert.rejects(s.client.catalog('receive', s.attendant.actor, command));
    const result = await s.client.catalog('receive', s.attendant.actor, command); assert.equal(result.stockAfter, 4);
    assert.deepEqual(await s.client.catalog('receive', s.attendant.actor, command), result);
    assert.equal((await s.get()).stock, 4); assert.equal(s.count('Movimentacoes_Estoque'), 1); assert.equal(s.count('Logs_Auditoria'), 2);
  }
});

test('interrupted metadata after a sale is recovered before a new receipt, preserving title, price and stock', async () => {
  for (const stage of ['intent', 'product', 'audit', 'marker']) for (const after of [false, true]) {
    const s = await setup(); await s.receive(1); await s.sell();
    const command = { ...s.created, commandId: randomUUID(), expectedVersion: 3, record: { ...s.created.record, title: 'Esgotado editado', priceCents: 1990 } };
    injectCatalogFault(s, stage, after); await assert.rejects(s.client.catalog('save', s.attendant.actor, command));
    await s.client.catalog('save', s.attendant.actor, command); await s.receive(2); await s.sell();
    const product = await s.get(); assert.equal(product.stock, 1); assert.equal(product.title, 'Esgotado editado'); assert.equal(product.priceCents, 1990); assert.equal(product.version, 6);
  }
});

test('only ADMIN/SUPER_ADMIN can logically exclude or toggle activity, including forged save requests', async () => {
  for (const role of ['ADMIN', 'SUPER_ADMIN']) {
    const s = await setup(); await s.receive(1); await s.sell();
    const command = { commandId: randomUUID(), id: s.created.id, expectedVersion: 3 };
    assert.equal((await s.http(s.attendant, 'remove', command)).status, 403);
    await assert.rejects(s.client.catalog('remove', s.attendant.actor, command), { code: 'WORKSPACE_FORBIDDEN' });
    assert.equal((await s.http(s.attendant, 'save', { ...s.created, commandId: randomUUID(), expectedVersion: 3, record: { ...s.created.record, active: false } })).status, 403);
    const actor = role === 'ADMIN' ? s.admin : s.owner;
    assert.equal((await s.http(actor, 'remove', command)).status, 200);
    assert.deepEqual(await s.client.catalog('remove', actor.actor, command), { id: s.created.id, version: 4 });
    const product = await s.get(); assert.equal(product.active, false); assert.equal(product.stock, 0); assert.equal(s.count('Produtos'), 1); assert.equal(s.count('Vendas'), 1);
    const query = { search: '', offset: 0, nicheId: '', includeInactive: false };
    assert.equal((await s.client.catalog('list', actor.actor, query)).total, 0);
    assert.equal((await s.client.catalog('list', actor.actor, { ...query, includeInactive: true })).total, 1);
    await assert.rejects(s.edit({ active: true }), { code: 'WORKSPACE_FORBIDDEN' });
    await s.edit({ active: true }, actor); await s.receive(2); assert.equal((await s.get()).stock, 2);
  }
});

test('zero/negative/fractional receipts, extra fields, formula reason and overflow are rejected without stock changes', async () => {
  const s = await setup(), command = await s.stockCommand();
  for (const quantity of [0, -1, 1.2, '2', 1000001]) {
    const value = { ...command, quantity }; assert.throws(() => normalizeStockReceipt(value), { code: 'INVALID_STOCK_RECEIPT' });
    assert.equal((await s.http(s.attendant, 'receive', value)).status, 400);
  }
  for (const patch of [{ stock: 999 }, { role: 'ADMIN' }, { reason: '=IMPORTXML("test")' }, { reason: '' }]) assert.equal((await s.http(s.attendant, 'receive', { ...command, ...patch })).status, 400);
  await s.receive(1000000); await assert.rejects(s.receive(), { code: 'WORKSPACE_STOCK_LIMIT' });
  assert.equal((await s.get()).stock, 1000000); assert.equal(s.count('Movimentacoes_Estoque'), 1);
});

test('receipt and removal require same-origin CSRF and a still-valid authoritative session', async () => {
  const s = await setup(), command = await s.stockCommand();
  for (const headers of [{ 'x-csrf-token': 'bad' }, { origin: 'https://evil.example' }, { 'content-type': 'text/plain' }]) assert.equal((await s.http(s.attendant, 'receive', command, headers)).status, 403);
  assert.equal((await s.http(s.admin, 'remove', { commandId: randomUUID(), id: s.created.id, expectedVersion: 1 }, { 'x-csrf-token': 'bad' })).status, 403);
  await s.client.revokeSession(s.attendant.tokenHash);
  await assert.rejects(s.client.catalog('receive', s.attendant.actor, command), { code: 'UNAUTHENTICATED' });
  assert.equal(s.count('_Eventos_Dominio'), 0);
});

test('inventory/catalog command ID collisions fail before appending an unrecoverable intent', async () => {
  const s = await setup();
  await assert.rejects(s.client.catalog('receive', s.attendant.actor, await s.stockCommand(1, { commandId: s.created.commandId })), { code: 'WORKSPACE_IDEMPOTENCY_CONFLICT' });
  const command = await s.stockCommand(2); await s.client.catalog('receive', s.attendant.actor, command);
  await assert.rejects(s.client.catalog('save', s.attendant.actor, { ...s.created, commandId: command.commandId, expectedVersion: 2 }), { code: 'WORKSPACE_CATALOG_CONFLICT' });
  assert.equal(s.journal.getLastRow(), 2); assert.equal((await s.get()).stock, 2);
});

test('metadata checkpoints cannot fabricate a version gap, different stock, or roll back a completed edit', async () => {
  for (const kind of ['gap', 'stock', 'rollback', 'snapshot']) {
    const s = await setup(); await s.receive(2); await s.sell(); await s.edit({ title: 'Título protegido' });
    const products = s.main.getSheetByName('Produtos'), columns = products.rows[0];
    if (kind === 'gap') products.rows[1][columns.indexOf('Versao_Registro')] = 50;
    if (kind === 'stock') products.rows[1][columns.indexOf('Estoque_Atual')] = 50;
    if (kind === 'rollback') products.rows[1][columns.indexOf('Titulo')] = 'Título antigo';
    if (kind === 'snapshot') {
      const table = s.journal, headers = table.rows[0], row = table.rows.at(-1), after = JSON.parse(row[headers.indexOf('After_JSON')]);
      after.values[columns.indexOf('Estoque_Atual')]++;
      row[headers.indexOf('After_JSON')] = JSON.stringify(after);
    }
    const writes = s.gas.writes;
    assert.throws(() => s.gas.call('recoverDevelopmentSales'), /PROJECTION_CONFLICT|CATALOG_UNAVAILABLE/);
    assert.equal(s.gas.writes, writes, kind);
  }
});

test('stale catalog edit cannot erase a receipt and restock never reactivates an excluded book', async () => {
  const s = await setup(); await s.receive(2);
  await assert.rejects(s.client.catalog('save', s.attendant.actor, { ...s.created, commandId: randomUUID(), expectedVersion: 1 }), { code: 'WORKSPACE_CATALOG_CONFLICT' });
  await s.client.catalog('remove', s.admin.actor, { commandId: randomUUID(), id: s.created.id, expectedVersion: 2 });
  await assert.rejects(s.receive(), { code: 'WORKSPACE_PRODUCT_UNAVAILABLE' });
  assert.equal((await s.get()).stock, 2); assert.equal((await s.get()).active, false);
});

test('private cover edits after a sale remain private and survive later stock replay', async () => {
  const s = await setup(); s.settings.photosEnabled = true; s.gas.props.COVER_PHOTOS_ENABLED = 'true';
  await s.receive(1); await s.sell();
  const bytes = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#23794c' } }).png().toBuffer();
  assert.equal((await s.http(s.attendant, 'save', { ...s.created, commandId: randomUUID(), expectedVersion: 3,
    record: { ...s.created.record, title: 'Foto atualizada após esgotar' }, photo: bytes.toString('base64') })).status, 200);
  await s.receive(2); await s.sell();
  const product = await s.get(); assert.equal(product.hasPhoto, true); assert.equal(product.stock, 1); assert.equal(product.title, 'Foto atualizada após esgotar');
  const response = await s.http(s.attendant, 'cover?id=' + s.created.id); assert.equal(response.status, 200);
  const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata(); assert.equal(meta.format, 'jpeg');
  const files = [...s.gas.resources.values()].filter(r => r.kind === 'image'); assert.equal(files.length, 1); assert.equal(files[0].sharing, 'private');
});
