/* Self-service display/phone/avatar only. Identity, role and CPF remain protected.
 * Dispatcher owns ScriptLock; recovery of committed changes ignores UI flags. */
function profileFail_(code){failure_(code||'INVALID_PROFILE');}
function profileUser_(ss,id){var table=staffUsers_(ss),rows=table.rows.filter(function(r){return r.ID_Usuario===id;});if(rows.length!==1)profileFail_('PROFILE_UNAVAILABLE');return {table:table,row:rows[0]};}
function profilePhotoFolder_(c){var id=PropertiesService.getScriptProperties().getProperty('PROFILES_FOLDER_ID');if(!id)profileFail_('PROFILE_UNAVAILABLE');var folder=DriveApp.getFolderById(id);assertMarker_(folder,c,'profiles');return folder;}
function profilePhotoFile_(c,id,userId,expected,unmarked){
 var folder=profilePhotoFolder_(c),file=DriveApp.getFileById(id),parents=file.getParents(),belongs=false;
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
 authControlTime_(v.at);var clone=JSON.parse(JSON.stringify(v));delete clone.hash;delete clone.state;if(!constantEqual_(v.hash,digest_(JSON.stringify(clone))))profileFail_('PROFILE_UNAVAILABLE');return v;
});}
function profileProject_(ss,v){
 var users=identityRows_(ss,'Usuarios'),cols=users.columns,rows=users.rows.filter(function(r){return r.ID_Usuario===v.userId;});
 if(rows.length!==1||v.before.length!==cols.length||v.after.length!==cols.length||v.after[cols.indexOf('ID_Usuario')]!==v.userId||v.before[cols.indexOf('ID_Usuario')]!==v.userId)profileFail_('PROFILE_UNAVAILABLE');
 var allowed=['Nome','Foto_Perfil_Drive_ID'];if(cols.some(function(k,i){return !allowed.includes(k)&&v.before[i]!==v.after[i];}))profileFail_('PROFILE_UNAVAILABLE');
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
 recoverProfiles_(c);if(!request.actor||!accessHash_(request.actor.sessionTokenHash))failure_('UNAUTHENTICATED');var ss=storage_(c,false).spreadsheet,principal=identitySession_(ss,request.actor.sessionTokenHash,Date.now()).principal,found=profileUser_(ss,principal.id),user=found.row,owner=user.ID_Usuario===PropertiesService.getScriptProperties().getProperty('IDENTITY_OWNER_USER_ID'),p=request.payload;
 if(request.action==='profile.get'){
  authControlExact_(p,[]);var extra=owner?staffConfig_(ss,'profile.owner.'+user.ID_Usuario).row:null;
  return {id:user.ID_Usuario,role:user.Perfil,owner:owner,contact:owner?extra?extra.Valor:'':user.Nome,email:owner?c.owner:'',revision:staffRevision_(ss,user.ID_Usuario),lastAccess:user.Ultimo_Acesso,hasPhoto:user.Foto_Perfil_Drive_ID!==''};
 }
 if(request.action==='profile.photo'){authControlExact_(p,[]);if(!user.Foto_Perfil_Drive_ID)profileFail_('PROFILE_NOT_FOUND');var photo=profilePhotoFile_(c,user.Foto_Perfil_Drive_ID,user.ID_Usuario,null,false);return {bytes:photo.bytes,sha256:photo.sha256};}
 if(request.action!=='profile.save')failure_('FORBIDDEN');if(!['passkey','mfa'].includes(principal.assurance)||Date.now()-principal.authenticatedAt>300000)failure_('FORBIDDEN');
 var hasPhoto=Object.prototype.hasOwnProperty.call(p,'photo');authControlExact_(p,['commandId','expectedRevision','contact','fingerprint'].concat(hasPhoto?['photo']:[]));
 if(!identityUuid_(p.commandId)||!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<0||p.expectedRevision>1000000||!staffSealed_(p.contact)||!accessHash_(p.fingerprint))profileFail_();
 var commands=profileCommands_(ss),prior=commands.filter(function(v){return v.id===p.commandId;});if(prior.length){if(prior[0].userId!==principal.id||prior[0].fingerprint!==p.fingerprint)profileFail_('PROFILE_CONFLICT');return {revision:prior[0].revision};}
 if(staffRevision_(ss,user.ID_Usuario)!==p.expectedRevision)profileFail_('PROFILE_CONFLICT');
 if(identityRows_(ss,'Logs_Auditoria').rows.some(function(r){return r.ID_Log===p.commandId;}))profileFail_('PROFILE_CONFLICT');
 if(commands.length>=1000||identityRows_(ss,'Logs_Auditoria').rows.length>=5000||identityRows_(ss,'Configuracoes').rows.length+3>5000)profileFail_('PROFILE_UNAVAILABLE');
 var before=found.table.columns.map(function(k){return user[k];}),next=JSON.parse(JSON.stringify(user));if(!owner)next.Nome=p.contact;
 if(hasPhoto)next.Foto_Perfil_Drive_ID=p.photo===null?'':profileEnsurePhoto_(c,user.ID_Usuario,p.commandId,p.photo);
 var v={version:1,id:p.commandId,userId:user.ID_Usuario,role:user.Perfil,state:'PENDING',fingerprint:p.fingerprint,revision:p.expectedRevision+1,at:new Date().toISOString(),before:before,after:found.table.columns.map(function(k){return next[k];}),ownerContact:owner?p.contact:'',avatarChanged:hasPhoto};
 var clone=JSON.parse(JSON.stringify(v));delete clone.state;v.hash=digest_(JSON.stringify(clone));staffPut_(ss,'profile.command.'+v.id,JSON.stringify(v),v.at,v.userId);profileProject_(ss,v);return {revision:v.revision};
}
