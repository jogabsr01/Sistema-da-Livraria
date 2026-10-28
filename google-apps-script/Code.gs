/* Signed DEV identity, catalog and independently gated anonymous checkout. */
function failure_(code) { throw new Error(code); }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
function secretBytes_(secret) { return secret.match(/../g).map(function (h) { var n = parseInt(h, 16); return n > 127 ? n - 256 : n; }); }
function hmac_(message, secret, direction) {
  return hex_(Utilities.computeHmacSha256Signature(Utilities.newBlob(direction + '.v1.' + message).getBytes(), secretBytes_(secret)));
}
function digest_(text) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)); }
function constantEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== 64 || b.length !== 64) return false;
  var diff = 0; for (var i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function jsonOutput_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function baseSettings_() {
  var p = scriptProperties_().getProperties();
  if (!['dev', 'prod'].includes(p.APP_ENV) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.INSTALLATION_ID || '') || !/^[a-f0-9]{64}$/i.test(p.SIGNING_SECRET || '') || !p.OWNER_EMAIL) failure_('CONFIGURATION_UNAVAILABLE');
  return { environment: p.APP_ENV, installationId: p.INSTALLATION_ID, secret: p.SIGNING_SECRET,
    owner: p.OWNER_EMAIL.toLowerCase(), spreadsheetId: p.SPREADSHEET_ID,
    driveRootId: p.DRIVE_ROOT_ID, backupsId: p.BACKUPS_FOLDER_ID };
}
function requireOwnerDev_(c) {
  if (c.environment !== 'dev' || Session.getEffectiveUser().getEmail().toLowerCase() !== c.owner) failure_('FORBIDDEN');
}
function marker_(c, kind) {
  return JSON.stringify({ application: 'livraria-ipb', environment: c.environment, installationId: c.installationId, kind: kind });
}
function assertMarker_(resource, c, kind) {
  var marker;
  try { marker = JSON.parse(resource.getDescription()); } catch (_) { failure_('BINDING_MISMATCH'); }
  if (!marker || marker.application !== 'livraria-ipb' || marker.environment !== c.environment || marker.installationId !== c.installationId || marker.kind !== kind) failure_('BINDING_MISMATCH');
  if (resource.getSharingAccess() !== DriveApp.Access.PRIVATE) failure_('BINDING_MISMATCH');
}
// Populated only inside one signed HTTP operation under ScriptLock. Never cache
// users, sessions, permissions, row contents or validation across requests.
var RPC_STORAGE_SCOPE_ = null;
// Read snapshots exist only while one signed identity command holds ScriptLock.
// Copy on read so callers cannot mutate a cached row before a durable save.
// Every identity write invalidates before touching Sheets, including failures.
function rpcRows_(sheet, lastRow, width) {
  var cache = RPC_STORAGE_SCOPE_ && RPC_STORAGE_SCOPE_.identityRows;
  var values = cache && cache.get(sheet);
  if (!values) {
    values = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, width).getValues();
    if (cache) cache.set(sheet, values);
  }
  return values.map(function(row) { return row.slice(); });
}
function invalidateRpcRows_(sheet) {
  if (RPC_STORAGE_SCOPE_ && RPC_STORAGE_SCOPE_.identityRows) RPC_STORAGE_SCOPE_.identityRows.delete(sheet);
}
function rpcSheet_(spreadsheet, name) {
  if (!RPC_STORAGE_SCOPE_) return spreadsheet.getSheetByName(name);
  var sheets = RPC_STORAGE_SCOPE_.sheets.get(spreadsheet);
  if (!sheets) { sheets = new Map(); RPC_STORAGE_SCOPE_.sheets.set(spreadsheet, sheets); }
  if (!sheets.has(name)) sheets.set(name, spreadsheet.getSheetByName(name));
  return sheets.get(name);
}
function storage_(c, withBackup) {
  var cacheKey = JSON.stringify([c.environment, c.installationId, c.spreadsheetId, c.driveRootId, c.backupsId || '', !!withBackup]);
  if (RPC_STORAGE_SCOPE_ && RPC_STORAGE_SCOPE_.main[cacheKey]) return RPC_STORAGE_SCOPE_.main[cacheKey];
  if (!c.spreadsheetId || !c.driveRootId) failure_('BINDING_MISMATCH');
  assertMarker_(resourceFile_(c.spreadsheetId), c, 'spreadsheet');
  assertMarker_(resourceFolder_(c.driveRootId), c, 'root');
  var backup = null;
  if (withBackup) {
    if (!c.backupsId) failure_('BINDING_MISMATCH');
    backup = resourceFolder_(c.backupsId); assertMarker_(backup, c, 'backups');
  }
  var result = { spreadsheet: resourceSheet_(c.spreadsheetId), backup: backup };
  if (RPC_STORAGE_SCOPE_) RPC_STORAGE_SCOPE_.main[cacheKey] = result;
  return result;
}
function withLock_(fn, waitMs) {
  var lock = LockService.getScriptLock();
  var wait=waitMs===undefined?20000:waitMs;
  var waiting=Date.now();
  if (!lock.tryLock(wait)) { try { console.info(JSON.stringify({metric:'rpc.lockBusy',waitMs:Date.now()-waiting,limitMs:wait})); } catch (_) {} failure_('BUSY'); }
  try { return fn(); } finally { lock.releaseLock(); }
}
function rowValues_(sheet, knownLastRow) {
  // Runtime commands never edit row 1. Reuse only its header during this locked
  // invocation; authorization and business rows are always read afresh.
  if (RPC_STORAGE_SCOPE_ && RPC_STORAGE_SCOPE_.headers.has(sheet)) return RPC_STORAGE_SCOPE_.headers.get(sheet).slice();
  var header = (knownLastRow === undefined ? sheet.getLastRow() : knownLastRow) ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
  if (RPC_STORAGE_SCOPE_) RPC_STORAGE_SCOPE_.headers.set(sheet, header.slice());
  return header;
}
function same_(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function migrationRows_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('_Migracoes'), lastRow = sheet ? sheet.getLastRow() : 0;
  return lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, 4).getValues();
}
function migrationVersion_(rows) {
  if (rows.some(function (r) { return !Number.isSafeInteger(Number(r[0])) || Number(r[0]) < 1; })) failure_('SCHEMA_INVALID');
  if (new Set(rows.map(function (r) { return Number(r[0]); })).size !== rows.length) failure_('SCHEMA_INVALID');
  return rows.length ? Math.max.apply(null, rows.map(function (r) { return Number(r[0]); })) : 0;
}
function version_(spreadsheet) { return migrationVersion_(migrationRows_(spreadsheet)); }
function preflight_(spreadsheet) {
  LIVRARIA_SCHEMA.tables.forEach(function (table) {
    var sheet = spreadsheet.getSheetByName(table.name);
    if (sheet && sheet.getLastRow() && !same_(rowValues_(sheet), table.columns)) failure_('SCHEMA_CONFLICT');
  });
}
function assertSchema_(spreadsheet) {
  var rows = migrationRows_(spreadsheet);
  if (migrationVersion_(rows) !== LIVRARIA_SCHEMA.version) failure_('SCHEMA_REQUIRED');
  if (!rows.some(function (r) { return Number(r[0]) === LIVRARIA_SCHEMA.version && r[3] === digest_(JSON.stringify(LIVRARIA_SCHEMA)); })) failure_('SCHEMA_REQUIRED');
  // Read every header once, on every invocation. No cross-request cache.
  // Conflicting nonempty headers still take precedence over missing sheets.
  var missing = false;
  LIVRARIA_SCHEMA.tables.forEach(function (table) {
    var sheet = rpcSheet_(spreadsheet, table.name), lastRow = sheet ? sheet.getLastRow() : 0;
    if (!sheet || !lastRow) { missing = true; return; }
    if (!same_(rowValues_(sheet, lastRow), table.columns)) failure_('SCHEMA_CONFLICT');
  });
  if (missing) failure_('SCHEMA_REQUIRED');
}
function migrate_(c) {
  var store = storage_(c, true), ss = store.spreadsheet;
  preflight_(ss);
  var installed = version_(ss);
  if (installed > LIVRARIA_SCHEMA.version) failure_('SCHEMA_NEWER');
  if (installed === LIVRARIA_SCHEMA.version) { assertSchema_(ss); return { changed: false, schemaVersion: installed }; }
  // Validate every header BEFORE copying or mutating. Back up BEFORE the first write.
  var backup = resourceFile_(c.spreadsheetId).makeCopy('Livraria DEV before schema v' + LIVRARIA_SCHEMA.version + ' ' + new Date().toISOString(), store.backup);
  LIVRARIA_SCHEMA.tables.forEach(function (table) {
    var sheet = ss.getSheetByName(table.name) || ss.insertSheet(table.name);
    if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, table.columns.length).setValues([table.columns]);
    sheet.setFrozenRows(1);
    table.text_columns.forEach(function (column) {
      sheet.getRange(2, table.columns.indexOf(column) + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('@');
    });
  });
  SpreadsheetApp.flush();
  ss.getSheetByName('_Migracoes').appendRow([LIVRARIA_SCHEMA.version, new Date().toISOString(), backup.getId(), digest_(JSON.stringify(LIVRARIA_SCHEMA))]);
  SpreadsheetApp.flush();
  return { changed: true, schemaVersion: LIVRARIA_SCHEMA.version, backupId: backup.getId() };
}
function migrateDevelopmentSchema() {
  var c = baseSettings_(); requireOwnerDev_(c);
  return withLock_(function () { return migrate_(c); });
}
function inspectDevelopmentSchema() {
  var c = baseSettings_(); requireOwnerDev_(c);
  return withLock_(function () {
    assertSchema_(storage_(c, true).spreadsheet);
    var result = { environment: 'dev', schemaVersion: LIVRARIA_SCHEMA.version, tables: LIVRARIA_SCHEMA.tables.length };
    console.info(JSON.stringify(result)); // Owner-only verification; never keys, IDs or personal data.
    return result;
  });
}
function provisionDevelopment() {
  var c = baseSettings_(); requireOwnerDev_(c);
  return withLock_(function () {
    var props = scriptProperties_();
    var root;
    if (c.driveRootId) { root = resourceFolder_(c.driveRootId); assertMarker_(root, c, 'root'); }
    else {
      root = DriveApp.createFolder('Livraria DEV ' + c.installationId);
      root.setDescription(marker_(c, 'root')); c.driveRootId = root.getId(); props.setProperty('DRIVE_ROOT_ID', c.driveRootId);
    }
    assertMarker_(root, c, 'root');
    if (!c.spreadsheetId) {
      var sheet = SpreadsheetApp.create('Livraria DEV ' + c.installationId), file = resourceFile_(sheet.getId());
      file.setDescription(marker_(c, 'spreadsheet')); file.moveTo(root);
      c.spreadsheetId = sheet.getId(); props.setProperty('SPREADSHEET_ID', c.spreadsheetId);
    }
    // Never relabel existing resources: mismatched markers refuse further writes.
    assertMarker_(resourceFile_(c.spreadsheetId), c, 'spreadsheet');
    ['covers', 'profiles', 'documents', 'exports', 'backups'].forEach(function (kind) {
      var property = kind.toUpperCase() + '_FOLDER_ID';
      var existing = props.getProperty(property);
      if (kind === 'backups') property = 'BACKUPS_FOLDER_ID';
      if (existing) assertMarker_(resourceFolder_(existing), c, kind);
      else {
        var folder = root.createFolder(kind); folder.setDescription(marker_(c, kind));
        assertMarker_(folder, c, kind);
        props.setProperty(property, folder.getId());
      }
    });
    c.backupsId = props.getProperty('BACKUPS_FOLDER_ID');
    var result = migrate_(c);
    return { environment: c.environment, installationId: c.installationId, schemaVersion: result.schemaVersion,
      spreadsheetId: c.spreadsheetId, driveRootId: c.driveRootId, backupsId: c.backupsId };
  });
}
function readMessage_(envelope, c) {
  if (!envelope || typeof envelope.message !== 'string' || envelope.message.length > 180000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.message) || !constantEqual_(hmac_(envelope.message, c.secret, 'request'), envelope.signature)) failure_('UNAUTHORIZED');
  var request = JSON.parse(Utilities.newBlob(Utilities.base64Decode(envelope.message)).getDataAsString('UTF-8'));
  var now = Date.now();
  if (request.version !== 1 || !Number.isSafeInteger(request.issuedAt) || now - request.issuedAt > 120000 || request.issuedAt - now > 30000 || !/^[a-f0-9]{64}$/i.test(request.nonce || '') || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(request.requestId || '')) failure_('UNAUTHORIZED');
  if (request.environment !== c.environment || request.installationId !== c.installationId || request.resources?.spreadsheetId !== c.spreadsheetId || request.resources?.driveRootId !== c.driveRootId) failure_('BINDING_MISMATCH');
  return request;
}
function registerNonce_(request, spreadsheet) {
  var sheet = spreadsheet.getSheetByName('_Requisicoes'), now = Date.now();
  var rows = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  var live = rows.filter(function (r) { return Date.parse(r[2]) > now; });
  var hash = digest_(request.nonce);
  if (live.some(function (r) { return r[0] === hash; })) failure_('REPLAY');
  if (live.length >= 5000) failure_('SERVICE_CAPACITY');
  if (rows.length !== live.length) {
    sheet.getRange(2, 1, rows.length, 4).clearContent();
    if (live.length) sheet.getRange(2, 1, live.length, 4).setValues(live);
  }
  // getLastRow reflects cleared rows. No raw session token or PIN is stored.
  sheet.appendRow([hash, new Date(now).toISOString(), new Date(now + 300000).toISOString(), request.requestId]);
  SpreadsheetApp.flush();
}
function processRequest_(request, c) {
  var started=Date.now();
  return withLock_(function () {
    var acquired=Date.now(),bound=acquired,validated=acquired;
    var previousScope = RPC_STORAGE_SCOPE_;
    RPC_STORAGE_SCOPE_ = { main: {}, controls: {}, sheets: new WeakMap(), headers: new WeakMap(), identityRows: /^identity\.(access\.|passkey\.|guard\.)/.test(request.action) ? new WeakMap() : null };
    try {
    if(scriptProperties_().getProperty('MAINTENANCE_MODE')==='true')failure_('MAINTENANCE_ACTIVE');
    var ss;
    try { ss=storage_(c, false).spreadsheet; } finally { bound=Date.now();validated=bound; }
    try { assertSchema_(ss); } finally { validated=Date.now(); }
    registerNonce_(request, ss);
    // Service readiness is not a user login: no roles, PII or table names.
    // Full installation bindings, schema, signature and durable nonce still apply.
    if (request.action === 'system.ping' && c.environment === 'dev') {
      return { ready: true, environment: 'dev', schemaVersion: LIVRARIA_SCHEMA.version };
    }
    if (typeof request.action === 'string' && (request.action.indexOf('staff.') === 0 || request.action.indexOf('identity.staffAccess.') === 0)) {
      var staffProps = scriptProperties_();
      if (c.environment !== 'dev' || !staffEnabled_() || ['IDENTITY_SESSIONS_ENABLED','IDENTITY_ACCESS_ENABLED','IDENTITY_GUARDS_ENABLED','IDENTITY_PASSKEYS_ENABLED'].some(function(key){return staffProps.getProperty(key)!=='true';})) failure_('STAFF_UNAVAILABLE');
      return request.action.indexOf('staff.') === 0 ? staffOperation_(request,c) : staffAccessOperation_(request,c);
    }
    if (typeof request.action === 'string' && request.action.indexOf('customers.') === 0) {
      var customerProps=scriptProperties_();
      if(c.environment!=='dev'||['CUSTOMERS_ENABLED','IDENTITY_SESSIONS_ENABLED'].some(function(key){return customerProps.getProperty(key)!=='true';})) failure_('CUSTOMERS_UNAVAILABLE');
      return customerOperation_(request,c);
    }
    if(typeof request.action==='string'&&request.action.indexOf('insights.')===0){if(c.environment!=='dev'||['CUSTOMER_INSIGHTS_ENABLED','CUSTOMERS_ENABLED','REPORTS_ENABLED','CATALOG_ENABLED','IDENTITY_SESSIONS_ENABLED'].some(function(k){return scriptProperties_().getProperty(k)!=='true';}))failure_('REPORT_UNAVAILABLE');return customerInsightsOperation_(request,c);}
    if(typeof request.action==='string'&&request.action.indexOf('reports.')===0){if(c.environment!=='dev'||['REPORTS_ENABLED','CATALOG_ENABLED','IDENTITY_SESSIONS_ENABLED'].some(function(k){return scriptProperties_().getProperty(k)!=='true';}))failure_('REPORT_UNAVAILABLE');return reportsOperation_(request,c);}
    if(typeof request.action==='string'&&request.action.indexOf('audit.')===0){if(c.environment!=='dev'||['AUDIT_ENABLED','CATALOG_ENABLED','IDENTITY_SESSIONS_ENABLED'].some(function(k){return scriptProperties_().getProperty(k)!=='true';}))failure_('AUDIT_UNAVAILABLE');return auditOperation_(request,c);}
    if(typeof request.action==='string'&&request.action.indexOf('schedules.')===0){if(c.environment!=='dev'||['SCHEDULES_ENABLED','CATALOG_ENABLED','NOTIFICATIONS_ENABLED','IDENTITY_SESSIONS_ENABLED'].some(function(k){return scriptProperties_().getProperty(k)!=='true';}))failure_('SCHEDULE_UNAVAILABLE');return schedulesOperation_(request,c);}
    if(typeof request.action==='string'&&request.action.indexOf('niches.')===0){if(c.environment!=='dev'||['NICHES_ENABLED','CATALOG_ENABLED','IDENTITY_SESSIONS_ENABLED'].some(function(k){return scriptProperties_().getProperty(k)!=='true';}))failure_('NICHES_UNAVAILABLE');return nichesOperation_(request,c);}
    if(typeof request.action==='string'&&request.action.indexOf('profile.')===0){
      if(c.environment!=='dev'||scriptProperties_().getProperty('PROFILE_ENABLED')!=='true'||scriptProperties_().getProperty('IDENTITY_SESSIONS_ENABLED')!=='true')failure_('PROFILE_UNAVAILABLE');
      return profileOperation_(request,c);
    }
    if(typeof request.action==='string'&&request.action.indexOf('operations.')===0){
      var operationProps=scriptProperties_();
      if(c.environment!=='dev'||['OPERATIONS_ENABLED','CATALOG_ENABLED','IDENTITY_SESSIONS_ENABLED'].some(function(key){return operationProps.getProperty(key)!=='true';}))failure_('OPERATIONS_UNAVAILABLE');
      return operationsOperation_(request,c);
    }
    if (['sales.checkout','sales.receipt'].includes(request.action)) {
      var checkoutProps = scriptProperties_();
      if (c.environment !== 'dev' || ['CHECKOUT_ENABLED', 'CATALOG_ENABLED', 'IDENTITY_SESSIONS_ENABLED'].some(function (key) { return checkoutProps.getProperty(key) !== 'true'; })) failure_('CHECKOUT_UNAVAILABLE');
      return checkoutOperation_(request, c);
    }
    if (typeof request.action === 'string' && request.action.indexOf('notifications.') === 0) {
      var notificationProps = scriptProperties_();
      if (c.environment !== 'dev' || ['NOTIFICATIONS_ENABLED', 'CATALOG_ENABLED', 'IDENTITY_SESSIONS_ENABLED'].some(function (key) { return notificationProps.getProperty(key) !== 'true'; })) failure_('NOTIFICATIONS_UNAVAILABLE');
      return notificationOperation_(request, c);
    }
    if (['catalog.list', 'catalog.get', 'catalog.niches', 'catalog.save', 'catalog.cover', 'catalog.receive', 'catalog.remove'].includes(request.action)) {
      var catalogProps = scriptProperties_();
      if (c.environment !== 'dev' || catalogProps.getProperty('CATALOG_ENABLED') !== 'true' || catalogProps.getProperty('IDENTITY_SESSIONS_ENABLED') !== 'true') failure_('CATALOG_UNAVAILABLE');
      return catalogOperation_(request, c);
    }
    if(typeof request.action==='string'&&request.action.indexOf('keys.')===0){if(c.environment!=='dev'||['KEY_MANAGEMENT_ENABLED','IDENTITY_PASSKEYS_ENABLED','IDENTITY_SESSIONS_ENABLED'].some(function(k){return scriptProperties_().getProperty(k)!=='true';}))failure_('KEY_MANAGEMENT_UNAVAILABLE');return keyManagementOperation_(request,c);}
    if(request.action==='identity.security.record'){if(c.environment!=='dev'||['IDENTITY_ACCESS_ENABLED','IDENTITY_GUARDS_ENABLED','IDENTITY_SESSIONS_ENABLED'].some(function(k){return scriptProperties_().getProperty(k)!=='true';}))failure_('IDENTITY_UNAVAILABLE');return securityRecord_(request,c);}
    if (typeof request.action === 'string' && request.action.indexOf('identity.access.') === 0) {
      var props = scriptProperties_();
      if (c.environment !== 'dev' || ['IDENTITY_ACCESS_ENABLED', 'IDENTITY_GUARDS_ENABLED', 'IDENTITY_PASSKEYS_ENABLED', 'IDENTITY_SESSIONS_ENABLED'].some(function (key) { return props.getProperty(key) !== 'true'; })) failure_('IDENTITY_UNAVAILABLE');
      if (request.action === 'identity.access.startGuarded') return accessStartGuarded_(request, c);
      if (request.action === 'identity.access.emailGuarded') return accessEmailGuarded_(request, c);
      if (request.action === 'identity.access.pinReadGuarded') return accessPinReadGuarded_(request, c);
      if (request.action === 'identity.access.options') return accessOptions_(request, c);
      if (request.action === 'identity.access.prepareCompletion') return accessPrepareCompletion_(request, c);
      return ownerAccessOperation_(request, c);
    }
    if (['identity.passkey.list', 'identity.passkey.begin', 'identity.passkey.take', 'identity.passkey.register', 'identity.passkey.counter'].includes(request.action)) {
      if (c.environment !== 'dev' || scriptProperties_().getProperty('IDENTITY_PASSKEYS_ENABLED') !== 'true') failure_('IDENTITY_UNAVAILABLE');
      return passkeyOperation_(request, c);
    }
    if (['identity.guard.attempt', 'identity.challenge.create', 'identity.challenge.consume'].includes(request.action)) {
      if (c.environment !== 'dev' || scriptProperties_().getProperty('IDENTITY_GUARDS_ENABLED') !== 'true') failure_('IDENTITY_UNAVAILABLE');
      return authControlOperation_(request, c);
    }
    if (['identity.session.read', 'identity.session.revoke', 'identity.session.revokeOthers'].includes(request.action)) {
      if (c.environment !== 'dev' || scriptProperties_().getProperty('IDENTITY_SESSIONS_ENABLED') !== 'true') failure_('IDENTITY_UNAVAILABLE');
      return identitySessionOperation_(request, c);
    }
    var actor = request.actor;
    if (request.action !== 'system.schema') failure_('FORBIDDEN');
    if (c.environment !== 'dev' || scriptProperties_().getProperty('IDENTITY_SESSIONS_ENABLED') !== 'true') failure_('IDENTITY_UNAVAILABLE');
    if (!actor || !/^[a-f0-9]{64}$/.test(actor.sessionTokenHash || '')) failure_('UNAUTHENTICATED');
    // Re-resolve INSIDE this operation's lock. A prior Node lookup cannot
    // authorize metadata after a concurrent logout, disable or epoch change.
    var principal = identitySessionOperation_({ action: 'identity.session.read', payload: { tokenHash: actor.sessionTokenHash } }, c);
    if (actor.id !== principal.id || actor.role !== principal.role || actor.assurance !== principal.assurance || actor.authenticatedAt !== principal.authenticatedAt ||
        !['ADMIN', 'SUPER_ADMIN'].includes(principal.role) || !['mfa', 'passkey'].includes(principal.assurance) || Date.now() - principal.authenticatedAt > 300000) failure_('FORBIDDEN');
    return { schemaVersion: LIVRARIA_SCHEMA.version, tables: LIVRARIA_SCHEMA.tables.map(function (t) { return t.name; }) };
    } finally {
      // Fixed numeric fields only: no payloads, identifiers, PINs or email codes.
      try { console.info(JSON.stringify({metric:'rpc.duration',lockMs:acquired-started,bindingsMs:bound-acquired,schemaMs:Math.max(0,validated-bound),workMs:Date.now()-validated,totalMs:Date.now()-started})); }
      catch (_) {} finally { RPC_STORAGE_SCOPE_ = previousScope; }
    }
  }, 5000);
}
function signedResponse_(c, request, ok, data, code) {
  var result = { version: 1, environment: c.environment, installationId: c.installationId,
    requestId: request.requestId, nonce: request.nonce, sentAt: Date.now(), ok: ok };
  if (ok) result.data = data; else result.error = { code: code };
  var message = Utilities.base64Encode(Utilities.newBlob(JSON.stringify(result)).getBytes());
  return jsonOutput_({ message: message, signature: hmac_(message, c.secret, 'response') });
}
function doPost(event) {
  var c, request;
  try {
    c = baseSettings_();
    if (!event || !event.postData || typeof event.postData.contents !== 'string' || event.postData.contents.length > 190000) failure_('UNAUTHORIZED');
    request = readMessage_(JSON.parse(event.postData.contents), c);
  } catch (_) { return jsonOutput_({ error: { code: 'UNAUTHORIZED' } }); }
  try { return signedResponse_(c, request, true, processRequest_(request, c)); }
  catch (error) {
    var allowed = ['EMERGENCY_RECOVERY_UNAVAILABLE','KEY_MANAGEMENT_RATE_LIMITED','KEY_MANAGEMENT_UNAVAILABLE','KEY_MANAGEMENT_REJECTED','KEY_MANAGEMENT_CONFLICT','KEY_MANAGEMENT_LAST_KEY','KEY_MANAGEMENT_CAPACITY','CUSTOMER_NOT_FOUND','CUSTOMER_CONTACT_NOT_AUTHORIZED','REPORT_UNAVAILABLE','INVALID_REPORT','REPORT_CHANGED','REPORT_CONFLICT','REPORT_CAPACITY','SECURITY_AUDIT_UNAVAILABLE','REPLAY', 'BUSY', 'SERVICE_CAPACITY', 'MAINTENANCE_ACTIVE', 'SCHEMA_REQUIRED', 'SCHEMA_CONFLICT', 'FORBIDDEN', 'BINDING_MISMATCH', 'UNAUTHENTICATED', 'IDENTITY_UNAVAILABLE', 'CHALLENGE_REJECTED', 'PASSKEY_REJECTED', 'ACCESS_REJECTED', 'CATALOG_UNAVAILABLE', 'CATALOG_INVALID', 'CATALOG_CONFLICT', 'CATALOG_DUPLICATE', 'CATALOG_NOT_FOUND', 'CATALOG_STOCK_HISTORY', 'COVER_PHOTOS_UNAVAILABLE', 'COVER_PHOTO_INVALID'];
    allowed = allowed.concat(['CHECKOUT_UNAVAILABLE', 'INVALID_SALE', 'IDEMPOTENCY_CONFLICT', 'INSUFFICIENT_STOCK', 'PRODUCT_UNAVAILABLE', 'SALE_PRICE_CHANGED', 'JOURNAL_CAPACITY', 'JOURNAL_INVALID', 'PROJECTION_CONFLICT']);
    allowed = allowed.concat(['STAFF_UNAVAILABLE','INVALID_STAFF','STAFF_CONFLICT','STAFF_DUPLICATE','STAFF_CAPACITY','STAFF_CPF_DUPLICATE','STAFF_EMAIL_DUPLICATE']);
    allowed = allowed.concat(['CUSTOMERS_UNAVAILABLE','INVALID_CUSTOMER','CUSTOMER_CONFLICT','CUSTOMER_DUPLICATE','CUSTOMER_CAPACITY','CUSTOMER_UNAVAILABLE']);
    allowed = allowed.concat(['EMAIL_CHANGE_UNAVAILABLE','EMAIL_CHANGE_REJECTED','EMAIL_CHANGE_CONFLICT','EMAIL_CHANGE_RATE_LIMITED','EMAIL_CHANGE_DELIVERY']);
    allowed = allowed.concat(['AUDIT_UNAVAILABLE','INVALID_AUDIT','AUDIT_CHANGED','AUDIT_CONFLICT','AUDIT_CAPACITY','AUDIT_EXPORT_LIMIT']);
    allowed = allowed.concat(['SCHEDULE_UNAVAILABLE','INVALID_SCHEDULE','SCHEDULE_NOT_FOUND','SCHEDULE_CONFLICT','SCHEDULE_CAPACITY','SCHEDULE_EMPLOYEE_UNAVAILABLE','SCHEDULE_NO_CHANGE','SCHEDULE_OVERLAP']);
    allowed = allowed.concat(['NICHES_UNAVAILABLE','INVALID_NICHE','NICHE_CONFLICT','NICHE_DUPLICATE','NICHE_NOT_FOUND']);
    allowed = allowed.concat(['PROFILE_UNAVAILABLE','INVALID_PROFILE','PROFILE_CONFLICT','PROFILE_NOT_FOUND','PROFILE_CPF_DUPLICATE','PROFILE_CPF_LOCKED']);
    allowed = allowed.concat(['OPERATIONS_UNAVAILABLE','INVALID_OPERATION','SALE_NOT_FOUND','OPERATION_CONFLICT','STOCK_NO_CHANGE']);
    allowed = allowed.concat(['INVALID_STOCK_RECEIPT', 'STOCK_LIMIT']);
    allowed = allowed.concat(['NOTIFICATIONS_UNAVAILABLE', 'INVALID_NOTIFICATION', 'NOTIFICATION_NOT_FOUND', 'NOTIFICATION_CONFLICT', 'NOTIFICATION_CAPACITY']);
    return signedResponse_(c, request, false, null, allowed.includes(error.message) ? error.message : 'UNAVAILABLE');
  }
}
function doGet() { return jsonOutput_({ error: { code: 'METHOD_NOT_ALLOWED' } }); }
