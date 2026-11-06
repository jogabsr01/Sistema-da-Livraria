/* Positive stock receipts and metadata-aware inventory checkpoints.
 * All entry points execute under the same installation ScriptLock as sales. */
function stockCommand_(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || !same_(Object.keys(p).sort(), ['commandId', 'expectedVersion', 'id', 'quantity', 'reason']) ||
      !saleUuid_(p.commandId) || !saleUuid_(p.id) || !Number.isSafeInteger(p.expectedVersion) || p.expectedVersion < 1 || p.expectedVersion >= 1000000000 ||
      !Number.isSafeInteger(p.quantity) || p.quantity < 1 || p.quantity > 1000000 || typeof p.reason !== 'string' || !p.reason || p.reason !== p.reason.trim() ||
      p.reason.length > 300 || /[\x00-\x1f\x7f]/.test(p.reason) || /^[=+@-]/.test(p.reason)) failure_('INVALID_STOCK_RECEIPT');
  return { commandId: p.commandId, id: p.id, expectedVersion: p.expectedVersion, quantity: p.quantity, reason: p.reason };
}
function validateStockEvent_(event, row) {
  var receipt = event && event.receipt;
  if (!event || event.type !== 'STOCK_RECEIVED' || event.version !== 1 || !saleUuid_(event.actorId) || !['ADMIN', 'SUPER_ADMIN', 'ATENDENTE'].includes(event.actorRole) ||
      !receipt || receipt.commandId !== event.idempotencyKey || !saleInteger_(receipt.stockBefore) || !saleInteger_(receipt.stockAfter) || receipt.stockAfter > 1000000 ||
      receipt.stockAfter !== receipt.stockBefore + receipt.quantity || !Number.isSafeInteger(receipt.version) ||
      typeof receipt.createdAt !== 'string' || !Number.isFinite(Date.parse(receipt.createdAt))) failure_('JOURNAL_INVALID');
  var command;
  try { command = stockCommand_({ commandId: receipt.commandId, id: receipt.id, expectedVersion: receipt.version - 1, quantity: receipt.quantity, reason: event.reason }); }
  catch (_) { failure_('JOURNAL_INVALID'); }
  if (event.commandHash !== digest_(JSON.stringify(command)) || row.ID_Evento !== event.idempotencyKey || row.Chave_Idempotencia !== event.idempotencyKey || row.Tipo !== event.type ||
      row.Hash_Comando !== event.commandHash || row.Versao_Esquema !== 1 || row.Criado_Em !== receipt.createdAt || row.Estado_Projecao !== 'PENDENTE') failure_('JOURNAL_INVALID');
}
function receiveStock_(request, c, principal, ss) {
  var command = stockCommand_(request.payload), hash = digest_(JSON.stringify(command)), journal = saleTable_(ss, '_Eventos_Dominio');
  var prior = saleObjects_(journal).filter(function (row) { return row.ID_Evento === command.commandId; });
  if (prior.length) {
    var event = JSON.parse(prior[0].Conteudo_JSON);
    if (prior.length !== 1 || event.type !== 'STOCK_RECEIVED' || event.actorId !== principal.id || event.commandHash !== hash) failure_('IDEMPOTENCY_CONFLICT');
    return event.receipt;
  }
  var audit = saleTable_(ss, 'Logs_Auditoria');
  if (journal.rows.length >= 2000 || audit.rows.length >= 5000) failure_('JOURNAL_CAPACITY');
  if (saleObjects_(audit).some(function (row) { return row.ID_Log === command.commandId; }) || catalogJournal_(c).rows.some(function (row) { return row.Command_ID === command.commandId; })) failure_('IDEMPOTENCY_CONFLICT');
  var product = catalogProducts_(ss).rows.filter(function (row) { return row.ID_Produto === command.id; })[0];
  if (!product || !product.Ativo) failure_('PRODUCT_UNAVAILABLE');
  if (product.Versao_Registro !== command.expectedVersion) catalogFail_('CATALOG_CONFLICT');
  var stockAfter = product.Estoque_Atual + command.quantity;
  if (!saleInteger_(stockAfter) || stockAfter > 1000000) failure_('STOCK_LIMIT');
  var receipt = { commandId: command.commandId, id: command.id, quantity: command.quantity, version: command.expectedVersion + 1,
    stockBefore: product.Estoque_Atual, stockAfter: stockAfter, createdAt: new Date().toISOString() };
  var event = { type: 'STOCK_RECEIVED', version: 1, idempotencyKey: command.commandId, commandHash: hash, actorId: principal.id, actorRole: principal.role, reason: command.reason, receipt: receipt };
  var values = { ID_Evento: command.commandId, Tipo: event.type, Chave_Idempotencia: command.commandId, Hash_Comando: hash, Conteudo_JSON: JSON.stringify(event),
    Estado_Projecao: 'PENDENTE', Criado_Em: receipt.createdAt, Versao_Esquema: 1 };
  validateStockEvent_(event, values);
  journal.sheet.appendRow(journal.columns.map(function (key) { return values[key]; })); SpreadsheetApp.flush();
  recoverSales_(ss); return receipt;
}
function inventoryChains_(ss, products, byId, transitions) {
  var floors = {}, latestMetadata = {}, chains = {};
  Object.keys(transitions).forEach(function (id) { floors[id] = Math.min.apply(null, transitions[id].map(function (point) { return point.version; })); });
  if (Object.keys(floors).length && scriptProperties_().getProperty('CATALOG_JOURNAL_ID')) {
    var c = baseSettings_(), journal = catalogJournal_(c);
    journal.rows.forEach(function (row) {
      if (!Object.prototype.hasOwnProperty.call(floors, row.Product_ID) || row.Expected_Version < floors[row.Product_ID]) return;
      if (row.State !== 'COMPLETE') failure_('PROJECTION_CONFLICT');
      var intent = catalogIntent_(c, row, products.columns), after = intent.desired;
      if (!intent.before) failure_('PROJECTION_CONFLICT');
      var beforeStock = intent.before.values[products.columns.indexOf('Estoque_Atual')];
      if (beforeStock !== after.Estoque_Atual) failure_('PROJECTION_CONFLICT');
      transitions[row.Product_ID].push({ version: row.Expected_Version, before: beforeStock, after: after.Estoque_Atual });
      if (!latestMetadata[row.Product_ID] || after.Versao_Registro > latestMetadata[row.Product_ID].Versao_Registro) latestMetadata[row.Product_ID] = after;
    });
  }
  Object.keys(transitions).forEach(function (id) {
    var steps = transitions[id].sort(function (a, b) { return a.version - b.version; }), product = byId[id];
    if (!product || !saleInteger_(product.Estoque_Atual) || !saleInteger_(product.Versao_Registro)) failure_('PROJECTION_CONFLICT');
    var chain = [{ version: steps[0].version, stock: steps[0].before }];
    steps.forEach(function (step) {
      var last = chain[chain.length - 1];
      if (last.version !== step.version || last.stock !== step.before) failure_('PROJECTION_CONFLICT');
      chain.push({ version: step.version + 1, stock: step.after });
    });
    var metadata = latestMetadata[id];
    // COMPLETE metadata must already be present; inventory recovery may never
    // manufacture a metadata version or restore an old title/photo/status.
    if (metadata && (product.Versao_Registro < metadata.Versao_Registro || products.columns.some(function (key) {
      return !['Estoque_Atual', 'Versao_Registro'].includes(key) && product[key] !== metadata[key];
    }))) failure_('PROJECTION_CONFLICT');
    if (!chain.some(function (point) { return point.version === product.Versao_Registro && point.stock === product.Estoque_Atual; })) failure_('PROJECTION_CONFLICT');
    chains[id] = chain;
  });
  return chains;
}
