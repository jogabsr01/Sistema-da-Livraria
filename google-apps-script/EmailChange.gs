/* Verified self-service login-email change. Private, bounded per-user journal;
 * main data receives only sealed contact and keyed index. ScriptLock required. */
function ownerLoginEmail_(c){return accessEmail_(scriptProperties_().getProperty('IDENTITY_OWNER_LOGIN_EMAIL')||c.owner);}
function emailChangeAddress_(value){var email=accessEmail_(value),parts=email.split('@');if(parts[0].length>64||!/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/i.test(parts[0])||parts[0][0]==='.'||parts[0].slice(-1)==='.'||parts[0].indexOf('..')!==-1||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(parts[1]))emailChangeFail_();return email;}
function emailChangeFail_(code){failure_(code||'EMAIL_CHANGE_REJECTED');}
function emailChangeKey_(id){if(!identityUuid_(id))emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');return 'IDENTITY_EMAIL_CHANGE_'+id;}
function emailChangeRead_(id){
 var raw=scriptProperties_().getProperty(emailChangeKey_(id));if(!raw)return null;var v;try{v=JSON.parse(raw);}catch(_){emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');}
 if(!v||v.version!==1||v.userId!==id||!identityUuid_(v.id)||!identityUuid_(v.sessionId)||!accessHash_(v.sessionHash)||!accessHash_(v.codeHash)||!accessHash_(v.emailIndex)||!accessHash_(v.fingerprint)||!accessHash_(v.sourceHash)||!Number.isSafeInteger(v.revision)||v.revision<0||!Number.isSafeInteger(v.epoch)||v.epoch<1||!Number.isSafeInteger(v.attempts)||v.attempts<0||v.attempts>5||!Number.isSafeInteger(v.sendCount)||v.sendCount<1||v.sendCount>5||!['EMAIL','COMMITTING','COMPLETE','REVOKED'].includes(v.state)||!['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(v.role)||typeof v.owner!=='boolean'||emailChangeAddress_(v.target)!==v.target||authControlTime_(v.expiresAt)-authControlTime_(v.createdAt)!==300000)emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');
 authControlTime_(v.sendWindow);var copy=JSON.parse(JSON.stringify(v));delete copy.hash;if(!constantEqual_(v.hash,digest_(JSON.stringify(copy))))emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');return v;
}
function emailChangeSave_(v){
 var copy=JSON.parse(JSON.stringify(v));delete copy.hash;v.hash=digest_(JSON.stringify(copy));var value=JSON.stringify(v),key=emailChangeKey_(v.userId),props=scriptProperties_(),all=props.getProperties();
 // Below documented ScriptProperties per-value/total quotas, in UTF-8 bytes.
 var bytes=function(s){return Utilities.newBlob(s).getBytes().length;},total=bytes(key)+bytes(value);Object.keys(all).forEach(function(k){if(k!==key)total+=bytes(k)+bytes(all[k]);});
 if(bytes(value)>8000||total>400000)emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');props.setProperty(key,value);
}
function emailChangeBound_(v,principal,hash){if(!v||v.userId!==principal.id||v.sessionId!==principal.sessionId||v.epoch!==principal.authorizationVersion||v.role!==principal.role||!constantEqual_(v.sessionHash,hash))emailChangeFail_();}
function emailChangeDto_(v){return {commandId:v?v.id:null,stage:v&&v.state==='COMPLETE'?'COMPLETE':v&&v.state==='EMAIL'&&Date.parse(v.expiresAt)>Date.now()?'EMAIL':'IDLE',revision:v&&v.state==='COMPLETE'?v.revision+1:null,expiresAt:v&&v.state==='EMAIL'?v.expiresAt:null};}
function emailChangeAvailable_(ss,c,v){
 var users=staffUsers_(ss),other=users.rows.some(function(r){return r.ID_Usuario!==v.userId&&r.Email_Indice===v.emailIndex;});
 if(other||!v.owner&&[accessEmail_(c.owner),ownerLoginEmail_(c)].includes(v.target))emailChangeFail_('EMAIL_CHANGE_CONFLICT');
}
function emailChangeProject_(c,v){
 if(v.state!=='COMMITTING')return;var ss=storage_(c,false).spreadsheet,users=identityRows_(ss,'Usuarios'),cols=users.columns,found=users.rows.filter(function(r){return r.ID_Usuario===v.userId;}),epoch=staffConfig_(ss,'identity.version.'+v.userId).row;
 if(found.length!==1||!epoch||epoch.Valor!==v.epoch||!Array.isArray(v.before)||!Array.isArray(v.after)||v.before.length!==cols.length||v.after.length!==cols.length||v.before[cols.indexOf('ID_Usuario')]!==v.userId||v.after[cols.indexOf('ID_Usuario')]!==v.userId||v.before[cols.indexOf('Perfil')]!==v.role||v.before[cols.indexOf('Status')]!=='ATIVO'||v.before[cols.indexOf('Primeiro_Acesso_Concluido')]!==true)emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');
 if(cols.some(function(k,i){return !['Nome','Email_Indice'].includes(k)&&v.before[i]!==v.after[i];}))emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');
 var current=cols.map(function(k){return found[0][k];});if(!same_(current,v.before)&&!same_(current,v.after))emailChangeFail_('EMAIL_CHANGE_CONFLICT');
 var revision=staffRevision_(ss,v.userId);if(![v.revision,v.revision+1].includes(revision))emailChangeFail_('EMAIL_CHANGE_CONFLICT');emailChangeAvailable_(ss,c,v);
 if(v.owner){var old=ownerLoginEmail_(c);if(![v.ownerBefore,v.target].includes(old))emailChangeFail_('EMAIL_CHANGE_CONFLICT');scriptProperties_().setProperty('IDENTITY_OWNER_LOGIN_EMAIL',v.target);}
 if(!same_(current,v.after)){var row={number:found[0].number};cols.forEach(function(k,i){row[k]=v.after[i];});accessSaveMain_(users,row);}
 staffPut_(ss,'staff.revision.'+v.userId,v.revision+1,v.at,v.userId);
 // Keep the confirmed current session and enrolled credentials. Invalidate other
 // sessions and unfinished activation/login/recovery proofs for the old address.
 var sessions=identityRows_(ss,'Sessoes');sessions.rows.filter(function(r){return r.ID_Usuario===v.userId&&r.ID_Sessao!==v.sessionId&&r.Revogado_Em==='';}).forEach(function(r){r.Revogado_Em=v.at;accessSaveMain_(sessions,r);});
 var privateId=scriptProperties_().getProperty('IDENTITY_CONTROL_SPREADSHEET_ID');if(privateId){var flows=accessFlows_(authControlStore_(c));flows.rows.filter(function(r){return r.Subject_ID===v.userId&&!['COMPLETE','REVOKED'].includes(r.State);}).forEach(function(r){r.State='REVOKED';authControlSave_(flows,r);});}
 var audit=identityRows_(ss,'Logs_Auditoria'),logged=audit.rows.filter(function(r){return r.ID_Log===v.id;}),log={ID_Log:v.id,Data_Hora:v.at,ID_Usuario:v.userId,Perfil:v.role,Acao:'IDENTITY_EMAIL_CHANGE',Entidade:'Usuarios',ID_Entidade:v.userId,Antes:JSON.stringify({revision:v.revision}),Depois:JSON.stringify({revision:v.revision+1,emailVerified:true,otherSessionsRevoked:true}),Resultado:'SUCESSO',ID_Requisicao:v.id};
 if(logged.length>1||logged.length&&!audit.columns.every(function(k){return logged[0][k]===log[k];}))emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');if(!logged.length)accessSaveMain_(audit,log);
 v.state='COMPLETE';v.codeHash='0'.repeat(64);v.contact='';v.before=null;v.after=null;emailChangeSave_(v);scriptProperties_().setProperty('IDENTITY_EMAIL_PENDING','');
}
function recoverEmailChanges_(c){
 // One installation lock permits one commit intent. The pointer is written
 // before the intent, so normal session reads never scan every user's journal.
 var props=scriptProperties_(),id=props.getProperty('IDENTITY_EMAIL_PENDING');if(!id)return;
 if(!identityUuid_(id))emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');var v=emailChangeRead_(id);if(!v)emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');
 if(v.state==='COMMITTING')emailChangeProject_(c,v);else props.setProperty('IDENTITY_EMAIL_PENDING','');
}
function emailChangeOperation_(request,c,principal){
 var props=scriptProperties_();if(props.getProperty('EMAIL_CHANGE_ENABLED')!=='true')emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');var p=request.payload,ss=storage_(c,false).spreadsheet,now=Date.now(),v=emailChangeRead_(principal.id),hash=request.actor.sessionTokenHash,op=request.action;
 if(op==='profile.emailState'){authControlExact_(p,[]);if(v&&v.sessionId===principal.sessionId&&v.epoch===principal.authorizationVersion&&constantEqual_(v.sessionHash,hash))return emailChangeDto_(v);return emailChangeDto_(null);}
 if(!['mfa','passkey'].includes(principal.assurance)||now-principal.authenticatedAt>300000)failure_('FORBIDDEN');
 if(op==='profile.emailStart'){
  authControlExact_(p,['commandId','expectedRevision','delivery','emailIndex','contact','sourceHash','fingerprint','code','codeHash']);
  if(!identityUuid_(p.commandId)||!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<0||p.expectedRevision>1000000||![p.emailIndex,p.sourceHash,p.fingerprint,p.codeHash].every(accessHash_)||!passkeyText_(p.code,43,43)||emailChangeAddress_(p.delivery)!==p.delivery)emailChangeFail_();
  if(v&&v.id===p.commandId){emailChangeBound_(v,principal,hash);if(v.fingerprint!==p.fingerprint)emailChangeFail_('EMAIL_CHANGE_CONFLICT');return emailChangeDto_(v);}
  if(v&&(now-Date.parse(v.createdAt)<60000||now-Date.parse(v.sendWindow)<3600000&&v.sendCount>=5))emailChangeFail_('EMAIL_CHANGE_RATE_LIMITED');
  var owner=principal.id===props.getProperty('IDENTITY_OWNER_USER_ID'),users=staffUsers_(ss),found=users.rows.filter(function(r){return r.ID_Usuario===principal.id;});if(found.length!==1||staffRevision_(ss,principal.id)!==p.expectedRevision||digest_(found[0].Nome)!==p.sourceHash)emailChangeFail_('EMAIL_CHANGE_CONFLICT');
  if(owner?p.contact!=='':!staffSealed_(p.contact))emailChangeFail_();
  if((owner&&p.delivery===ownerLoginEmail_(c))||!owner&&found[0].Email_Indice===p.emailIndex)emailChangeFail_('EMAIL_CHANGE_CONFLICT');
  var audit=identityRows_(ss,'Logs_Auditoria');if(audit.rows.length>=5000||identityRows_(ss,'Configuracoes').rows.length+1>5000)emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');if(audit.rows.some(function(r){return r.ID_Log===p.commandId;}))emailChangeFail_('EMAIL_CHANGE_CONFLICT');
  var start=new Date(now).toISOString(),sameWindow=v&&now-Date.parse(v.sendWindow)<3600000;
  v={version:1,id:p.commandId,userId:principal.id,sessionId:principal.sessionId,sessionHash:hash,epoch:principal.authorizationVersion,role:principal.role,owner:owner,fingerprint:p.fingerprint,revision:p.expectedRevision,createdAt:start,expiresAt:new Date(now+300000).toISOString(),attempts:0,codeHash:p.codeHash,target:p.delivery,emailIndex:p.emailIndex,contact:p.contact,sourceHash:p.sourceHash,state:'EMAIL',before:null,after:null,ownerBefore:'',at:'',sendWindow:sameWindow?v.sendWindow:start,sendCount:sameWindow?v.sendCount+1:1};
  emailChangeAvailable_(ss,c,v);emailChangeSave_(v);
  try{if(MailApp.getRemainingDailyQuota()<1)throw Error('MAIL_QUOTA');MailApp.sendEmail({to:v.target,subject:'Livraria IPB DEV — confirmar novo e-mail',body:'Foi solicitada a alteração do e-mail de acesso da sua conta.\n\nCódigo de uso único (5 minutos):\n'+p.code+'\n\nDigite somente no perfil em:\nhttps://dev--merry-chimera-49a1f3.netlify.app/meu-perfil-dev.html\n\nA alteração também exige uma sessão recente com passkey. Se não solicitou, ignore e não compartilhe este código.'});}catch(_){v.state='REVOKED';emailChangeSave_(v);emailChangeFail_('EMAIL_CHANGE_DELIVERY');}
  return emailChangeDto_(v);
 }
 if(!['profile.emailConfirm','profile.emailCancel'].includes(op))failure_('FORBIDDEN');authControlExact_(p,op==='profile.emailConfirm'?['commandId','codeHash']:['commandId']);if(!identityUuid_(p.commandId)||!v||v.id!==p.commandId)emailChangeFail_();emailChangeBound_(v,principal,hash);
 if(op==='profile.emailCancel'){if(v.state==='EMAIL'){v.state='REVOKED';emailChangeSave_(v);}return emailChangeDto_(v);}
 if(v.state==='COMPLETE')return emailChangeDto_(v);if(v.state!=='EMAIL'||Date.parse(v.expiresAt)<=now||Date.parse(v.createdAt)>now||!accessHash_(p.codeHash))emailChangeFail_();
 v.attempts++;if(!constantEqual_(v.codeHash,p.codeHash)){if(v.attempts>=5)v.state='REVOKED';emailChangeSave_(v);emailChangeFail_();}
 var users=staffUsers_(ss),found=users.rows.filter(function(r){return r.ID_Usuario===v.userId;});if(found.length!==1||staffRevision_(ss,v.userId)!==v.revision||digest_(found[0].Nome)!==v.sourceHash)emailChangeFail_('EMAIL_CHANGE_CONFLICT');emailChangeAvailable_(ss,c,v);
 var audit=identityRows_(ss,'Logs_Auditoria');if(audit.rows.length>=5000||identityRows_(ss,'Configuracoes').rows.length+1>5000)emailChangeFail_('EMAIL_CHANGE_UNAVAILABLE');
 if(audit.rows.some(function(r){return r.ID_Log===v.id;}))emailChangeFail_('EMAIL_CHANGE_CONFLICT');
 var next=JSON.parse(JSON.stringify(found[0]));if(!v.owner)next.Nome=v.contact;next.Email_Indice=v.emailIndex;v.before=users.columns.map(function(k){return found[0][k];});v.after=users.columns.map(function(k){return next[k];});v.ownerBefore=v.owner?ownerLoginEmail_(c):'';v.at=new Date(now).toISOString();v.state='COMMITTING';props.setProperty('IDENTITY_EMAIL_PENDING',v.userId);emailChangeSave_(v);emailChangeProject_(c,v);return emailChangeDto_(v);
}
