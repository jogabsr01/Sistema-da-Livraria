import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
import {properties} from './fixtures.mjs';
async function fixture(){const s=ownerFixture(),token=randomBytes(32).toString('base64url');await s.service().execute('start',{email:properties.OWNER_EMAIL},token,'192.0.2.172');return {...s,token};}
function batches(s,change=()=>{}){
 const calls=[];
 s.gas.context.Sheets={Spreadsheets:{Values:{batchGet(id,options){
   calls.push({id,options});const ss=s.gas.sheets.get(id);assert.ok(ss);assert.equal(options.majorDimension,'ROWS');assert.equal(options.valueRenderOption,'UNFORMATTED_VALUE');
   const response={spreadsheetId:id,valueRanges:options.ranges.map(range=>{
     const name=range.match(/^'((?:[^']|'')+)'!1:1$/)[1].replace(/''/g,"'");const sheet=ss.getSheetByName(name);assert.ok(sheet);
     return {range:"'"+name.replace(/'/g,"''")+"'!A1:ZZ1",majorDimension:'ROWS',values:sheet.rows[0]?.length?[sheet.rows[0].slice()]:[]};
   })};change(response,ss,calls.length);return response;
 }}}};return calls;
}
test('one signed request validates all 24 fresh headers in two native read-only batches, with no row-1 SpreadsheetApp reads',async()=>{
 const s=await fixture(),calls=batches(s);let slowHeaders=0;
 for(const ss of s.gas.sheets.values())for(const sheet of ss.tables.values()){const get=sheet.getRange;sheet.getRange=function(row,...args){const r=get.call(this,row,...args),read=r.getValues;r.getValues=()=>{if(row===1)slowHeaders++;return read();};return r;};}
 assert.equal((await s.service().state(s.token)).stage,'EMAIL');assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.options.ranges.length),[17,7]);assert.equal(slowHeaders,0);assert.equal(s.gas.context.RPC_STORAGE_SCOPE_,null);assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
 const u=s.main.getSheetByName('Usuarios');u.rows[0][0]='CHANGED';await assert.rejects(s.service().state(s.token),{code:'WORKSPACE_SCHEMA_CONFLICT'});assert.equal(s.gas.context.RPC_STORAGE_SCOPE_,null);
});
test('batch validation retains missing/conflicting header precedence and sees distant extra columns without truncation',async()=>{
 for(const mode of ['missing','conflict-before-missing','distant-extra','distant-body']){
  const s=await fixture();batches(s);
  if(['missing','conflict-before-missing'].includes(mode))s.main.tables.delete('Usuarios');
  if(mode==='conflict-before-missing')s.main.getSheetByName('Produtos').rows[0][0]='CHANGED';
  if(mode==='distant-extra')s.main.getSheetByName('Produtos').rows[0][200]='EXTRA';
  if(mode==='distant-body'){const table=s.main.getSheetByName('Produtos');table.rows[1]=new Array(201).fill('');table.rows[1][200]='EXTRA';}
  const writes=s.gas.writes;await assert.rejects(s.service().state(s.token),{code:mode==='missing'?'WORKSPACE_SCHEMA_REQUIRED':'WORKSPACE_SCHEMA_CONFLICT'});assert.equal(s.gas.writes,writes);
 }
});
test('malformed, wrong-resource and incomplete batch responses fail closed without falling back or exposing provider text',async()=>{
 for(const mode of ['id','count','range','dimension','rows','type','exception']){
  const s=await fixture();batches(s,r=>{
   if(mode==='exception')throw Error('PRIVATE_PROVIDER_SENTINEL');
   if(mode==='id')r.spreadsheetId='private-other-file';
   if(mode==='count')r.valueRanges.pop();
   if(mode==='range')r.valueRanges[0].range="'Other'!A1:Z1";
   if(mode==='dimension')r.valueRanges[0].majorDimension='COLUMNS';
   if(mode==='rows')r.valueRanges[0].values.push(['private-data']);
   if(mode==='type')r.valueRanges[0].values=[[{private:'secret'}]];
  });
  const writes=s.gas.writes;await assert.rejects(s.service().state(s.token),error=>error.code==='UPSTREAM_UNAVAILABLE'&&!/PRIVATE_PROVIDER|secret|private-other/.test(error.message));assert.equal(s.gas.writes,writes);assert.equal(s.gas.context.RPC_STORAGE_SCOPE_,null);
 }
});
test('private bindings are rechecked before batching private headers, and private corruption/capacity are still rejected',async()=>{
 for(const mode of ['public','header','capacity']){
  const s=await fixture(),calls=batches(s),id=s.gas.props.IDENTITY_CONTROL_SPREADSHEET_ID,ss=s.gas.sheets.get(id);
  if(mode==='public')s.gas.resources.get(id).sharing='anyone';
  if(mode==='header')ss.getSheetByName('_Passkeys').rows[0][0]='CHANGED';
  if(mode==='capacity'){const sheet=ss.getSheetByName('_Passkeys');sheet.rows=Array.from({length:3002},(_,i)=>i?['over-capacity']:sheet.rows[0]);}
  await assert.rejects(s.service().state(s.token));
  if(mode==='public')assert.equal(calls.filter(c=>c.id===id).length,0);
  assert.equal(s.main.getSheetByName('Sessoes').getLastRow(),1);
 }
});
test('fresh valid batched headers avoid redundant last-row probes on all unused main tables',async()=>{
 const s=await fixture();batches(s);let probes=0;
 const unused=['Produtos','Clientes','Vendas','Itens_Venda','Movimentacoes_Estoque'];
 for(const name of unused){const table=s.main.getSheetByName(name);if(!table)continue;const original=table.getLastRow;table.getLastRow=function(){probes++;return original.call(this);};}
 assert.equal((await s.service().state(s.token)).stage,'EMAIL');assert.equal(probes,0);
});
