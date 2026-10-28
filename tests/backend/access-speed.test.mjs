import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
import {properties} from './fixtures.mjs';
import {createAccessEmailCode} from '../../backend/owner-access.mjs';
const code = s => s.gas.outbox.at(-1).body.match(/\n([A-HJ-NP-Z2-9]{7})\n/)[1];

test('email proof uses seven cryptographic symbols and normalizes lowercase without shortening internal tokens', async () => {
  for(let i=0;i<100;i++) assert.match(createAccessEmailCode(), /^[A-HJ-NP-Z2-9]{7}$/);
  const s=ownerFixture(), service=s.service(), token=randomBytes(32).toString('base64url'), ip='192.0.2.42';
  await service.execute('start',{email:properties.OWNER_EMAIL},token,ip);
  const proof=code(s);
  assert.equal(token.length,43);
  assert.equal((await service.execute('email',{code:' '+proof.toLowerCase()+' '},token,ip)).stage,'PIN');
  await assert.rejects(service.execute('email',{code:proof},token,ip), {code:'WORKSPACE_ACCESS_REJECTED'});
  assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
  const rows=s.priv.getSheetByName('_Identity_Flows').rows;
  assert.ok(!JSON.stringify(rows).includes(proof));
});

test('an already delivered legacy email proof remains valid for its existing flow', async () => {
  const s=ownerFixture(), token=randomBytes(32).toString('base64url'), proof=randomBytes(32).toString('base64url');
  const scope=[s.settings.config.environment,s.settings.config.installationId];
  const digest=(kind,value)=>createHmac('sha256',s.settings.guardKey).update(JSON.stringify([kind,scope,value])).digest('hex');
  const tokenHash=digest('access.token.v1',token);
  await s.client.access('start',{email:properties.OWNER_EMAIL,flowId:randomUUID(),tokenHash,codeHash:digest('access.email.v1',[tokenHash,proof]),code:proof});
  assert.equal((await s.service().execute('email',{code:proof},token,'192.0.2.43')).stage,'PIN');
});

test('bindings are checked once per resource per RPC while each new request revalidates and clears failed scopes', async () => {
  const s=ownerFixture(), original=s.gas.context.assertMarker_;let checks=0;
  s.gas.context.assertMarker_=(...args)=>{checks++;return original(...args);};
  const token=randomBytes(32).toString('base64url'), service=s.service(), ip='192.0.2.44';
  await service.execute('start',{email:properties.OWNER_EMAIL},token,ip);assert.equal(checks,3);
  checks=0;await service.execute('email',{code:code(s)},token,ip);assert.equal(checks,3);
  checks=0;await service.execute('pin',{pin:'8274'},token,ip);assert.equal(checks,6);
  checks=0;assert.equal((await service.state(token)).stage,'PASSKEY');assert.equal(checks,3);
  assert.equal(s.gas.context.RPC_STORAGE_SCOPE_,null);
  const mainFile=s.gas.resources.get(s.settings.config.spreadsheetId);mainFile.sharing='public';
  await assert.rejects(service.state(token),{code:'WORKSPACE_BINDING_MISMATCH'});
  assert.equal(s.gas.context.RPC_STORAGE_SCOPE_,null);
  mainFile.sharing='private';s.priv.getSheetByName('_Identity_Flows').rows[0][0]='bad';
  await assert.rejects(service.state(token),{code:'WORKSPACE_IDENTITY_UNAVAILABLE'});
  assert.equal(s.gas.context.RPC_STORAGE_SCOPE_,null);
});
