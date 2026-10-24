/* Minimal security events and a single private, authenticated write-ahead intent.
 * No browser endpoint; every call requires the signed server envelope/ScriptLock. */
function securityId_(c,kind,value){var h=hmac_(JSON.stringify([c.installationId,kind,value]),c.secret,'security.audit');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
function securityLog_(id,at,actor,role,action,detail){return {ID_Log:id,Data_Hora:at,ID_Usuario:actor,Perfil:role,Acao:action,Entidade:'Autenticacao',ID_Entidade:'',Antes:'',Depois:JSON.stringify(detail),Resultado:action==='IDENTITY_ACCESS_DENIED'?'NEGADO':['IDENTITY_AUTH_BLOCKED','IDENTITY_PROOF_BLOCKED'].includes(action)?'BLOQUEADO':'SUCESSO',ID_Requisicao:id};}
function securityAppend_(ss,log){var table=identityRows_(ss,'Logs_Auditoria'),found=table.rows.filter(function(r){return r.ID_Log===log.ID_Log;});if(found.length>1||found.length&&!table.columns.every(function(k){return found[0][k]===log[k];}))failure_('SECURITY_AUDIT_UNAVAILABLE');if(!found.length){if(table.rows.length>=5000)failure_('SECURITY_AUDIT_UNAVAILABLE');accessSaveMain_(table,log);}}
function securityIntentHash_(v,c){var copy=JSON.parse(JSON.stringify(v));delete copy.hash;return hmac_(JSON.stringify([c.environment,c.installationId,copy]),c.secret,'security.intent');}
function securityBegin_(c,v){var props=PropertiesService.getScriptProperties();if(props.getProperty('IDENTITY_SECURITY_PENDING'))failure_('SECURITY_AUDIT_UNAVAILABLE');v.version=1;v.hash=securityIntentHash_(v,c);var raw=JSON.stringify(v);if(Utilities.newBlob(raw).getBytes().length>8000||v.kind!=='SESSIONS'&&identityRows_(storage_(c,false).spreadsheet,'Logs_Auditoria').rows.length>=5000)failure_('SECURITY_AUDIT_UNAVAILABLE');props.setProperty('IDENTITY_SECURITY_PENDING',raw);recoverSecurityIntent_(c);}
function securitySessionTargets_(table,p){
 var seen=new Set();table.rows.forEach(function(r){if(!identityUuid_(r.ID_Sessao)||seen.has(r.ID_Sessao)||!identityUuid_(r.ID_Usuario))failure_('SECURITY_AUDIT_UNAVAILABLE');seen.add(r.ID_Sessao);});
 return table.rows.filter(function(r){return r.ID_Usuario===p.actor&&(p.kind==='SELF'?r.ID_Sessao===p.sessionId:r.ID_Sessao!==p.sessionId&&identityTime_(r.Criado_Em)<=p.cutoff)&&(r.Revogado_Em===''||r.Revogado_Em===p.at);});
}
function recoverSecurityIntent_(c){
 var props=PropertiesService.getScriptProperties(),raw=props.getProperty('IDENTITY_SECURITY_PENDING');if(!raw)return;var v;try{v=JSON.parse(raw);}catch(_){failure_('SECURITY_AUDIT_UNAVAILABLE');}if(!v||v.version!==1||!['LIMIT','SESSIONS','PROOF'].includes(v.kind)||!constantEqual_(v.hash,securityIntentHash_(v,c))||!v.log||!identityUuid_(v.log.ID_Log))failure_('SECURITY_AUDIT_UNAVAILABLE');
 var main=storage_(c,false).spreadsheet;
 if(v.kind==='LIMIT'){
  if(!Array.isArray(v.plans)||v.plans.length!==2)failure_('SECURITY_AUDIT_UNAVAILABLE');var table=authControlRows_(authControlStore_(c),'_Auth_Limits');
  v.plans.forEach(function(plan){var rows=table.rows.filter(function(r){return r.Key===plan.key;}),current=rows.length?table.columns.map(function(k){return rows[0][k];}):null;if(rows.length>1||!same_(current,plan.before)&&!same_(current,plan.after)||!Array.isArray(plan.after)||plan.after.length!==table.columns.length||plan.after[0]!==plan.key)failure_('SECURITY_AUDIT_UNAVAILABLE');if(!same_(current,plan.after)){var row={number:rows.length?rows[0].number:undefined};table.columns.forEach(function(k,i){row[k]=plan.after[i];});authControlSave_(table,row);}});
 }else if(v.kind==='PROOF'){
  var plan=v.plan,table=accessFlows_(authControlStore_(c)),rows=table.rows.filter(function(r){return r.ID===plan.flowId;});if(rows.length!==1||!identityUuid_(plan.flowId)||rows[0].Attempt_Count!==4&&rows[0].Attempt_Count!==5||rows[0].State!=='EMAIL'&&rows[0].State!=='REVOKED')failure_('SECURITY_AUDIT_UNAVAILABLE');var row=rows[0];if(row.Attempt_Count!==5||row.State!=='REVOKED'){row.Attempt_Count=5;row.State='REVOKED';authControlSave_(table,row);}
 }else{
  var p=v.plan;if(!p||!['SELF','OTHERS'].includes(p.kind)||!identityUuid_(p.actor)||!identityUuid_(p.sessionId)||!Number.isSafeInteger(p.cutoff)||p.cutoff<0||!Number.isSafeInteger(p.count)||p.count<1||p.count>5000||!accessHash_(p.idsHash))failure_('SECURITY_AUDIT_UNAVAILABLE');identityTime_(p.at);var table=identityRows_(main,'Sessoes'),targets=securitySessionTargets_(table,p);if(targets.length!==p.count||digest_(JSON.stringify(targets.map(function(r){return r.ID_Sessao;}).sort()))!==p.idsHash)failure_('SECURITY_AUDIT_UNAVAILABLE');targets.forEach(function(row){if(row.Revogado_Em===''){row.Revogado_Em=p.at;accessSaveMain_(table,row);}});
 }
 securityAppend_(main,v.log);props.setProperty('IDENTITY_SECURITY_PENDING','');
}
function securitySettle_(c){recoverStaff_(c);recoverProfiles_(c);recoverRecoveryIntents_(c);recoverEmailChanges_(c);recoverNiches_(c);recoverSchedules_(c);var props=PropertiesService.getScriptProperties();if(props.getProperty('CATALOG_JOURNAL_ID')){recoverCatalog_(c);recoverSales_(storage_(c,false).spreadsheet);}if(props.getProperty('IDENTITY_CONTROL_SPREADSHEET_ID'))accessRecoverIntents_(authControlStore_(c),c,Date.now());}
function securityProofBlock_(c,row,now){securitySettle_(c);var id=securityId_(c,'PROOF_BLOCK',row.ID),log=securityLog_(id,new Date(now).toISOString(),'SYSTEM_AUTH','SYSTEM','IDENTITY_PROOF_BLOCKED',{phase:'EMAIL',code:'EMAIL_PROOF_LIMIT'});securityBegin_(c,{kind:'PROOF',plan:{flowId:row.ID},log:log});}
function securityBlock_(privateStore,plans,c,now,retry){
 securitySettle_(c);
 var table=authControlRows_(privateStore,'_Auth_Limits'),at=new Date(now).toISOString(),kinds=plans.filter(function(p){return p.row.Attempt_Count>p.maximum;}).map(function(p){return p.row.Key.split(':')[0];}),id=securityId_(c,'BLOCK',plans.map(function(p){return [p.row.Key,p.row.Blocked_Until];}));
 var log=securityLog_(id,at,'SYSTEM_AUTH','SYSTEM','IDENTITY_AUTH_BLOCKED',{phase:'LIMITER',code:kinds.length===2?'ACCOUNT_AND_ORIGIN_LIMIT':kinds[0]==='account'?'ACCOUNT_LIMIT':'ORIGIN_LIMIT',retryAfterSeconds:retry});
 securityBegin_(c,{kind:'LIMIT',log:log,plans:plans.map(function(p){return {key:p.row.Key,before:p.before,after:table.columns.map(function(k){return p.row[k];})};})});
}
function securityRevoke_(request,c){
 recoverSecurityIntent_(c);securitySettle_(c);var ss=storage_(c,false).spreadsheet,table=identityRows_(ss,'Sessoes'),matches=table.rows.filter(function(r){return r.Token_Hash===request.payload.tokenHash;}),self=request.action==='identity.session.revoke';
 if(matches.length!==1)failure_('UNAUTHENTICATED');var session=matches[0],id=self?securityId_(c,'LOGOUT',session.ID_Sessao):null;
 if(self&&session.Revogado_Em!==''){
  var prior=identityRows_(ss,'Logs_Auditoria').rows.filter(function(r){return r.ID_Log===id;});if(prior.length===1&&prior[0].Acao==='IDENTITY_LOGOUT'&&prior[0].ID_Usuario===session.ID_Usuario&&prior[0].Data_Hora===session.Revogado_Em)return {revoked:true};failure_('UNAUTHENTICATED');
 }
 var now=Date.now(),resolved=identitySession_(ss,request.payload.tokenHash,now),at=new Date(now).toISOString();while(table.rows.some(function(r){return r.Revogado_Em===at;}))at=new Date(Date.parse(at)+1).toISOString();
 var p={kind:self?'SELF':'OTHERS',actor:resolved.principal.id,sessionId:resolved.principal.sessionId,cutoff:now,at:at};var targets=securitySessionTargets_(table,p);if(!targets.length)return {revoked:true};p.count=targets.length;p.idsHash=digest_(JSON.stringify(targets.map(function(r){return r.ID_Sessao;}).sort()));if(!self)id=securityId_(c,'REVOKE_OTHERS',[p.sessionId,p.idsHash]);
 var log=securityLog_(id,at,p.actor,resolved.principal.role,self?'IDENTITY_LOGOUT':'IDENTITY_SESSIONS_REVOKED',{revokedSessions:p.count});securityBegin_(c,{kind:'SESSIONS',plan:p,log:log});return {revoked:true};
}
function securityRecord_(request,c){
 recoverSecurityIntent_(c);securitySettle_(c);var p=request.payload;authControlExact_(p,['commandId','phase','code']);if(!identityUuid_(p.commandId)||!['START','RECOVER','LOGIN','EMAIL','PIN','OPTIONS','COMPLETE'].includes(p.phase)||!['CREDENTIALS_REJECTED','EMAIL_PROOF_REJECTED','PASSKEY_REJECTED','FLOW_REJECTED'].includes(p.code))failure_('SECURITY_AUDIT_UNAVAILABLE');var ss=storage_(c,false).spreadsheet,prior=identityRows_(ss,'Logs_Auditoria').rows.filter(function(r){return r.ID_Log===p.commandId;});if(prior.length){var expected=securityLog_(p.commandId,prior[0].Data_Hora,'SYSTEM_AUTH','SYSTEM','IDENTITY_ACCESS_DENIED',{phase:p.phase,code:p.code});securityAppend_(ss,expected);return {recorded:true};}
 securityAppend_(ss,securityLog_(p.commandId,new Date().toISOString(),'SYSTEM_AUTH','SYSTEM','IDENTITY_ACCESS_DENIED',{phase:p.phase,code:p.code}));return {recorded:true};
}
