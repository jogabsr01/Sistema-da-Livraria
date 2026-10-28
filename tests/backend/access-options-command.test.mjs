import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
import {properties} from './fixtures.mjs';
import {createLoginGuard} from '../../backend/login-guard.mjs';
import {preparedAccessOptions} from '../../backend/passkey-service.mjs';
async function setup(pin=true) {
  const s=ownerFixture(), token=randomBytes(32).toString('base64url'), ip='192.0.2.46', service=s.service();
  await service.execute('start',{email:properties.OWNER_EMAIL},token,ip);
  const code=s.gas.outbox.at(-1).body.match(/\n([A-HJ-NP-Z2-9]{7})\n/)[1];
  await service.execute('email',{code},token,ip);
  if(pin) await service.execute('pin',{pin:'8274'},token,ip);
  const table=s.priv.getSheetByName('_Identity_Flows'), row=table.rows.at(-1), cols=table.rows[0], hash=row[cols.indexOf('Token_Hash')];
  const keys=createLoginGuard(s.settings,{client:s.client}).attemptKeys({identifier:'flow:'+hash,originAddress:ip});
  const payload=()=>({...keys,tokenHash:hash,ceremonyId:randomUUID(),challenge:randomBytes(32).toString('base64url'),allowReplacement:false});
  return {...s,token,row,cols,keys,payload};
}
test('one options RPC reserves one durable attempt and binds a stored challenge before returning browser options',async()=>{
  const s=await setup(), p=s.payload(), original=s.gas.post;let calls=0;
  s.gas.post=(...args)=>{calls++;return original(...args);};
  const limits=s.priv.getSheetByName('_Auth_Limits'), ix=limits.rows[0].indexOf('Attempt_Count'), key=limits.rows[0].indexOf('Key');
  const before=limits.rows.find(r=>r[key]==='account:'+s.keys.accountKey)[ix];
  const prepared=await s.client.prepareAccessOptions(p);assert.equal(calls,1);
  assert.equal(limits.rows.find(r=>r[key]==='account:'+s.keys.accountKey)[ix],before+1);
  const options=await preparedAccessOptions(prepared);
  assert.equal(options.kind,'create');assert.equal(options.options.challenge,p.challenge);
  await assert.rejects(preparedAccessOptions({...prepared,kind:'get',credentials:[]}),{code:'PASSKEY_REJECTED'});
  assert.equal(s.row[s.cols.indexOf('Ceremony_ID')],p.ceremonyId);
  assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
});
test('options command refuses PIN not set, disabled owner, epoch change, expired flow and flags off before binding a challenge',async()=>{
  for(const mode of ['pin','disabled','epoch','expired','flag']){
    const s=await setup(mode!=='pin');
    if(mode==='disabled'){const users=s.main.getSheetByName('Usuarios');users.rows[1][users.rows[0].indexOf('Status')]='INATIVO';}
    if(mode==='epoch')s.main.getSheetByName('Configuracoes').rows[1][1]=2;
    if(mode==='expired'){s.row[s.cols.indexOf('Created_At')]=new Date(Date.now()-700000).toISOString();s.row[s.cols.indexOf('Expires_At')]=new Date(Date.now()-100000).toISOString();}
    if(mode==='flag')s.gas.props.IDENTITY_PASSKEYS_ENABLED='false';
    await assert.rejects(s.client.prepareAccessOptions(s.payload()));
    assert.equal(s.priv.getSheetByName('_Passkey_Ceremonies').getLastRow(),1);
    assert.equal(s.row[s.cols.indexOf('Ceremony_ID')],'');
    assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
  }
});
test('blocked durable attempt does not create a ceremony and preserves the retry indication',async()=>{
  const s=await setup();let result;
  for(let i=0;i<6;i++){result=await s.client.reserveAuthAttempt(s.keys);if(!result.allowed)break;}
  assert.equal(result.allowed,false);
  await assert.rejects(s.client.prepareAccessOptions(s.payload()),error=>error.code==='AUTH_RATE_LIMITED'&&error.retryAfterSeconds>0);
  assert.equal(s.priv.getSheetByName('_Passkey_Ceremonies').getLastRow(),1);
});

test('owner options service uses one signed RPC and keeps the returned challenge bound to that browser flow',async()=>{
  const s=await setup(), original=s.gas.post;let calls=0;
  s.gas.post=(...args)=>{calls++;return original(...args);};
  const result=await s.service().execute('options',{},s.token,'192.0.2.46');
  assert.equal(calls,1);assert.equal(result.stage,'PASSKEY');assert.equal(result.kind,'create');
  const ceremonies=s.priv.getSheetByName('_Passkey_Ceremonies'), columns=ceremonies.rows[0];
  const bound=ceremonies.rows.find(r=>r[columns.indexOf('ID')]===s.row[s.cols.indexOf('Ceremony_ID')]);
  assert.equal(bound[columns.indexOf('Challenge')],result.options.challenge);
  assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
});

test('fixed options command rejects caller-supplied identity or flags before creating any challenge',async()=>{
  const s=await setup();
  for(const change of [{subjectId:randomUUID()},{role:'SUPER_ADMIN'},{allowReplacement:'true'}]){
    await assert.rejects(s.client.prepareAccessOptions({...s.payload(),...change}));
  }
  assert.equal(s.priv.getSheetByName('_Passkey_Ceremonies').getLastRow(),1);
});

test('a failure after storing a ceremony never grants access and a new attempt safely binds another challenge',async()=>{
  const s=await setup(), save=s.gas.context.authControlSave_;let fail=true;
  s.gas.context.authControlSave_=(table,row)=>{
    if(fail&&table.sheet.name==='_Identity_Flows'&&row.Ceremony_ID){fail=false;throw Error('TEST_BIND_INTERRUPTED');}
    return save(table,row);
  };
  await assert.rejects(s.client.prepareAccessOptions(s.payload()));
  assert.equal(s.row[s.cols.indexOf('Ceremony_ID')],'');
  assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
  const fresh=s.payload(), prepared=await s.client.prepareAccessOptions(fresh);
  assert.equal(prepared.ceremonyId,fresh.ceremonyId);
  assert.equal(s.row[s.cols.indexOf('Ceremony_ID')],fresh.ceremonyId);
  assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
});
