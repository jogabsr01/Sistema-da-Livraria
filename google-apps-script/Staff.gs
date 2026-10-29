/* DEV staff management. Dispatcher owns ScriptLock. Contact data is AEAD-sealed
 * in Node; no plaintext personal fields, PINs or bearer tokens in this journal. */
function staffEnabled_() { return scriptProperties_().getProperty('STAFF_ENABLED') === 'true'; }
function staffFail_(code) { failure_(code || 'INVALID_STAFF'); }
function staffSealed_(value) { return typeof value === 'string' && value.length <= 16000 && /^pd1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(value); }
function staffConfig_(ss, key) {
  var table = identityRows_(ss, 'Configuracoes'), rows = table.rows.filter(function (r) { return r.Chave === key; });
  if (rows.length > 1) staffFail_('STAFF_UNAVAILABLE'); return { table: table, row: rows[0] };
}
function staffPut_(ss, key, value, at, actor) {
  var existing = staffConfig_(ss, key);
  if (existing.row && existing.row.Valor === value) return;
  accessSaveMain_(existing.table, { number: existing.row && existing.row.number, Chave:key, Valor:value, Atualizado_Em:at, Atualizado_Por:actor });
}
function staffRevision_(ss, id) {
  var row = staffConfig_(ss, 'staff.revision.' + id).row;
  if (!row) return 0;
  if (!Number.isSafeInteger(row.Valor) || row.Valor < 1) staffFail_('STAFF_UNAVAILABLE'); return row.Valor;
}
function staffUsers_(ss) {
  var table = identityRows_(ss, 'Usuarios'), ids = new Set(), emails = new Set(), cpfs = new Set();
  table.rows.forEach(function (r) {
    if (!identityUuid_(r.ID_Usuario) || ids.has(r.ID_Usuario) || !['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(r.Perfil) || !['ATIVO','INATIVO'].includes(r.Status) || typeof r.Primeiro_Acesso_Concluido !== 'boolean') staffFail_('STAFF_UNAVAILABLE');
    ids.add(r.ID_Usuario);
    if (r.Nome === '' && r.Perfil === 'SUPER_ADMIN') return;
    if (!staffSealed_(r.Nome) || r.CPF !== '' || r.Email !== '' || r.Whatsapp !== '' || !accessHash_(r.CPF_Indice) || !accessHash_(r.Email_Indice) || cpfs.has(r.CPF_Indice) || emails.has(r.Email_Indice)) staffFail_('STAFF_UNAVAILABLE');
    cpfs.add(r.CPF_Indice); emails.add(r.Email_Indice);
  }); return table;
}
function staffDto_(ss, r) {
  return { id:r.ID_Usuario, contact:r.Nome, role:r.Perfil, status:r.Status, activated:r.Primeiro_Acesso_Concluido,
    revision:staffRevision_(ss,r.ID_Usuario), createdAt:r.Criado_Em, lastAccess:r.Ultimo_Acesso };
}
function staffSubject_(c, id) {
  if (!staffEnabled_() || !identityUuid_(id) || id === scriptProperties_().getProperty('IDENTITY_OWNER_USER_ID')) return null;
  var ss=storage_(c,false).spreadsheet, users=staffUsers_(ss), found=users.rows.filter(function(r){return r.ID_Usuario===id;}), epoch=staffConfig_(ss,'identity.version.'+id).row;
  if(found.length!==1||!epoch||!Number.isSafeInteger(epoch.Valor)||epoch.Valor<1||found[0].Status!=='ATIVO'||!['ATENDENTE','ADMIN'].includes(found[0].Perfil))return null;
  return {row:found[0],users:users,version:epoch.Valor};
}
function staffJournal_(ss) {
  return identityRows_(ss,'Configuracoes').rows.filter(function(r){return r.Chave.indexOf('staff.command.')===0;}).map(function(r){
    var v;try{v=JSON.parse(r.Valor);}catch(_){staffFail_('STAFF_UNAVAILABLE');}
    if(!v||v.version!==1||!identityUuid_(v.commandId)||r.Chave!=='staff.command.'+v.commandId||!identityUuid_(v.id)||!identityUuid_(v.actor)||!['ADMIN','SUPER_ADMIN'].includes(v.role)||!['PENDING','COMPLETE'].includes(v.state)||!accessHash_(v.fingerprint)||!Array.isArray(v.after)||v.before!==null&&!Array.isArray(v.before)||!Number.isSafeInteger(v.revision)||v.revision<1||!Number.isSafeInteger(v.epoch)||v.epoch<1||!staffSealed_(v.reason))staffFail_('STAFF_UNAVAILABLE');
    authControlTime_(v.at);var clone=JSON.parse(JSON.stringify(v));delete clone.hash;delete clone.state;if(!constantEqual_(digest_(JSON.stringify(clone)),v.hash))staffFail_('STAFF_UNAVAILABLE');
    return v;
  });
}
function staffProject_(ss,v) {
  var users=identityRows_(ss,'Usuarios'),columns=users.columns;
  if(v.after.length!==columns.length||v.before!==null&&v.before.length!==columns.length||v.after[columns.indexOf('ID_Usuario')]!==v.id||v.after[columns.indexOf('Perfil')]==='SUPER_ADMIN')staffFail_('STAFF_UNAVAILABLE');
  var found=users.rows.filter(function(r){return r.ID_Usuario===v.id;});
  if(found.length>1||!found.length&&v.before!==null)staffFail_('STAFF_CONFLICT');
  var values=found.length?columns.map(function(k){return found[0][k];}):null;
  if(!same_(values,v.before)&&!same_(values,v.after))staffFail_('STAFF_CONFLICT');
  // Epoch FIRST: no stale session can survive a partially applied disable/promotion.
  staffPut_(ss,'identity.version.'+v.id,v.epoch,v.at,v.actor);
  if(!same_(values,v.after)){var row={number:found.length?found[0].number:undefined};columns.forEach(function(k,i){row[k]=v.after[i];});accessSaveMain_(users,row);}
  staffPut_(ss,'staff.revision.'+v.id,v.revision,v.at,v.actor);
  var audit=identityRows_(ss,'Logs_Auditoria'),logged=audit.rows.filter(function(r){return r.ID_Log===v.commandId;}),log={ID_Log:v.commandId,Data_Hora:v.at,ID_Usuario:v.actor,Perfil:v.role,
    Acao:v.before===null?'STAFF_CREATE':'STAFF_UPDATE',Entidade:'Usuarios',ID_Entidade:v.id,Antes:JSON.stringify({revision:v.revision-1}),Depois:JSON.stringify({revision:v.revision,role:v.after[columns.indexOf('Perfil')],status:v.after[columns.indexOf('Status')],reenrollmentRequired:v.reenrollmentRequired,reasonRecorded:true}),Resultado:'SUCESSO',ID_Requisicao:v.commandId};
  if(logged.length>1||logged.length&&!audit.columns.every(function(k){return logged[0][k]===log[k];}))staffFail_('STAFF_UNAVAILABLE');
  if(!logged.length)accessSaveMain_(audit,log);
  v.state='COMPLETE';staffPut_(ss,'staff.command.'+v.commandId,JSON.stringify(v),v.at,v.actor);
}
function recoverStaff_(c) {
  var ss=storage_(c,false).spreadsheet,pending=staffJournal_(ss).filter(function(v){return v.state==='PENDING';});
  if(pending.length>1)staffFail_('STAFF_UNAVAILABLE');pending.forEach(function(v){staffProject_(ss,v);});
}
function staffAdmin_(principal) {
  if(!['ADMIN','SUPER_ADMIN'].includes(principal.role)||!businessAssurance_(principal)||Date.now()-principal.authenticatedAt>300000)failure_('FORBIDDEN');
}
function staffOperation_(request,c) {
  recoverStaff_(c);var ss=storage_(c,false).spreadsheet,p=request.payload;
  if(!request.actor||!accessHash_(request.actor.sessionTokenHash))failure_('UNAUTHENTICATED');
  var principal=identitySession_(ss,request.actor.sessionTokenHash,Date.now()).principal;staffAdmin_(principal);
  var users=staffUsers_(ss);
  if(request.action==='staff.bootstrap'||request.action==='staff.list'||request.action==='staff.get'){
    if(request.action==='staff.list'||request.action==='staff.bootstrap'){authControlExact_(p,['offset']);if(!Number.isSafeInteger(p.offset)||p.offset<0||p.offset>5000)staffFail_();}
    else {authControlExact_(p,['id']);if(!identityUuid_(p.id))staffFail_();}
    // List access is itself sensitive and append-only audited, without contact data.
    var at=new Date().toISOString(),audit=identityRows_(ss,'Logs_Auditoria');if(audit.rows.length>=5000)staffFail_('STAFF_CAPACITY');
    accessSaveMain_(audit,{ID_Log:request.requestId,Data_Hora:at,ID_Usuario:principal.id,Perfil:principal.role,Acao:'STAFF_LIST',Entidade:'Usuarios',ID_Entidade:'',Antes:'',Depois:'',Resultado:'SUCESSO',ID_Requisicao:request.requestId});
    if(request.action==='staff.get'){var found=users.rows.filter(function(r){return r.ID_Usuario===p.id;});if(found.length!==1)staffFail_('STAFF_CONFLICT');return {user:staffDto_(ss,found[0])};}
    var sorted=users.rows.slice().sort(function(a,b){return String(a.Criado_Em).localeCompare(String(b.Criado_Em))||a.ID_Usuario.localeCompare(b.ID_Usuario);}),page=sorted.slice(p.offset,p.offset+25);
    var data={users:page.map(function(r){return staffDto_(ss,r);}),total:sorted.length,nextOffset:p.offset+page.length<sorted.length?p.offset+page.length:null};if(request.action==='staff.bootstrap')data.principal=principal;return data;
  }
  if(request.action!=='staff.save')failure_('FORBIDDEN');
  authControlExact_(p,['commandId','id','expectedRevision','reason','role','status','fingerprint','contact','emailIndex','cpfIndex','emailCheck']);
  if(!identityUuid_(p.commandId)||!identityUuid_(p.id)||!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<0||p.expectedRevision>1000000||!['ATENDENTE','ADMIN'].includes(p.role)||!['ATIVO','INATIVO'].includes(p.status)||!staffSealed_(p.contact)||!staffSealed_(p.reason)||![p.fingerprint,p.emailIndex,p.cpfIndex,p.emailCheck].every(accessHash_))staffFail_();
  if([digest_(accessEmail_(c.owner)),digest_(ownerLoginEmail_(c))].includes(p.emailCheck))staffFail_('STAFF_EMAIL_DUPLICATE');
  var prior=staffJournal_(ss).filter(function(v){return v.commandId===p.commandId;});
  if(prior.length){var v=prior[0];if(v.fingerprint!==p.fingerprint||v.actor!==principal.id||v.id!==p.id)staffFail_('STAFF_CONFLICT');return {id:v.id,revision:v.revision,reenrollmentRequired:v.reenrollmentRequired};}
  var found=users.rows.filter(function(r){return r.ID_Usuario===p.id;}),old=found[0];
  if(principal.id===p.id||old&&old.Perfil==='SUPER_ADMIN'||(p.role==='ADMIN'||old&&old.Perfil==='ADMIN')&&principal.role!=='SUPER_ADMIN')failure_('FORBIDDEN');
  if(staffRevision_(ss,p.id)!==p.expectedRevision||!old&&p.expectedRevision!==0)staffFail_('STAFF_CONFLICT');
  if(users.rows.some(function(r){return r.ID_Usuario!==p.id&&r.CPF_Indice===p.cpfIndex;}))staffFail_('STAFF_CPF_DUPLICATE');
  if(users.rows.some(function(r){return r.ID_Usuario!==p.id&&r.Email_Indice===p.emailIndex;}))staffFail_('STAFF_EMAIL_DUPLICATE');
  var epoch=staffConfig_(ss,'identity.version.'+p.id).row;if(old&&!epoch||!old&&epoch)staffFail_('STAFF_UNAVAILABLE');
  var reset=!old||old.Email_Indice!==p.emailIndex||old.CPF_Indice!==p.cpfIndex||old.Perfil!==p.role||old.Status!==p.status;
  if(old&&old.CPF_Indice!==p.cpfIndex&&principal.role!=='SUPER_ADMIN')failure_('FORBIDDEN');
  var at=new Date().toISOString(),row=old?JSON.parse(JSON.stringify(old)):{ID_Usuario:p.id,Criado_Por:principal.id,Criado_Em:at,Foto_Perfil_Drive_ID:'',Ultimo_Acesso:''};
  row.Nome=p.contact;row.CPF='';row.Email='';row.Whatsapp='';row.Email_Indice=p.emailIndex;row.CPF_Indice=p.cpfIndex;row.Perfil=p.role;row.Status=p.status;
  row.Primeiro_Acesso_Concluido=reset?false:old.Primeiro_Acesso_Concluido;
  var configs=identityRows_(ss,'Configuracoes'),audit=identityRows_(ss,'Logs_Auditoria');
  if(configs.rows.length+3>5000||audit.rows.length>=5000||!old&&users.rows.length>=5000||staffJournal_(ss).length>=1000)staffFail_('STAFF_CAPACITY');
  var v={version:1,commandId:p.commandId,id:p.id,actor:principal.id,role:principal.role,state:'PENDING',fingerprint:p.fingerprint,reason:p.reason,at:at,revision:p.expectedRevision+1,epoch:old?epoch.Valor+(reset?1:0):1,reenrollmentRequired:reset,
    before:old?users.columns.map(function(k){return old[k];}):null,after:users.columns.map(function(k){return row[k]===undefined?'':row[k];})};
  var clone=JSON.parse(JSON.stringify(v));delete clone.state;v.hash=digest_(JSON.stringify(clone));
  staffPut_(ss,'staff.command.'+p.commandId,JSON.stringify(v),at,principal.id);staffProject_(ss,v);
  return {id:p.id,revision:v.revision,reenrollmentRequired:reset};
}
function staffAccessOperation_(request,c) {
  recoverStaff_(c);recoverProfiles_(c);recoverRecoveryIntents_(c);recoverEmailChanges_(c);var p=request.payload,ss=authControlStore_(c),main=storage_(c,false).spreadsheet,now=Date.now();
  if(request.action==='identity.staffAccess.lookup'){
    authControlExact_(p,['emailIndex','cpfIndex']);if(p.emailIndex!==''&&!accessHash_(p.emailIndex)||p.cpfIndex!==''&&!accessHash_(p.cpfIndex)||!p.emailIndex&&!p.cpfIndex)accessReject_();
    var matches=staffUsers_(main).rows.filter(function(r){return p.emailIndex&&r.Email_Indice===p.emailIndex||p.cpfIndex&&r.CPF_Indice===p.cpfIndex;});
    if(matches.length!==1)return {account:null};var subject=staffSubject_(c,matches[0].ID_Usuario);if(!subject)return {account:null};
    var pins=accessPins_(ss).rows.filter(function(r){return r.Subject_ID===subject.row.ID_Usuario&&r.Authorization_Version===subject.version;});
    return {account:{subjectId:subject.row.ID_Usuario,authorizationVersion:subject.version,contact:subject.row.Nome,activated:subject.row.Primeiro_Acesso_Concluido,
      record:subject.row.Primeiro_Acesso_Concluido&&pins.length===1?accessPinRecord_(pins[0].Record_JSON):null}};
  }
  if(['identity.staffAccess.start','identity.staffAccess.recover'].includes(request.action)){
    var recovery=request.action==='identity.staffAccess.recover',purpose=recovery?'RECOVER':'ACTIVATE';if(recovery&&!recoveryEnabled_())failure_('IDENTITY_UNAVAILABLE');
    authControlExact_(p,['subjectId','contactHash','delivery','flowId','tokenHash','codeHash','code']);
    if(!accessHash_(p.contactHash)||!accessHash_(p.codeHash)||!accessDeliveryCode_(p.code))accessReject_();if([accessEmail_(c.owner),ownerLoginEmail_(c)].includes(accessEmail_(p.delivery)))accessReject_();
    var subject=staffSubject_(c,p.subjectId),table=accessFlows_(ss);
    if(!recovery&&subject&&subject.row.Primeiro_Acesso_Concluido&&digest_(subject.row.Nome)===p.contactHash)return {accepted:true,outcome:'ALREADY_ACTIVE'};
    if(!subject||subject.row.Primeiro_Acesso_Concluido!==recovery||digest_(subject.row.Nome)!==p.contactHash)subject=null;
    if(!recovery&&!subject)return {accepted:true,outcome:'NOT_FOUND'};
    if(subject&&table.rows.some(function(r){return r.Subject_ID===subject.row.ID_Usuario&&now-authControlTime_(r.Created_At)<60000;})){if(!recovery)return {accepted:true,outcome:'THROTTLED'};subject=null;}
    if(subject)table.rows.filter(function(r){return r.Subject_ID===subject.row.ID_Usuario&&!['COMMITTING','COMPLETE','REVOKED'].includes(r.State);}).forEach(function(r){r.State='REVOKED';authControlSave_(table,r);});
    var flow=accessNewFlow_(table,p,subject,purpose,now);
    if(subject){try{if(MailApp.getRemainingDailyQuota()<1)throw Error('QUOTA');MailApp.sendEmail({to:p.delivery,subject:'Livraria IPB DEV — confirmar acesso',body:'Foi solicitado acesso à sua conta na Livraria IPB DEV.\n\nCódigo de uso único (10 minutos):\n'+p.code+'\n\nUse somente em https://dev--merry-chimera-49a1f3.netlify.app/acesso-dev.html\nSe não solicitou, ignore. Não compartilhe o código.'});}catch(_){flow.State='REVOKED';authControlSave_(accessFlows_(ss),flow);if(!recovery)return {accepted:true,outcome:'DELIVERY_UNAVAILABLE'};}}
    return recovery?{accepted:true}:{accepted:true,outcome:'SENT'};
  }
  failure_('FORBIDDEN');
}
