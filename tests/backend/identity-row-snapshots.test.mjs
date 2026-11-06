import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
import {properties} from './fixtures.mjs';

function bodies(s) {
  let count=0;
  for (const ss of s.gas.sheets.values()) for(const sheet of ss.getSheets()) {
    const get=sheet.getRange;
    sheet.getRange=function(row,...args) {const range=get.call(this,row,...args), read=range.getValues; range.getValues=()=>{if(row===2)count++;return read();};return range;};
  }
  return {reset(){count=0;},get count(){return count;}};
}
test('one locked options operation reuses rows, invalidates its writes and keeps every new request fresh',async()=>{
  const s=ownerFixture(), service=s.service(), token=randomBytes(32).toString('base64url'),ip='192.0.2.118';
  await service.execute('start',{email:properties.OWNER_EMAIL},token,ip);
  const code=s.gas.outbox.at(-1).body.match(/\n([A-HJ-NP-Z2-9]{7})\n/)[1];
  await service.execute('email',{code},token,ip);await service.execute('pin',{pin:'8274'},token,ip);
  const reads=bodies(s);
  await service.execute('options',{},token,ip);const optimized=reads.count;
  const snapshot=s.gas.context.rpcRows_;
  s.gas.context.rpcRows_=(sheet,last,width)=>last<2?[]:sheet.getRange(2,1,last-1,width).getValues();
  reads.reset();await service.execute('options',{},token,ip);const previous=reads.count;
  assert.ok(optimized<previous,`${optimized} should be less than ${previous}`);
  console.info(JSON.stringify({metric:'options.bodyReads',before:previous,after:optimized}));
  s.gas.context.rpcRows_=snapshot;
  const users=s.main.getSheetByName('Usuarios');users.rows[1][users.rows[0].indexOf('Status')]='INATIVO';
  assert.equal((await service.state(token)).stage,'INITIAL');
  assert.equal(s.gas.context.RPC_STORAGE_SCOPE_,null);
  assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
});
test('snapshots copy rows and writes invalidate even if Sheets fails; cache never escapes the operation',()=>{
  const s=ownerFixture(),sheet=s.main.getSheetByName('Usuarios'),context=s.gas.context;
  context.RPC_STORAGE_SCOPE_={identityRows:new WeakMap()};
  try {
    const first=context.rpcRows_(sheet,sheet.getLastRow(),sheet.rows[0].length);
    const expected=first[0][0];first[0][0]='unsaved mutation';
    assert.equal(context.rpcRows_(sheet,sheet.getLastRow(),sheet.rows[0].length)[0][0],expected);
    const get=sheet.getRange;sheet.getRange=()=>{throw Error('WRITE_FAILED');};
    assert.throws(()=>context.accessSaveMain_({sheet,columns:sheet.rows[0],rows:[]},{number:2}),/WRITE_FAILED/);
    assert.equal(context.RPC_STORAGE_SCOPE_.identityRows.has(sheet),false);
    sheet.getRange=get;
    assert.equal(context.rpcRows_(sheet,sheet.getLastRow(),sheet.rows[0].length)[0][0],expected);
  } finally {context.RPC_STORAGE_SCOPE_=null;}
});
