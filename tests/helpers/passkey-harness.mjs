// LOCAL TEST HARNESS ONLY. No external Google calls or real identities.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createGasEmulator } from '../backend/gas-emulator.mjs';
import { properties, environment } from '../backend/fixtures.mjs';
import { loadPasskeySettings, createPasskeyService } from '../../backend/passkey-service.mjs';
import { createWorkspaceClient } from '../../backend/workspace-client.mjs';
import { ApiError } from '../../backend/errors.mjs';
const gas = createGasEmulator({ ...properties, IDENTITY_PASSKEYS_ENABLED: 'true' });
const install = gas.call('provisionDevelopment'); gas.call('provisionDevelopmentAuthControls');
const settings = loadPasskeySettings(environment({ WORKSPACE_IDENTITY_PASSKEYS_ENABLED: 'true',
  WORKSPACE_SPREADSHEET_ID: install.spreadsheetId, WORKSPACE_DRIVE_ROOT_ID: install.driveRootId }));
const main = gas.sheets.get(install.spreadsheetId), priv = gas.sheets.get(gas.props.IDENTITY_CONTROL_SPREADSHEET_ID);
const subjects = { primary: randomUUID(), other: randomUUID() };
for (const id of Object.values(subjects)) {
  for (const [name, fields] of [['Usuarios', { ID_Usuario: id, Perfil: 'ADMIN', Status: 'ATIVO', Primeiro_Acesso_Concluido: false }],
    ['Configuracoes', { Chave: 'identity.version.' + id, Valor: 1 }]]) {
    const sheet = main.getSheetByName(name); sheet.appendRow(sheet.rows[0].map(column => fields[column] ?? ''));
  }
}
const client = createWorkspaceClient(settings.config, { fetchImpl: async (_url, options) => new Response(JSON.stringify(gas.post(JSON.parse(options.body)))) });
const service = createPasskeyService(settings, { client });
const server = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 24000) throw Error('large test request'); }
    const input = JSON.parse(raw || '{}'), subjectId = subjects[input.testSubject || 'primary'];
    const identity = { subjectId, authorizationVersion: 1, ceremonyId: input.ceremonyId };
    let value;
    switch (req.url) {
      case '/register/options': value = await service.registrationOptions(identity); break;
      case '/register/verify': value = await service.verifyRegistration(identity, input.response); break;
      case '/authenticate/options': value = await service.authenticationOptions(identity); break;
      case '/authenticate/verify': value = await service.verifyAuthentication(identity, input.response); break;
      case '/state': value = { credentials: priv.getSheetByName('_Passkeys').getLastRow() - 1,
        sessions: main.getSheetByName('Sessoes').getLastRow() - 1,
        counters: priv.getSheetByName('_Passkeys').rows.slice(1).map(row => row[3]) }; break;
      case '/inject-counter-failure': {
        const sheet = priv.getSheetByName('_Passkeys'), original = sheet.getRange.bind(sheet); let once = true;
        sheet.getRange = (...args) => { const range = original(...args), set = range.setValues;
          range.setValues = values => {
            if (!once) return set(values);
            once = false; if (input.after) set(values); throw Error('INJECTED_COUNTER_FAILURE');
          }; return range; };
        value = { ok: true }; break;
      }
      case '/expire': {
        const sheet = priv.getSheetByName('_Passkey_Ceremonies'), row = sheet.rows.find(row => row[0] === input.ceremonyId);
        row[4] = new Date(Date.now() - 360000).toISOString(); row[5] = new Date(Date.now() - 60000).toISOString(); value = { ok: true }; break;
      }
      default: res.statusCode = 404; value = { error: { code: 'NOT_FOUND' } };
    }
    res.end(JSON.stringify(value));
  } catch (error) {
    res.statusCode = error instanceof ApiError ? error.status : 500;
    res.end(JSON.stringify({ error: { code: error instanceof ApiError ? error.code : 'TEST_INTERNAL' } }));
  }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
