import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
test('owner configuration inventory is read-only and emits only fixed names and statuses',()=>{
 const s=ownerFixture(),before=JSON.stringify(s.gas.props),rows=s.main.getSheetByName('Usuarios').getLastRow();s.gas.props.UNEXPECTED_SECRET='PRIVATE_MARKER';
 const report=s.gas.call('inspectDevelopmentConfiguration');assert.equal(report.readOnly,true);assert.equal(report.netlifyInspected,false);assert.equal(report.resourceAccessChecked,false);assert.ok(report.flags.some(f=>f.google==='CATALOG_ENABLED'&&f.status==='NOT_SET'));
 const text=JSON.stringify(report);for(const value of [s.gas.props.SIGNING_SECRET,s.gas.props.OWNER_EMAIL,s.gas.props.SPREADSHEET_ID,'PRIVATE_MARKER','UNEXPECTED_SECRET'])assert.ok(!text.includes(value));
 delete s.gas.props.UNEXPECTED_SECRET;assert.equal(JSON.stringify(s.gas.props),before);assert.equal(s.main.getSheetByName('Usuarios').getLastRow(),rows);
 s.gas.owner='other@example.invalid';assert.throws(()=>s.gas.call('inspectDevelopmentConfiguration'),/FORBIDDEN/);s.gas.owner='owner@example.invalid';s.gas.props.APP_ENV='prod';assert.throws(()=>s.gas.call('inspectDevelopmentConfiguration'),/FORBIDDEN/);
});
test('configuration inventory names missing dependencies and formats without activating optional modules',()=>{
 const s=ownerFixture();s.gas.props.CHECKOUT_ENABLED='true';s.gas.props.CATALOG_ENABLED='false';s.gas.props.PROFILE_ENABLED='true';delete s.gas.props.PROFILES_FOLDER_ID;s.gas.props.SIGNING_SECRET='invalid';s.gas.props.REPORTS_ENABLED='yes';const before=JSON.stringify(s.gas.props);
 const r=s.gas.call('inspectDevelopmentConfiguration');assert.ok(r.missingDependencies.some(x=>x.module==='CHECKOUT_ENABLED'&&x.requires==='CATALOG_ENABLED'));assert.ok(r.checks.some(x=>x.name==='SIGNING_SECRET'&&x.status==='INVALID_FORMAT'));assert.ok(r.checks.some(x=>x.name==='PROFILES_FOLDER_ID'&&x.status==='MISSING'));assert.ok(r.flags.some(x=>x.google==='REPORTS_ENABLED'&&x.status==='INVALID_BOOLEAN'));assert.equal(JSON.stringify(s.gas.props),before);
});
