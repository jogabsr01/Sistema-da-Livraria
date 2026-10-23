/* Internal projection adapter. No HTTP sale endpoint or customer/payment writes.
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
  if (total !== event.receipt.totalCents || event.commandHash !== digest_(JSON.stringify(command)) ||
      row.ID_Evento !== event.idempotencyKey || row.Chave_Idempotencia !== event.idempotencyKey ||
      row.Tipo !== event.type || row.Hash_Comando !== event.commandHash || row.Versao_Esquema !== 1 ||
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
    if (row.Tipo !== 'SALE_COMMITTED') failure_('JOURNAL_INVALID');
    var event;
    try { event = JSON.parse(row.Conteudo_JSON); } catch (_) { failure_('JOURNAL_INVALID'); }
    validateSaleEvent_(event, row);
    if (eventKeys.has(event.idempotencyKey)) failure_('JOURNAL_INVALID');
    eventKeys.add(event.idempotencyKey); events.push(event);
  });
  var products = saleTable_(ss, 'Produtos'), byId = {};
  saleObjects_(products).forEach(function (product) {
    if (byId[product.ID_Produto]) failure_('PROJECTION_CONFLICT');
    byId[product.ID_Produto] = product;
  });
  var sales = saleTable_(ss, 'Vendas'), items = saleTable_(ss, 'Itens_Venda'), movements = saleTable_(ss, 'Movimentacoes_Estoque');
  var plans = [], chains = {};
  events.forEach(function (event) {
    var sale = { ID_Venda: event.idempotencyKey, Data_Hora: event.receipt.createdAt,
      ID_Atendente: event.actorId, Valor_Total: event.receipt.totalCents,
      Status: 'CONFIRMADA', Origem: 'DEV_TEST', Idempotency_Key: event.idempotencyKey };
    plans.push({ table: sales, keys: ['ID_Venda'], values: sale });
    event.lines.forEach(function (line) {
      var product = byId[line.productId];
      if (!product || !saleInteger_(product.Estoque_Atual) || !saleInteger_(product.Versao_Registro)) failure_('PROJECTION_CONFLICT');
      var chain = chains[line.productId];
      if (!chain) chain = chains[line.productId] = [{ version: line.expectedVersion, stock: line.stockAfter + line.quantity }];
      var last = chain[chain.length - 1];
      if (last.version !== line.expectedVersion || last.stock !== line.stockAfter + line.quantity) failure_('PROJECTION_CONFLICT');
      chain.push({ version: line.expectedVersion + 1, stock: line.stockAfter });
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
  // Validate ALL projections and stock checkpoints before any mutation.
  plans.forEach(function (plan) { ensureSaleRow_(plan.table, plan.keys, plan.values, false); });
  Object.keys(chains).forEach(function (id) {
    var product = byId[id];
    if (!chains[id].some(function (point) { return point.version === product.Versao_Registro && point.stock === product.Estoque_Atual; })) failure_('PROJECTION_CONFLICT');
  });
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
  return { recoveredSales: events.length };
}
// Owner-only editor action; no public endpoint, no supplied actor impersonation.
function recoverDevelopmentSales() {
  var c = baseSettings_(); requireOwnerDev_(c);
  return withLock_(function () {
    if (PropertiesService.getScriptProperties().getProperty('CATALOG_JOURNAL_ID')) recoverCatalog_(c);
    return recoverSales_(storage_(c, false).spreadsheet);
  });
}
