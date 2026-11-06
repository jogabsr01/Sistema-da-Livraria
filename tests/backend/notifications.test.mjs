import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { catalogFixture, CATALOG_ORIGIN } from '../helpers/catalog-fixture.mjs';
import { createNotificationHandler, loadNotificationSettings } from '../../backend/notification-handler.mjs';
import { validateNotificationResponse } from '../../backend/notification-model.mjs';
import { createWorkspaceClient } from '../../backend/workspace-client.mjs';

async function setup(create = true) {
  const s = catalogFixture(), attendant = s.session(), other = s.session(), admin = s.session('ADMIN');
  s.env.WORKSPACE_NOTIFICATIONS_ENABLED = 'true'; s.gas.props.NOTIFICATIONS_ENABLED = 'true'; s.gas.props.CHECKOUT_ENABLED = 'true';
  const handler = createNotificationHandler({ loadSettings: () => loadNotificationSettings(s.env), createClient: () => s.client });
  async function book(title = 'Livro esgotado', supplier = 'Fornecedor A', minimumStock = 3) {
    const command = s.command({ record: { isbn: '', title, supplier, minimumStock } }); await s.client.catalog('save', attendant.actor, command); return command;
  }
  const created = create ? await book() : null;
  const get = async id => (await s.client.catalog('get', attendant.actor, { id })).product;
  async function receive(id, quantity) { const p = await get(id); return s.client.catalog('receive', attendant.actor, { commandId: randomUUID(), id, expectedVersion: p.version, quantity, reason: 'REPOSICAO' }); }
  async function sell(id, quantity) { const p = await get(id); return s.client.checkout(attendant.actor, { idempotencyKey: randomUUID(), items: [{ productId: id, quantity }], paymentMethod: 'PIX', customerId: null, expectedTotalCents: p.priceCents * quantity }); }
  const operation = (op, payload = {}, actor = admin) => s.client.notifications(op, actor.actor, payload);
  const list = (actor = admin, history = false) => operation('list', { offset: 0, history }, actor);
  async function http(op, body, actor = admin, headers = {}) {
    const session = await s.sessionService.current(new Request(CATALOG_ORIGIN + '/api/v1/session', { headers: { cookie: actor.cookie } }));
    return handler(new Request(CATALOG_ORIGIN + '/api/v1/notifications/' + op, { method: body ? 'POST' : 'GET', headers: { cookie: actor.cookie, ...(body ? { origin: CATALOG_ORIGIN, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  }
  return { ...s, attendant, other, admin, handler, created, book, get, receive, sell, operation, list, http, count: name => s.main.getSheetByName(name).getLastRow() - 1 };
}

test('one persistent alert per stock episode; personal read does not resolve it or affect another user', async () => {
  const s = await setup(), first = (await s.list()).items[0];
  assert.equal(first.type, 'STOCK_ZERO'); assert.equal(first.state, 'ABERTA'); assert.equal(first.read, false);
  for (let i = 0; i < 3; i++) await s.operation('summary', {}, s.attendant);
  assert.equal(s.count('Notificacoes'), 1);
  await s.operation('read', { id: first.id }, s.attendant); await s.operation('read', { id: first.id }, s.attendant);
  assert.deepEqual(await s.operation('summary', {}, s.attendant), { total: 1, unread: 0 });
  assert.deepEqual(await s.operation('summary', {}, s.other), { total: 1, unread: 1 });
  assert.equal((await s.list(s.attendant)).items[0].state, 'ABERTA'); assert.equal(s.count('Notificacoes_Usuarios'), 1);
});

test('zero/low escalation creates a new unread priority episode; replenishment resolves and later stock-out reopens once', async () => {
  const s = await setup(); const original = (await s.list()).items[0]; await s.operation('read', { id: original.id });
  await s.receive(s.created.id, 1); const low = (await s.list()).items[0]; assert.equal(low.type, 'STOCK_LOW'); assert.notEqual(low.id, original.id);
  await s.operation('read', { id: low.id }); await s.sell(s.created.id, 1);
  const zero = (await s.list()).items[0]; assert.equal(zero.type, 'STOCK_ZERO'); assert.equal(zero.read, false); assert.notEqual(zero.id, low.id);
  await s.receive(s.created.id, 3); assert.equal((await s.list()).total, 0);
  assert.equal((await s.list(s.admin, true)).items.filter(n => n.state === 'RESOLVIDA').length, 3);
  await s.sell(s.created.id, 3); assert.equal((await s.list()).total, 1); await s.operation('summary'); assert.equal(s.count('Notificacoes'), 4);
});

test('handling is administrative, recoverable and distinct from personal reading or stock resolution', async () => {
  const s = await setup(), id = (await s.list()).items[0].id, command = { commandId: randomUUID(), id, state: 'EM_ATENDIMENTO' };
  assert.equal((await s.http('state', command, s.attendant)).status, 403);
  await assert.rejects(s.operation('state', command, s.attendant), { code: 'WORKSPACE_FORBIDDEN' });
  await s.operation('state', command); await s.operation('state', command);
  assert.equal((await s.list()).items[0].state, 'EM_ATENDIMENTO'); assert.equal((await s.list()).items[0].read, false);
  await assert.rejects(s.operation('state', { ...command, state: 'ABERTA' }), { code: 'WORKSPACE_NOTIFICATION_CONFLICT' });
  await s.operation('state', { ...command, commandId: randomUUID(), state: 'ABERTA' }); assert.equal((await s.list()).items[0].state, 'ABERTA');
  await s.receive(s.created.id, 3); assert.equal((await s.list()).total, 0);
  assert.deepEqual(await s.operation('state', command), { accepted: true }); assert.equal((await s.list()).total, 0);
});

test('state ledger survives failure after append before the notification row update', async () => {
  const s = await setup(), command = { commandId: randomUUID(), id: (await s.list()).items[0].id, state: 'EM_ATENDIMENTO' };
  const original = s.gas.context.notificationWrite_; let once = true;
  s.gas.context.notificationWrite_ = (table, row) => { if (once && row.Status === 'EM_ATENDIMENTO') { once = false; throw Error('INJECTED_STATE_FAILURE'); } return original(table, row); };
  await assert.rejects(s.operation('state', command)); await s.operation('state', command);
  assert.equal((await s.list()).items[0].state, 'EM_ATENDIMENTO');
  const audit = s.main.getSheetByName('Logs_Auditoria'); assert.equal(audit.rows.filter(row => row[0] === command.commandId).length, 1);
});

test('alert creation and audit recover before/after their writes without duplicate alerts', async () => {
  for (const stage of ['notification', 'audit']) for (const after of [false, true]) {
    const s = await setup(false), command = s.command(); let once = true;
    if (stage === 'notification') {
      const original = s.gas.context.notificationWrite_;
      s.gas.context.notificationWrite_ = (table, row) => { if (!once) return original(table, row); once = false; if (after) original(table, row); throw Error('INJECTED_ALERT_FAILURE'); };
    } else {
      const original = s.gas.context.ensureSaleRow_;
      s.gas.context.ensureSaleRow_ = (table, keys, row, write) => { if (!once || !write || row.Acao !== 'STOCK_ALERT_OPENED') return original(table, keys, row, write); once = false; if (after) original(table, keys, row, write); throw Error('INJECTED_ALERT_FAILURE'); };
    }
    await assert.rejects(s.client.catalog('save', s.attendant.actor, command)); await s.client.catalog('save', s.attendant.actor, command);
    assert.equal((await s.list()).total, 1); assert.equal(s.count('Notificacoes'), 1);
    const table = s.main.getSheetByName('Logs_Auditoria'); assert.equal(table.rows.filter(row => row[table.rows[0].indexOf('Acao')] === 'STOCK_ALERT_OPENED').length, 1);
  }
});

test('alert resolution failure does not duplicate stock receipts or reopen resolved history', async () => {
  const s = await setup(), command = { commandId: randomUUID(), id: s.created.id, expectedVersion: 1, quantity: 3, reason: 'REPOSICAO' };
  const original = s.gas.context.notificationWrite_; let once = true;
  s.gas.context.notificationWrite_ = (table, row) => { const value = original(table, row); if (once && row.Status === 'RESOLVIDA') { once = false; throw Error('INJECTED_RESOLVE_FAILURE'); } return value; };
  await assert.rejects(s.client.catalog('receive', s.attendant.actor, command)); await s.client.catalog('receive', s.attendant.actor, command);
  assert.equal((await s.list()).total, 0); assert.equal((await s.get(s.created.id)).stock, 3); assert.equal(s.count('Movimentacoes_Estoque'), 1);
});

test('report groups all zero-stock books by supplier, flags missing suppliers and derives minimum-based suggestions', async () => {
  const s = await setup(); await s.book('Outro livro A', 'fornecedor a', 0); await s.book('Livro B', 'Fornecedor B', 5); await s.book('Sem fornecedor', '', 2);
  const low = await s.book('Abaixo do mínimo', 'Fornecedor B', 5); await s.receive(low.id, 2);
  const report = await s.operation('report', { scope: 'zero', supplier: null, format: 'view' });
  assert.equal(report.totalBooks, 4); assert.equal(report.groups.length, 3); assert.equal(report.missingSupplier, 1); assert.equal(report.suggestedUnits, 11);
  const all = await s.operation('report', { scope: 'low', supplier: null, format: 'csv' }); assert.equal(all.totalBooks, 5); assert.equal(all.suggestedUnits, 14);
  const filtered = await s.operation('report', { scope: 'low', supplier: 'Fornecedor B', format: 'copy' }); assert.equal(filtered.totalBooks, 2); assert.equal(filtered.groups.length, 1);
  const missing = await s.operation('report', { scope: 'zero', supplier: '', format: 'print' }); assert.equal(missing.totalBooks, 1); assert.equal(missing.groups[0].supplier, '');
  const audit = s.main.getSheetByName('Logs_Auditoria'); assert.equal(audit.rows.filter(row => row[audit.rows[0].indexOf('Acao')] === 'STOCK_REPORT_EXPORT').length, 3);
  assert.ok(!JSON.stringify(report).includes(s.admin.rawToken));
});

test('supplier prototype keys are ordinary groups and stocked/inactive products are excluded', async () => {
  const s = await setup(false), proto = await s.book('Fornecedor especial', '__proto__', 1), stocked = await s.book('Disponível', 'constructor', 1), inactive = await s.book('Inativo', 'Fornecedor antigo', 1);
  await s.receive(stocked.id, 1);
  await s.client.catalog('remove', s.admin.actor, { commandId: randomUUID(), id: inactive.id, expectedVersion: 1 });
  const report = await s.operation('report', { scope: 'zero', supplier: null, format: 'view' }); assert.equal(report.totalBooks, 1); assert.equal(report.groups[0].supplier, '__proto__'); assert.equal(report.groups[0].items[0].id, proto.id);
});

test('report is complete beyond notification pagination and the old signed-response size limit', async () => {
  const s = await setup(), table = s.main.getSheetByName('Produtos'), title = table.rows[0].indexOf('Titulo'), id = table.rows[0].indexOf('ID_Produto'), code = table.rows[0].indexOf('Codigo_Interno');
  for (let i = 1; i < 400; i++) { const row = [...table.rows[1]], uuid = randomUUID(); row[id] = uuid; row[code] = 'INT' + uuid.replaceAll('-', '').slice(0,12).toUpperCase(); row[title] = String(i).padStart(3,'0') + 'x'.repeat(297); table.appendRow(row); }
  assert.equal((await s.list()).items.length, 25);
  const response = await s.http('report', { scope: 'zero', supplier: null, format: 'view' }); assert.equal(response.status, 200, await response.clone().text());
  const report = (await response.json()).data; assert.equal(report.totalBooks, 400); assert.equal(report.groups.flatMap(g => g.items).length, 400); assert.ok(JSON.stringify(report).length > 180000);
});

test('reports enforce admin role, recent strong authentication, CSRF and source isolation in Node and GAS', async () => {
  const s = await setup(), request = { scope: 'zero', supplier: null, format: 'csv' };
  assert.equal((await s.http('report', request, s.attendant)).status, 403); await assert.rejects(s.operation('report', request, s.attendant), { code: 'WORKSPACE_FORBIDDEN' });
  for (const headers of [{ 'x-csrf-token': 'bad' }, { origin: 'https://evil.example' }, { 'content-type': 'text/plain' }]) assert.equal((await s.http('report', request, s.admin, headers)).status, 403);
  const sessions = s.main.getSheetByName('Sessoes'), row = sessions.rows.find(r => r[sessions.rows[0].indexOf('Token_Hash')] === s.admin.tokenHash); row[sessions.rows[0].indexOf('Criado_Em')] = new Date(Date.now()-360000).toISOString();
  assert.equal((await s.http('report', request)).status, 401); await assert.rejects(s.operation('report', request), { code: 'WORKSPACE_FORBIDDEN' });
  assert.equal((await s.handler(new Request('https://merry-chimera-49a1f3.netlify.app/api/v1/notifications/summary'))).status, 403);
});

test('default-off flags, invalid filters, personal-read spoofing, revocation and bad bindings fail closed', async () => {
  const s = await setup(); assert.throws(() => loadNotificationSettings({}), { code: 'NOTIFICATIONS_NOT_ACTIVATED' });
  assert.equal((await s.http('read', { id: (await s.list()).items[0].id, userId: s.other.userId })).status, 400);
  assert.equal((await s.http('report', { scope: 'all', supplier: null, format: 'csv' })).status, 400);
  assert.equal((await s.http('report', { scope: 'zero', supplier: null, format: 'email' })).status, 400);
  s.env.WORKSPACE_NOTIFICATIONS_ENABLED = 'false'; assert.equal((await s.http('summary')).status, 503); s.env.WORKSPACE_NOTIFICATIONS_ENABLED = 'true';
  s.gas.props.NOTIFICATIONS_ENABLED = 'false'; await assert.rejects(s.operation('summary'), { code: 'WORKSPACE_NOTIFICATIONS_UNAVAILABLE' }); s.gas.props.NOTIFICATIONS_ENABLED = 'true';
  await s.client.revokeSession(s.admin.tokenHash); await assert.rejects(s.operation('summary'), { code: 'UNAUTHENTICATED' });
  s.gas.resources.get(s.gas.props.DRIVE_ROOT_ID).sharing = 'public'; await assert.rejects(s.operation('summary', {}, s.other));
});

test('malformed signed alert/report data and oversized responses cannot be shown as a complete report', async () => {
  const s = await setup(), good = await s.operation('report', { scope: 'zero', supplier: null, format: 'view' }), payload = { scope: 'zero', supplier: null, format: 'view' };
  for (const kind of ['total', 'quantity', 'duplicate', 'scope', 'date']) {
    const data = structuredClone(good);
    if (kind === 'total') data.totalBooks++;
    if (kind === 'quantity') data.groups[0].items[0].suggestedQuantity = 0;
    if (kind === 'duplicate') data.groups[0].items.push(data.groups[0].items[0]);
    if (kind === 'scope') data.scope = 'low';
    if (kind === 'date') data.generatedAt = 'bad';
    assert.throws(() => validateNotificationResponse('report', data, payload, good.reportId), { code: 'UPSTREAM_UNTRUSTED' });
  }
  const value = (await s.list()).items[0];
  assert.throws(() => validateNotificationResponse('list', { total: 1, nextOffset: null, items: [{ ...value, id: 'bad' }] }, { offset: 0, history: false }), { code: 'UPSTREAM_UNTRUSTED' });
  const client = createWorkspaceClient(s.settings.config, { fetchImpl: async () => new Response('x'.repeat(4000001)) });
  await assert.rejects(client.notifications('report', s.admin.actor, payload), { code: 'UPSTREAM_UNTRUSTED' });
});

test('notification bootstrap authorizes and returns list, summary and CSRF in one signed RPC',async()=>{
 const s=await setup(),calls=[],post=s.gas.post;s.gas.post=e=>{calls.push(JSON.parse(Buffer.from(e.message,'base64')).action);return post(e);};
 const r=await s.handler(new Request(CATALOG_ORIGIN+'/api/v1/notifications/bootstrap?offset=0&history=false',{headers:{cookie:s.admin.cookie}}));assert.equal(r.status,200);const{data}=await r.json();assert.deepEqual(calls,['notifications.bootstrap']);assert.equal(data.items.length,1);assert.equal(data.summary.unread,1);assert.equal(data.user.role,'ADMIN');assert.match(data.csrfToken,/^[A-Za-z0-9_-]{43}$/);assert.equal(data.principal,undefined);assert.ok(!JSON.stringify(data).includes(s.admin.tokenHash));
 const table=s.main.getSheetByName('Sessoes'),row=table.rows.find(r=>r[0]===s.admin.sessionId);if(row)row[table.rows[0].indexOf('Revogado_Em')]=new Date().toISOString();
 const missing=await s.handler(new Request(CATALOG_ORIGIN+'/api/v1/notifications/bootstrap'));assert.equal(missing.status,401);
 const spoof=await s.handler(new Request(CATALOG_ORIGIN+'/api/v1/notifications/bootstrap?role=SUPER_ADMIN',{headers:{cookie:s.admin.cookie}}));assert.equal(spoof.status,400);
});
