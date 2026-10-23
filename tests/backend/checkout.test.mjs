import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { catalogFixture, CATALOG_ORIGIN } from '../helpers/catalog-fixture.mjs';
import { createCheckoutHandler, loadCheckoutSettings } from '../../backend/checkout-handler.mjs';
import { normalizeCheckout } from '../../backend/checkout-command.mjs';
import { createWorkspaceClient } from '../../backend/workspace-client.mjs';
import { pack, unpack } from '../../backend/protocol.mjs';

async function setup(stock = 4) {
  const s = catalogFixture(), user = s.session(), product = s.command();
  s.env.WORKSPACE_CHECKOUT_ENABLED = 'true'; s.gas.props.CHECKOUT_ENABLED = 'true';
  await s.client.catalog('save', user.actor, product);
  // Imported DEV stock is a disposable fixture, never a runtime stock endpoint.
  const table = s.main.getSheetByName('Produtos'); table.rows[1][table.rows[0].indexOf('Estoque_Atual')] = stock;
  const handler = createCheckoutHandler({ loadSettings: () => loadCheckoutSettings(s.env), createClient: () => s.client });
  const command = () => ({ idempotencyKey: randomUUID(), items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'PIX', customerId: null, expectedTotalCents: 3290 });
  async function http(input = command(), actor = user, headers = {}) {
    const data = await s.sessionService.current(new Request(CATALOG_ORIGIN + '/api/v1/session', { headers: { cookie: actor.cookie } }));
    return handler(new Request(CATALOG_ORIGIN + '/api/v1/checkout', { method: 'POST', headers: { origin: CATALOG_ORIGIN, 'content-type': 'application/json', cookie: actor.cookie, 'x-csrf-token': data.csrfToken, ...headers }, body: JSON.stringify(input) }));
  }
  return { ...s, user, product, handler, command, http, count: name => s.main.getSheetByName(name).getLastRow() - 1,
    stock: () => table.rows[1][table.rows[0].indexOf('Estoque_Atual')] };
}

test('anonymous checkout records all payment methods, authoritative totals, operator and audit exactly once', async () => {
  const s = await setup();
  for (const paymentMethod of ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO']) {
    const command = { ...s.command(), paymentMethod }, response = await s.http(command);
    assert.equal(response.status, 200, await response.clone().text());
    const receipt = (await response.json()).data;
    assert.equal(receipt.customerId, null); assert.equal(receipt.paymentMethod, paymentMethod); assert.equal(receipt.totalCents, 3290);
    assert.equal(receipt.items[0].unitPriceCents, 3290);
    assert.deepEqual((await (await s.http(command)).json()).data, receipt);
  }
  assert.equal(s.stock(), 0);
  for (const name of ['Vendas', 'Itens_Venda', 'Movimentacoes_Estoque', '_Eventos_Dominio']) assert.equal(s.count(name), 4);
  assert.equal(s.count('Logs_Auditoria'), 5); // product plus four sales
  const sales = s.main.getSheetByName('Vendas');
  for (const row of sales.rows.slice(1)) { assert.equal(row[sales.rows[0].indexOf('ID_Cliente')], ''); assert.equal(row[sales.rows[0].indexOf('ID_Atendente')], s.user.userId); }
});

