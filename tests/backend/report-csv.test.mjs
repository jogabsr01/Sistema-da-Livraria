import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportCsv, createReportSheets } from '../../backend/report-xlsx.mjs';

test('CSV quotes separators and neutralizes spreadsheet formulas',()=>{
 const report={kind:'SALES',summary:{},generatedAt:'2026-01-01T00:00:00Z',rows:[{id:'1',at:'',operator:'=1+1',operatorId:'2',customer:'Nome; "teste"',customerId:'3',city:'',state:'',paymentMethod:'PIX',status:'CONFIRMADA',reversedAt:'',saleTotalCents:100,valueCents:100,items:[]}],products:[],operators:[]};
 const csv=createReportCsv(report,{cpf:''},'id');
 assert.match(csv,/"'=1\+1"/);assert.match(csv,/"Nome; ""teste"""/);assert.ok(csv.startsWith('\ufeff'));
});

test('sales exports preserve exact reais and every selected item',()=>{
 const item={productId:'produto',title:'Livro; edição',quantity:1,unitPriceCents:4190,subtotalCents:4190};
 const report={kind:'SALES',summary:{netCents:4190},generatedAt:'2026-01-01T00:00:00.000Z',rows:[{id:'venda',at:'2026-01-01T12:00:00.000Z',operator:'Atendente',operatorId:'2',customer:'Cliente',customerId:null,city:'',state:'',paymentMethod:'PIX',status:'CONFIRMADA',reversedAt:null,saleTotalCents:4190,valueCents:4190,items:[item,{...item,productId:'outro',title:'Outro'}]}],products:[],operators:[]};
 const csv=createReportCsv(report,{cpf:''},'id');
 assert.match(csv,/"41,90"/);assert.match(csv,/"Livro; edição"/);assert.match(csv,/"Outro"/);assert.doesNotMatch(csv,/44\.190/);
 const sheets=createReportSheets(report,{cpf:''},'id');assert.equal(sheets[1].rows[1][14],'41,90');assert.equal(sheets[2].rows.length,3);
});