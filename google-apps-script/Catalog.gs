/* Authenticated DEV catalog, positive stock receipts and admin-only removal.
 * Dispatcher owns the installation lock; durable intent precedes projections. */
var CATALOG_COLUMNS = ['Command_ID', 'Actor_ID', 'Actor_Role', 'Product_ID', 'Expected_Version', 'Command_Hash', 'Before_JSON', 'After_JSON', 'Created_At', 'State', 'Completed_At', 'Record_Hash'];
function catalogFail_(code) { failure_(code || 'CATALOG_INVALID'); }
function catalogJournalHash_(row) { return digest_(JSON.stringify(CATALOG_COLUMNS.filter(function (key) { return key !== 'Record_Hash'; }).map(function (key) { return row[key]; }))); }
function catalogJournal_(c) {
  var id = scriptProperties_().getProperty('CATALOG_JOURNAL_ID');
  if (!id) catalogFail_('CATALOG_UNAVAILABLE');
  assertMarker_(resourceFile_(id), c, 'catalog-journal');
  var sheet = resourceSheet_(id).getSheetByName('_Product_Commands');
  if (!sheet || !same_(rowValues_(sheet), CATALOG_COLUMNS) || sheet.getLastRow() > 1001) catalogFail_('CATALOG_UNAVAILABLE');
  var values = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, CATALOG_COLUMNS.length).getValues();
  var ids = new Set();
  return { sheet: sheet, columns: CATALOG_COLUMNS, rows: values.map(function (values, index) {
    var row = { number: index + 2 }; CATALOG_COLUMNS.forEach(function (key, i) { row[key] = values[i]; });
    if (!identityUuid_(row.Command_ID) || ids.has(row.Command_ID) || !identityUuid_(row.Actor_ID) || !['SUPER_ADMIN', 'ADMIN', 'ATENDENTE'].includes(row.Actor_Role) || !identityUuid_(row.Product_ID) ||
        !Number.isSafeInteger(row.Expected_Version) || row.Expected_Version < 0 || !accessHash_(row.Command_Hash) ||
        !['PENDING', 'COMPLETE'].includes(row.State) || typeof row.Before_JSON !== 'string' || typeof row.After_JSON !== 'string') catalogFail_('CATALOG_UNAVAILABLE');
    authControlTime_(row.Created_At); if (row.State === 'COMPLETE') authControlTime_(row.Completed_At);
    if (row.State === 'PENDING' && row.Completed_At !== '' || !accessHash_(row.Record_Hash) || !constantEqual_(catalogJournalHash_(row), row.Record_Hash)) catalogFail_('CATALOG_UNAVAILABLE');
    ids.add(row.Command_ID); return row;
  }) };
}
function provisionDevelopmentCatalog() {
  var c = baseSettings_(); requireOwnerDev_(c);
  return withLock_(function () {
    var store = storage_(c, true); assertSchema_(store.spreadsheet);
    var props = scriptProperties_(), owner = props.getProperty('IDENTITY_OWNER_USER_ID');
    if (!identityUuid_(owner)) failure_('IDENTITY_UNAVAILABLE');
    var id = props.getProperty('CATALOG_JOURNAL_ID');
    if (!id) {
      var created = SpreadsheetApp.create('Livraria DEV catalog journal ' + c.installationId), file = resourceFile_(created.getId());
      file.setDescription(marker_(c, 'catalog-journal')); file.moveTo(resourceFolder_(c.driveRootId));
      id = created.getId(); props.setProperty('CATALOG_JOURNAL_ID', id);
    }
    var resource = resourceFile_(id); assertMarker_(resource, c, 'catalog-journal');
    var journal = resourceSheet_(id), sheet = journal.getSheetByName('_Product_Commands');
    if (sheet && sheet.getLastRow() && !same_(rowValues_(sheet), CATALOG_COLUMNS)) failure_('SCHEMA_CONFLICT');
    if (!sheet || !sheet.getLastRow()) {
      resource.makeCopy('DEV catalog before v1 ' + new Date().toISOString(), store.backup);
      sheet = sheet || journal.insertSheet('_Product_Commands'); sheet.getRange(1, 1, 1, CATALOG_COLUMNS.length).setValues([CATALOG_COLUMNS]); sheet.setFrozenRows(1);
      CATALOG_COLUMNS.forEach(function (key, index) { if (key !== 'Expected_Version') sheet.getRange(2, index + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('@'); });
      SpreadsheetApp.flush();
    }
    catalogJournal_(c);
    var niches = identityRows_(store.spreadsheet, 'Nichos');
    if (!niches.rows.length) accessSaveMain_(niches, { ID_Nicho: Utilities.getUuid(), Nome: 'Geral', Descricao: '', Cor_Destaque: '#205b43', Ordem_Exibicao: 0, Ativo: true, Criado_Por: owner, Criado_Em: new Date().toISOString() });
    return { environment: 'dev', prepared: true };
  });
}
function catalogText_(value, max, required) {
  if (typeof value !== 'string' || value.length > max || value !== value.trim() || required && !value || /[\x00-\x08\x0b-\x1f\x7f]/.test(value) || /^[=+@-]/.test(value)) catalogFail_();
}
function catalogRecord_(p) {
  authControlExact_(p, ['isbn', 'internalCode', 'title', 'author', 'publisher', 'edition', 'supplier', 'priceCents', 'minimumStock', 'category', 'coverUrl', 'year', 'pages', 'synopsis', 'nicheIds', 'active']);
  [['isbn', 13], ['internalCode', 31], ['title', 300], ['author', 300], ['publisher', 160], ['edition', 80], ['supplier', 160], ['category', 80], ['coverUrl', 2000], ['synopsis', 5000]].forEach(function (pair) { catalogText_(p[pair[0]], pair[1], pair[0] === 'title'); });
  if (p.isbn ? !/^(978|979)\d{10}$/.test(p.isbn) || p.internalCode !== '' || p.isbn.split('').reduce(function (sum, n, i) { return sum + Number(n) * (i % 2 ? 3 : 1); }, 0) % 10 !== 0 : !/^INT[A-Z0-9]{6,28}$/.test(p.internalCode)) catalogFail_();
  [['priceCents', 100000000], ['minimumStock', 1000000], ['year', 3000], ['pages', 100000]].forEach(function (pair) { if (!Number.isSafeInteger(p[pair[0]]) || p[pair[0]] < 0 || p[pair[0]] > pair[1]) catalogFail_(); });
  if (p.year && p.year < 1000 || typeof p.active !== 'boolean' || !Array.isArray(p.nicheIds) || !p.nicheIds.length || p.nicheIds.length > 20 ||
      p.nicheIds.some(function (id) { return !identityUuid_(id); }) || new Set(p.nicheIds).size !== p.nicheIds.length || !same_(p.nicheIds, p.nicheIds.slice().sort())) catalogFail_();
  if (p.coverUrl) {
    var match = /^https:\/\/([^/?#]+)(\/[^#]*)?$/.exec(p.coverUrl), host = match && match[1];
    if (!host || host.indexOf('.') < 0 || /[^a-z0-9.-]/.test(host) || host.endsWith('.') || /^[\d.]+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host)) catalogFail_();
  }
  var canonical = {}; ['isbn', 'internalCode', 'title', 'author', 'publisher', 'edition', 'supplier', 'priceCents', 'minimumStock', 'category', 'coverUrl', 'year', 'pages', 'synopsis', 'nicheIds', 'active'].forEach(function (key) { canonical[key] = p[key]; }); return canonical;
}
function catalogProducts_(ss) {
  var table = identityRows_(ss, 'Produtos'), ids = new Set(), barcodes = new Set(), internal = new Set();
  table.rows.forEach(function (row) {
    if (!identityUuid_(row.ID_Produto) || ids.has(row.ID_Produto) || !Number.isSafeInteger(row.Versao_Registro) || row.Versao_Registro < 1 ||
        !Number.isSafeInteger(row.Estoque_Atual) || row.Estoque_Atual < 0 || typeof row.Ativo !== 'boolean') catalogFail_('CATALOG_UNAVAILABLE');
    ids.add(row.ID_Produto);
    if (row.Ativo) {
      if (row.ISBN && barcodes.has(row.ISBN) || row.Codigo_Interno && internal.has(row.Codigo_Interno)) catalogFail_('CATALOG_UNAVAILABLE');
      if (row.ISBN) barcodes.add(row.ISBN); if (row.Codigo_Interno) internal.add(row.Codigo_Interno);
    }
  }); return table;
}
function catalogNiches_(ss) {
  var table = identityRows_(ss, 'Nichos'), ids = new Set();
  if (table.rows.length > 200) catalogFail_('CATALOG_UNAVAILABLE');
  table.rows.forEach(function (row) {
    if (!identityUuid_(row.ID_Nicho) || ids.has(row.ID_Nicho) || typeof row.Ativo !== 'boolean' || !Number.isSafeInteger(row.Ordem_Exibicao) || row.Ordem_Exibicao < 0 || !/^#[a-fA-F0-9]{6}$/.test(row.Cor_Destaque)) catalogFail_('CATALOG_UNAVAILABLE');
    catalogText_(row.Nome, 100, true); ids.add(row.ID_Nicho);
  }); return table;
}
function catalogLinks_(ss) {
  var table = identityRows_(ss, 'Produto_Nichos'), seen = new Set();
  table.rows.forEach(function (row) {
    if (row.ID_Produto === '' && row.ID_Nicho === '') return;
    var key = row.ID_Produto + ':' + row.ID_Nicho;
    if (!identityUuid_(row.ID_Produto) || !identityUuid_(row.ID_Nicho) || seen.has(key)) catalogFail_('CATALOG_UNAVAILABLE'); seen.add(key);
  }); return table;
}
function catalogLinkIds_(table, id) { return table.rows.filter(function (row) { return row.ID_Produto === id; }).map(function (row) { return row.ID_Nicho; }).sort(); }
function catalogReferences_(products, links, niches) {
  var ids = new Set(products.rows.map(function (row) { return row.ID_Produto; })), targets = new Set(niches.rows.map(function (row) { return row.ID_Nicho; }));
  links.rows.forEach(function (row) { if (row.ID_Produto !== '' && (!ids.has(row.ID_Produto) || !targets.has(row.ID_Nicho))) catalogFail_('CATALOG_UNAVAILABLE'); });
}
function catalogDto_(row, links, detailed) {
  var p = { id: row.ID_Produto, isbn: row.ISBN, internalCode: row.Codigo_Interno, title: row.Titulo, author: row.Autor, publisher: row.Editora, edition: row.Edicao,
    priceCents: row.Preco_Venda, minimumStock: row.Estoque_Minimo, category: row.Categoria, coverUrl: row.Capa_URL_Externa, year: row.Ano_Publicacao,
    pages: row.Paginas, nicheIds: catalogLinkIds_(links, row.ID_Produto), active: row.Ativo, stock: row.Estoque_Atual, version: row.Versao_Registro, updatedAt: row.Atualizado_Em,hasPhoto:row.Capa_Drive_ID !== '' };
  if (detailed) { p.supplier = row.Fornecedor; p.synopsis = row.Sinopse; } return p;
}
function catalogSnapshot_(table, row, links) { return row ? { values: table.columns.map(function (key) { return row[key]; }), nicheIds: catalogLinkIds_(links, row.ID_Produto) } : null; }
function catalogValidateSnapshot_(snapshot, columns, id) {
  if (!snapshot || !Array.isArray(snapshot.values) || snapshot.values.length !== columns.length || snapshot.values[0] !== id || !Array.isArray(snapshot.nicheIds)) catalogFail_('CATALOG_UNAVAILABLE');
  var row = {}; columns.forEach(function (key, i) { row[key] = snapshot.values[i]; });
  var dto = catalogDto_(row, { rows: snapshot.nicheIds.map(function (niche) { return { ID_Produto: id, ID_Nicho: niche }; }) }, true);
  var record = {}; ['isbn', 'internalCode', 'title', 'author', 'publisher', 'edition', 'supplier', 'priceCents', 'minimumStock', 'category', 'coverUrl', 'year', 'pages', 'synopsis', 'nicheIds', 'active'].forEach(function (key) { record[key] = dto[key]; }); catalogRecord_(record);
  if (!Number.isSafeInteger(row.Estoque_Atual) || row.Estoque_Atual < 0 || !Number.isSafeInteger(row.Versao_Registro) || row.Versao_Registro < 1) catalogFail_('CATALOG_UNAVAILABLE');
  return row;
}
// Validate an intent independently of its current projection. Inventory replay
// uses completed metadata intents as stock-preserving version checkpoints.
function catalogIntent_(c, command, columns) {
  var before, after;
  try { before = JSON.parse(command.Before_JSON); after = JSON.parse(command.After_JSON); } catch (_) { catalogFail_('CATALOG_UNAVAILABLE'); }
  if(Object.prototype.hasOwnProperty.call(after,'auditVersion')&&after.auditVersion!==2)catalogFail_('CATALOG_UNAVAILABLE');
  var desired = catalogValidateSnapshot_(after, columns, command.Product_ID);
  if (before !== null) catalogValidateSnapshot_(before, columns, command.Product_ID);
  if (desired.Versao_Registro !== command.Expected_Version + 1 || before === null && command.Expected_Version !== 0 || before && before.values[columns.indexOf('Versao_Registro')] !== command.Expected_Version) catalogFail_('CATALOG_UNAVAILABLE');
  var record = catalogDto_(desired, { rows: after.nicheIds.map(function (id) { return { ID_Produto: command.Product_ID, ID_Nicho: id }; }) }, true);
  delete record.id; delete record.stock; delete record.version; delete record.updatedAt; delete record.hasPhoto;
  record = catalogRecord_(record);
  var canonical = { commandId: command.Command_ID, id: command.Product_ID, expectedVersion: command.Expected_Version, record: record };
  if (Object.prototype.hasOwnProperty.call(after,'photoHash')) {
    if (after.photoHash !== 'REMOVE' && !accessHash_(after.photoHash)) catalogFail_('CATALOG_UNAVAILABLE');
    canonical.photoHash = after.photoHash;
    if (after.photoHash === 'REMOVE') { if (desired.Capa_Drive_ID !== '') catalogFail_('CATALOG_UNAVAILABLE'); }
    else { var file = coverFile_(c,desired.Capa_Drive_ID,command.Product_ID,after.photoHash,false); if (file.marker.commandId !== command.Command_ID || desired.Capa_URL_Externa !== '') catalogFail_('CATALOG_UNAVAILABLE'); }
  }
  if (digest_(JSON.stringify(canonical)) !== command.Command_Hash ||
      desired.Atualizado_Em !== command.Created_At || desired.Atualizado_Por !== command.Actor_ID ||
      before === null && (desired.Estoque_Atual !== 0 || desired.Criado_Em !== command.Created_At || desired.Criado_Por !== command.Actor_ID) ||
      before && ['Estoque_Atual', 'Criado_Em', 'Criado_Por'].some(function (key) { return before.values[columns.indexOf(key)] !== desired[key]; }) ||
      !Object.prototype.hasOwnProperty.call(after,'photoHash') && desired.Capa_Drive_ID !== (before ? before.values[columns.indexOf('Capa_Drive_ID')] : '')) catalogFail_('CATALOG_UNAVAILABLE');
  return { before: before, after: after, desired: desired };
}
function catalogAuditSummary_(snapshot,columns,version){
 if(!snapshot)return {version:version};var at=function(k){return snapshot.values[columns.indexOf(k)];};
 return {version:version,isbn:at('ISBN'),internalCode:at('Codigo_Interno'),title:at('Titulo'),author:at('Autor'),publisher:at('Editora'),edition:at('Edicao'),supplier:at('Fornecedor'),priceCents:at('Preco_Venda'),minimumStock:at('Estoque_Minimo'),category:at('Categoria'),year:at('Ano_Publicacao'),pages:at('Paginas'),stock:at('Estoque_Atual'),active:at('Ativo'),nicheIds:snapshot.nicheIds,hasPhoto:!!at('Capa_Drive_ID'),hasExternalCover:!!at('Capa_URL_Externa')};
}
function catalogProject_(c, command) {
  var ss = storage_(c, false).spreadsheet, products = catalogProducts_(ss), links = catalogLinks_(ss);
  catalogReferences_(products, links, catalogNiches_(ss));
  var intent = catalogIntent_(c, command, products.columns), before = intent.before, after = intent.after, desired = intent.desired;
  var found = products.rows.filter(function (row) { return row.ID_Produto === command.Product_ID; }), actual = found.length ? catalogSnapshot_(products, found[0], links) : null;
  if (actual && !same_(actual.values, after.values) && (!before || !same_(actual.values, before.values)) || !actual && before) catalogFail_('CATALOG_CONFLICT');
  var allowed = (before ? before.nicheIds : []).concat(after.nicheIds);
  if (catalogLinkIds_(links, command.Product_ID).some(function (id) { return allowed.indexOf(id) < 0; })) catalogFail_('CATALOG_CONFLICT');
  // Recheck duplicates before restoring a partially applied product.
  if (desired.Ativo && products.rows.some(function (row) { return row.ID_Produto !== command.Product_ID && row.Ativo && (desired.ISBN && row.ISBN === desired.ISBN || desired.Codigo_Interno && row.Codigo_Interno === desired.Codigo_Interno); })) catalogFail_('CATALOG_DUPLICATE');
  var audit = identityRows_(ss, 'Logs_Auditoria'), logged = audit.rows.filter(function (row) { return row.ID_Log === command.Command_ID; });
  var log = { ID_Log: command.Command_ID, Data_Hora: command.Created_At, ID_Usuario: command.Actor_ID, Perfil: command.Actor_Role, Acao: before ? 'PRODUCT_UPDATE' : 'PRODUCT_CREATE', Entidade: 'Produtos', ID_Entidade: command.Product_ID,
    Antes: JSON.stringify({ version: command.Expected_Version }), Depois: JSON.stringify({ version: command.Expected_Version + 1 }), Resultado: 'SUCESSO', ID_Requisicao: command.Command_ID };
  if(after.auditVersion===2){var oldSummary=catalogAuditSummary_(before,products.columns,command.Expected_Version),newSummary=catalogAuditSummary_(after,products.columns,command.Expected_Version+1),oldAt=function(k){return before?before.values[products.columns.indexOf(k)]:'';};newSummary.coverChanged=oldAt('Capa_Drive_ID')!==desired.Capa_Drive_ID||oldAt('Capa_URL_Externa')!==desired.Capa_URL_Externa;newSummary.synopsisChanged=oldAt('Sinopse')!==desired.Sinopse;log.Antes=JSON.stringify(oldSummary);log.Depois=JSON.stringify(newSummary);}
  if (logged.length > 1 || logged.length && !audit.columns.every(function (key) { return logged[0][key] === log[key]; }) || !logged.length && audit.rows.length >= 5000) catalogFail_('CATALOG_UNAVAILABLE');
  if (!actual || !same_(actual.values, after.values)) { if (found.length) desired.number = found[0].number; accessSaveMain_(products, desired); }
  // Each relation is its own recoverable row; other products are never cleared.
  links.rows.filter(function (row) { return row.ID_Produto === command.Product_ID && after.nicheIds.indexOf(row.ID_Nicho) < 0; }).forEach(function (row) { links.sheet.getRange(row.number, 1, 1, 2).setValues([['', '']]); SpreadsheetApp.flush(); });
  after.nicheIds.forEach(function (id) {
    var current = catalogLinks_(ss);
    if (current.rows.some(function (row) { return row.ID_Produto === command.Product_ID && row.ID_Nicho === id; })) return;
    var empty = current.rows.filter(function (row) { return row.ID_Produto === '' && row.ID_Nicho === ''; })[0];
    accessSaveMain_(current, { number: empty && empty.number, ID_Produto: command.Product_ID, ID_Nicho: id });
  });
  if (!logged.length) accessSaveMain_(audit, log);
}
function recoverCatalog_(c) {
  var journal = catalogJournal_(c), pending = journal.rows.filter(function (row) { return row.State === 'PENDING'; });
  // New writes always recover first; two unfinished intents imply corruption.
  if (pending.length > 1) catalogFail_('CATALOG_UNAVAILABLE');
  pending.forEach(function (row) {
    catalogProject_(c, row); row.State = 'COMPLETE'; row.Completed_At = new Date().toISOString(); row.Record_Hash = catalogJournalHash_(row); accessSaveMain_(journal, row);
  });
}
function catalogSave_(c, principal, p) {
  var hasPhoto = Object.prototype.hasOwnProperty.call(p,'photo');
  authControlExact_(p, ['commandId', 'id', 'expectedVersion', 'record'].concat(hasPhoto ? ['photo']:[]));
  if (!identityUuid_(p.commandId) || !identityUuid_(p.id) || !Number.isSafeInteger(p.expectedVersion) || p.expectedVersion < 0 || p.expectedVersion > 1000000000) catalogFail_();
  p.record = catalogRecord_(p.record);
  var canonical = { commandId: p.commandId, id: p.id, expectedVersion: p.expectedVersion, record: p.record };
  if (hasPhoto) { coverPhotosEnabled_(); if (p.photo !== null) { coverDescriptor_(p.photo); if (p.record.coverUrl) catalogFail_(); } canonical.photoHash = p.photo === null ? 'REMOVE':p.photo.sha256; }
  var journal = catalogJournal_(c), hash = digest_(JSON.stringify(canonical)), prior = journal.rows.filter(function (row) { return row.Command_ID === p.commandId; });
  if (prior.length) {
    if (prior[0].Actor_ID !== principal.id || prior[0].Product_ID !== p.id || prior[0].Command_Hash !== hash) catalogFail_('CATALOG_CONFLICT');
    return { id: p.id, version: prior[0].Expected_Version + 1 };
  }
  if (identityRows_(storage_(c, false).spreadsheet, '_Eventos_Dominio').rows.some(function (row) { return row.ID_Evento === p.commandId; })) catalogFail_('CATALOG_CONFLICT');
  if (journal.rows.length >= 1000) catalogFail_('CATALOG_UNAVAILABLE');
  var ss = storage_(c, false).spreadsheet, products = catalogProducts_(ss), links = catalogLinks_(ss), niches = catalogNiches_(ss);
  catalogReferences_(products, links, niches);
  var matches = products.rows.filter(function (row) { return row.ID_Produto === p.id; }), existing = matches[0];
  if (existing ? existing.Versao_Registro !== p.expectedVersion : p.expectedVersion !== 0) catalogFail_('CATALOG_CONFLICT');
  if (!existing && products.rows.length >= 5000) catalogFail_('CATALOG_UNAVAILABLE');
  // A forged save must not bypass the dedicated administrative removal route.
  if ((!existing && !p.record.active || existing && p.record.active !== existing.Ativo) && !['ADMIN', 'SUPER_ADMIN'].includes(principal.role)) failure_('FORBIDDEN');
  if (existing && existing.Capa_Drive_ID && p.record.coverUrl && !hasPhoto) catalogFail_();
  if (p.record.nicheIds.some(function (id) { return !niches.rows.some(function (row) { return row.ID_Nicho === id && (row.Ativo || existing&&catalogLinkIds_(links,existing.ID_Produto).includes(id)); }); })) catalogFail_();
  if (p.record.active && products.rows.some(function (row) { return row.ID_Produto !== p.id && row.Ativo && (p.record.isbn && row.ISBN === p.record.isbn || p.record.internalCode && row.Codigo_Interno === p.record.internalCode); })) catalogFail_('CATALOG_DUPLICATE');
  var now = new Date().toISOString(), row = {};
  products.columns.forEach(function (key) { row[key] = existing ? existing[key] : ''; });
  var map = { ISBN: 'isbn', Codigo_Interno: 'internalCode', Titulo: 'title', Autor: 'author', Editora: 'publisher', Edicao: 'edition', Fornecedor: 'supplier', Preco_Venda: 'priceCents', Estoque_Minimo: 'minimumStock', Categoria: 'category', Capa_URL_Externa: 'coverUrl', Ano_Publicacao: 'year', Paginas: 'pages', Sinopse: 'synopsis', Ativo: 'active' };
  Object.keys(map).forEach(function (key) { row[key] = p.record[map[key]]; });
  row.ID_Produto = p.id; row.Versao_Registro = p.expectedVersion + 1; row.Atualizado_Em = now; row.Atualizado_Por = principal.id;
  if (!existing) { row.Estoque_Atual = 0; row.Criado_Em = now; row.Criado_Por = principal.id; }
  var before = catalogSnapshot_(products, existing, links), after = { values: products.columns.map(function (key) { return row[key]; }), nicheIds: p.record.nicheIds,auditVersion:2 };
  if (hasPhoto) after.photoHash = canonical.photoHash;
  if (before) catalogValidateSnapshot_(before, products.columns, p.id);
  catalogValidateSnapshot_(after, products.columns, p.id);
  if (links.rows.length + p.record.nicheIds.length > 5000 || identityRows_(ss, 'Logs_Auditoria').rows.length >= 5000) catalogFail_('CATALOG_UNAVAILABLE');
  if (hasPhoto) { row.Capa_Drive_ID = p.photo === null ? '':ensureCoverPhoto_(c,p.id,p.commandId,p.photo); after.values = products.columns.map(function (key) { return row[key]; }); }
  var intent = { Command_ID: p.commandId, Actor_ID: principal.id, Actor_Role: principal.role, Product_ID: p.id, Expected_Version: p.expectedVersion, Command_Hash: hash,
    Before_JSON: JSON.stringify(before), After_JSON: JSON.stringify(after), Created_At: now, State: 'PENDING', Completed_At: '' };
  intent.Record_Hash = catalogJournalHash_(intent); accessSaveMain_(journal, intent);
  recoverCatalog_(c); synchronizeStockNotifications_(ss); return { id: p.id, version: p.expectedVersion + 1 };
}
function catalogOperation_(request, c) {
  if (c.environment !== 'dev' || !request.actor || !accessHash_(request.actor.sessionTokenHash) || Object.keys(request.actor).length !== 1) failure_('UNAUTHENTICATED');
  var principal = identitySessionOperation_({ action: 'identity.session.read', payload: { tokenHash: request.actor.sessionTokenHash } }, c);
  if (!['ATENDENTE', 'ADMIN', 'SUPER_ADMIN'].includes(principal.role)) failure_('FORBIDDEN');
  recoverCatalog_(c);
  var p = request.payload, ss = storage_(c, false).spreadsheet;
  var bootstrap=request.action==='catalog.bootstrap',create=false;
  if(bootstrap){authControlExact_(p,['search','offset','nicheId','includeInactive','create']);if(typeof p.create!=='boolean'||typeof p.search!=='string'||p.search.length>100||!Number.isSafeInteger(p.offset)||p.offset<0||p.offset>5000||p.nicheId!==''&&!identityUuid_(p.nicheId)||typeof p.includeInactive!=='boolean')catalogFail_();create=p.create;p={search:p.search,offset:p.offset,nicheId:p.nicheId,includeInactive:p.includeInactive};}
  // A failed checkout must finish its durable projections before exposing stock.
  recoverSales_(ss);
  if (request.action === 'catalog.receive') return receiveStock_(request, c, principal, ss);
  if (request.action === 'catalog.remove') {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(principal.role) || !['mfa', 'passkey'].includes(principal.assurance)) failure_('FORBIDDEN');
    authControlExact_(p, ['commandId', 'id', 'expectedVersion']);
    if (!identityUuid_(p.commandId) || !identityUuid_(p.id) || !Number.isSafeInteger(p.expectedVersion) || p.expectedVersion < 1 || p.expectedVersion > 1000000000) catalogFail_();
    var prior = catalogJournal_(c).rows.filter(function (row) { return row.Command_ID === p.commandId; });
    if (prior.length) {
      var old = catalogIntent_(c, prior[0], rowValues_(ss.getSheetByName('Produtos')));
      if (prior[0].Actor_ID !== principal.id || prior[0].Product_ID !== p.id || prior[0].Expected_Version !== p.expectedVersion || !old.before || old.desired.Ativo !== false || old.before.values[rowValues_(ss.getSheetByName('Produtos')).indexOf('Ativo')] !== true) catalogFail_('CATALOG_CONFLICT');
      return { id: p.id, version: p.expectedVersion + 1 };
    }
    var row = catalogProducts_(ss).rows.filter(function (product) { return product.ID_Produto === p.id; })[0];
    if (!row) catalogFail_('CATALOG_NOT_FOUND');
    if (row.Ativo !== true) catalogFail_('CATALOG_CONFLICT');
    var record = catalogDto_(row, catalogLinks_(ss), true);
    ['id', 'stock', 'version', 'updatedAt', 'hasPhoto'].forEach(function (key) { delete record[key]; }); record.active = false;
    return catalogSave_(c, principal, { commandId: p.commandId, id: p.id, expectedVersion: p.expectedVersion, record: record });
  }
  if (request.action === 'catalog.save') return catalogSave_(c, principal, p);
  if (request.action === 'catalog.niches') {
    authControlExact_(p, []); return { niches: nicheDtos_(ss,catalogNiches_(ss).rows) };
  }
  if(bootstrap&&create)return {principal:principal,niches:nicheDtos_(ss,catalogNiches_(ss).rows),products:[],total:0,nextOffset:null};
  var products = catalogProducts_(ss), links = catalogLinks_(ss);
  catalogReferences_(products, links, catalogNiches_(ss));
  if (['catalog.get','catalog.cover'].includes(request.action)) {
    authControlExact_(p, ['id']); if (!identityUuid_(p.id)) catalogFail_();
    var found = products.rows.filter(function (row) { return row.ID_Produto === p.id; }); if (found.length !== 1) catalogFail_('CATALOG_NOT_FOUND');
    if (request.action === 'catalog.cover') return readCoverPhoto_(c,found[0]);
    return { product: catalogDto_(found[0], links, true) };
  }
  if (request.action !== 'catalog.list'&&!bootstrap) failure_('FORBIDDEN');
  authControlExact_(p, ['search', 'offset', 'nicheId', 'includeInactive']);
  if (typeof p.search !== 'string' || p.search.length > 100 || !Number.isSafeInteger(p.offset) || p.offset < 0 || p.offset > 5000 || p.nicheId !== '' && !identityUuid_(p.nicheId) || typeof p.includeInactive !== 'boolean') catalogFail_();
  var needle = p.search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  var filtered = products.rows.filter(function (row) { return (p.includeInactive || row.Ativo) && (!p.nicheId || catalogLinkIds_(links, row.ID_Produto).indexOf(p.nicheId) >= 0) &&
    [row.Titulo, row.Autor, row.ISBN, row.Codigo_Interno].join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').indexOf(needle) >= 0; }).sort(function (a, b) { return a.Titulo.localeCompare(b.Titulo) || a.ID_Produto.localeCompare(b.ID_Produto); });
  var page = filtered.slice(p.offset, p.offset + 10);
  var result={ products: page.map(function (row) { return catalogDto_(row, links, false); }), total: filtered.length, nextOffset: p.offset + page.length < filtered.length ? p.offset + page.length : null };
  if(bootstrap){result.principal=principal;result.niches=nicheDtos_(ss,catalogNiches_(ss).rows);}
  return result;
}
function recoverDevelopmentCatalog() { var c = baseSettings_(); requireOwnerDev_(c); return withLock_(function () { recoverCatalog_(c); return { recovered: true }; }); }

// OWNER EDITOR ONLY. Not dispatched over HTTP. Prepare/back up the catalog
// before enabling only the two core storefront modules in this DEV install.
function activateDevelopmentStorefront(){
  var c=baseSettings_();requireOwnerDev_(c);
  provisionDevelopmentCatalog();
  return withLock_(function(){
    var ss=storage_(c,false).spreadsheet;assertSchema_(ss);authControlStore_(c);catalogJournal_(c);recoverSales_(ss);
    scriptProperties_().setProperties({CATALOG_ENABLED:'true',CHECKOUT_ENABLED:'true'});
    return {environment:'dev',catalog:true,checkout:true};
  });
}
