/* Private DEV WebAuthn persistence. Signature/schema/global lock checked by dispatcher.
 * Crypto verification is performed in Node with maintained SimpleWebAuthn library.
 * No browser route, PIN validation, email proof or session issuance is provided. */
function passkeyText_(value, min, max) {
  return typeof value === 'string' && value.length >= min && value.length <= max &&
    value.length % 4 !== 1 && /^[A-Za-z0-9_-]+$/.test(value);
}
function passkeySubject_(c, subjectId, version) {
  if (!identityUuid_(subjectId) || !Number.isSafeInteger(version) || version < 1) failure_('PASSKEY_REJECTED');
  var ss = storage_(c, false).spreadsheet;
  var users = identityRows_(ss, 'Usuarios').rows.filter(function (row) { return row.ID_Usuario === subjectId; });
  var epochs = identityRows_(ss, 'Configuracoes').rows.filter(function (row) { return row.Chave === 'identity.version.' + subjectId; });
  if (users.length !== 1 || epochs.length !== 1 || users[0].Status !== 'ATIVO' ||
      !['ADMIN', 'SUPER_ADMIN', 'ATENDENTE'].includes(users[0].Perfil) || typeof users[0].Primeiro_Acesso_Concluido !== 'boolean' ||
      !Number.isSafeInteger(epochs[0].Valor) || epochs[0].Valor !== version) failure_('PASSKEY_REJECTED');
}
function passkeyCredentials_(ss) {
  var table = authControlRows_(ss, '_Passkeys'), seen = new Set();
  table.rows.forEach(function (row) {
    if (!passkeyText_(row.Credential_ID, 2, 1400) || seen.has(row.Credential_ID) || !identityUuid_(row.Subject_ID) ||
        !passkeyText_(row.Public_Key, 20, 4096) || !Number.isSafeInteger(row.Counter) || row.Counter < 0 || row.Counter > 4294967295 ||
        !Number.isSafeInteger(row.Authorization_Version) || row.Authorization_Version < 1) failure_('IDENTITY_UNAVAILABLE');
    var transports;
    try { transports = JSON.parse(row.Transports_JSON); } catch (_) { failure_('IDENTITY_UNAVAILABLE'); }
    if (!Array.isArray(transports) || transports.length > 7 || transports.some(function (value) { return !['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'].includes(value); })) failure_('IDENTITY_UNAVAILABLE');
    seen.add(row.Credential_ID);
  });
  return table;
}
function passkeyCeremonies_(ss) {
  var table = authControlRows_(ss, '_Passkey_Ceremonies'), seen = new Set(), challenges = new Set();
  table.rows.forEach(function (row) {
    if (!identityUuid_(row.ID) || seen.has(row.ID) || !identityUuid_(row.Subject_ID) || !['REGISTER', 'AUTHENTICATE'].includes(row.Purpose) ||
        !passkeyText_(row.Challenge, 43, 43) || challenges.has(row.Challenge) || !Number.isSafeInteger(row.Authorization_Version) || row.Authorization_Version < 1) failure_('IDENTITY_UNAVAILABLE');
    if (authControlTime_(row.Expires_At) - authControlTime_(row.Created_At) !== 300000) failure_('IDENTITY_UNAVAILABLE');
    seen.add(row.ID); challenges.add(row.Challenge);
  });
  return table;
}
function passkeyCurrentCeremony_(table, payload, now, consumed) {
  var found = table.rows.filter(function (row) { return row.ID === payload.ceremonyId; });
  if (found.length !== 1) failure_('PASSKEY_REJECTED');
  var row = found[0];
  if (row.Subject_ID !== payload.subjectId || row.Authorization_Version !== payload.authorizationVersion ||
      Date.parse(row.Created_At) > now || Date.parse(row.Expires_At) <= now || (consumed ? row.Consumed_At === '' : row.Consumed_At !== '')) failure_('PASSKEY_REJECTED');
  return row;
}
function passkeyOperation_(request, c) {
  if (c.environment !== 'dev') failure_('FORBIDDEN');
  recoverEmergencyRecovery_(c);recoverKeyManagement_(c);
  var p = request.payload, action = request.action, now = Date.now();
  var schemas = {
    'identity.passkey.list': ['subjectId', 'authorizationVersion'],
    'identity.passkey.begin': ['ceremonyId', 'subjectId', 'authorizationVersion', 'purpose', 'challenge'],
    'identity.passkey.take': ['ceremonyId', 'subjectId', 'authorizationVersion', 'credentialId'],
    'identity.passkey.register': ['ceremonyId', 'subjectId', 'authorizationVersion', 'credentialId', 'publicKey', 'counter', 'transports'],
    'identity.passkey.counter': ['ceremonyId', 'subjectId', 'authorizationVersion', 'credentialId', 'expectedCounter', 'newCounter']
  };
  if (!Object.prototype.hasOwnProperty.call(schemas, action)) failure_('FORBIDDEN');
  authControlExact_(p, schemas[action]); passkeySubject_(c, p.subjectId, p.authorizationVersion);
  var ss = authControlStore_(c), keys = passkeyCredentials_(ss);
  var active = keys.rows.filter(function (row) { return row.Subject_ID === p.subjectId && row.Authorization_Version === p.authorizationVersion && row.Revoked_At === ''; });
  if (action === 'identity.passkey.list') return { credentials: active.map(function (row) { return { id: row.Credential_ID, transports: JSON.parse(row.Transports_JSON) }; }) };
  if (!identityUuid_(p.ceremonyId)) failure_('PASSKEY_REJECTED');
  var ceremonies = passkeyCeremonies_(ss);
  if (action === 'identity.passkey.begin') {
    if (!['REGISTER', 'AUTHENTICATE'].includes(p.purpose) || !passkeyText_(p.challenge, 43, 43) ||
        ceremonies.rows.some(function (row) { return row.ID === p.ceremonyId || row.Challenge === p.challenge; }) ||
        (p.purpose === 'AUTHENTICATE' && !active.length) || (p.purpose === 'REGISTER' && active.length >= 5)) failure_('PASSKEY_REJECTED');
    authControlSave_(ceremonies, { ID: p.ceremonyId, Subject_ID: p.subjectId, Purpose: p.purpose, Challenge: p.challenge,
      Created_At: new Date(now).toISOString(), Expires_At: new Date(now + 300000).toISOString(), Consumed_At: '', Authorization_Version: p.authorizationVersion, Completed_At: '', Credential_ID: '', Expected_Counter: '' });
    return { ceremonyId: p.ceremonyId };
  }
  var row = passkeyCurrentCeremony_(ceremonies, p, now, action !== 'identity.passkey.take');
  if (action === 'identity.passkey.take') {
    var credential = null;
    if (row.Purpose === 'AUTHENTICATE') {
      var found = active.filter(function (key) { return key.Credential_ID === p.credentialId; });
      if (found.length !== 1) failure_('PASSKEY_REJECTED');
      credential = { id: found[0].Credential_ID, publicKey: found[0].Public_Key, counter: found[0].Counter, transports: JSON.parse(found[0].Transports_JSON) };
    } else if (p.credentialId !== '') failure_('PASSKEY_REJECTED');
    row.Consumed_At = new Date(now).toISOString(); row.Credential_ID = p.credentialId; row.Expected_Counter = credential ? credential.counter : ''; authControlSave_(ceremonies, row);
    return { challenge: row.Challenge, purpose: row.Purpose, credential: credential };
  }
  // Only trusted Node verifier may commit; no caller-supplied verified/mfa flag.
  if (row.Completed_At !== '' || !passkeyText_(p.credentialId, 2, 1400)) failure_('PASSKEY_REJECTED');
  if (action === 'identity.passkey.register') {
    if (row.Purpose !== 'REGISTER' || !passkeyText_(p.publicKey, 20, 4096) || !Number.isSafeInteger(p.counter) || p.counter < 0 || p.counter > 4294967295 ||
        !Array.isArray(p.transports) || p.transports.length > 7 || p.transports.some(function (value) { return !['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'].includes(value); }) ||
        keys.rows.some(function (key) { return key.Credential_ID === p.credentialId || key.Registration_Ceremony_ID === row.ID; }) || active.length >= 5) failure_('PASSKEY_REJECTED');
    authControlSave_(keys, { Credential_ID: p.credentialId, Subject_ID: p.subjectId, Public_Key: p.publicKey, Counter: p.counter,
      Transports_JSON: JSON.stringify(p.transports), Created_At: new Date(now).toISOString(), Updated_At: new Date(now).toISOString(),
      Authorization_Version: p.authorizationVersion, Revoked_At: '', Registration_Ceremony_ID: row.ID });
    row.Credential_ID = p.credentialId; row.Completed_At = new Date(now).toISOString(); authControlSave_(ceremonies, row);
    return { stored: true };
  }
  if (row.Purpose !== 'AUTHENTICATE' || row.Credential_ID !== p.credentialId || row.Expected_Counter !== p.expectedCounter || !Number.isSafeInteger(p.expectedCounter) || !Number.isSafeInteger(p.newCounter) ||
      p.expectedCounter < 0 || p.newCounter < 0 || p.newCounter > 4294967295 ||
      (p.expectedCounter !== 0 || p.newCounter !== 0) && p.newCounter <= p.expectedCounter) failure_('PASSKEY_REJECTED');
  var current = active.filter(function (key) { return key.Credential_ID === p.credentialId; });
  if (current.length !== 1 || current[0].Counter !== p.expectedCounter) failure_('PASSKEY_REJECTED');
  current[0].Counter = p.newCounter; current[0].Updated_At = new Date(now).toISOString(); authControlSave_(keys, current[0]);
  row.Completed_At = new Date(now).toISOString(); authControlSave_(ceremonies, row);
  return { stored: true };
}
