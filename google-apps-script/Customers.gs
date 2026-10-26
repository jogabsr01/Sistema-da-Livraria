/* Private customer records and recoverable updates. Dispatcher holds ScriptLock.
 * PII lives in an authenticated encrypted contact envelope in Clientes.Nome. */
function customerFail_(code){failure_(code||'INVALID_CUSTOMER');}
function customerRevision_(ss,id){var row=staffConfig_(ss,'customer.revision.'+id).row;if(!row)return 0;if(!Number.isSafeInteger(row.Valor)||row.Valor<1)customerFail_('CUSTOMERS_UNAVAILABLE');return row.Valor;}
function customerRows_(ss){
 var table=identityRows_(ss,'Clientes'),ids=new Set(),cpfs=new Set();
 table.rows.forEach(function(r){if(!identityUuid_(r.ID_Cliente)||ids.has(r.ID_Cliente)||!staffSealed_(r.Nome)||!accessHash_(r.CPF_Indice)||cpfs.has(r.CPF_Indice)||!['NONE','WHATSAPP','EMAIL'].includes(r.Preferencia_Contato)||typeof r.Consentimento_Marketing!=='boolean'||['CPF','Email','Whatsapp','CEP','Logradouro','Numero','Complemento','Bairro','Cidade','UF'].some(function(k){return r[k]!=='';}))customerFail_('CUSTOMERS_UNAVAILABLE');ids.add(r.ID_Cliente);cpfs.add(r.CPF_Indice);authControlTime_(r.Data_Cadastro);if(r.Ultima_Compra!=='')authControlTime_(r.Ultima_Compra);if(r.Data_Consentimento!=='')authControlTime_(r.Data_Consentimento);});return table;
}
function customerDto_(ss,r){return {id:r.ID_Cliente,contact:r.Nome,revision:customerRevision_(ss,r.ID_Cliente),createdAt:r.Data_Cadastro,lastPurchase:r.Ultima_Compra,consentAt:r.Data_Consentimento,contactPreference:r.Preferencia_Contato,marketingConsent:r.Consentimento_Marketing};}
function customerCommands_(ss){return identityRows_(ss,'Configuracoes').rows.filter(function(r){return r.Chave.indexOf('customer.command.')===0;}).map(function(r){
 var v;try{v=JSON.parse(r.Valor);}catch(_){customerFail_('CUSTOMERS_UNAVAILABLE');}
 if(!v||v.version!==1||!identityUuid_(v.commandId)||r.Chave!=='customer.command.'+v.commandId||!identityUuid_(v.id)||!identityUuid_(v.actor)||!['ATENDENTE','ADMIN','SUPER_ADMIN'].includes(v.role)||!['PENDING','COMPLETE'].includes(v.state)||!accessHash_(v.fingerprint)||!Array.isArray(v.after)||v.before!==null&&!Array.isArray(v.before)||!Number.isSafeInteger(v.revision)||v.revision<1)customerFail_('CUSTOMERS_UNAVAILABLE');
 authControlTime_(v.at);var clone=JSON.parse(JSON.stringify(v));delete clone.state;delete clone.hash;if(!constantEqual_(digest_(JSON.stringify(clone)),v.hash))customerFail_('CUSTOMERS_UNAVAILABLE');return v;
});}
function customerProject_(ss,v){
 var table=identityRows_(ss,'Clientes'),cols=table.columns;if(v.after.length!==cols.length||v.before!==null&&v.before.length!==cols.length||v.after[cols.indexOf('ID_Cliente')]!==v.id)customerFail_('CUSTOMERS_UNAVAILABLE');
 var found=table.rows.filter(function(r){return r.ID_Cliente===v.id;});if(found.length>1||!found.length&&v.before!==null)customerFail_('CUSTOMER_CONFLICT');
 var values=found.length?cols.map(function(k){return found[0][k];}):null;if(!same_(values,v.before)&&!same_(values,v.after))customerFail_('CUSTOMER_CONFLICT');
 if(!same_(values,v.after)){var row={number:found.length?found[0].number:undefined};cols.forEach(function(k,i){row[k]=v.after[i];});accessSaveMain_(table,row);}
 staffPut_(ss,'customer.revision.'+v.id,v.revision,v.at,v.actor);
 var audit=identityRows_(ss,'Logs_Auditoria'),prior=audit.rows.filter(function(r){return r.ID_Log===v.commandId;}),log={ID_Log:v.commandId,Data_Hora:v.at,ID_Usuario:v.actor,Perfil:v.role,Acao:v.before===null?'CUSTOMER_CREATE':'CUSTOMER_UPDATE',Entidade:'Clientes',ID_Entidade:v.id,
 Antes:JSON.stringify({revision:v.revision-1}),Depois:JSON.stringify({revision:v.revision,contactPreference:v.after[cols.indexOf('Preferencia_Contato')],marketingConsent:v.after[cols.indexOf('Consentimento_Marketing')]}),Resultado:'SUCESSO',ID_Requisicao:v.commandId};
 if(prior.length>1||prior.length&&!audit.columns.every(function(k){return prior[0][k]===log[k];}))customerFail_('CUSTOMERS_UNAVAILABLE');if(!prior.length)accessSaveMain_(audit,log);
 v.state='COMPLETE';staffPut_(ss,'customer.command.'+v.commandId,JSON.stringify(v),v.at,v.actor);
}
function recoverCustomers_(ss){var pending=customerCommands_(ss).filter(function(v){return v.state==='PENDING';});if(pending.length>1)customerFail_('CUSTOMERS_UNAVAILABLE');pending.forEach(function(v){customerProject_(ss,v);});}
function customerOperation_(request,c){
 var ss=storage_(c,false).spreadsheet;recoverCustomers_(ss);
 if(ss.getSheetByName('_Eventos_Dominio').getLastRow()>1){if(scriptProperties_().getProperty('CATALOG_JOURNAL_ID'))recoverCatalog_(c);recoverSales_(ss);}
 if(!request.actor||!accessHash_(request.actor.sessionTokenHash))failure_('UNAUTHENTICATED');var principal=identitySession_(ss,request.actor.sessionTokenHash,Date.now()).principal,p=request.payload,users=customerRows_(ss);
 if(!['ATENDENTE','ADMIN','SUPER_ADMIN'].includes(principal.role))failure_('FORBIDDEN');
 if(request.action==='customers.find'||request.action==='customers.get'){
  if(request.action==='customers.find'){authControlExact_(p,['cpfIndex']);if(!accessHash_(p.cpfIndex))customerFail_();}else{authControlExact_(p,['id']);if(!identityUuid_(p.id))customerFail_();}
  var found=users.rows.filter(function(r){return request.action==='customers.find'?r.CPF_Indice===p.cpfIndex:r.ID_Cliente===p.id;}),audit=identityRows_(ss,'Logs_Auditoria');if(audit.rows.length>=5000)customerFail_('CUSTOMER_CAPACITY');
  accessSaveMain_(audit,{ID_Log:request.requestId,Data_Hora:new Date().toISOString(),ID_Usuario:principal.id,Perfil:principal.role,Acao:'CUSTOMER_READ',Entidade:'Clientes',ID_Entidade:found.length?found[0].ID_Cliente:'',Antes:'',Depois:JSON.stringify({found:found.length===1}),Resultado:'SUCESSO',ID_Requisicao:request.requestId});return {customer:found.length===1?customerDto_(ss,found[0]):null};
 }
 if(request.action!=='customers.save')failure_('FORBIDDEN');authControlExact_(p,['commandId','id','expectedRevision','contact','cpfIndex','fingerprint','contactPreference','marketingConsent']);
 if(!identityUuid_(p.commandId)||!identityUuid_(p.id)||!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<0||p.expectedRevision>1000000||!staffSealed_(p.contact)||!accessHash_(p.cpfIndex)||!accessHash_(p.fingerprint)||!['NONE','WHATSAPP','EMAIL'].includes(p.contactPreference)||typeof p.marketingConsent!=='boolean'||p.marketingConsent&&p.contactPreference==='NONE')customerFail_();
 var prior=customerCommands_(ss).filter(function(v){return v.commandId===p.commandId;});if(prior.length){var v=prior[0];if(v.fingerprint!==p.fingerprint||v.actor!==principal.id||v.id!==p.id)customerFail_('CUSTOMER_CONFLICT');return {id:v.id,revision:v.revision};}
 var old=users.rows.filter(function(r){return r.ID_Cliente===p.id;})[0];if(customerRevision_(ss,p.id)!==p.expectedRevision||!old&&p.expectedRevision!==0)customerFail_('CUSTOMER_CONFLICT');
 if(old&&old.CPF_Indice!==p.cpfIndex)failure_('FORBIDDEN');if(users.rows.some(function(r){return r.ID_Cliente!==p.id&&r.CPF_Indice===p.cpfIndex;}))customerFail_('CUSTOMER_DUPLICATE');
 var audit=identityRows_(ss,'Logs_Auditoria'),configs=identityRows_(ss,'Configuracoes');if(users.rows.length>=5000&&!old||configs.rows.length+2>5000||audit.rows.length>=5000||customerCommands_(ss).length>=1000)customerFail_('CUSTOMER_CAPACITY');
 var at=new Date().toISOString(),row=old?JSON.parse(JSON.stringify(old)):{ID_Cliente:p.id,Data_Cadastro:at,Ultima_Compra:''};
 row.Nome=p.contact;row.CPF_Indice=p.cpfIndex;row.Preferencia_Contato=p.contactPreference;row.Consentimento_Marketing=p.marketingConsent;
 row.Data_Consentimento=!old?p.marketingConsent?at:'':old.Consentimento_Marketing!==p.marketingConsent||old.Preferencia_Contato!==p.contactPreference?at:old.Data_Consentimento;
 var v={version:1,commandId:p.commandId,id:p.id,actor:principal.id,role:principal.role,state:'PENDING',fingerprint:p.fingerprint,at:at,revision:p.expectedRevision+1,before:old?users.columns.map(function(k){return old[k];}):null,after:users.columns.map(function(k){return row[k]===undefined?'':row[k];})};
 var clone=JSON.parse(JSON.stringify(v));delete clone.state;v.hash=digest_(JSON.stringify(clone));staffPut_(ss,'customer.command.'+p.commandId,JSON.stringify(v),at,principal.id);customerProject_(ss,v);return {id:p.id,revision:v.revision};
}