test('two authenticated sessions competing for last unit have one receipt and no negative stock', async () => {
  const s = await setup(1), other = s.session();
  const results = await Promise.all([s.http(), s.http(s.command(), other)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(s.stock(), 0); assert.equal(s.count('Vendas'), 1);
});

test('checkout rejects changed prices, extra customer/actor/price fields, invalid totals and inactive products without a journal append', async () => {
  const s = await setup();
  for (const patch of [{ customerId: randomUUID() }, { cpf: 'test' }, { actor: s.user.actor }, { expectedTotalCents: -1 }, { paymentMethod: 'BOLETO' },
    { items: [{ productId: s.product.id, quantity: 1, priceCents: 1 }] }, { items: [null] }]) {
    assert.equal((await s.http({ ...s.command(), ...patch })).status, 400);
  }
  assert.equal((await s.http({ ...s.command(), expectedTotalCents: 1 })).status, 409);
  assert.equal(s.count('_Eventos_Dominio'), 0); assert.equal(s.stock(), 4);
  const products = s.main.getSheetByName('Produtos'); products.rows[1][products.rows[0].indexOf('Ativo')] = false;
  assert.equal((await s.http()).status, 409); assert.equal(s.count('Vendas'), 0);
});

test('checkout key cannot change operator, items or payment after a successful command', async () => {
  const s = await setup(), command = s.command(); assert.equal((await s.http(command)).status, 200);
  for (const patch of [{ paymentMethod: 'DINHEIRO' }, { items: [{ productId: s.product.id, quantity: 2 }], expectedTotalCents: 6580 }]) assert.equal((await s.http({ ...command, ...patch })).status, 409);
  assert.equal((await s.http(command, s.session())).status, 409);
  assert.equal(s.count('Vendas'), 1); assert.equal(s.stock(), 3);
});

test('response loss and failure before/after each append or stock write recover without duplicate sale, movement or audit', async () => {
  for (const name of ['_Eventos_Dominio', 'Vendas', 'Itens_Venda', 'Movimentacoes_Estoque', 'Logs_Auditoria', 'Produtos']) for (const after of [false, true]) {
    const s = await setup(1), command = s.command(), sheet = s.main.getSheetByName(name); let once = true;
    if (name === 'Produtos') {
      const range = sheet.getRange.bind(sheet);
      sheet.getRange = (...args) => { const result = range(...args), set = result.setValues; result.setValues = values => {
        if (!once) return set(values); once = false; if (after) set(values); throw Error('INJECTED_CHECKOUT_FAILURE');
      }; return result; };
    } else {
      const append = sheet.appendRow.bind(sheet);
      sheet.appendRow = values => { if (!once) return append(values); once = false; if (after) append(values); throw Error('INJECTED_CHECKOUT_FAILURE'); };
    }
    assert.notEqual((await s.http(command)).status, 200, name);
    // Catalog read also finishes an interrupted sale before returning stock.
    if (s.count('_Eventos_Dominio')) assert.equal((await s.client.catalog('get', s.user.actor, { id: s.product.id })).product.stock, 0);
    const response = await s.http(command); assert.equal(response.status, 200, name + ' ' + await response.clone().text());
    const receipt = (await response.json()).data;
    assert.deepEqual((await (await s.http(command)).json()).data, receipt);
    for (const table of ['_Eventos_Dominio', 'Vendas', 'Itens_Venda', 'Movimentacoes_Estoque']) assert.equal(s.count(table), 1, name);
    assert.equal(s.count('Logs_Auditoria'), 2); assert.equal(s.stock(), 0);
  }
});

test('HTTP checkout enforces CSRF, body bounds, session, DEV and independent flags', async () => {
  const s = await setup();
  for (const headers of [{ origin: 'https://example.org' }, { 'x-csrf-token': 'bad' }, { 'content-type': 'text/plain' }, { 'sec-fetch-site': 'cross-site' }, { cookie: '' }]) assert.ok([401, 403].includes((await s.http(s.command(), s.user, headers)).status));
  assert.equal((await s.http({ ...s.command(), junk: 'a'.repeat(17000) })).status, 413);
  assert.equal((await s.handler(new Request(CATALOG_ORIGIN + '/api/v1/checkout'))).status, 405);
  assert.equal((await s.handler(new Request('https://merry-chimera-49a1f3.netlify.app/api/v1/checkout', { method: 'POST' }))).status, 403);
  s.env.WORKSPACE_CHECKOUT_ENABLED = 'false'; assert.equal((await s.http()).status, 503);
  assert.throws(() => loadCheckoutSettings({}), { code: 'CHECKOUT_NOT_ACTIVATED' });
  assert.equal(s.count('_Eventos_Dominio'), 0);
});

test('Apps Script rechecks session revocation, role, binding and checkout flag inside its lock', async () => {
  for (const kind of ['revoked', 'flag', 'role', 'prod', 'lock', 'binding', 'actor']) {
    const s = await setup(); let actor = s.user.actor;
    if (kind === 'revoked') await s.client.revokeSession(s.user.tokenHash);
    if (kind === 'flag') s.gas.props.CHECKOUT_ENABLED = 'false';
    if (kind === 'role') { const table = s.main.getSheetByName('Usuarios'); table.rows.find(row => row[0] === s.user.userId)[table.rows[0].indexOf('Perfil')] = 'VISITANTE'; }
    if (kind === 'prod') s.gas.props.APP_ENV = 'prod';
    if (kind === 'lock') s.gas.locked = true;
    if (kind === 'binding') s.gas.resources.get(s.gas.props.DRIVE_ROOT_ID).sharing = 'public';
    if (kind === 'actor') actor = { ...actor, role: 'SUPER_ADMIN' };
    await assert.rejects(s.client.checkout(actor, s.command()), undefined, kind);
    assert.equal(s.count('_Eventos_Dominio'), 0, kind);
  }
});

test('normalized retries merge duplicate lines, accept no PII and preserve exact command identity', async () => {
  const s = await setup(), command = { ...s.command(), expectedTotalCents: 6580 };
  command.items.push({ ...command.items[0] });
  const normalized = normalizeCheckout(command);
  assert.equal(normalized.items[0].quantity, 2);
  assert.equal((await s.http(command)).status, 200);
  assert.equal((await s.http(normalized)).status, 200); assert.equal(s.stock(), 2);
});

test('chosen catalog audit ID collision is refused before a durable sale is appended', async () => {
  const s = await setup();
  assert.equal((await s.http({ ...s.command(), idempotencyKey: s.product.commandId })).status, 409);
  assert.equal(s.count('_Eventos_Dominio'), 0); assert.equal(s.stock(), 4);
  assert.equal((await s.http()).status, 200);
});

test('corrupted v2 payment/receipt/role/hash blocks replay and further stock decisions', async () => {
  for (const kind of ['payment', 'receipt', 'role', 'hash']) {
    const s = await setup(), command = s.command(); assert.equal((await s.http(command)).status, 200);
    const journal = s.main.getSheetByName('_Eventos_Dominio'), index = journal.rows[0].indexOf('Conteudo_JSON'), event = JSON.parse(journal.rows[1][index]);
    if (kind === 'payment') event.receipt.paymentMethod = 'BOLETO';
    if (kind === 'receipt') event.receipt.items[0].unitPriceCents = 1;
    if (kind === 'role') event.actorRole = 'VISITANTE';
    if (kind === 'hash') event.commandHash = '0'.repeat(64);
    journal.rows[1][index] = JSON.stringify(event);
    assert.equal((await s.http()).status, 503); assert.equal(s.stock(), 3); assert.equal(s.count('Vendas'), 1);
  }
});

test('catalog preserves the sold-product version checkpoint and refuses metadata edits until unified event replay', async () => {
  const s = await setup(1); assert.equal((await s.http()).status, 200);
  const product = (await s.client.catalog('get', s.user.actor, { id: s.product.id })).product;
  assert.equal(product.version, 2); assert.equal(product.stock, 0);
  await assert.rejects(s.client.catalog('save', s.user.actor, { ...s.product, commandId: randomUUID(), expectedVersion: 2 }), { code: 'WORKSPACE_CATALOG_STOCK_HISTORY' });
  assert.equal(s.stock(), 0); assert.equal((await s.http()).status, 409);
});

test('stock rejection appends a restricted audit record without a sale event', async () => {
  const s = await setup(0), response = await s.http();
  assert.equal(response.status, 409); assert.equal(s.count('_Eventos_Dominio'), 0);
  const table = s.main.getSheetByName('Logs_Auditoria'), log = Object.fromEntries(table.rows[0].map((key, i) => [key, table.rows.at(-1)[i]]));
  assert.equal(log.Acao, 'SALE_REJECTED'); assert.equal(log.Resultado, 'NEGADO'); assert.equal(log.ID_Usuario, s.user.userId);
  assert.equal(JSON.parse(log.Depois).code, 'INSUFFICIENT_STOCK'); assert.ok(!JSON.stringify(log).includes(s.user.tokenHash));
});

test('signed but malformed upstream receipts cannot confirm a different sale, payment or total', async () => {
  const s = await setup(), command = normalizeCheckout(s.command());
  for (const kind of ['total', 'payment', 'id', 'items', 'customer']) {
    const client = createWorkspaceClient(s.settings.config, { fetchImpl: async (_url, options) => {
      const request = unpack(JSON.parse(options.body), s.settings.config.secret, 'request');
      const data = { saleId: command.idempotencyKey, totalCents: 3290, paymentMethod: 'PIX', customerId: null, createdAt: new Date().toISOString(),
        items: [{ productId: s.product.id, quantity: 1, unitPriceCents: 3290, subtotalCents: 3290 }] };
      if (kind === 'total') data.totalCents++;
      if (kind === 'payment') data.paymentMethod = 'CREDITO';
      if (kind === 'id') data.saleId = randomUUID();
      if (kind === 'items') data.items[0].quantity++;
      if (kind === 'customer') data.customerId = randomUUID();
      return new Response(JSON.stringify(pack({ version: 1, environment: request.environment, installationId: request.installationId,
        requestId: request.requestId, nonce: request.nonce, sentAt: Date.now(), ok: true, data }, s.settings.config.secret, 'response')));
    } });
    await assert.rejects(client.checkout(s.user.actor, command), { code: 'UPSTREAM_UNTRUSTED' });
  }
});
