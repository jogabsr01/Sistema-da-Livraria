// Disposable contract only: fake owner, emulated Google/MailApp, random test keys.
import { randomBytes, randomUUID } from 'node:crypto';
import { createGasEmulator } from '../backend/gas-emulator.mjs';
import { properties, environment } from '../backend/fixtures.mjs';
import { createWorkspaceClient } from '../../backend/workspace-client.mjs';
import { createOwnerAccessHandler, loadOwnerAccessSettings, createOwnerAccessService } from '../../backend/owner-access.mjs';
import { createSessionHandler } from '../../backend/session-handler.mjs';
export function ownerFixture() {
  const gas = createGasEmulator({ ...properties, IDENTITY_ACCESS_ENABLED: 'true', IDENTITY_SESSIONS_ENABLED: 'true', IDENTITY_GUARDS_ENABLED: 'true', IDENTITY_PASSKEYS_ENABLED: 'true' });
  const install = gas.call('provisionDevelopment'); gas.call('provisionDevelopmentAuthControls'); gas.call('prepareDevelopmentOwnerAccess');
  const env = environment({ WORKSPACE_IDENTITY_ACCESS_ENABLED: 'true', WORKSPACE_IDENTITY_SESSIONS_ENABLED: 'true', WORKSPACE_IDENTITY_GUARDS_ENABLED: 'true', WORKSPACE_IDENTITY_PASSKEYS_ENABLED: 'true',
    WORKSPACE_PIN_PEPPER: randomBytes(32).toString('hex'), WORKSPACE_SESSION_TOKEN_KEY: randomBytes(32).toString('hex'), WORKSPACE_AUTH_GUARD_KEY: randomBytes(32).toString('hex'),
    WORKSPACE_SPREADSHEET_ID: install.spreadsheetId, WORKSPACE_DRIVE_ROOT_ID: install.driveRootId });
  const settings = loadOwnerAccessSettings(env);
  const client = createWorkspaceClient(settings.config, { fetchImpl: async (_url, options) => new Response(JSON.stringify(gas.post(JSON.parse(options.body)))) });
  const dependencies = { loadSettings: () => loadOwnerAccessSettings(env), createClient: () => client };
  const handler = createOwnerAccessHandler(dependencies);
  const sessionDependencies = { loadSessionSettings: () => settings, createWorkspaceClient: () => client };
  const sessions = Object.fromEntries(['current', 'logout'].map(name => [name, createSessionHandler(name, sessionDependencies)]));
  const priv = gas.sheets.get(gas.props.IDENTITY_CONTROL_SPREADSHEET_ID), main = gas.sheets.get(install.spreadsheetId);
  return { gas, env, settings, client, handler, sessions, priv, main,
    service: () => createOwnerAccessService(loadOwnerAccessSettings(env), { client }),
    // Never available through runtime source. Only these storage-contract tests
    // may fabricate a completed ceremony; real signatures are tested in Chromium.
    storageProof(tokenHash) {
      const flows = priv.getSheetByName('_Identity_Flows'), cols = flows.rows[0], row = flows.rows.find(row => row[cols.indexOf('Token_Hash')] === tokenHash);
      const subjectId = row[cols.indexOf('Subject_ID')], authorizationVersion = row[cols.indexOf('Authorization_Version')], ceremonyId = randomUUID();
      const now = new Date().toISOString(), ceremony = priv.getSheetByName('_Passkey_Ceremonies'), credentialId = randomBytes(32).toString('base64url');
      const c = { ID: ceremonyId, Subject_ID: subjectId, Purpose: 'REGISTER', Challenge: randomBytes(32).toString('base64url'), Created_At: now, Expires_At: new Date(Date.now() + 300000).toISOString(),
        Consumed_At: now, Authorization_Version: authorizationVersion, Completed_At: now, Credential_ID: credentialId, Expected_Counter: '' };
      ceremony.appendRow(ceremony.rows[0].map(key => c[key]));
      const key = { Credential_ID: credentialId, Subject_ID: subjectId, Public_Key: randomBytes(77).toString('base64url'), Counter: 0, Transports_JSON: '[]', Created_At: now, Updated_At: now,
        Authorization_Version: authorizationVersion, Revoked_At: '', Registration_Ceremony_ID: ceremonyId };
      const keys = priv.getSheetByName('_Passkeys'); keys.appendRow(keys.rows[0].map(column => key[column]));
      row[cols.indexOf('Ceremony_ID')] = ceremonyId; return ceremonyId;
    },
  };
}
export function injectAccessFault(fixture, stage, after) {
  const context = fixture.gas.context;
  for (const name of ['authControlSave_', 'accessSaveMain_']) {
    const original = context[name];
    context[name] = (table, row) => {
      const target = table.sheet.name === '_Identity_Flows' ? row.State === 'COMMITTING' ? 'intent' : row.State === 'COMPLETE' ? 'marker' : '' :
        { _Pin_Verifiers: 'pin', Usuarios: 'user', Sessoes: 'session', Logs_Auditoria: 'audit' }[table.sheet.name];
      if (target !== stage) return original(table, row);
      context[name] = original; if (after) original(table, row); throw Error('INJECTED_ACCESS_COMMIT_FAILURE');
    };
  }
}
