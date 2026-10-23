/* Recoverable sale projections, including gated anonymous DEV checkout.
 * Caller MUST hold the installation ScriptLock for the entire read/write cycle.
 * The journal remains append-only; deterministic keys and product versions allow
 * replay after interruption between any two projection writes.
 */
function saleTable_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) failure_('SCHEMA_REQUIRED');
  var columns = rowValues_(sheet);
  var rows = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, columns.length).getValues();
  return { sheet: sheet, columns: columns, rows: rows };
}
function saleObjects_(table) {
  return table.rows.map(function (row, index) {
    var object = { rowNumber: index + 2 };
    table.columns.forEach(function (key, i) { object[key] = row[i]; });
    return object;
  });
}
function saleUuid_(value) { return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value); }
function saleInteger_(value) { return Number.isSafeInteger(value) && value >= 0; }
function checkoutCommand_(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !same_(Object.keys(input).sort(), ['customerId', 'expectedTotalCents', 'idempotencyKey', 'items', 'paymentMethod']) ||
      !saleUuid_(input.idempotencyKey) || input.customerId !== null && !saleUuid_(input.customerId) || !saleInteger_(input.expectedTotalCents) ||
      !['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'].includes(input.paymentMethod) || !Array.isArray(input.items) || !input.items.length || input.items.length > 100) failure_('INVALID_SALE');
  var quantities = {};
  input.items.forEach(function (item) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !same_(Object.keys(item).sort(), ['productId', 'quantity']) ||
        !saleUuid_(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) failure_('INVALID_SALE');
    quantities[item.productId] = (quantities[item.productId] || 0) + item.quantity;
    if (!Number.isSafeInteger(quantities[item.productId])) failure_('INVALID_SALE');
  });
  return { idempotencyKey: input.idempotencyKey, items: Object.keys(quantities).sort().map(function (id) { return { productId: id, quantity: quantities[id] }; }),
    paymentMethod: input.paymentMethod, customerId: input.customerId, expectedTotalCents: input.expectedTotalCents };
}
function checkoutOperation_(request, c) {
  if (c.environment !== 'dev' || !request.actor || !same_(Object.keys(request.actor), ['sessionTokenHash']) || !accessHash_(request.actor.sessionTokenHash)) failure_('UNAUTHENTICATED');
  // Authorize again under the same ScriptLock as the stock decision.
  var principal = identitySessionOperation_({ action: 'identity.session.read', payload: { tokenHash: request.actor.sessionTokenHash } }, c);
  if (!['ATENDENTE', 'ADMIN', 'SUPER_ADMIN'].includes(principal.role) || principal.role !== 'ATENDENTE' && !['mfa', 'passkey'].includes(principal.assurance)) failure_('FORBIDDEN');
  var command = checkoutCommand_(request.payload), hash = digest_(JSON.stringify(command));
  recoverCatalog_(c);
  var ss = storage_(c, false).spreadsheet;
  recoverSales_(ss);
  var journal = saleTable_(ss, '_Eventos_Dominio'), prior = saleObjects_(journal).filter(function (row) { return row.ID_Evento === command.idempotencyKey; });
  if (prior.length) {
    var existing = JSON.parse(prior[0].Conteudo_JSON);
    if (prior.length !== 1 || ![2,3].includes(existing.version) || existing.commandHash !== hash || existing.actorId !== principal.id) failure_('IDEMPOTENCY_CONFLICT');
    return existing.receipt;
  }
  if(request.action==='sales.receipt')failure_('CUSTOMER_UNAVAILABLE');
  if (journal.rows.length >= 2000 || saleTable_(ss, 'Logs_Auditoria').rows.length >= 5000) failure_('JOURNAL_CAPACITY');
  // Command IDs share the audit namespace with catalog changes. Refuse a
  // chosen collision before appending an event that could never be projected.
  if (saleObjects_(saleTable_(ss, 'Logs_Auditoria')).some(function (row) { return row.ID_Log === command.idempotencyKey; }) ||
      saleObjects_(saleTable_(ss, 'Vendas')).some(function (row) { return row.ID_Venda === command.idempotencyKey; })) failure_('IDEMPOTENCY_CONFLICT');
  function rejectBusiness(code) {
    var audit = saleTable_(ss, 'Logs_Auditoria'), log = { ID_Log: request.requestId + ':sale-rejected', Data_Hora: new Date().toISOString(),
      ID_Usuario: principal.id, Perfil: principal.role, Acao: 'SALE_REJECTED', Entidade: 'Vendas', ID_Entidade: command.idempotencyKey,
      Antes: '', Depois: JSON.stringify({ code: code, items: command.items }), Resultado: 'NEGADO', ID_Requisicao: request.requestId };
    ensureSaleRow_(audit, ['ID_Log'], log, true); failure_(code);
  }
  if(command.customerId!==null){
    if(PropertiesService.getScriptProperties().getProperty('CUSTOMERS_ENABLED')!=='true')rejectBusiness('CUSTOMER_UNAVAILABLE');
    recoverCustomers_(ss);if(!customerRows_(ss).rows.some(function(r){return r.ID_Cliente===command.customerId;}))rejectBusiness('CUSTOMER_UNAVAILABLE');
  }
  var products = catalogProducts_(ss), total = 0;
  var lines = command.items.map(function (item) {
    var matches = products.rows.filter(function (p) { return p.ID_Produto === item.productId; }), product = matches[0];
    if (matches.length !== 1 || product.Ativo !== true) rejectBusiness('PRODUCT_UNAVAILABLE');
    if (!saleInteger_(product.Preco_Venda) || product.Preco_Venda > 100000000) failure_('INVALID_SALE');
    if (product.Estoque_Atual < item.quantity) rejectBusiness('INSUFFICIENT_STOCK');
    var subtotal = product.Preco_Venda * item.quantity; total += subtotal;
    if (!saleInteger_(subtotal) || !saleInteger_(total) || product.Versao_Registro >= 1000000000) failure_('INVALID_SALE');
    return { productId: item.productId, quantity: item.quantity, unitPriceCents: product.Preco_Venda, subtotalCents: subtotal,
      expectedVersion: product.Versao_Registro, stockAfter: product.Estoque_Atual - item.quantity };
  });
  if (total !== command.expectedTotalCents) rejectBusiness('SALE_PRICE_CHANGED');
  var receipt = { saleId: command.idempotencyKey, totalCents: total, createdAt: new Date().toISOString(), customerId: command.customerId, paymentMethod: command.paymentMethod,
    items: lines.map(function (line) { return { productId: line.productId, quantity: line.quantity, unitPriceCents: line.unitPriceCents, subtotalCents: line.subtotalCents }; }) };
  var event = { version: command.customerId===null?2:3, type: 'SALE_COMMITTED', idempotencyKey: command.idempotencyKey, commandHash: hash, actorId: principal.id, actorRole: principal.role, lines: lines, receipt: receipt };
  var values = { ID_Evento: event.idempotencyKey, Tipo: event.type, Chave_Idempotencia: event.idempotencyKey, Hash_Comando: hash,
    Conteudo_JSON: JSON.stringify(event), Estado_Projecao: 'PENDENTE', Criado_Em: receipt.createdAt, Versao_Esquema: event.version };
  validateSaleEvent_(event, values);
  // Durable append precedes ALL business projections. Repeating the same key
  // recovers this event and returns this exact receipt, even after response loss.
  journal.sheet.appendRow(journal.columns.map(function (key) { return values[key]; })); SpreadsheetApp.flush();
  recoverSales_(ss);
  return receipt;
}
function validateSaleEvent_(event, row) {
  if (!event || event.type !== 'SALE_COMMITTED' || !saleUuid_(event.idempotencyKey) || !saleUuid_(event.actorId) ||
      !event.receipt || event.receipt.saleId !== event.idempotencyKey || !saleInteger_(event.receipt.totalCents) ||
      typeof event.receipt.createdAt !== 'string' || !Number.isFinite(Date.parse(event.receipt.createdAt)) ||
      !Array.isArray(event.lines) || !event.lines.length || event.lines.length > 100) failure_('JOURNAL_INVALID');
  var seen = new Set(), total = 0;
  event.lines.forEach(function (line) {
    if (!saleUuid_(line.productId) || seen.has(line.productId) || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
        !saleInteger_(line.unitPriceCents) || !saleInteger_(line.subtotalCents) || !saleInteger_(line.expectedVersion) ||
        line.expectedVersion >= Number.MAX_SAFE_INTEGER || !saleInteger_(line.stockAfter) ||
        !saleInteger_(line.stockAfter + line.quantity) || line.subtotalCents !== line.quantity * line.unitPriceCents) failure_('JOURNAL_INVALID');
    seen.add(line.productId); total += line.subtotalCents;
    if (!saleInteger_(total)) failure_('JOURNAL_INVALID');
  });
  var command = { idempotencyKey: event.idempotencyKey, items: event.lines.map(function (line) {
    return { productId: line.productId, quantity: line.quantity };
  }).sort(function (a, b) { return a.productId.localeCompare(b.productId); }) };
  if (event.version !== undefined && ![2,3].includes(event.version)) failure_('JOURNAL_INVALID');
  if ([2,3].includes(event.version)) {
    if (event.version===2&&event.receipt.customerId!==null||event.version===3&&!saleUuid_(event.receipt.customerId))failure_('JOURNAL_INVALID');
    if (!['ATENDENTE', 'ADMIN', 'SUPER_ADMIN'].includes(event.actorRole)) failure_('JOURNAL_INVALID');
    command.paymentMethod = event.receipt.paymentMethod; command.customerId = event.receipt.customerId; command.expectedTotalCents = total;
    try { checkoutCommand_(command); } catch (_) { failure_('JOURNAL_INVALID'); }
    if (!same_(event.receipt.items, event.lines.map(function (line) { return { productId: line.productId, quantity: line.quantity, unitPriceCents: line.unitPriceCents, subtotalCents: line.subtotalCents }; })) ||
        !same_(event.lines.map(function (line) { return { productId: line.productId, quantity: line.quantity }; }), command.items)) failure_('JOURNAL_INVALID');
  }
  if (total !== event.receipt.totalCents || event.commandHash !== digest_(JSON.stringify(command)) ||
      row.ID_Evento !== event.idempotencyKey || row.Chave_Idempotencia !== event.idempotencyKey ||
      row.Tipo !== event.type || row.Hash_Comando !== event.commandHash || row.Versao_Esquema !== ([2,3].includes(event.version) ? event.version : 1) ||
      row.Criado_Em !== event.receipt.createdAt || row.Estado_Projecao !== 'PENDENTE') failure_('JOURNAL_INVALID');
}
function ensureSaleRow_(table, keyColumns, values, write) {
  var row = table.columns.map(function (column) { return Object.prototype.hasOwnProperty.call(values, column) ? values[column] : ''; });
  var matches = table.rows.filter(function (candidate) {
    return keyColumns.every(function (key) { var col = table.columns.indexOf(key); return candidate[col] === row[col]; });
  });
  if (matches.length > 1 || (matches.length && !same_(matches[0], row))) failure_('PROJECTION_CONFLICT');
  if (!matches.length && write) { table.sheet.appendRow(row); table.rows.push(row); SpreadsheetApp.flush(); }
}
function recoverSales_(ss) {
  assertSchema_(ss);
  var journal = saleTable_(ss, '_Eventos_Dominio');
  // Bound execution and fail before writes; archival/checkpoint compaction is a
  // separate migration, never silently truncate authoritative history.
  if (journal.rows.length > 2000) failure_('JOURNAL_CAPACITY');
  var events = [], eventKeys = new Set();
  saleObjects_(journal).forEach(function (row) {
    if (!['SALE_COMMITTED', 'STOCK_RECEIVED'].includes(row.Tipo)) failure_('JOURNAL_INVALID');
    var event;
    try { event = JSON.parse(row.Conteudo_JSON); } catch (_) { failure_('JOURNAL_INVALID'); }
    if (row.Tipo === 'STOCK_RECEIVED') validateStockEvent_(event, row); else validateSaleEvent_(event, row);
    if (eventKeys.has(event.idempotencyKey)) failure_('JOURNAL_INVALID');
    eventKeys.add(event.idempotencyKey); events.push(event);
  });
  var products = saleTable_(ss, 'Produtos'), byId = {};
  saleObjects_(products).forEach(function (product) {
    if (byId[product.ID_Produto]) failure_('PROJECTION_CONFLICT');
    byId[product.ID_Produto] = product;
  });
  var sales = saleTable_(ss, 'Vendas'), items = saleTable_(ss, 'Itens_Venda'), movements = saleTable_(ss, 'Movimentacoes_Estoque'), audit = saleTable_(ss, 'Logs_Auditoria');
  var plans = [], transitions = {};
  events.forEach(function (event) {
    if (event.type === 'STOCK_RECEIVED') {
      var r = event.receipt;
      if (!transitions[r.id]) transitions[r.id] = [];
      transitions[r.id].push({ version: r.version - 1, before: r.stockBefore, after: r.stockAfter });
      plans.push({ table: movements, keys: ['ID_Movimentacao'], values: {
        ID_Movimentacao: r.commandId, Data_Hora: r.createdAt, ID_Produto: r.id, Tipo: 'ENTRADA', Quantidade: r.quantity,
        Saldo_Anterior: r.stockBefore, Saldo_Posterior: r.stockAfter, Motivo: event.reason, ID_Venda: '', ID_Usuario: event.actorId } });
      plans.push({ table: audit, keys: ['ID_Log'], values: {
        ID_Log: r.commandId, Data_Hora: r.createdAt, ID_Usuario: event.actorId, Perfil: event.actorRole,
        Acao: 'STOCK_RECEIVED', Entidade: 'Produtos', ID_Entidade: r.id, Antes: JSON.stringify({ stock: r.stockBefore, version: r.version - 1 }),
        Depois: JSON.stringify({ stock: r.stockAfter, version: r.version, quantity: r.quantity, reason: event.reason }), Resultado: 'SUCESSO', ID_Requisicao: r.commandId } });
      return;
    }
    var sale = { ID_Venda: event.idempotencyKey, Data_Hora: event.receipt.createdAt,
      ID_Atendente: event.actorId, Valor_Total: event.receipt.totalCents,
      Status: 'CONFIRMADA', Origem: [2,3].includes(event.version) ? 'CAIXA_DEV' : 'DEV_TEST', Idempotency_Key: event.idempotencyKey };
    if ([2,3].includes(event.version)) sale.Forma_Pagamento = event.receipt.paymentMethod;
    if(event.version===3)sale.ID_Cliente=event.receipt.customerId;
    plans.push({ table: sales, keys: ['ID_Venda'], values: sale });
    if ([2,3].includes(event.version)) plans.push({ table: audit, keys: ['ID_Log'], values: {
      ID_Log: event.idempotencyKey, Data_Hora: event.receipt.createdAt, ID_Usuario: event.actorId, Perfil: event.actorRole,
      Acao: 'SALE_COMMITTED', Entidade: 'Vendas', ID_Entidade: event.idempotencyKey, Antes: '',
      Depois: JSON.stringify({ totalCents: event.receipt.totalCents, paymentMethod: event.receipt.paymentMethod, customerId: event.receipt.customerId,
        items: event.receipt.items }), Resultado: 'SUCESSO', ID_Requisicao: event.idempotencyKey } });
    event.lines.forEach(function (line) {
      var product = byId[line.productId];
      if (!product || !saleInteger_(product.Estoque_Atual) || !saleInteger_(product.Versao_Registro)) failure_('PROJECTION_CONFLICT');
      if (!transitions[line.productId]) transitions[line.productId] = [];
      transitions[line.productId].push({ version: line.expectedVersion, before: line.stockAfter + line.quantity, after: line.stockAfter });
      plans.push({ table: items, keys: ['ID_Venda', 'ID_Produto'], values: {
        ID_Venda: event.idempotencyKey, ID_Produto: line.productId, Quantidade: line.quantity,
        Preco_Unitario: line.unitPriceCents, Subtotal: line.subtotalCents } });
      plans.push({ table: movements, keys: ['ID_Movimentacao'], values: {
        ID_Movimentacao: event.idempotencyKey + ':' + line.productId, Data_Hora: event.receipt.createdAt,
        ID_Produto: line.productId, Tipo: 'SAIDA', Quantidade: line.quantity,
        Saldo_Anterior: line.stockAfter + line.quantity, Saldo_Posterior: line.stockAfter,
        Motivo: 'VENDA', ID_Venda: event.idempotencyKey, ID_Usuario: event.actorId } });
    });
  });
  var identified=events.filter(function(e){return e.version===3;}),customers=null,latest={};
  if(identified.length){recoverCustomers_(ss);customers=customerRows_(ss);identified.forEach(function(e){var id=e.receipt.customerId;if(!latest[id]||latest[id]<e.receipt.createdAt)latest[id]=e.receipt.createdAt;});
    Object.keys(latest).forEach(function(id){var r=customers.rows.filter(function(r){return r.ID_Cliente===id;})[0];if(!r||r.Ultima_Compra&&r.Ultima_Compra>latest[id])failure_('PROJECTION_CONFLICT');});
  }
  // Validate ALL projections and stock checkpoints before any mutation.
  plans.forEach(function (plan) { ensureSaleRow_(plan.table, plan.keys, plan.values, false); });
  var missingAudit = plans.filter(function (plan) { return plan.table === audit && !audit.rows.some(function (row) { return row[audit.columns.indexOf('ID_Log')] === plan.values.ID_Log; }); }).length;
  if (audit.rows.length + missingAudit > 5000) failure_('JOURNAL_CAPACITY');
  var chains = inventoryChains_(ss, products, byId, transitions);
  plans.forEach(function (plan) { ensureSaleRow_(plan.table, plan.keys, plan.values, true); });
  Object.keys(chains).forEach(function (id) {
    var product = byId[id], final = chains[id][chains[id].length - 1];
    if (product.Versao_Registro === final.version) return;
    // Stock + checkpoint in ONE row write. Never write the two cells separately.
    var row = products.rows[product.rowNumber - 2].slice();
    row[products.columns.indexOf('Estoque_Atual')] = final.stock;
    row[products.columns.indexOf('Versao_Registro')] = final.version;
    products.sheet.getRange(product.rowNumber, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();
  });
  // Last purchase is derived from authoritative events, including response-loss repair.
  if(customers)Object.keys(latest).forEach(function(id){var r=customers.rows.filter(function(r){return r.ID_Cliente===id;})[0];if(r.Ultima_Compra!==latest[id]){r.Ultima_Compra=latest[id];accessSaveMain_(customers,r);}});
  synchronizeStockNotifications_(ss);
  return { recoveredSales: events.filter(function (event) { return event.type === 'SALE_COMMITTED'; }).length };
}
// Owner-only editor action; no public endpoint, no supplied actor impersonation.
function recoverDevelopmentSales() {
  var c = baseSettings_(); requireOwnerDev_(c);
  return withLock_(function () {
    if (PropertiesService.getScriptProperties().getProperty('CATALOG_JOURNAL_ID')) recoverCatalog_(c);
    return recoverSales_(storage_(c, false).spreadsheet);
  });
}
