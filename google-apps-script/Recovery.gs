/* PIN recovery: email possession AND an existing WebAuthn credential.
 * Durable COMMITTING intent precedes epoch/PIN/key/session projections. */
function recoveryEnabled_(){return PropertiesService.getScriptProperties().getProperty('RECOVERY_ENABLED')==='true';}
function recoverySubject_(c,row){
 var subject;
 if(row.Subject_ID===PropertiesService.getScriptProperties().getProperty('IDENTITY_OWNER_USER_ID'))subject=accessOwner_(c);
 else if(['COMMITTING','COMPLETE'].includes(row.State)){
  var main=storage_(c,false).spreadsheet,users=identityRows_(main,'Usuarios'),found=users.rows.filter(function(r){return r.ID_Usuario===row.Subject_ID;}),epoch=staffConfig_(main,'identity.version.'+row.Subject_ID).row;
  if(found.length===1&&found[0].Status==='ATIVO'&&['ADMIN','ATENDENTE'].includes(found[0].Perfil)&&epoch)subject={row:found[0],users:users,version:epoch.Valor};
 }else subject=staffSubject_(c,row.Subject_ID);
 if(!subject||!subject.row.Primeiro_Acesso_Concluido||subject.version!==row.Authorization_Version&&(!['COMMITTING','COMPLETE'].includes(row.State)||subject.version!==row.Authorization_Version+1))accessReject_();
 return subject;
}
function recoveryCommit_(ss,c,current,p,now,background){
 var row=current.row,subject=recoverySubject_(c,row),target=row.Authorization_Version+1;
 if(row.Purpose!=='RECOVER'||!['PASSKEY','COMMITTING','COMPLETE'].includes(row.State)||!accessHash_(p.sessionTokenHash))accessReject_();
 var ceremonies=passkeyCeremonies_(ss).rows.filter(function(r){return r.ID===row.Ceremony_ID;}),keys=passkeyCredentials_(ss),key;
 if(ceremonies.length!==1||ceremonies[0].Subject_ID!==row.Subject_ID||ceremonies[0].Authorization_Version!==row.Authorization_Version||ceremonies[0].Purpose!=='AUTHENTICATE'||!ceremonies[0].Completed_At||!ceremonies[0].Consumed_At)accessReject_();
 var matches=keys.rows.filter(function(r){return r.Credential_ID===ceremonies[0].Credential_ID&&r.Subject_ID===row.Subject_ID&&r.Revoked_At==='';});
 if(matches.length!==1||![row.Authorization_Version,target].includes(matches[0].Authorization_Version))accessReject_();key=matches[0];
 var main=storage_(c,false).spreadsheet,pins=accessPins_(ss),pin=pins.rows.filter(function(r){return r.Subject_ID===row.Subject_ID;}),sessions=identityRows_(main,'Sessoes'),audit=identityRows_(main,'Logs_Auditoria');
 if(row.State==='PASSKEY'){
  if(!recoveryEnabled_()||subject.version!==row.Authorization_Version||pin.length!==1||pin[0].Authorization_Version!==row.Authorization_Version||!row.Pin_JSON||authControlTime_(ceremonies[0].Expires_At)<=now||sessions.rows.length>=5000||audit.rows.length>=5000)accessReject_();
  accessPinRecord_(row.Pin_JSON);row.State='COMMITTING';row.Session_Token_Hash=p.sessionTokenHash;row.Commit_Started_At=new Date(now).toISOString();authControlSave_(current.table,row);
 }
 if(!constantEqual_(row.Session_Token_Hash,p.sessionTokenHash))accessReject_();
 if(row.State!=='COMPLETE'){
  if(pin.length!==1||![row.Authorization_Version,target].includes(pin[0].Authorization_Version))accessReject_();accessPinRecord_(row.Pin_JSON);
  // Epoch first. A half-applied recovery never authenticates an old session.
  staffPut_(main,'identity.version.'+row.Subject_ID,target,row.Commit_Started_At,row.Subject_ID);
  if(pin[0].Authorization_Version!==target){pin[0].Record_JSON=row.Pin_JSON;pin[0].Authorization_Version=target;pin[0].Created_At=row.Commit_Started_At;authControlSave_(pins,pin[0]);}
  else if(pin[0].Record_JSON!==row.Pin_JSON)accessReject_();
  keys.rows.filter(function(r){return r.Subject_ID===row.Subject_ID&&r.Revoked_At==='';}).forEach(function(r){
   if(r.Credential_ID===key.Credential_ID){r.Authorization_Version=target;r.Updated_At=row.Commit_Started_At;}
   else r.Revoked_At=row.Commit_Started_At;authControlSave_(keys,r);
  });
  // Other in-flight logins/recoveries and old sessions cannot survive the reset.
  accessFlows_(ss).rows.filter(function(r){return r.Subject_ID===row.Subject_ID&&r.ID!==row.ID&&!['COMPLETE','REVOKED'].includes(r.State);}).forEach(function(r){r.State='REVOKED';authControlSave_(current.table,r);});
  sessions.rows.filter(function(r){return r.ID_Usuario===row.Subject_ID&&r.ID_Sessao!==row.ID&&r.Revogado_Em==='';}).forEach(function(r){r.Revogado_Em=row.Commit_Started_At;accessSaveMain_(sessions,r);});
  subject.row.Ultimo_Acesso=row.Commit_Started_At;accessSaveMain_(subject.users,subject.row);
  var value={ID_Sessao:row.ID,ID_Usuario:row.Subject_ID,Criado_Em:row.Commit_Started_At,Expira_Em:new Date(authControlTime_(row.Commit_Started_At)+28800000).toISOString(),Revogado_Em:'',Dispositivo:'identity-flow:'+row.ID,Ultima_Atividade:row.Commit_Started_At,Token_Hash:p.sessionTokenHash,Nivel_Autenticacao:'passkey',Versao_Autorizacao:target};
  var stored=sessions.rows.filter(function(r){return r.ID_Sessao===row.ID||r.Token_Hash===p.sessionTokenHash;});if(stored.length>1||stored.length&&!sessions.columns.every(function(k){return stored[0][k]===value[k];}))accessReject_();if(!stored.length)accessSaveMain_(sessions,value);
  var log={ID_Log:row.ID,Data_Hora:row.Commit_Started_At,ID_Usuario:row.Subject_ID,Perfil:subject.row.Perfil,Acao:'IDENTITY_PIN_RECOVER',Entidade:'Usuarios',ID_Entidade:row.Subject_ID,Antes:JSON.stringify({authorizationVersion:row.Authorization_Version}),Depois:JSON.stringify({authorizationVersion:target,otherSessionsRevoked:true}),Resultado:'SUCESSO',ID_Requisicao:row.ID};
  var logged=audit.rows.filter(function(r){return r.ID_Log===row.ID;});if(logged.length>1||logged.length&&!audit.columns.every(function(k){return logged[0][k]===log[k];}))accessReject_();if(!logged.length)accessSaveMain_(audit,log);
  row.State='COMPLETE';row.Completed_At=new Date(now).toISOString();row.Pin_JSON='';authControlSave_(current.table,row);
 }
 return background?null:identitySession_(main,p.sessionTokenHash,now).principal;
}
function recoverRecoveryIntents_(c){
 if(!PropertiesService.getScriptProperties().getProperty('IDENTITY_CONTROL_SPREADSHEET_ID'))return;
 var ss=authControlStore_(c),pending=accessFlows_(ss).rows.filter(function(r){return r.Purpose==='RECOVER'&&r.State==='COMMITTING';}),subjects=new Set();
 pending.forEach(function(r){if(subjects.has(r.Subject_ID))failure_('IDENTITY_UNAVAILABLE');subjects.add(r.Subject_ID);recoveryCommit_(ss,c,{table:accessFlows_(ss),row:r},{sessionTokenHash:r.Session_Token_Hash},Date.now(),true);});
}
