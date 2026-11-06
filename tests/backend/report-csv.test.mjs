import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportCsv } from '../../backend/report-xlsx.mjs';

test('CSV quotes separators and neutralizes spreadsheet formulas',()=>{
 const report={kind:'SALES',summary:{},generatedAt:'2026-01-01T00:00:00Z',rows:[{id:'1',at:'',operator:'=1+1',operatorId:'2',customer:'Nome; "teste"',customerId:'3',city:'',state:'',paymentMethod:'PIX',status:'CONFIRMADA',reversedAt:'',saleTotalCents:100,valueCents:100,items:[]}],products:[],operators:[]};
 const csv=createReportCsv(report,{cpf:''},'id');
 assert.match(csv,/"'=1\+1"/);assert.match(csv,/"Nome; ""teste"""/);assert.ok(csv.startsWith('\ufeff'));
});