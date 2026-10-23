/* Administrative adjustments and integral reversals. Dispatcher owns ScriptLock.
 * No bank payment is performed. Committed events replay independently of flags. */
function operationCommand_(kind,p){
 var keys=kind==='adjust'?['commandId','expectedVersion','id','newStock','reason']:['commandId','reason','saleId'];authControlExact_(p,keys);
 if(!identityUuid_(p.commandId)||!identityUuid_(kind==='adjust'?p.id:p.saleId)||typeof p.reason!=='string'||!p.reason||p.reason!==p.reason.trim()||p.reason.length>300||/[\x00-\x1f\x7f]/.test(p.reason)||/^[=+@-]/.test(p.reason))failure_('INVALID_OPERATION');
 if(kind==='adjust'){if(!Number.isSafeInteger(p.expectedVersion)||p.expectedVersion<1||p.expectedVersion>=1000000000||!Number.isSafeInteger(p.newStock)||p.newStock<0||p.newStock>1000000)failure_('INVALID_OPERATION');return {commandId:p.commandId,id:p.id,expectedVersion:p.expectedVersion,newStock:p.newStock,reason:p.reason};}
 if(kind!=='reverse')failure_('INVALID_OPERATION');return {commandId:p.commandId,saleId:p.saleId,reason:p.reason};
}
function operationEvent_(e,row){
 if(!e||!['STOCK_ADJUSTED','SALE_REVERSED'].includes(e.type)||e.version!==1||!identityUuid_(e.actorId)||!['ADMIN','SUPER_ADMIN'].includes(e.actorRole)||!e.receipt||e.receipt.commandId!==e.idempotencyKey||!identityUuid_(e.idempotencyKey)||!Array.isArray(e.lines)||!e.lines.length||e.lines.length>100)failure_('JOURNAL_INVALID');
 authControlTime_(e.receipt.createdAt);var command;
 try{command=operationCommand_(e.type==='STOCK_ADJUSTED'?'adjust':'reverse',e.command);}catch(_){failure_('JOURNAL_INVALID');}
 if(command.commandId!==e.idempotencyKey||digest_(JSON.stringify(command))!==e.commandHash||row.ID_Evento!==e.idempotencyKey||row.Chave_Idempotencia!==e.idempotencyKey||row.Tipo!==e.type||row.Hash_Comando!==e.commandHash||row.Versao_Esquema!==1||row.Criado_Em!==e.receipt.createdAt||row.Estado_Projecao!=='PENDENTE')failure_('JOURNAL_INVALID');
 var ids=new Set();e.lines.forEach(function(l){if(!identityUuid_(l.id)||ids.has(l.id)||!Number.isSafeInteger(l.expectedVersion)||l.expectedVersion<1||l.expectedVersion>=1000000000||![l.before,l.after].every(function(n){return Number.isSafeInteger(n)&&n>=0&&n<=1000000;})||l.before===l.after)failure_('JOURNAL_INVALID');ids.add(l.id);});
 if(e.type==='STOCK_ADJUSTED'){var l=e.lines[0];if(e.lines.length!==1||l.id!==command.id||l.expectedVersion!==command.expectedVersion||l.after!==command.newStock||e.receipt.id!==l.id||e.receipt.stockBefore!==l.before||e.receipt.stockAfter!==l.after||e.receipt.version!==l.expectedVersion+1)failure_('JOURNAL_INVALID');}
 else if(e.receipt.saleId!==command.saleId||e.receipt.state!=='CANCELADA'||!saleInteger_(e.receipt.totalCents)||!['PIX','DINHEIRO','DEBITO','CREDITO'].includes(e.receipt.paymentMethod)||e.lines.some(function(l){return l.after<=l.before;}))failure_('JOURNAL_INVALID');
}
function operationReversals_(events){
 var reversed={};events.filter(function(e){return e.type==='SALE_REVERSED';}).forEach(function(e){var original=events.filter(function(s){return s.type==='SALE_COMMITTED'&&s.idempotencyKey===e.command.saleId&&[2,3].includes(s.version);});
 if(original.length!==1||reversed[e.command.saleId])failure_('JOURNAL_INVALID');var s=original[0];
 if(e.receipt.totalCents!==s.receipt.totalCents||e.receipt.paymentMethod!==s.receipt.paymentMethod||e.lines.length!==s.lines.length||e.receipt.createdAt<s.receipt.createdAt)failure_('JOURNAL_INVALID');
 s.lines.forEach(function(l){var points=e.lines.filter(function(p){return p.id===l.productId;});if(points.length!==1||points[0].after-points[0].before!==l.quantity)failure_('JOURNAL_INVALID');});reversed[e.command.saleId]=e;
 });return reversed;
}
function appendOperation_(ss,e){var journal=saleTable_(ss,'_Eventos_Dominio'),values={ID_Evento:e.idempotencyKey,Tipo:e.type,Chave_Idempotencia:e.idempotencyKey,Hash_Comando:e.commandHash,Conteudo_JSON:JSON.stringify(e),Estado_Projecao:'PENDENTE',Criado_Em:e.receipt.createdAt,Versao_Esquema:1};operationEvent_(e,values);journal.sheet.appendRow(journal.columns.map(function(k){return values[k];}));SpreadsheetApp.flush();recoverSales_(ss);return e.receipt;}
function operationDto_(event,reversed,detail){return {saleId:event.idempotencyKey,actorId:event.actorId,customerId:event.receipt.customerId,createdAt:event.receipt.createdAt,totalCents:event.receipt.totalCents,paymentMethod:event.receipt.paymentMethod,state:reversed[event.idempotencyKey]?'CANCELADA':'CONFIRMADA',items:detail?event.receipt.items.map(function(i){return {productId:i.productId,title:i.title||'',quantity:i.quantity,unitPriceCents:i.unitPriceCents,subtotalCents:i.subtotalCents};}):[]};}
function operationsOperation_(request,c){
 if(!request.actor||!accessHash_(request.actor.sessionTokenHash))failure_('UNAUTHENTICATED');var ss=storage_(c,false).spreadsheet,principal=identitySession_(ss,request.actor.sessionTokenHash,Date.now()).principal,op=request.action.slice('operations.'.length),p=request.payload;
 if(principal.role!=='ATENDENTE')staffAdmin_(principal);
 if(['adjust','reverse'].includes(op)&&!['ADMIN','SUPER_ADMIN'].includes(principal.role))failure_('FORBIDDEN');
 recoverCatalog_(c);recoverSales_(ss);var table=saleTable_(ss,'_Eventos_Dominio'),events=saleObjects_(table).map(function(r){return JSON.parse(r.Conteudo_JSON);}),reversed=operationReversals_(events);
 if(op==='get'||op==='list'){
  var sales=events.filter(function(e){return e.type==='SALE_COMMITTED'&&[2,3].includes(e.version)&&(principal.role!=='ATENDENTE'||e.actorId===principal.id);});
  if(op==='get'){authControlExact_(p,['id']);if(!identityUuid_(p.id))failure_('INVALID_OPERATION');sales=sales.filter(function(e){return e.idempotencyKey===p.id;});if(sales.length!==1)failure_('SALE_NOT_FOUND');}
  else{authControlExact_(p,['from','to','offset']);if(!Number.isSafeInteger(p.offset)||p.offset<0||p.offset>2000)failure_('INVALID_OPERATION');var from=authControlTime_(p.from),to=authControlTime_(p.to);if(to<from||to-from>366*86400000)failure_('INVALID_OPERATION');sales=sales.filter(function(e){var at=Date.parse(e.receipt.createdAt);return at>=from&&at<=to;}).sort(function(a,b){return b.receipt.createdAt.localeCompare(a.receipt.createdAt)||a.idempotencyKey.localeCompare(b.idempotencyKey);});}
  var audit=identityRows_(ss,'Logs_Auditoria');if(audit.rows.length>=5000)failure_('JOURNAL_CAPACITY');accessSaveMain_(audit,{ID_Log:request.requestId,Data_Hora:new Date().toISOString(),ID_Usuario:principal.id,Perfil:principal.role,Acao:op==='get'?'SALE_READ':'SALE_LIST',Entidade:'Vendas',ID_Entidade:op==='get'?p.id:'',Antes:'',Depois:'',Resultado:'SUCESSO',ID_Requisicao:request.requestId});
  if(op==='get')return {sale:operationDto_(sales[0],reversed,true)};var page=sales.slice(p.offset,p.offset+20);return {sales:page.map(function(e){return operationDto_(e,reversed);}),total:sales.length,nextOffset:p.offset+page.length<sales.length?p.offset+page.length:null};
 }
 var command=operationCommand_(op,p),hash=digest_(JSON.stringify(command)),prior=events.filter(function(e){return e.idempotencyKey===command.commandId;});
 if(prior.length){var e=prior[0];if(e.commandHash!==hash||e.actorId!==principal.id||e.type!==(op==='adjust'?'STOCK_ADJUSTED':'SALE_REVERSED'))failure_('IDEMPOTENCY_CONFLICT');return e.receipt;}
 if(table.rows.length>=2000||identityRows_(ss,'Logs_Auditoria').rows.length>=5000)failure_('JOURNAL_CAPACITY');
 if(identityRows_(ss,'Logs_Auditoria').rows.some(function(r){return r.ID_Log===command.commandId;})||catalogJournal_(c).rows.some(function(r){return r.Command_ID===command.commandId;}))failure_('IDEMPOTENCY_CONFLICT');
 var products=catalogProducts_(ss),at=new Date().toISOString(),lines,receipt;
 if(op==='adjust'){var product=products.rows.filter(function(r){return r.ID_Produto===command.id;})[0];if(!product)failure_('PRODUCT_UNAVAILABLE');if(product.Versao_Registro!==command.expectedVersion)failure_('CATALOG_CONFLICT');if(product.Estoque_Atual===command.newStock)failure_('STOCK_NO_CHANGE');
 lines=[{id:command.id,expectedVersion:command.expectedVersion,before:product.Estoque_Atual,after:command.newStock}];receipt={commandId:command.commandId,id:command.id,version:command.expectedVersion+1,stockBefore:product.Estoque_Atual,stockAfter:command.newStock,createdAt:at};}
 else{var matches=events.filter(function(e){return e.type==='SALE_COMMITTED'&&[2,3].includes(e.version)&&e.idempotencyKey===command.saleId;});if(matches.length!==1)failure_('SALE_NOT_FOUND');if(reversed[command.saleId])failure_('OPERATION_CONFLICT');var sale=matches[0];
 lines=sale.lines.map(function(l){var product=products.rows.filter(function(p){return p.ID_Produto===l.productId;})[0];if(!product||product.Versao_Registro>=1000000000||product.Estoque_Atual+l.quantity>1000000)failure_('STOCK_LIMIT');return {id:l.productId,expectedVersion:product.Versao_Registro,before:product.Estoque_Atual,after:product.Estoque_Atual+l.quantity};});
 receipt={commandId:command.commandId,saleId:command.saleId,state:'CANCELADA',totalCents:sale.receipt.totalCents,paymentMethod:sale.receipt.paymentMethod,createdAt:at};}
 return appendOperation_(ss,{version:1,type:op==='adjust'?'STOCK_ADJUSTED':'SALE_REVERSED',idempotencyKey:command.commandId,commandHash:hash,actorId:principal.id,actorRole:principal.role,command:command,lines:lines,receipt:receipt});
}
