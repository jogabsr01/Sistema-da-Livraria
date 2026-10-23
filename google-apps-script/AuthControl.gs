/* DEV-only private controls. No credentials, sessions or accounts are issued.
 * All operations run under the installation ScriptLock in processRequest_. */
var AUTH_CONTROL_SCHEMA = {
  version: 1,
  tables: [
    { name: '_Control_Migrations', columns: ['Version', 'Schema_Hash', 'Created_At', 'Backup_Drive_ID'] },
    { name: '_Auth_Limits', columns: ['Key', 'Window_Start', 'Attempt_Count', 'Blocked_Until', 'Penalty_Level', 'Updated_At'] },
    { name: '_Auth_Challenges', columns: ['ID', 'Subject_ID', 'Purpose', 'Token_Hash', 'Created_At', 'Expires_At', 'Consumed_At', 'Attempt_Count', 'Authorization_Version', 'Revoked_At'] }
  ]
};
function authControlDefinition_(name) {
  var found = AUTH_CONTROL_SCHEMA.tables.filter(function (table) { return table.name === name; });
  if (found.length !== 1) failure_('IDENTITY_UNAVAILABLE');
  return found[0];
}
function authControlTime_(value) {
  try { return identityTime_(value); } catch (_) { failure_('IDENTITY_UNAVAILABLE'); }
}
function authControlRows_(ss, name) {
  var definition = authControlDefinition_(name), sheet = ss.getSheetByName(name);
  if (!sheet || !same_(rowValues_(sheet), definition.columns) || sheet.getLastRow() > 3001) failure_('IDENTITY_UNAVAILABLE');
  var values = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, definition.columns.length).getValues();
  return { sheet: sheet, columns: definition.columns, rows: values.map(function (values, index) {
    var row = { number: index + 2 };
    definition.columns.forEach(function (key, i) { row[key] = values[i]; }); return row;
  }) };
}
function authControlStore_(c) {
  if (c.environment !== 'dev') failure_('FORBIDDEN');
  storage_(c, false); // Validate public-data bindings as well as the private store.
  var id = PropertiesService.getScriptProperties().getProperty('IDENTITY_CONTROL_SPREADSHEET_ID');
  if (!id) failure_('IDENTITY_UNAVAILABLE');
  assertMarker_(DriveApp.getFileById(id), c, 'identity-controls');
  var ss = SpreadsheetApp.openById(id), history = authControlRows_(ss, '_Control_Migrations');
  if (history.rows.length !== 1 || history.rows[0].Version !== 1 || history.rows[0].Schema_Hash !== digest_(JSON.stringify(AUTH_CONTROL_SCHEMA))) failure_('IDENTITY_UNAVAILABLE');
  AUTH_CONTROL_SCHEMA.tables.forEach(function (table) { authControlRows_(ss, table.name); });
  return ss;
}
function provisionDevelopmentAuthControls() {
  var c = baseSettings_(); requireOwnerDev_(c);
  return withLock_(function () {
    var store = storage_(c, true); assertSchema_(store.spreadsheet);
    var props = PropertiesService.getScriptProperties(), id = props.getProperty('IDENTITY_CONTROL_SPREADSHEET_ID');
    if (!id) {
      var created = SpreadsheetApp.create('Livraria DEV private controls ' + c.installationId);
      var file = DriveApp.getFileById(created.getId()); file.setDescription(marker_(c, 'identity-controls'));
      file.moveTo(DriveApp.getFolderById(c.driveRootId)); id = created.getId();
      props.setProperty('IDENTITY_CONTROL_SPREADSHEET_ID', id);
    }
    var resource = DriveApp.getFileById(id); assertMarker_(resource, c, 'identity-controls');
    var ss = SpreadsheetApp.openById(id);
    AUTH_CONTROL_SCHEMA.tables.forEach(function (table) {
      var sheet = ss.getSheetByName(table.name);
      if (sheet && sheet.getLastRow() && !same_(rowValues_(sheet), table.columns)) failure_('SCHEMA_CONFLICT');
    });
    var history = ss.getSheetByName('_Control_Migrations');
    if (history && history.getLastRow() > 1) { authControlStore_(c); return { environment: 'dev', version: 1, changed: false }; }
    // Each initial/resumed migration backs up BEFORE any header mutation.
    var backup = resource.makeCopy('DEV controls before v1 ' + new Date().toISOString(), store.backup);
    AUTH_CONTROL_SCHEMA.tables.forEach(function (table) {
      var sheet = ss.getSheetByName(table.name) || ss.insertSheet(table.name);
      if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, table.columns.length).setValues([table.columns]);
      sheet.setFrozenRows(1);
      table.columns.forEach(function (column, index) {
        if (!['Version', 'Attempt_Count', 'Penalty_Level', 'Authorization_Version'].includes(column)) {
          sheet.getRange(2, index + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('@');
        }
      });
    });
    SpreadsheetApp.flush();
    ss.getSheetByName('_Control_Migrations').appendRow([1, digest_(JSON.stringify(AUTH_CONTROL_SCHEMA)), new Date().toISOString(), backup.getId()]);
    SpreadsheetApp.flush(); authControlStore_(c);
    return { environment: 'dev', version: 1, changed: true };
  });
}
function authControlExact_(payload, keys) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !same_(Object.keys(payload).sort(), keys.slice().sort())) failure_('CHALLENGE_REJECTED');
}
function authControlSave_(table, row) {
  var values = table.columns.map(function (key) { return row[key]; });
  if (row.number) table.sheet.getRange(row.number, 1, 1, values.length).setValues([values]);
  else {
    if (table.rows.length >= 3000) failure_('IDENTITY_UNAVAILABLE');
    table.sheet.appendRow(values);
  }
  SpreadsheetApp.flush();
}
function authAttempt_(ss, payload, now) {
  authControlExact_(payload, ['accountKey', 'originKey']);
  if (![payload.accountKey, payload.originKey].every(function (key) { return typeof key === 'string' && /^[a-f0-9]{64}$/.test(key); })) failure_('CHALLENGE_REJECTED');
  var table = authControlRows_(ss, '_Auth_Limits'), seen = new Set();
  table.rows.forEach(function (row) {
    if (typeof row.Key !== 'string' || !/^(account|origin):[a-f0-9]{64}$/.test(row.Key) || seen.has(row.Key)) failure_('IDENTITY_UNAVAILABLE');
    seen.add(row.Key);
  });
  var retry = 0, plans = [ ['account:' + payload.accountKey, 5], ['origin:' + payload.originKey, 30] ].map(function (policy) {
    var matches = table.rows.filter(function (row) { return row.Key === policy[0]; });
    var row = matches.length ? matches[0] : { Key: policy[0], Window_Start: new Date(now).toISOString(), Attempt_Count: 0, Blocked_Until: '', Penalty_Level: 0, Updated_At: new Date(now).toISOString() };
    var start = authControlTime_(row.Window_Start), updated = authControlTime_(row.Updated_At);
    var until = row.Blocked_Until === '' ? 0 : authControlTime_(row.Blocked_Until);
    if (start > now || updated > now || updated < start || !Number.isSafeInteger(row.Attempt_Count) || row.Attempt_Count < 0 || row.Attempt_Count > policy[1] + 1 ||
        !Number.isSafeInteger(row.Penalty_Level) || row.Penalty_Level < 0 || row.Penalty_Level > 7 || until > now + 3600000) failure_('IDENTITY_UNAVAILABLE');
    if (until > now) retry = Math.max(retry, Math.ceil((until - now) / 1000));
    if (now - updated >= 86400000) row.Penalty_Level = 0;
    if ((until && until <= now) || now - start >= 900000) { row.Window_Start = new Date(now).toISOString(); row.Attempt_Count = 0; row.Blocked_Until = ''; }
    return { row: row, maximum: policy[1] };
  });
  if (retry) return { allowed: false, retryAfterSeconds: retry };
  if (table.rows.length + plans.filter(function (plan) { return !plan.row.number; }).length > 3000) failure_('IDENTITY_UNAVAILABLE');
  plans.forEach(function (plan) {
    var row = plan.row; row.Attempt_Count++; row.Updated_At = new Date(now).toISOString();
    if (row.Attempt_Count > plan.maximum) {
      row.Penalty_Level = Math.min(7, row.Penalty_Level + 1);
      var delay = Math.min(3600, 60 * Math.pow(2, row.Penalty_Level - 1));
      row.Blocked_Until = new Date(now + delay * 1000).toISOString(); retry = Math.max(retry, delay);
    }
  });
  // A partial write fails closed; retry can spend another attempt, never grant one.
  plans.forEach(function (plan) { authControlSave_(table, plan.row); });
  return { allowed: retry === 0, retryAfterSeconds: retry };
}
function authSubjectCurrent_(c, subjectId, version, purpose) {
  var ss = storage_(c, false).spreadsheet;
  var users = identityRows_(ss, 'Usuarios').rows.filter(function (row) { return row.ID_Usuario === subjectId; });
  var epochs = identityRows_(ss, 'Configuracoes').rows.filter(function (row) { return row.Chave === 'identity.version.' + subjectId; });
  if (users.length !== 1 || epochs.length !== 1 || users[0].Status !== 'ATIVO' || !['ATENDENTE', 'ADMIN', 'SUPER_ADMIN'].includes(users[0].Perfil) ||
      !Number.isSafeInteger(epochs[0].Valor) || epochs[0].Valor !== version ||
      users[0].Primeiro_Acesso_Concluido !== (purpose !== 'ACTIVATE')) return false;
  return true;
}
function authChallengeOperation_(ss, c, action, payload, now) {
  var keys = ['challengeId', 'subjectId', 'purpose', 'tokenHash', 'authorizationVersion'];
  authControlExact_(payload, keys);
  if (!identityUuid_(payload.challengeId) || !identityUuid_(payload.subjectId) || !['ACTIVATE', 'RECOVER', 'DEVICE'].includes(payload.purpose) ||
      typeof payload.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.tokenHash) ||
      !Number.isSafeInteger(payload.authorizationVersion) || payload.authorizationVersion < 1) failure_('CHALLENGE_REJECTED');
  var table = authControlRows_(ss, '_Auth_Challenges'), seen = new Set(), hashes = new Set();
  table.rows.forEach(function (row) {
    if (!identityUuid_(row.ID) || !identityUuid_(row.Subject_ID) || typeof row.Token_Hash !== 'string' || !/^[a-f0-9]{64}$/.test(row.Token_Hash) ||
        !['ACTIVATE', 'RECOVER', 'DEVICE'].includes(row.Purpose) || !Number.isSafeInteger(row.Authorization_Version) || row.Authorization_Version < 1 ||
        !Number.isSafeInteger(row.Attempt_Count) || row.Attempt_Count < 0 || row.Attempt_Count > 5 || seen.has(row.ID) || hashes.has(row.Token_Hash)) failure_('IDENTITY_UNAVAILABLE');
    var created = authControlTime_(row.Created_At), expires = authControlTime_(row.Expires_At);
    if (created > now || expires <= created || expires - created > 600000) failure_('IDENTITY_UNAVAILABLE');
    seen.add(row.ID); hashes.add(row.Token_Hash);
  });
  var matches = table.rows.filter(function (row) { return row.ID === payload.challengeId; });
  var current = authSubjectCurrent_(c, payload.subjectId, payload.authorizationVersion, payload.purpose);
  if (action === 'identity.challenge.create') {
    if (!current) failure_('CHALLENGE_REJECTED');
    if (matches.length) {
      var prior = matches[0];
      if (prior.Subject_ID !== payload.subjectId || prior.Purpose !== payload.purpose || !constantEqual_(prior.Token_Hash, payload.tokenHash) ||
          prior.Authorization_Version !== payload.authorizationVersion || prior.Consumed_At !== '' || prior.Revoked_At !== '' || Date.parse(prior.Expires_At) <= now) failure_('CHALLENGE_REJECTED');
      return { challengeId: prior.ID, expiresAt: Date.parse(prior.Expires_At) };
    }
    if (hashes.has(payload.tokenHash) || table.rows.length >= 3000) failure_('IDENTITY_UNAVAILABLE');
    // Reissue invalidates the prior code before appending the new one.
    table.rows.filter(function (row) { return row.Subject_ID === payload.subjectId && row.Purpose === payload.purpose && row.Consumed_At === '' && row.Revoked_At === ''; }).forEach(function (row) {
      row.Revoked_At = new Date(now).toISOString(); authControlSave_(table, row);
    });
    authControlSave_(table, { ID: payload.challengeId, Subject_ID: payload.subjectId, Purpose: payload.purpose,
      Token_Hash: payload.tokenHash, Created_At: new Date(now).toISOString(), Expires_At: new Date(now + 600000).toISOString(),
      Consumed_At: '', Attempt_Count: 0, Authorization_Version: payload.authorizationVersion, Revoked_At: '' });
    return { challengeId: payload.challengeId, expiresAt: now + 600000 };
  }
  if (!matches.length) return { verified: false };
  var row = matches[0];
  if (row.Consumed_At !== '' || row.Revoked_At !== '' || Date.parse(row.Expires_At) <= now || row.Attempt_Count >= 5) return { verified: false };
  row.Attempt_Count++;
  var valid = current && row.Subject_ID === payload.subjectId && row.Purpose === payload.purpose && row.Authorization_Version === payload.authorizationVersion && constantEqual_(row.Token_Hash, payload.tokenHash);
  if (valid) row.Consumed_At = new Date(now).toISOString();
  else if (row.Attempt_Count >= 5) row.Revoked_At = new Date(now).toISOString();
  authControlSave_(table, row);
  return { verified: valid };
}
function authControlOperation_(request, c) {
  if (c.environment !== 'dev') failure_('FORBIDDEN');
  if (!['identity.guard.attempt', 'identity.challenge.create', 'identity.challenge.consume'].includes(request.action)) failure_('FORBIDDEN');
  var ss = authControlStore_(c), now = Date.now();
  return request.action === 'identity.guard.attempt' ? authAttempt_(ss, request.payload, now) : authChallengeOperation_(ss, c, request.action, request.payload, now);
}
