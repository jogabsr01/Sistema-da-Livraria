import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerFixture} from '../helpers/owner-access-fixture.mjs';
test('owner workspace activation prepares all business resources and flags idempotently without changing users or credentials',()=>{
 const s=ownerFixture(),before=JSON.stringify(s.main.getSheetByName('Usuarios').rows),keys=JSON.stringify(s.priv.getSheetByName('_Passkeys').rows),sessions=JSON.stringify(s.main.getSheetByName('Sessoes').rows);
 const result=s.gas.call('activateDevelopmentWorkspace');assert.equal(result.businessModulesReady,true);assert.equal(result.enabled.length,16);for(const name of result.enabled)assert.equal(s.gas.props[name],'true');
 const profile=s.gas.props.PROFILES_FOLDER_ID,covers=s.gas.props.COVERS_FOLDER_ID;assert.ok(profile);assert.ok(covers);assert.equal(s.gas.resources.get(profile).sharing,'private');assert.equal(s.gas.resources.get(covers).sharing,'private');
 const resources=s.gas.resources.size;assert.equal(s.gas.call('activateDevelopmentWorkspace').businessModulesReady,true);assert.equal(s.gas.resources.size,resources);assert.equal(s.gas.props.PROFILES_FOLDER_ID,profile);assert.equal(s.gas.props.COVERS_FOLDER_ID,covers);
 assert.equal(JSON.stringify(s.main.getSheetByName('Usuarios').rows),before);assert.equal(JSON.stringify(s.priv.getSheetByName('_Passkeys').rows),keys);assert.equal(JSON.stringify(s.main.getSheetByName('Sessoes').rows),sessions);assert.equal(s.gas.outbox.length,0);assert.equal(s.gas.props.EMERGENCY_RECOVERY_ENABLED,undefined);
});
test('workspace activation requires bound DEV owner and full identity prerequisites',()=>{
 for(const mode of ['owner','prod','identity']){const s=ownerFixture();if(mode==='owner')s.gas.props.OWNER_EMAIL='different@example.invalid';if(mode==='prod')s.gas.props.APP_ENV='prod';if(mode==='identity')s.gas.props.IDENTITY_GUARDS_ENABLED='false';const before=s.gas.resources.size;assert.throws(()=>s.gas.call('activateDevelopmentWorkspace'));assert.equal(s.gas.resources.size,before);assert.equal(s.gas.props.PROFILE_ENABLED,undefined);}
});
