function accessDeliveryCode_(value) { return typeof value === 'string' && (/^[A-HJ-NP-Z2-9]{7}$/.test(value) || /^[A-Za-z0-9_-]{43}$/.test(value)); }
/* DEV owner bootstrap + recoverable first access. Every RPC is signed, gated
 * and executed under the installation lock. No public role/bootstrap claims. */
function accessReject_() { failure_('ACCESS_REJECTED'); }
function accessHash_(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function accessEmail_(value) {
  if (typeof value !== 'string' || value.length > 254 || /[\x00-\x20\x7f]/.test(value) || !/^[^@]+@[^@]+\.[^@]+$/.test(value)) accessReject_();
  return value.toLowerCase();
}
function accessSaveMain_(table, row) {
  invalidateRpcRows_(table.sheet);
  if (!row.number && table.rows.length >= 5000) failure_('IDENTITY_UNAVAILABLE');
  var values = table.columns.map(function (key) { return row[key] === undefined ? '' : row[key]; });
  if (row.number) table.sheet.getRange(row.number, 1, 1, values.length).setValues([values]);
  else table.sheet.appendRow(values);
  SpreadsheetApp.flush();
}
// OWNER EDITOR ONLY. Never dispatched by doPost. Does not accept parameters,
// email, CPF, PIN or a role from the browser. Resuming never resets an account.
function prepareDevelopmentOwnerAccess() {
  var c = baseSettings_(); requireOwnerDev_(c);
  return withLock_(function () {
    authControlStore_(c);
    var ss = storage_(c, true).spreadsheet; assertSchema_(ss);
    var props = scriptProperties_(), users = identityRows_(ss, 'Usuarios');
    var configs = identityRows_(ss, 'Configuracoes');
    var id = props.getProperty('IDENTITY_OWNER_USER_ID');
    var binding = digest_(accessEmail_(c.owner));
    if (id && (!identityUuid_(id) || props.getProperty('IDENTITY_OWNER_EMAIL_BINDING') !== binding)) failure_('BINDING_MISMATCH');
    if (users.rows.some(function (row) { return row.Perfil === 'SUPER_ADMIN' && row.ID_Usuario !== id; })) failure_('FORBIDDEN');
    if (!id) {
      if (users.rows.length || configs.rows.some(function (row) { return String(row.Chave).indexOf('identity.version.') === 0; })) failure_('FORBIDDEN');
      id = Utilities.getUuid();
      // Properties form the resumable intent before any account write.
      props.setProperty('IDENTITY_OWNER_EMAIL_BINDING', binding);
      props.setProperty('IDENTITY_OWNER_USER_ID', id);
    }
    var matching = users.rows.filter(function (row) { return row.ID_Usuario === id; });
    if (matching.length > 1) failure_('IDENTITY_UNAVAILABLE');
    if (matching.length && (matching[0].Perfil !== 'SUPER_ADMIN' || matching[0].Status !== 'ATIVO' || matching[0].Primeiro_Acesso_Concluido !== false)) failure_('FORBIDDEN');
    var epochs = configs.rows.filter(function (row) { return row.Chave === 'identity.version.' + id; });
    if (epochs.length > 1 || epochs.length && epochs[0].Valor !== 1) failure_('IDENTITY_UNAVAILABLE');
    if (!epochs.length) accessSaveMain_(configs, { Chave: 'identity.version.' + id, Valor: 1, Atualizado_Em: new Date().toISOString(), Atualizado_Por: id });
    if (!matching.length) accessSaveMain_(users, { ID_Usuario: id, Perfil: 'SUPER_ADMIN', Status: 'ATIVO',
      Criado_Por: id, Criado_Em: new Date().toISOString(), Primeiro_Acesso_Concluido: false });
    // Personal fields stay blank; the delivery address stays in Script Properties.
    return { environment: 'dev', prepared: true };
  });
}
function accessOwner_(c, email) {
  var props = scriptProperties_(), id = props.getProperty('IDENTITY_OWNER_USER_ID');
  if (!identityUuid_(id) || props.getProperty('IDENTITY_OWNER_EMAIL_BINDING') !== digest_(accessEmail_(c.owner))) failure_('IDENTITY_UNAVAILABLE');
  if (email !== undefined && !constantEqual_(digest_(accessEmail_(email)), digest_(ownerLoginEmail_(c)))) return null;
  var ss = storage_(c, false).spreadsheet, users = identityRows_(ss, 'Usuarios');
  var rows = users.rows.filter(function (row) { return row.ID_Usuario === id; });
  var epochs = identityRows_(ss, 'Configuracoes').rows.filter(function (row) { return row.Chave === 'identity.version.' + id; });
  if (rows.length !== 1 || epochs.length !== 1 || !Number.isSafeInteger(epochs[0].Valor) || epochs[0].Valor < 1) failure_('IDENTITY_UNAVAILABLE');
  var row = rows[0];
  if (row.Perfil !== 'SUPER_ADMIN' || row.Status !== 'ATIVO' || typeof row.Primeiro_Acesso_Concluido !== 'boolean') return null;
  return { row: row, users: users, version: epochs[0].Valor };
}
function accessPins_(ss) {
  var table = authControlRows_(ss, '_Pin_Verifiers'), seen = new Set();
  table.rows.forEach(function (row) {
    if (!identityUuid_(row.Subject_ID) || seen.has(row.Subject_ID) || !Number.isSafeInteger(row.Authorization_Version) || row.Authorization_Version < 1) failure_('IDENTITY_UNAVAILABLE');
    accessPinRecord_(row.Record_JSON); seen.add(row.Subject_ID);
  }); return table;
}
function accessPinRecord_(value) {
  var record;
  try { if (typeof value !== 'string' || value.length > 300) accessReject_(); record = JSON.parse(value); } catch (_) { accessReject_(); }
  authControlExact_(record, ['version', 'algorithm', 'salt', 'hash']);
  if (record.version !== 1 || record.algorithm !== 'scrypt-N32768-r8-p1' || !accessHash_(record.salt) || !accessHash_(record.hash)) accessReject_();
  return record;
}
function accessFlows_(ss) {
  var table = authControlRows_(ss, '_Identity_Flows'), seen = new Set(), hashes = new Set(), ceremonies = new Set();
  table.rows.forEach(function (row) {
    if (!identityUuid_(row.ID) || seen.has(row.ID) || !accessHash_(row.Token_Hash) || hashes.has(row.Token_Hash) ||
        row.Subject_ID !== '' && !identityUuid_(row.Subject_ID) || !['ACTIVATE', 'LOGIN','RECOVER'].includes(row.Purpose) ||
        !['EMAIL', 'PIN', 'PASSKEY', 'COMMITTING', 'COMPLETE', 'REVOKED'].includes(row.State) ||
        !Number.isSafeInteger(row.Attempt_Count) || row.Attempt_Count < 0 || row.Attempt_Count > 5 ||
        !Number.isSafeInteger(row.Authorization_Version) || row.Authorization_Version < 0 ||
        authControlTime_(row.Expires_At) - authControlTime_(row.Created_At) !== 600000 ||
        row.Ceremony_ID !== '' && (!identityUuid_(row.Ceremony_ID) || ceremonies.has(row.Ceremony_ID))) failure_('IDENTITY_UNAVAILABLE');
    seen.add(row.ID); hashes.add(row.Token_Hash); if (row.Ceremony_ID) ceremonies.add(row.Ceremony_ID);
  }); return table;
}
function accessCurrent_(ss, hash, now) {
  if (!accessHash_(hash)) accessReject_();
  var table = accessFlows_(ss), found = table.rows.filter(function (row) { return constantEqual_(row.Token_Hash, hash); });
  if (found.length !== 1 || found[0].State === 'REVOKED' || authControlTime_(found[0].Expires_At) <= now || authControlTime_(found[0].Created_At) > now) accessReject_();
  return { table: table, row: found[0] };
}
function accessFlowOwner_(c, row) {
  if(row.Purpose==='RECOVER')return recoverySubject_(c,row);
  var owner = row.Subject_ID === scriptProperties_().getProperty('IDENTITY_OWNER_USER_ID') ? accessOwner_(c) : staffSubject_(c,row.Subject_ID);
  if (!owner || owner.row.ID_Usuario !== row.Subject_ID || owner.version !== row.Authorization_Version) accessReject_();
  if (row.Purpose === 'LOGIN' && owner.row.Primeiro_Acesso_Concluido !== true ||
      row.Purpose === 'ACTIVATE' && !['COMMITTING', 'COMPLETE'].includes(row.State) && owner.row.Primeiro_Acesso_Concluido !== false) accessReject_();
  return owner;
}
function accessNewFlow_(table, p, owner, purpose, now) {
  if (!identityUuid_(p.flowId) || !accessHash_(p.tokenHash) || table.rows.some(function (row) { return row.ID === p.flowId || row.Token_Hash === p.tokenHash; }) || table.rows.length >= 3000) accessReject_();
  var row = { ID: p.flowId, Token_Hash: p.tokenHash, Subject_ID: owner ? owner.row.ID_Usuario : '', Purpose: purpose,
    State: purpose !== 'LOGIN' ? 'EMAIL' : 'PASSKEY', Created_At: new Date(now).toISOString(), Expires_At: new Date(now + 600000).toISOString(),
    Email_Code_Hash: purpose !== 'LOGIN' ? p.codeHash : '', Attempt_Count: 0, Pin_JSON: '', Ceremony_ID: '', Session_Token_Hash: '',
    Authorization_Version: owner ? owner.version : 0, Commit_Started_At: '', Completed_At: '' };
  authControlSave_(table, row); return row;
}
function accessStart_(ss, c, p, now, recovery) {
  var purpose=recovery?'RECOVER':'ACTIVATE';if(recovery&&!recoveryEnabled_())failure_('IDENTITY_UNAVAILABLE');
  authControlExact_(p, ['email', 'flowId', 'tokenHash', 'codeHash', 'code']);
  if (!accessHash_(p.codeHash) || !accessDeliveryCode_(p.code)) accessReject_();
  var owner = accessOwner_(c, p.email), table = accessFlows_(ss);
  if (!recovery && !owner) return {accepted:true,outcome:'NOT_FOUND'};
  if (!recovery && owner.row.Primeiro_Acesso_Concluido) return {accepted:true,outcome:'ALREADY_ACTIVE'};
  if(owner&&owner.row.Primeiro_Acesso_Concluido!==!!recovery)owner=null;
  // Throttle delivery as well as requests. Invalid accounts have the same response.
  var prior = owner && table.rows.filter(function (row) { return row.Subject_ID === owner.row.ID_Usuario && row.Purpose === purpose && (purpose!=='ACTIVATE'||row.Authorization_Version===owner.version); });
  if (prior && prior.some(function (row) { return now - authControlTime_(row.Created_At) < 60000; })) {if(!recovery)return {accepted:true,outcome:'THROTTLED'};owner = null;}
  if (owner) table.rows.filter(function (row) { return row.Subject_ID === owner.row.ID_Usuario && row.Purpose === purpose && !['COMPLETE', 'COMMITTING', 'REVOKED'].includes(row.State); }).forEach(function (row) {
    row.State = 'REVOKED'; authControlSave_(table, row);
  });
  var flow = accessNewFlow_(table, p, owner, purpose, now), outcome = 'SENT';
  if (owner) {
    try {
      if (MailApp.getRemainingDailyQuota() < 1) throw new Error('MAIL_QUOTA');
      MailApp.sendEmail({ to: ownerLoginEmail_(c), subject:recovery?'Livraria IPB DEV — recuperar PIN':'Livraria IPB DEV — confirmar primeiro acesso',
        body:(recovery?'Foi solicitada a recuperação do PIN da conta proprietária no ambiente DEV.':'Foi solicitado o primeiro acesso da conta proprietária no ambiente DEV.')+'\n\nCódigo de uso único (válido por 10 minutos):\n' + p.code +
          '\n\nDigite esse código somente em:\nhttps://dev--merry-chimera-49a1f3.netlify.app/acesso-dev.html\n\nSe não solicitou, ignore este e-mail. Não compartilhe o código.' });
    } catch (_) {
      // No raw code is persisted or logged, including on provider errors.
      outcome = 'DELIVERY_UNAVAILABLE';
      var persisted = accessCurrent_(ss, p.tokenHash, now); persisted.row.State = 'REVOKED'; authControlSave_(persisted.table, persisted.row);
    }
  }
  return recovery?{accepted:true}:{accepted:true,outcome:outcome};
}
function accessCommit_(ss, c, current, p, now) {
  if(current.row.Purpose==='RECOVER')return recoveryCommit_(ss,c,current,p,now,false);
  var row = current.row, owner = accessFlowOwner_(c, row);
  if (!accessHash_(p.sessionTokenHash) || !['PASSKEY', 'COMMITTING', 'COMPLETE'].includes(row.State)) accessReject_();
  var ceremony = passkeyCeremonies_(ss).rows.filter(function (item) { return item.ID === row.Ceremony_ID; });
  if (ceremony.length !== 1 || ceremony[0].Subject_ID !== row.Subject_ID || ceremony[0].Authorization_Version !== row.Authorization_Version ||
      ceremony[0].Purpose !== (row.Purpose === 'ACTIVATE'||emergencyFlow_(c,row) ? 'REGISTER' : 'AUTHENTICATE') || ceremony[0].Completed_At === '' || ceremony[0].Consumed_At === '') accessReject_();
  var key = passkeyCredentials_(ss).rows.filter(function (item) { return item.Credential_ID === ceremony[0].Credential_ID && item.Subject_ID === row.Subject_ID && item.Authorization_Version === row.Authorization_Version && item.Revoked_At === ''; });
  if (key.length !== 1 || row.Purpose === 'ACTIVATE' && key[0].Registration_Ceremony_ID !== row.Ceremony_ID) accessReject_();
  var pins = accessPins_(ss), pin = pins.rows.filter(function (item) { return item.Subject_ID === row.Subject_ID; });
  var sessions = identityRows_(storage_(c, false).spreadsheet, 'Sessoes');
  var audit = identityRows_(storage_(c, false).spreadsheet, 'Logs_Auditoria');
  if (row.State === 'PASSKEY') {
    if (authControlTime_(ceremony[0].Expires_At) <= now || sessions.rows.length >= 5000 || audit.rows.length >= 5000 ||
        row.Purpose === 'ACTIVATE' && (pin.length && pin[0].Authorization_Version === row.Authorization_Version || !row.Pin_JSON) ||
        row.Purpose === 'LOGIN' && (pin.length !== 1 || pin[0].Authorization_Version !== row.Authorization_Version)) accessReject_();
    if (row.Purpose === 'ACTIVATE') accessPinRecord_(row.Pin_JSON);
    row.State = 'COMMITTING'; row.Session_Token_Hash = p.sessionTokenHash; row.Commit_Started_At = new Date(now).toISOString();
    // Write-ahead intent. All following projections may safely be replayed.
    authControlSave_(current.table, row);
  }
  if (!constantEqual_(row.Session_Token_Hash, p.sessionTokenHash)) accessReject_();
  if (row.State !== 'COMPLETE') {
    if (row.Purpose === 'ACTIVATE') {
      if (pin.length && pin[0].Authorization_Version === row.Authorization_Version && pin[0].Record_JSON !== row.Pin_JSON) accessReject_();
      if (!pin.length || pin[0].Authorization_Version !== row.Authorization_Version) authControlSave_(pins, { number:pin.length ? pin[0].number : undefined, Subject_ID: row.Subject_ID, Record_JSON: row.Pin_JSON, Authorization_Version: row.Authorization_Version, Created_At: row.Commit_Started_At });
      owner.row.Primeiro_Acesso_Concluido = true;
    }
    owner.row.Ultimo_Acesso = row.Commit_Started_At; accessSaveMain_(owner.users, owner.row);
    var matches = sessions.rows.filter(function (item) { return item.ID_Sessao === row.ID || item.Token_Hash === p.sessionTokenHash; });
    var value = { ID_Sessao: row.ID, ID_Usuario: row.Subject_ID, Criado_Em: row.Commit_Started_At,
      Expira_Em: new Date(authControlTime_(row.Commit_Started_At) + 28800000).toISOString(), Revogado_Em: '', Dispositivo: 'identity-flow:' + row.ID,
      Ultima_Atividade: row.Commit_Started_At, Token_Hash: p.sessionTokenHash, Nivel_Autenticacao: 'passkey', Versao_Autorizacao: row.Authorization_Version };
    if (matches.length > 1 || matches.length && !sessions.columns.every(function (column) { return matches[0][column] === value[column]; })) accessReject_();
    if (!matches.length) accessSaveMain_(sessions, value);
    var auditValue = { ID_Log: row.ID, Data_Hora: row.Commit_Started_At, ID_Usuario: row.Subject_ID, Perfil: owner.row.Perfil,
      Acao: row.Purpose === 'ACTIVATE' ? 'IDENTITY_ACTIVATE' : 'IDENTITY_LOGIN', Entidade: 'Usuarios', ID_Entidade: row.Subject_ID,
      Antes: '', Depois: '', Resultado: 'SUCESSO', ID_Requisicao: row.ID };
    var logged = audit.rows.filter(function (item) { return item.ID_Log === row.ID; });
    if (logged.length > 1 || logged.length && !audit.columns.every(function (column) { return logged[0][column] === auditValue[column]; })) accessReject_();
    if (!logged.length) accessSaveMain_(audit, auditValue);
    row.State = 'COMPLETE'; row.Completed_At = new Date(now).toISOString(); row.Pin_JSON = ''; authControlSave_(current.table, row);
  }
  // Reader also requires the COMPLETE marker. A partial projection cannot log in.
  return identitySession_(storage_(c, false).spreadsheet, p.sessionTokenHash, now).principal;
}
function accessRecoverIntents_(ss, c, now) {
  // A lost browser/expired flow must not leave a half-activated owner forever.
  // Recovery replays only a durable, previously verified intent, never a PIN or
  // email supplied by this request. It never returns a cookie or raw token.
  accessFlows_(ss).rows.filter(function (row) { return row.State === 'COMMITTING'; }).forEach(function (row) {
    var owner = row.Subject_ID === scriptProperties_().getProperty('IDENTITY_OWNER_USER_ID') ? accessOwner_(c) : staffSubject_(c,row.Subject_ID);
    if (!owner || row.Subject_ID !== owner.row.ID_Usuario || row.Authorization_Version !== owner.version) return;
    try { accessCommit_(ss, c, { table: accessFlows_(ss), row: row }, { sessionTokenHash: row.Session_Token_Hash }, now); }
    catch (error) {
      // An old completed projection may have an expired/idle session; a new
      // PIN + passkey login is required rather than refreshing that session.
      var latest = accessFlows_(ss).rows.filter(function (item) { return item.ID === row.ID; });
      if (error.message !== 'UNAUTHENTICATED' || latest.length !== 1 || latest[0].State !== 'COMPLETE') throw error;
    }
  });
}
function ownerAccessOperation_(request, c) {
  if (c.environment !== 'dev') failure_('FORBIDDEN');
  recoverEmergencyRecovery_(c);recoverKeyManagement_(c);recoverSecurityIntent_(c);recoverStaff_(c);recoverProfiles_(c);recoverRecoveryIntents_(c);recoverEmailChanges_(c);
  var p = request.payload, action = request.action, now = Date.now(), ss = authControlStore_(c);
  var schemas = {
    'identity.access.start': ['email', 'flowId', 'tokenHash', 'codeHash', 'code'],
    'identity.access.rescue':['tokenHash','codeHash'],
    'identity.access.rescueBegin':['tokenHash','ceremonyId','challenge'],
    'identity.access.rescueKey':['tokenHash','sessionTokenHash','ceremonyId','credentialId','publicKey','counter','transports'],
    'identity.access.recover':['email','flowId','tokenHash','codeHash','code'],
    'identity.access.lookup': ['email'], 'identity.access.ownerLookup':['cpfIndex'],
    'identity.access.login': ['flowId', 'tokenHash', 'subjectId', 'authorizationVersion'],
    'identity.access.read': ['tokenHash'], 'identity.access.email': ['tokenHash', 'codeHash'],
    'identity.access.pin': ['tokenHash', 'record'], 'identity.access.bind': ['tokenHash', 'ceremonyId'],
    'identity.access.commit': ['tokenHash', 'sessionTokenHash']
  };
  if (!Object.prototype.hasOwnProperty.call(schemas, action)) failure_('FORBIDDEN'); authControlExact_(p, schemas[action]);
  if (action === 'identity.access.ownerLookup') {
    if (!accessHash_(p.cpfIndex)) accessReject_();
    var ownerLookup=accessOwner_(c);
    return {email:ownerLookup&&ownerLookup.row.CPF_Indice===p.cpfIndex?ownerLoginEmail_(c):null};
  }
  if (['identity.access.start', 'identity.access.lookup'].includes(action)) accessRecoverIntents_(ss, c, now);
  if(action==='identity.access.recover')return accessStart_(ss,c,p,now,true);
  if (action === 'identity.access.start') return accessStart_(ss, c, p, now);
  if (action === 'identity.access.lookup') {
    var owner = accessOwner_(c, p.email);
    if (!owner || !owner.row.Primeiro_Acesso_Concluido || !accessFlows_(ss).rows.some(function (row) { return row.Subject_ID === owner.row.ID_Usuario && row.Purpose === 'ACTIVATE' && row.State === 'COMPLETE'; })) return { account: null };
    var pin = accessPins_(ss).rows.filter(function (row) { return row.Subject_ID === owner.row.ID_Usuario && row.Authorization_Version === owner.version; });
    if (pin.length !== 1) failure_('IDENTITY_UNAVAILABLE');
    return { account: { subjectId: owner.row.ID_Usuario, authorizationVersion: owner.version, record: accessPinRecord_(pin[0].Record_JSON) } };
  }
  if (action === 'identity.access.login') {
    var owner = p.subjectId === scriptProperties_().getProperty('IDENTITY_OWNER_USER_ID') ? accessOwner_(c) : staffSubject_(c,p.subjectId);
    if (!owner || !owner.row.Primeiro_Acesso_Concluido || owner.row.ID_Usuario !== p.subjectId || owner.version !== p.authorizationVersion) accessReject_();
    accessNewFlow_(accessFlows_(ss), p, owner, 'LOGIN', now); return { accepted: true };
  }
  var current = accessCurrent_(ss, p.tokenHash, now), row = current.row;
  if (action === 'identity.access.email') {
    if (row.State !== 'EMAIL' || !accessHash_(p.codeHash)) accessReject_();
    row.Attempt_Count++;
    var verified = row.Attempt_Count <= 5 && row.Subject_ID !== '' && constantEqual_(row.Email_Code_Hash, p.codeHash);
    if (verified) {
      accessFlowOwner_(c, row);
      // A fresh, verified invitation may replace abandoned enrollments while
      // the owner is still pending. Never revoke keys of an activated account.
      var abandoned = passkeyCredentials_(ss);
      abandoned.rows.filter(function (key) { return row.Purpose==='ACTIVATE'&&key.Subject_ID === row.Subject_ID && key.Authorization_Version === row.Authorization_Version && key.Revoked_At === ''; }).forEach(function (key) {
        key.Revoked_At = new Date(now).toISOString(); authControlSave_(abandoned, key);
      });
      row.State = 'PIN'; row.Email_Code_Hash = '';row.Attempt_Count=0;
    }
    else if (row.Attempt_Count >= 5) row.State = 'REVOKED';
    if(!verified&&row.Attempt_Count===5)securityProofBlock_(c,row,now);else authControlSave_(current.table, row); return { verified: verified };
  }
  accessFlowOwner_(c, row);
  if(action==='identity.access.rescue')return emergencyAuthorize_(ss,c,current,p,now);
  if(action==='identity.access.rescueBegin')return emergencyBegin_(ss,c,current,p,now);
  if(action==='identity.access.rescueKey')return emergencyStartCommit_(ss,c,current,p,now);
  if (action === 'identity.access.read') return { flowId: row.ID, subjectId: row.Subject_ID, authorizationVersion: row.Authorization_Version,
    purpose: row.Purpose, state: row.State,replacementAllowed:emergencyFlow_(c,row), ceremonyId: row.Ceremony_ID, proofReady: row.Ceremony_ID !== '' && passkeyCeremonies_(ss).rows.some(function (item) { return item.ID === row.Ceremony_ID && item.Completed_At !== ''; }) };
  if (action === 'identity.access.pin') {
    if (row.State !== 'PIN' || !['ACTIVATE','RECOVER'].includes(row.Purpose)) accessReject_();
    accessPinRecord_(p.record); row.Pin_JSON = p.record; row.State = 'PASSKEY'; authControlSave_(current.table, row); return { stored: true };
  }
  if (action === 'identity.access.bind') {
    if (row.State !== 'PASSKEY' || !identityUuid_(p.ceremonyId) || current.table.rows.some(function (flow) { return flow.Ceremony_ID === p.ceremonyId; })) accessReject_();
    var ceremony = passkeyCeremonies_(ss).rows.filter(function (item) { return item.ID === p.ceremonyId && item.Subject_ID === row.Subject_ID && item.Authorization_Version === row.Authorization_Version && item.Completed_At === '' && item.Consumed_At === ''; });
    if (ceremony.length !== 1 || ceremony[0].Purpose !== (row.Purpose === 'ACTIVATE'||emergencyFlow_(c,row) ? 'REGISTER' : 'AUTHENTICATE')) accessReject_();
    row.Ceremony_ID = p.ceremonyId; authControlSave_(current.table, row); return { stored: true };
  }
  if (action === 'identity.access.commit') return accessCommit_(ss, c, current, p, now);
  accessReject_();
}

// Fixed access commands only, signed and gated by processRequest_ under ScriptLock.
// They preserve the existing validators; no caller-selected arbitrary batch.
function accessOptions_(request, c) {
  var p = request.payload;
  authControlExact_(p, ['tokenHash','accountKey','originKey','ceremonyId','challenge','allowReplacement']);
  if (typeof p.allowReplacement !== 'boolean' || !identityUuid_(p.ceremonyId) || !/^[A-Za-z0-9_-]{43}$/.test(p.challenge || '')) accessReject_();
  recoverSecurityIntent_(c);
  var attempt = authAttempt_(authControlStore_(c), {accountKey:p.accountKey, originKey:p.originKey}, Date.now());
  if (!attempt.allowed) return {allowed:false, retryAfterSeconds:attempt.retryAfterSeconds};
  var flow = ownerAccessOperation_({action:'identity.access.read',payload:{tokenHash:p.tokenHash}}, c);
  if (flow.state !== 'PASSKEY' || flow.replacementAllowed && !p.allowReplacement) accessReject_();
  var user = {subjectId:flow.subjectId, authorizationVersion:flow.authorizationVersion};
  var credentials = passkeyOperation_({action:'identity.passkey.list', payload:user}, c).credentials;
  var kind = flow.purpose === 'ACTIVATE' || flow.replacementAllowed ? 'create' : 'get';
  if (flow.replacementAllowed) ownerAccessOperation_({action:'identity.access.rescueBegin',payload:{tokenHash:p.tokenHash,ceremonyId:p.ceremonyId,challenge:p.challenge}}, c);
  else passkeyOperation_({action:'identity.passkey.begin',payload:{subjectId:user.subjectId,authorizationVersion:user.authorizationVersion,ceremonyId:p.ceremonyId,purpose:kind === 'create' ? 'REGISTER':'AUTHENTICATE',challenge:p.challenge}}, c);
  ownerAccessOperation_({action:'identity.access.bind',payload:{tokenHash:p.tokenHash,ceremonyId:p.ceremonyId}}, c);
  return {allowed:true, subjectId:user.subjectId, authorizationVersion:user.authorizationVersion, kind:kind, credentials:credentials, ceremonyId:p.ceremonyId, challenge:p.challenge, replacementAllowed:flow.replacementAllowed};
}

// One locked lookup reserves the durable guess budget before reading a PIN
// verifier. It never accepts a subject/role/PIN and never creates a flow/session.
function accessLoginLookup_(request,c) {
  var p=request.payload;
  authControlExact_(p,['accountKey','originKey','email','emailIndex','cpfIndex','staffLookup']);
  if(typeof p.staffLookup!=='boolean'||typeof p.email!=='string'||typeof p.emailIndex!=='string'||typeof p.cpfIndex!=='string'||
      (p.email!==''&&accessEmail_(p.email)!==p.email)||
      (p.email===''?!accessHash_(p.cpfIndex):p.cpfIndex!=='')||
      (p.staffLookup&&p.email!==''?!accessHash_(p.emailIndex):p.emailIndex!==''))accessReject_();
  if(p.staffLookup&&!staffEnabled_())failure_('STAFF_UNAVAILABLE');
  recoverSecurityIntent_(c);
  var attempt=authAttempt_(authControlStore_(c),{accountKey:p.accountKey,originKey:p.originKey},Date.now());
  if(!attempt.allowed)return {allowed:false,retryAfterSeconds:attempt.retryAfterSeconds};
  if(p.staffLookup){
    var staff=staffAccessOperation_({action:'identity.staffAccess.lookup',payload:{emailIndex:p.emailIndex,cpfIndex:p.cpfIndex}},c).account;
    if(staff)return {allowed:true,kind:'STAFF',account:staff.activated&&staff.record?staff:null};
  }
  var email=p.email;
  if(!email)email=ownerAccessOperation_({action:'identity.access.ownerLookup',payload:{cpfIndex:p.cpfIndex}},c).email;
  var account=email?ownerAccessOperation_({action:'identity.access.lookup',payload:{email:email}},c).account:null;
  return {allowed:true,kind:'OWNER',account:account};
}

function accessStartGuarded_(request,c) {
  var p=request.payload;
  authControlExact_(p,['accountKey','originKey','email','flowId','tokenHash','codeHash','code']);
  recoverSecurityIntent_(c);
  var attempt=authAttempt_(authControlStore_(c),{accountKey:p.accountKey,originKey:p.originKey},Date.now());
  if(!attempt.allowed)return {allowed:false,retryAfterSeconds:attempt.retryAfterSeconds};
  var result=ownerAccessOperation_({action:'identity.access.start',payload:{email:p.email,flowId:p.flowId,tokenHash:p.tokenHash,codeHash:p.codeHash,code:p.code}},c);
  result.allowed=true;return result;
}

// Fixed commands combine a durable attempt with one existing operation. The
// client cannot choose additional actions; all flow/epoch checks still run.
function accessEmailGuarded_(request,c) {
  var p=request.payload;
  authControlExact_(p,['accountKey','originKey','tokenHash','codeHash']);
  recoverSecurityIntent_(c);
  var attempt=authAttempt_(authControlStore_(c),{accountKey:p.accountKey,originKey:p.originKey},Date.now());
  if(!attempt.allowed)return {allowed:false,retryAfterSeconds:attempt.retryAfterSeconds};
  var result=ownerAccessOperation_({action:'identity.access.email',payload:{tokenHash:p.tokenHash,codeHash:p.codeHash}},c);
  result.allowed=true;return result;
}
function accessPinReadGuarded_(request,c) {
  var p=request.payload;
  authControlExact_(p,['accountKey','originKey','tokenHash']);
  recoverSecurityIntent_(c);
  var attempt=authAttempt_(authControlStore_(c),{accountKey:p.accountKey,originKey:p.originKey},Date.now());
  if(!attempt.allowed)return {allowed:false,retryAfterSeconds:attempt.retryAfterSeconds};
  var result=ownerAccessOperation_({action:'identity.access.read',payload:{tokenHash:p.tokenHash}},c);
  if(result.state!=='PIN')accessReject_();
  result.allowed=true;return result;
}

// One bounded preparation command replaces repeated flow reads, a separate
// limiter RPC and a separate challenge take. Crypto verification stays in Node.
// A previously persisted proof can commit/release the SAME session directly.
function accessPrepareCompletion_(request,c) {
  var p=request.payload;
  authControlExact_(p,['tokenHash','sessionTokenHash','accountKey','originKey','credentialId','hasResponse','allowReplacement','handleSubjectId']);
  if(!accessHash_(p.tokenHash)||!accessHash_(p.sessionTokenHash)||typeof p.hasResponse!=='boolean'||typeof p.allowReplacement!=='boolean'||typeof p.credentialId!=='string'||p.credentialId.length>1400||typeof p.handleSubjectId!=='string'||p.handleSubjectId!==''&&!identityUuid_(p.handleSubjectId))accessReject_();
  recoverSecurityIntent_(c);
  var flow;
  try { flow=ownerAccessOperation_({action:'identity.access.read',payload:{tokenHash:p.tokenHash}},c); }
  catch(error){
    if(error.message==='ACCESS_REJECTED'){
      var failed=authAttempt_(authControlStore_(c),{accountKey:p.accountKey,originKey:p.originKey},Date.now());
      if(!failed.allowed)return {allowed:false,retryAfterSeconds:failed.retryAfterSeconds};
    }
    throw error;
  }
  if(flow.proofReady){
    if(!['PASSKEY','COMMITTING','COMPLETE'].includes(flow.state)||!flow.ceremonyId)accessReject_();
    // This is acknowledgement/recovery of an already verified proof, not a new
    // guess. commit rechecks key, epoch, flow binding and durable projections.
    var principal=ownerAccessOperation_({action:'identity.access.commit',payload:{tokenHash:p.tokenHash,sessionTokenHash:p.sessionTokenHash}},c);
    return {allowed:true,done:true,flow:flow,principal:principal};
  }
  var attempt=authAttempt_(authControlStore_(c),{accountKey:p.accountKey,originKey:p.originKey},Date.now());
  if(!attempt.allowed)return {allowed:false,retryAfterSeconds:attempt.retryAfterSeconds};
  if(p.handleSubjectId!==''&&p.handleSubjectId!==flow.subjectId)accessReject_();
  if(flow.state!=='PASSKEY'||!flow.ceremonyId||!p.hasResponse||!passkeyText_(p.credentialId,2,1400)||flow.replacementAllowed&&!p.allowReplacement)accessReject_();
  var ceremony=passkeyOperation_({action:'identity.passkey.take',payload:{subjectId:flow.subjectId,authorizationVersion:flow.authorizationVersion,ceremonyId:flow.ceremonyId,credentialId:flow.purpose==='ACTIVATE'||flow.replacementAllowed?'':p.credentialId}},c);
  return {allowed:true,done:false,flow:flow,ceremony:ceremony};
}
