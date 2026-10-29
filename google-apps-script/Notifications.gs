/* DEV stock alerts and replenishment reports. Caller holds ScriptLock. */
function notificationEnabled_() { return scriptProperties_().getProperty('NOTIFICATIONS_ENABLED') === 'true'; }
function notificationTime_(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function notificationId_(product) {
  var c = baseSettings_(), hash = digest_(JSON.stringify(['stock-alert.v1', c.installationId, product.ID_Produto, product.Versao_Registro]));
  return hash.slice(0, 8) + '-' + hash.slice(8, 12) + '-4' + hash.slice(13, 16) + '-8' + hash.slice(17, 20) + '-' + hash.slice(20, 32);
}
function notificationRows_(ss) {
  var table = identityRows_(ss, 'Notificacoes'), ids = new Set(), open = new Set();
  if (table.rows.length > 5000) failure_('NOTIFICATION_CAPACITY');
  table.rows.forEach(function (row) {
    var maintenance=row.Tipo==='MAINTENANCE_COMPLETED',stock=['STOCK_ZERO','STOCK_LOW'].includes(row.Tipo),schedule=['SCHEDULE_PUBLISHED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED'].includes(row.Tipo);
    if(!saleUuid_(row.ID_Notificacao)||ids.has(row.ID_Notificacao)||!stock&&!schedule&&!maintenance||!saleUuid_(row.ID_Referencia)||!notificationTime_(row.Criado_Em))failure_('NOTIFICATIONS_UNAVAILABLE');
    if(stock&&(!['ALTA','MEDIA'].includes(row.Prioridade)||row.Entidade_Referencia!=='Produtos'||!['ABERTA','EM_ATENDIMENTO','RESOLVIDA'].includes(row.Status)||row.Status==='RESOLVIDA'&&(!notificationTime_(row.Resolvido_Em)||row.Resolvido_Por!=='SYSTEM_STOCK')||row.Status!=='RESOLVIDA'&&(row.Resolvido_Em!==''||row.Resolvido_Por!=='')))failure_('NOTIFICATIONS_UNAVAILABLE');
    if(schedule&&(row.Prioridade!=='MEDIA'||row.Entidade_Referencia!=='Escalas'||row.Status!=='ABERTA'||row.Resolvido_Em!==''||row.Resolvido_Por!==''))failure_('NOTIFICATIONS_UNAVAILABLE');
    if(maintenance&&(row.Prioridade!=='MEDIA'||row.Entidade_Referencia!=='Configuracoes'||row.Status!=='ABERTA'||row.Resolvido_Em!==''||row.Resolvido_Por!==''))failure_('NOTIFICATIONS_UNAVAILABLE');
    catalogText_(row.Titulo,300,true);catalogText_(row.Mensagem,300,true);ids.add(row.ID_Notificacao);
    if(stock&&row.Status!=='RESOLVIDA'){if(open.has(row.ID_Referencia))failure_('NOTIFICATIONS_UNAVAILABLE');open.add(row.ID_Referencia);}
  }); return table;
}
function notificationReads_(ss) {
  var table = identityRows_(ss, 'Notificacoes_Usuarios'), keys = new Set();
  if (table.rows.length > 5000) failure_('NOTIFICATION_CAPACITY');
  table.rows.forEach(function (row) {
    var key = row.ID_Notificacao + ':' + row.ID_Usuario;
    if (!saleUuid_(row.ID_Notificacao) || !saleUuid_(row.ID_Usuario) || keys.has(key) || !notificationTime_(row.Lida_Em) || row.Confirmada_Em !== '') failure_('NOTIFICATIONS_UNAVAILABLE'); keys.add(key);
  }); return table;
}
function notificationWrite_(table, row) {
  var values = table.columns.map(function (key) { return row[key]; });
  if (row.number) table.sheet.getRange(row.number, 1, 1, values.length).setValues([values]);
  else { table.sheet.appendRow(values); row.number = table.sheet.getLastRow(); table.rows.push(row); }
  SpreadsheetApp.flush();
}
function notificationStateCommands_(audit, notifications) {
  var latest = {}, ids = new Set();
  saleObjects_(audit).filter(function (row) { return row.Acao === 'STOCK_ALERT_STATE'; }).forEach(function (row) {
    var data; try { data = JSON.parse(row.Depois); } catch (_) { failure_('NOTIFICATIONS_UNAVAILABLE'); }
    if (!saleUuid_(row.ID_Log) || ids.has(row.ID_Log) || !saleUuid_(row.ID_Usuario) || !['ADMIN', 'SUPER_ADMIN'].includes(row.Perfil) || row.Entidade !== 'Notificacoes' ||
        !saleUuid_(row.ID_Entidade) || !notificationTime_(row.Data_Hora) || row.Resultado !== 'ACEITO' || row.ID_Requisicao !== row.ID_Log ||
        !data || !same_(Object.keys(data).sort(), ['id', 'state']) || data.id !== row.ID_Entidade || !['ABERTA', 'EM_ATENDIMENTO'].includes(data.state) ||
        !notifications.rows.some(function (n) { return n.ID_Notificacao === data.id; })) failure_('NOTIFICATIONS_UNAVAILABLE');
    ids.add(row.ID_Log); latest[data.id] = data.state;
  }); return latest;
}
function synchronizeStockNotifications_(ss) {
  if (!notificationEnabled_()) return;
  var allRows=notificationRows_(ss),table={sheet:allRows.sheet,columns:allRows.columns,rows:allRows.rows.filter(function(r){return r.Entidade_Referencia==='Produtos';})}, products = catalogProducts_(ss), audit = saleTable_(ss, 'Logs_Auditoria'), now = new Date().toISOString();
  if (products.rows.length > 5000 || audit.rows.length > 5000) failure_('NOTIFICATION_CAPACITY');
  var byProduct = {}, byId = {}, writes = [], logs = [];
  table.rows.forEach(function (row) { if (row.Status !== 'RESOLVIDA') byProduct[row.ID_Referencia] = row; byId[row.ID_Notificacao] = row; });
  products.rows.forEach(function (p) {
    catalogText_(p.Titulo, 300, true);
    if (!saleInteger_(p.Estoque_Minimo) || p.Estoque_Minimo > 1000000) failure_('NOTIFICATIONS_UNAVAILABLE');
    var type = p.Ativo && p.Estoque_Atual === 0 ? 'STOCK_ZERO' : p.Ativo && p.Estoque_Atual < p.Estoque_Minimo ? 'STOCK_LOW' : null, current = byProduct[p.ID_Produto];
    if (type) {
      if (current && current.Tipo !== type) {
        current.Status = 'RESOLVIDA'; current.Resolvido_Em = now; current.Resolvido_Por = 'SYSTEM_STOCK'; writes.push(current); current = null;
      }
      if (!current) {
        var id = notificationId_(p);
        // A resolved episode at this same version must not reopen by polling.
        if (byId[id]) failure_('NOTIFICATIONS_UNAVAILABLE');
        current = { ID_Notificacao: id, Tipo: type, Prioridade: type === 'STOCK_ZERO' ? 'ALTA' : 'MEDIA', Titulo: p.Titulo,
          Mensagem: 'Estoque atual: ' + p.Estoque_Atual + '. Estoque mínimo: ' + p.Estoque_Minimo + '.', Entidade_Referencia: 'Produtos', ID_Referencia: p.ID_Produto,
          Status: 'ABERTA', Criado_Em: now, Resolvido_Em: '', Resolvido_Por: '' };
        writes.push(current); byId[id] = current;
      } else if (current.Titulo !== p.Titulo || current.Mensagem !== 'Estoque atual: ' + p.Estoque_Atual + '. Estoque mínimo: ' + p.Estoque_Minimo + '.') {
        current.Tipo = type; current.Prioridade = type === 'STOCK_ZERO' ? 'ALTA' : 'MEDIA'; current.Titulo = p.Titulo;
        current.Mensagem = 'Estoque atual: ' + p.Estoque_Atual + '. Estoque mínimo: ' + p.Estoque_Minimo + '.'; writes.push(current);
      }
    } else if (current) { current.Status = 'RESOLVIDA'; current.Resolvido_Em = now; current.Resolvido_Por = 'SYSTEM_STOCK'; writes.push(current); }
  });
  // A product must be preserved by logical exclusion, never silently disappear.
  table.rows.forEach(function (row) { if (!products.rows.some(function (p) { return p.ID_Produto === row.ID_Referencia; })) failure_('NOTIFICATIONS_UNAVAILABLE'); });
  var all = table.rows.concat(writes.filter(function (row) { return !row.number; }));
  all.forEach(function (row) {
    logs.push({ ID_Log: row.ID_Notificacao + ':opened', Data_Hora: row.Criado_Em, ID_Usuario: 'SYSTEM_STOCK', Perfil: 'SYSTEM', Acao: 'STOCK_ALERT_OPENED', Entidade: 'Notificacoes', ID_Entidade: row.ID_Notificacao,
      Antes: '', Depois: JSON.stringify({ productId: row.ID_Referencia }), Resultado: 'SUCESSO', ID_Requisicao: row.ID_Notificacao });
    if (row.Status === 'RESOLVIDA') logs.push({ ID_Log: row.ID_Notificacao + ':resolved', Data_Hora: row.Resolvido_Em, ID_Usuario: 'SYSTEM_STOCK', Perfil: 'SYSTEM', Acao: 'STOCK_ALERT_RESOLVED', Entidade: 'Notificacoes', ID_Entidade: row.ID_Notificacao,
      Antes: '', Depois: JSON.stringify({ productId: row.ID_Referencia }), Resultado: 'SUCESSO', ID_Requisicao: row.ID_Notificacao });
  });
  var states = notificationStateCommands_(audit, { rows: all });
  all.forEach(function (row) { if (row.Status !== 'RESOLVIDA' && states[row.ID_Notificacao] && row.Status !== states[row.ID_Notificacao]) { row.Status = states[row.ID_Notificacao]; if (writes.indexOf(row) < 0) writes.push(row); } });
  logs.forEach(function (log) { ensureSaleRow_(audit, ['ID_Log'], log, false); });
  var missing = logs.filter(function (log) { return !audit.rows.some(function (r) { return r[audit.columns.indexOf('ID_Log')] === log.ID_Log; }); }).length;
  if (all.length+allRows.rows.length-table.rows.length > 5000 || audit.rows.length + missing > 5000) failure_('NOTIFICATION_CAPACITY');
  writes.forEach(function (row) { notificationWrite_(table, row); });
  logs.forEach(function (log) { ensureSaleRow_(audit, ['ID_Log'], log, true); });
}
function notificationDto_(row, product, read) {
  return { id: row.ID_Notificacao, productId: row.ID_Referencia, type: row.Tipo, priority: row.Prioridade, title: row.Titulo, state: row.Status,
    createdAt: row.Criado_Em, resolvedAt: row.Resolvido_Em || null, read: !!read, stock: product.Estoque_Atual, minimumStock: product.Estoque_Minimo };
}
function stockReport_(request, ss, principal, notifications) {
  var p = request.payload;
  authControlExact_(p, ['scope', 'supplier', 'format']);
  if (!['zero', 'low'].includes(p.scope) || p.supplier !== null && (typeof p.supplier !== 'string' || p.supplier.length > 160) || !['view', 'csv', 'print', 'copy'].includes(p.format)) failure_('INVALID_NOTIFICATION');
  if (!['ADMIN', 'SUPER_ADMIN'].includes(principal.role) || !businessAssurance_(principal) || Date.now() - principal.authenticatedAt > 300000) failure_('FORBIDDEN');
  function supplier(value) { catalogText_(value, 160, false); return value.normalize('NFC').replace(/\s+/g, ' ').trim(); }
  var products = catalogProducts_(ss).rows, groups = Object.create(null), count = 0, units = 0, missing = 0;
  products.forEach(function (product) {
    if (!product.Ativo || !(product.Estoque_Atual === 0 || p.scope === 'low' && product.Estoque_Atual < product.Estoque_Minimo)) return;
    var name = supplier(product.Fornecedor), key = name.toLowerCase();
    if (p.supplier !== null && key !== supplier(p.supplier).toLowerCase()) return;
    if (!groups[key]) groups[key] = { supplier: name, items: [] };
    var open = notifications.rows.filter(function (row) { return row.ID_Referencia === product.ID_Produto && row.Status !== 'RESOLVIDA'; });
    if (open.length !== 1) failure_('NOTIFICATIONS_UNAVAILABLE');
    var suggested = Math.max(1, product.Estoque_Minimo - product.Estoque_Atual);
    groups[key].items.push({ id: product.ID_Produto, title: product.Titulo, isbn: product.ISBN, internalCode: product.Codigo_Interno,
      stock: product.Estoque_Atual, minimumStock: product.Estoque_Minimo, suggestedQuantity: suggested, alertState: open[0].Status, since: open[0].Criado_Em });
    count++; units += suggested; if (!name) missing++;
  });
  var data = { reportId: request.requestId, generatedAt: new Date().toISOString(), scope: p.scope, supplier: p.supplier,
    groups: Object.keys(groups).sort().map(function (key) { var group = groups[key]; group.items.sort(function (a, b) { return a.title.localeCompare(b.title) || a.id.localeCompare(b.id); }); return group; }),
    totalBooks: count, suggestedUnits: units, missingSupplier: missing };
  // Whole snapshot or explicit refusal; never silently truncate the order list.
  if (count > 5000 || Utilities.base64Encode(Utilities.newBlob(JSON.stringify(data)).getBytes()).length > 3500000) failure_('NOTIFICATION_CAPACITY');
  var audit = saleTable_(ss, 'Logs_Auditoria'); if (audit.rows.length >= 5000) failure_('NOTIFICATION_CAPACITY');
  ensureSaleRow_(audit, ['ID_Log'], { ID_Log: request.requestId, Data_Hora: data.generatedAt, ID_Usuario: principal.id, Perfil: principal.role,
    Acao: p.format === 'view' ? 'STOCK_REPORT_VIEW' : 'STOCK_REPORT_EXPORT', Entidade: 'Produtos', ID_Entidade: request.requestId,
    Antes: '', Depois: JSON.stringify({ scope: p.scope, supplier: p.supplier, format: p.format, books: count, suggestedUnits: units }), Resultado: 'SUCESSO', ID_Requisicao: request.requestId }, true);
  return data;
}
function notificationOperation_(request, c) {
  if (c.environment !== 'dev' || !request.actor || !same_(Object.keys(request.actor), ['sessionTokenHash']) || !accessHash_(request.actor.sessionTokenHash)) failure_('UNAUTHENTICATED');
  var principal = identitySessionOperation_({ action: 'identity.session.read', payload: { tokenHash: request.actor.sessionTokenHash } }, c);
  recoverCatalog_(c); var ss = storage_(c, false).spreadsheet; recoverSales_(ss);
  var table = notificationRows_(ss), reads = notificationReads_(ss), p = request.payload, operation = request.action.slice('notifications.'.length);
  var bindings=scheduleNotificationBindings_(ss);
  table.rows.forEach(function(n){if(n.Entidade_Referencia==='Escalas'){var binding=bindings.get(n.ID_Notificacao);if(!binding||binding.scheduleId!==n.ID_Referencia||binding.type!==n.Tipo)failure_('NOTIFICATIONS_UNAVAILABLE');}});
  table={sheet:table.sheet,columns:table.columns,rows:table.rows.filter(function(n){return n.Entidade_Referencia==='Produtos'||n.Entidade_Referencia==='Configuracoes'&&['ADMIN','SUPER_ADMIN'].includes(principal.role)||n.Entidade_Referencia==='Escalas'&&bindings.get(n.ID_Notificacao).userId===principal.id;})};
  var isRead=function(n){return reads.rows.some(function(r){return r.ID_Notificacao===n.ID_Notificacao&&r.ID_Usuario===principal.id;});},pending=function(n){return n.Entidade_Referencia!=='Produtos'?!isRead(n):n.Status!=='RESOLVIDA';};
  if (operation === 'report') return stockReport_(request, ss, principal, {rows:table.rows.filter(function(n){return n.Entidade_Referencia==='Produtos';})});
  if (operation === 'read') {
    authControlExact_(p, ['id']); if (!saleUuid_(p.id) || !table.rows.some(function (row) { return row.ID_Notificacao === p.id; })) failure_('NOTIFICATION_NOT_FOUND');
    var prior = reads.rows.filter(function (row) { return row.ID_Notificacao === p.id && row.ID_Usuario === principal.id; });
    if (!prior.length) { if (reads.rows.length >= 5000) failure_('NOTIFICATION_CAPACITY'); notificationWrite_(reads, { ID_Notificacao: p.id, ID_Usuario: principal.id, Lida_Em: new Date().toISOString(), Confirmada_Em: '' }); }
    return { read: true };
  }
  if (operation === 'state') {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(principal.role)) failure_('FORBIDDEN');
    authControlExact_(p, ['commandId', 'id', 'state']);
    if (!saleUuid_(p.commandId) || !saleUuid_(p.id) || !['ABERTA', 'EM_ATENDIMENTO'].includes(p.state)) failure_('INVALID_NOTIFICATION');
    var target = table.rows.filter(function (row) { return row.ID_Notificacao === p.id; })[0]; if (!target||target.Entidade_Referencia!=='Produtos') failure_('NOTIFICATION_NOT_FOUND');
    var audit = saleTable_(ss, 'Logs_Auditoria'), old = saleObjects_(audit).filter(function (row) { return row.ID_Log === p.commandId; });
    var after = JSON.stringify({ id: p.id, state: p.state });
    if (old.length) { if (old.length !== 1 || old[0].Acao !== 'STOCK_ALERT_STATE' || old[0].ID_Usuario !== principal.id || old[0].Depois !== after) failure_('NOTIFICATION_CONFLICT'); return { accepted: true }; }
    if (target.Status === 'RESOLVIDA') failure_('NOTIFICATION_CONFLICT');
    if (audit.rows.length >= 5000) failure_('NOTIFICATION_CAPACITY');
    ensureSaleRow_(audit, ['ID_Log'], { ID_Log: p.commandId, Data_Hora: new Date().toISOString(), ID_Usuario: principal.id, Perfil: principal.role,
      Acao: 'STOCK_ALERT_STATE', Entidade: 'Notificacoes', ID_Entidade: p.id, Antes: '', Depois: after, Resultado: 'ACEITO', ID_Requisicao: p.commandId }, true);
    synchronizeStockNotifications_(ss); return { accepted: true };
  }
  if (operation === 'summary') {
    authControlExact_(p, []); var active = table.rows.filter(pending);
    return { total: active.length, unread: active.filter(function (row) { return !reads.rows.some(function (r) { return r.ID_Notificacao === row.ID_Notificacao && r.ID_Usuario === principal.id; }); }).length };
  }
  if (operation !== 'list') failure_('FORBIDDEN'); authControlExact_(p, ['offset', 'history']);
  if (!Number.isSafeInteger(p.offset) || p.offset < 0 || p.offset > 5000 || typeof p.history !== 'boolean') failure_('INVALID_NOTIFICATION');
  var products = catalogProducts_(ss).rows, filtered = table.rows.filter(function (row) { return p.history || pending(row); });
  filtered.sort(function (a, b) { return Number(a.Status === 'RESOLVIDA') - Number(b.Status === 'RESOLVIDA') || Number(b.Prioridade === 'ALTA') - Number(a.Prioridade === 'ALTA') || a.Criado_Em.localeCompare(b.Criado_Em) || a.ID_Notificacao.localeCompare(b.ID_Notificacao); });
  var page = filtered.slice(p.offset, p.offset + 25);
  return { items: page.map(function (row) { if(row.Entidade_Referencia==='Configuracoes')return {id:row.ID_Notificacao,referenceId:row.ID_Referencia,type:row.Tipo,priority:row.Prioridade,title:row.Titulo,message:row.Mensagem,state:row.Status,createdAt:row.Criado_Em,resolvedAt:null,read:isRead(row)};if(row.Entidade_Referencia==='Escalas'){var b=bindings.get(row.ID_Notificacao);return {recipientId:b.userId,id:row.ID_Notificacao,scheduleId:row.ID_Referencia,type:row.Tipo,priority:row.Prioridade,title:row.Titulo,message:row.Mensagem,state:row.Status,createdAt:row.Criado_Em,resolvedAt:null,read:isRead(row),date:b.date,start:b.start,end:b.end};}return notificationDto_(row, products.filter(function (product) { return product.ID_Produto === row.ID_Referencia; })[0], isRead(row)); }),
    total: filtered.length, nextOffset: p.offset + page.length < filtered.length ? p.offset + page.length : null };
}
