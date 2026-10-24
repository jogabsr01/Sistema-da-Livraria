/* Persistent session reader/revoker. Internal functions only.
 * processRequest_ MUST hold ScriptLock and validate the signed envelope before
 * invoking identitySessionOperation_. No user/session creation or PIN storage.
 */
function identityUuid_(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}
function identityRows_(spreadsheet, name) {
  var sheet = spreadsheet.getSheetByName(name);
  var definition = LIVRARIA_SCHEMA.tables.filter(function (table) { return table.name === name; })[0];
  if (!sheet || !definition || !same_(rowValues_(sheet), definition.columns) || sheet.getLastRow() > 5001) failure_('IDENTITY_UNAVAILABLE');
  var values = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, definition.columns.length).getValues();
  return { sheet: sheet, columns: definition.columns, rows: values.map(function (values, index) {
    var row = { number: index + 2 };
    definition.columns.forEach(function (column, columnIndex) { row[column] = values[columnIndex]; });
    return row;
  }) };
}
function identityTime_(value) {
  if (typeof value !== 'string') failure_('UNAUTHENTICATED');
  var milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) failure_('UNAUTHENTICATED');
  return milliseconds;
}
function identitySession_(spreadsheet, tokenHash, now) {
  recoverStaff_(baseSettings_());recoverProfiles_(baseSettings_());recoverRecoveryIntents_(baseSettings_());recoverEmailChanges_(baseSettings_());recoverNiches_(baseSettings_());recoverSchedules_(baseSettings_());
  var sessions = identityRows_(spreadsheet, 'Sessoes'), ids = new Set(), hashes = new Set();
  sessions.rows.forEach(function (row) {
    if (!identityUuid_(row.ID_Sessao) || !identityUuid_(row.ID_Usuario) || typeof row.Token_Hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(row.Token_Hash) || ids.has(row.ID_Sessao) || hashes.has(row.Token_Hash)) failure_('IDENTITY_UNAVAILABLE');
    ids.add(row.ID_Sessao); hashes.add(row.Token_Hash);
  });
  var matches = sessions.rows.filter(function (row) { return row.Token_Hash === tokenHash; });
  if (matches.length !== 1) failure_('UNAUTHENTICATED');
  var session = matches[0];
  if (typeof session.Dispositivo === 'string' && session.Dispositivo.indexOf('identity-flow:') === 0) {
    var flowId = session.Dispositivo.slice(14), c = baseSettings_();
    var flows = accessFlows_(authControlStore_(c)).rows.filter(function (row) { return row.ID === flowId; });
    if (flows.length !== 1 || flows[0].State !== 'COMPLETE' || flows[0].ID !== session.ID_Sessao ||
        flows[0].Subject_ID !== session.ID_Usuario || flows[0].Session_Token_Hash !== tokenHash ||
        (flows[0].Authorization_Version+(flows[0].Purpose==='RECOVER'?1:0)) !== session.Versao_Autorizacao) failure_('UNAUTHENTICATED');
  }
  if (session.Revogado_Em !== '' || !['pin', 'mfa', 'passkey'].includes(session.Nivel_Autenticacao) ||
      !Number.isSafeInteger(session.Versao_Autorizacao) || session.Versao_Autorizacao < 1) failure_('UNAUTHENTICATED');
  var created = identityTime_(session.Criado_Em), expires = identityTime_(session.Expira_Em), activity = identityTime_(session.Ultima_Atividade);
  if (created > now || expires <= now || expires <= created || expires - created > 8 * 60 * 60 * 1000 ||
      activity < created || activity > now || now - activity > 30 * 60 * 1000) failure_('UNAUTHENTICATED');
  var users = identityRows_(spreadsheet, 'Usuarios');
  var userMatches = users.rows.filter(function (row) { return row.ID_Usuario === session.ID_Usuario; });
  if (userMatches.length > 1) failure_('IDENTITY_UNAVAILABLE');
  if (userMatches.length !== 1) failure_('UNAUTHENTICATED');
  var user = userMatches[0];
  if (user.Status !== 'ATIVO' || user.Primeiro_Acesso_Concluido !== true ||
      !['ATENDENTE', 'ADMIN', 'SUPER_ADMIN'].includes(user.Perfil)) failure_('UNAUTHENTICATED');
  if (user.Perfil !== 'ATENDENTE' && !['mfa', 'passkey'].includes(session.Nivel_Autenticacao)) failure_('UNAUTHENTICATED');
  var versions = identityRows_(spreadsheet, 'Configuracoes').rows.filter(function (row) { return row.Chave === 'identity.version.' + user.ID_Usuario; });
  if (versions.length !== 1 || !Number.isSafeInteger(versions[0].Valor) || versions[0].Valor < 1) failure_('IDENTITY_UNAVAILABLE');
  if (session.Versao_Autorizacao !== versions[0].Valor) failure_('UNAUTHENTICATED');
  return { sessions: sessions, session: session, activity: activity, principal: {
    id: user.ID_Usuario, sessionId: session.ID_Sessao, role: user.Perfil,
    assurance: session.Nivel_Autenticacao, authenticatedAt: created, expiresAt: expires,
    authorizationVersion: versions[0].Valor
  } };
}
function identitySessionOperation_(request, c) {
  if (!c || c.environment !== 'dev') failure_('FORBIDDEN');
  if (!request || !['identity.session.read', 'identity.session.revoke', 'identity.session.revokeOthers'].includes(request.action)) failure_('FORBIDDEN');
  var payload = request.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 1 ||
      typeof payload.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.tokenHash)) failure_('UNAUTHENTICATED');
  var spreadsheet = storage_(c, false).spreadsheet;
  var now = Date.now(), resolved = identitySession_(spreadsheet, payload.tokenHash, now);
  var table = resolved.sessions;
  if (request.action === 'identity.session.read') {
    // Reduce Sheets writes while keeping the idle window bounded and shared.
    if (now - resolved.activity >= 60 * 1000) {
      table.sheet.getRange(resolved.session.number, table.columns.indexOf('Ultima_Atividade') + 1, 1, 1).setValues([[new Date(now).toISOString()]]);
      SpreadsheetApp.flush();
    }
    return resolved.principal;
  }
  var targets = request.action === 'identity.session.revoke' ? [resolved.session] : table.rows.filter(function (row) {
    return row.ID_Usuario === resolved.principal.id && row.ID_Sessao !== resolved.principal.sessionId;
  });
  targets.forEach(function (row) {
    if (row.Revogado_Em !== '') return;
    table.sheet.getRange(row.number, table.columns.indexOf('Revogado_Em') + 1, 1, 1).setValues([[new Date(now).toISOString()]]);
    SpreadsheetApp.flush();
  });
  return { revoked: true };
}
