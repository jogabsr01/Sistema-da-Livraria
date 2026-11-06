/* Self-service profile. Owner CPF can be bound once after strong authentication.
 * Dispatcher owns ScriptLock; recovery of committed changes ignores UI flags. */
function profileFail_(code){failure_(code||'INVALID_PROFILE');}
function profileUser_(ss,id){var table=staffUsers_(ss),rows=table.rows.filter(function(r){return r.ID_Usuario===id;});if(rows.length!==1)profileFail_('PROFILE_UNAVAILABLE');return {table:table,row:rows[0]};}
function profilePhotoFolder_(c){var id=scriptProperties_().getProperty('PROFILES_FOLDER_ID');if(!id)profileFail_('PROFILE_UNAVAILABLE');var folder=resourceFolder_(id);assertMarker_(folder,c,'profiles');return folder;}
function profilePhotoFile_(c,id,userId,expected,unmarked){
 var folder=profilePhotoFolder_(c),file=resourceFile_(id),parents=file.getParents(),belongs=false;
 while(parents.hasNext())if(parents.next().getId()===folder.getId())belongs=true;
 if(!belongs||file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getMimeType()!=='image/jpeg'||file.getSize()>49152)failure_('BINDING_MISMATCH');
 var bytes=file.getBlob().getBytes(),hash=coverBytesHash_(bytes),m;try{m=JSON.parse(file.getDescription());}catch(_){m=null;}
 if(!m&&!unmarked)failure_('BINDING_MISMATCH');if(m){assertMarker_(file,c,'profile-photo');if(m.userId!==userId||!identityUuid_(m.commandId)||!constantEqual_(m.sha256,hash))failure_('BINDING_MISMATCH');}
 if(expected&&hash!==expected)profileFail_('PROFILE_CONFLICT');coverDescriptor_({bytes:Utilities.base64Encode(bytes),sha256:hash});return {file:file,bytes:Utilities.base64Encode(bytes),sha256:hash,marker:m};
}
function profileEnsurePhoto_(c,userId,commandId,photo){
 var bytes=coverDescriptor_(photo),folder=profilePhotoFolder_(c),matches=folder.getFilesByName('profile-'+userId+'-'+commandId+'.jpg'),files=[];while(matches.hasNext()){files.push(matches.next());if(files.length>1)profileFail_('PROFILE_UNAVAILABLE');}
 var file=files.length?files[0]:folder.createFile(Utilities.newBlob(bytes,'image/jpeg','profile-'+userId+'-'+commandId+'.jpg')),checked=profilePhotoFile_(c,file.getId(),userId,photo.sha256,true);
 if(checked.marker&&checked.marker.commandId!==commandId)failure_('BINDING_MISMATCH');if(!checked.marker){var m=JSON.parse(marker_(c,'profile-photo'));m.userId=userId;m.commandId=commandId;m.sha256=photo.sha256;file.setDescription(JSON.stringify(m));}
 profilePhotoFile_(c,file.getId(),userId,photo.sha256,false);return file.getId();
}
function profileCommands_(ss){return identityRows_(ss,'Configuracoes').rows.filter(function(r){return r.Chave.indexOf('profile.command.')===0;}).map(function(r){
 var v;try{v=JSON.parse(r.Valor);}catch(_){profileFail_('PROFILE_UNAVAILABLE');}
 if(!v||v.version!==1||r.Chave!=='profile.command.'+v.id||!identityUuid_(v.id)||!identityUuid_(v.userId)||!['ATENDENTE','ADMIN','SUPER_ADMIN'].includes(v.role)||!['PENDING','COMPLETE'].includes(v.state)||!accessHash_(v.fingerprint)||!Array.isArray(v.before)||!Array.isArray(v.after)||!Number.isSafeInteger(v.revision)||v.revision<1)profileFail_('PROFILE_UNAVAILABLE');
 if(v.ownerCpfLinked!==undefined&&v.ownerCpfLinked!==true)profileFail_('PROFILE_UNAVAILABLE');
 authControlTime_(v.at);var clone=JSON.parse(JSON.stringify(v));delete clone.hash;delete clone.state;if(!constantEqual_(v.hash,digest_(JSON.stringify(clone))))profileFail_('PROFILE_UNAVAILABLE');return v;
});}
function profileProject_(ss,v){
 var users=identityRows_(ss,'Usuarios'),cols=users.columns,rows=users.rows.filter(function(r){return r.ID_Usuario===v.userId;});
 if(rows.length!==1||v.before.length!==cols.length||v.after.length!==cols.length||v.after[cols.indexOf('ID_Usuario')]!==v.userId||v.before[cols.indexOf('ID_Usuario')]!==v.userId)profileFail_('PROFILE_UNAVAILABLE');
 var allowed=['Nome','Foto_Perfil_Drive_ID'];if(v.ownerCpfLinked){if(v.userId!==scriptProperties_().getProperty('IDENTITY_OWNER_USER_ID')||!accessHash_(v.after[cols.indexOf('CPF_Indice')])||!accessHash_(v.after[cols.indexOf('Email_Indice')])||v.before[cols.indexOf('CPF_Indice')]&&v.before[cols.indexOf('CPF_Indice')]!==v.after[cols.indexOf('CPF_Indice')])profileFail_('PROFILE_UNAVAILABLE');allowed=allowed.concat(['CPF_Indice','Email_Indice']);}if(cols.some(function(k,i){return !allowed.includes(k)&&v.before[i]!==v.after[i];}))profileFail_('PROFILE_UNAVAILABLE');
 var values=cols.map(function(k){return rows[0][k];});if(!same_(values,v.before)&&!same_(values,v.after))profileFail_('PROFILE_CONFLICT');
 if(!same_(values,v.after)){var row={number:rows[0].number};cols.forEach(function(k,i){row[k]=v.after[i];});accessSaveMain_(users,row);}
 if(v.ownerContact)staffPut_(ss,'profile.owner.'+v.userId,v.ownerContact,v.at,v.userId);
 staffPut_(ss,'staff.revision.'+v.userId,v.revision,v.at,v.userId);
 var audit=identityRows_(ss,'Logs_Auditoria'),existing=audit.rows.filter(function(r){return r.ID_Log===v.id;}),log={ID_Log:v.id,Data_Hora:v.at,ID_Usuario:v.userId,Perfil:v.role,Acao:'PROFILE_UPDATE',Entidade:'Usuarios',ID_Entidade:v.userId,Antes:JSON.stringify({revision:v.revision-1}),Depois:JSON.stringify({revision:v.revision,avatarChanged:v.avatarChanged}),Resultado:'SUCESSO',ID_Requisicao:v.id};
 if(existing.length>1||existing.length&&!audit.columns.every(function(k){return existing[0][k]===log[k];}))profileFail_('PROFILE_UNAVAILABLE');if(!existing.length)accessSaveMain_(audit,log);
 v.state='COMPLETE';staffPut_(ss,'profile.command.'+v.id,JSON.stringify(v),v.at,v.userId);
}
function recoverProfiles_(c){var ss=storage_(c,false).spreadsheet,pending=profileCommands_(ss).filter(function(v){return v.state==='PENDING';});if(pending.length>1)profileFail_('PROFILE_UNAVAILABLE');pending.forEach(function(v){profileProject_(ss,v);});}
function profileOperation_(request,c){
 // identitySession_ below already recovers staff/profile projections (and
 // seven other domains) before resolving the session, so repeating those two
 // calls here would only re-do the same work a second time.
 if(!request.actor||!accessHash_(request.actor.sessionTokenHash))failure_('UNAUTHENTICATED');var ss=storage_(c,false).spreadsheet,principal=identitySession_(ss,request.actor.sessionTokenHash,Date.now()).principal,found=profileUser_(ss,principal.id),user=found.row,owner=user.ID_Usuario===scriptProperties_().getProperty('IDENTITY_OWNER_USER_ID'),p=request.payload;
 if(request.action.indexOf('profile.email')===0)return emailChangeOperation_(request,c,principal);
 if(request.action==='profile.get'||request.action==='profile.bootstrap'){
  authControlExact_(p,[]);var extra=owner?staffConfig_(ss,'profile.owner.'+user.ID_Usuario).row:null;
  var data={id:user.ID_Usuario,role:user.Perfil,owner:owner,contact:owner?extra?extra.Valor:'':user.Nome,email:owner?ownerLoginEmail_(c):'',revision:staffRevision_(ss,user.ID_Usuario),lastAccess:user.Ultimo_Acesso,hasPhoto:user.Foto_Perfil_Drive_ID!==''};
  return request.action==='profile.bootstrap'?{principal:principal,profile:data}:data;
 }
 if(request.action==='profile.photo'){authControlExact_(p,[]);if(!user.Foto_Perfil_Drive_ID)profileFail_('PROFILE_NOT_FOUND');var photo=profilePhotoFile_(c,user.Foto_Perfil_Drive_ID,user.ID_Usuario,null,false);return {bytes:photo.bytes,sha256:photo.sha256};}
 if(request.action!=='profile.save')failure_('FORBIDDEN');if(!businessAssurance_(principal)||Date.now()-principal.authenticatedAt>300000)failure_('FORBIDDEN');
 var hasPhoto=Object.prototype.hasOwnProperty.call(p,'photo'),hasCpf=Object.prototype.hasOwnProperty.call(p,'ownerCpfIndex');authControlExact_(p,['commandId','expectedRevision','contact','fingerprint'].concat(hasPhoto?['photo']:[]).concat(hasCpf?['ownerCpfIndex','ownerEmailIndex']:[]));
 if(hasCpf){if(!owner)failure_('FORBIDDEN');if(!accessHash_(p.ownerCpfIndex)||!accessHash_(p.ownerEmailIndex))profileFail_();if(user.CPF_Indice&&user.CPF_Indice!==p.ownerCpfIndex)profileFail_('PROFILE_CPF_LOCKED');if(found.table.rows.some(function(r){return r.ID_Usuario!==user.ID_Usuario&&(r.CPF_Indice===p.ownerCpfIndex||r.Email_Indice===p.ownerEmailIndex);}))profileFail_('PROFILE_CPF_DUPLICATE');}
 if(!identityUuid_(p.commandId)||!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<0||p.expectedRevision>1000000||!staffSealed_(p.contact)||!accessHash_(p.fingerprint))profileFail_();
 var commands=profileCommands_(ss),prior=commands.filter(function(v){return v.id===p.commandId;});if(prior.length){if(prior[0].userId!==principal.id||prior[0].fingerprint!==p.fingerprint)profileFail_('PROFILE_CONFLICT');return {revision:prior[0].revision};}
 if(staffRevision_(ss,user.ID_Usuario)!==p.expectedRevision)profileFail_('PROFILE_CONFLICT');
 if(identityRows_(ss,'Logs_Auditoria').rows.some(function(r){return r.ID_Log===p.commandId;}))profileFail_('PROFILE_CONFLICT');
 if(commands.length>=1000||identityRows_(ss,'Logs_Auditoria').rows.length>=5000||identityRows_(ss,'Configuracoes').rows.length+3>5000)profileFail_('PROFILE_UNAVAILABLE');
 var before=found.table.columns.map(function(k){return user[k];}),next=JSON.parse(JSON.stringify(user));if(!owner)next.Nome=p.contact;if(hasCpf){next.CPF_Indice=p.ownerCpfIndex;next.Email_Indice=p.ownerEmailIndex;}
 if(hasPhoto)next.Foto_Perfil_Drive_ID=p.photo===null?'':profileEnsurePhoto_(c,user.ID_Usuario,p.commandId,p.photo);
 var v={version:1,id:p.commandId,userId:user.ID_Usuario,role:user.Perfil,state:'PENDING',fingerprint:p.fingerprint,revision:p.expectedRevision+1,at:new Date().toISOString(),before:before,after:found.table.columns.map(function(k){return next[k];}),ownerContact:owner?p.contact:'',avatarChanged:hasPhoto};
 if(hasCpf)v.ownerCpfLinked=true;
 var clone=JSON.parse(JSON.stringify(v));delete clone.state;v.hash=digest_(JSON.stringify(clone));staffPut_(ss,'profile.command.'+v.id,JSON.stringify(v),v.at,v.userId);profileProject_(ss,v);return {revision:v.revision};
}

// Owner editor setup only. This does not initialize accounts or change credentials.
function provisionDevelopmentProfile() {
  var c=baseSettings_();requireOwnerDev_(c);
  return withLock_(function(){var store=storage_(c,false);assertSchema_(store.spreadsheet);var props=scriptProperties_(),id=props.getProperty('PROFILES_FOLDER_ID');
    if(!id){var folder=resourceFolder_(c.driveRootId).createFolder('Perfis privados');folder.setDescription(marker_(c,'profiles'));id=folder.getId();props.setProperty('PROFILES_FOLDER_ID',id);}
    assertMarker_(resourceFolder_(id),c,'profiles');setFeatureFlags_({PROFILE_ENABLED:'true'});return {environment:'dev',profileReady:true};
  });
}
