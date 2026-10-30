/* Owner-editor only. Fixed names/statuses; never property values, hashes or IDs.
 * This function only reads Script Properties; it never provisions or enables. */
function inspectDevelopmentConfiguration(){
  var p=scriptProperties_().getProperties();
  if(p.APP_ENV!=='dev'||!p.OWNER_EMAIL||Session.getEffectiveUser().getEmail().toLowerCase()!==p.OWNER_EMAIL.toLowerCase())failure_('FORBIDDEN');
  var uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,resource=/^[A-Za-z0-9_-]{20,160}$/,hash=/^[a-f0-9]{64}$/i;
  var fields=[['INSTALLATION_ID',uuid],['SIGNING_SECRET',hash],['SPREADSHEET_ID',resource],['DRIVE_ROOT_ID',resource],['BACKUPS_FOLDER_ID',resource],['IDENTITY_CONTROL_SPREADSHEET_ID',resource],['IDENTITY_OWNER_USER_ID',uuid],['IDENTITY_OWNER_EMAIL_BINDING',hash]];
  var checks=fields.map(function(f){return {name:f[0],status:!p[f[0]]?'MISSING':f[1].test(p[f[0]])?'FORMAT_OK':'INVALID_FORMAT'};});
  var names=['ADMIN_PIN_LOGIN','IDENTITY_SESSIONS','IDENTITY_GUARDS','IDENTITY_PASSKEYS','IDENTITY_ACCESS','CATALOG','COVER_PHOTOS','CHECKOUT','NOTIFICATIONS','STAFF','CUSTOMERS','OPERATIONS','PROFILE','RECOVERY','EMAIL_CHANGE','NICHES','SCHEDULES','AUDIT','REPORTS','CUSTOMER_INSIGHTS','KEY_MANAGEMENT','EMERGENCY_RECOVERY'];
  var flags=names.map(function(name){var key=name+'_ENABLED';return {google:key,netlify:'WORKSPACE_'+key,status:key==='ADMIN_PIN_LOGIN_ENABLED'?(devPinLoginEnabled_()?(p[key]==='true'?'ENABLED':'ENABLED_BY_DEV_POLICY'):'DISABLED'):p[key]==='true'?'ENABLED':p[key]==='false'?'DISABLED':p[key]===undefined||p[key]===''?'NOT_SET':'INVALID_BOOLEAN'};});
  var dependencies={IDENTITY_ACCESS:['IDENTITY_SESSIONS','IDENTITY_GUARDS','IDENTITY_PASSKEYS'],CATALOG:['IDENTITY_SESSIONS'],COVER_PHOTOS:['CATALOG','IDENTITY_SESSIONS'],CHECKOUT:['CATALOG','IDENTITY_SESSIONS'],NOTIFICATIONS:['CATALOG','IDENTITY_SESSIONS'],OPERATIONS:['CATALOG','IDENTITY_SESSIONS'],NICHES:['CATALOG','IDENTITY_SESSIONS'],SCHEDULES:['CATALOG','NOTIFICATIONS','IDENTITY_SESSIONS'],REPORTS:['CATALOG','IDENTITY_SESSIONS'],AUDIT:['CATALOG','IDENTITY_SESSIONS'],CUSTOMER_INSIGHTS:['CUSTOMERS','REPORTS','CATALOG','IDENTITY_SESSIONS'],KEY_MANAGEMENT:['IDENTITY_PASSKEYS','IDENTITY_SESSIONS'],STAFF:['IDENTITY_SESSIONS','IDENTITY_ACCESS','IDENTITY_GUARDS','IDENTITY_PASSKEYS'],CUSTOMERS:['IDENTITY_SESSIONS'],PROFILE:['IDENTITY_SESSIONS'],EMAIL_CHANGE:['PROFILE','IDENTITY_SESSIONS'],RECOVERY:['IDENTITY_ACCESS','IDENTITY_PASSKEYS','IDENTITY_SESSIONS'],EMERGENCY_RECOVERY:['RECOVERY','IDENTITY_PASSKEYS','IDENTITY_SESSIONS']};
  var missingDependencies=[];Object.keys(dependencies).forEach(function(module){if(p[module+'_ENABLED']!=='true')return;dependencies[module].forEach(function(dep){if(p[dep+'_ENABLED']!=='true')missingDependencies.push({module:module+'_ENABLED',requires:dep+'_ENABLED'});});});
  [['CATALOG','CATALOG_JOURNAL_ID'],['COVER_PHOTOS','COVERS_FOLDER_ID'],['PROFILE','PROFILES_FOLDER_ID']].forEach(function(pair){if(p[pair[0]+'_ENABLED']==='true')checks.push({name:pair[1],status:!p[pair[1]]?'MISSING':resource.test(p[pair[1]])?'FORMAT_OK':'INVALID_FORMAT'});});
  var result={environment:'dev',readOnly:true,scope:'SCRIPT_PROPERTIES_FORMAT_AND_FLAGS_ONLY',checks:checks,flags:flags,missingDependencies:missingDependencies,maintenance:p.MAINTENANCE_MODE==='true'?'ACTIVE':'INACTIVE',netlifyInspected:false,resourceAccessChecked:false};
  console.info(JSON.stringify(result));return result;
}

// Owner editor only; never dispatched by the HTTP API. Activates the complete
// implemented DEV business workspace without resetting users, keys or sessions.
function activateDevelopmentWorkspace(){
  var c=baseSettings_();requireOwnerDev_(c);
  var props=scriptProperties_();
  if(['IDENTITY_SESSIONS_ENABLED','IDENTITY_ACCESS_ENABLED','IDENTITY_GUARDS_ENABLED','IDENTITY_PASSKEYS_ENABLED'].some(function(k){return props.getProperty(k)!=='true';}))failure_('IDENTITY_UNAVAILABLE');
  provisionDevelopmentCatalog();provisionDevelopmentProfile();
  return withLock_(function(){
    var ss=storage_(c,false).spreadsheet;assertSchema_(ss);authControlStore_(c);catalogJournal_(c);
    var id=props.getProperty('COVERS_FOLDER_ID');
    if(!id){var folder=resourceFolder_(c.driveRootId).createFolder('Capas privadas');folder.setDescription(marker_(c,'covers'));id=folder.getId();props.setProperty('COVERS_FOLDER_ID',id);}
    assertMarker_(resourceFolder_(id),c,'covers');
    var names=['CATALOG','CHECKOUT','COVER_PHOTOS','NOTIFICATIONS','STAFF','CUSTOMERS','OPERATIONS','PROFILE','RECOVERY','EMAIL_CHANGE','NICHES','SCHEDULES','AUDIT','REPORTS','CUSTOMER_INSIGHTS','KEY_MANAGEMENT'],flags={};
    names.forEach(function(name){flags[name+'_ENABLED']='true';});props.setProperties(flags);
    var result={environment:'dev',businessModulesReady:true,enabled:names.map(function(name){return name+'_ENABLED';}),netlifyStillRequiresMatchingFlags:true};console.info(JSON.stringify(result));return result;
  });
}
