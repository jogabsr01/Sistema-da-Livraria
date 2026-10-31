'use strict';
(()=>{
 const $=id=>document.getElementById(id),ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app';
 const operations={IDENTITY_RECOVERY_CODES_ISSUED:'Geração de códigos de recuperação',IDENTITY_PASSKEY_RECOVERED:'Recuperação de passkeys',IDENTITY_PASSKEY_ADDED:'Cadastro de passkey adicional',IDENTITY_PASSKEY_REMOVED:'Remoção de passkey',CUSTOMER_INSIGHTS_VIEW:'Consulta de perfil de compra',CUSTOMER_MESSAGE_PREPARED:'Preparação de mensagem para cliente',COMMERCIAL_REPORT_VIEW:'Consulta de relatório comercial',COMMERCIAL_REPORT_EXPORT:'Exportação de relatório comercial',IDENTITY_ACCESS_DENIED:'Acesso negado',IDENTITY_AUTH_BLOCKED:'Bloqueio temporário de acesso',IDENTITY_PROOF_BLOCKED:'Prova de e-mail bloqueada',IDENTITY_LOGOUT:'Saída da conta',IDENTITY_SESSIONS_REVOKED:'Revogação de outras sessões',IDENTITY_ACTIVATE:'Primeiro acesso',IDENTITY_LOGIN:'Entrada na conta',IDENTITY_PIN_RECOVER:'Recuperação do PIN',IDENTITY_EMAIL_CHANGE:'Alteração verificada de e-mail',PROFILE_UPDATE:'Alteração do perfil',STAFF_CREATE:'Cadastro de funcionário',STAFF_UPDATE:'Alteração de funcionário',STAFF_LIST:'Consulta da equipe',CUSTOMER_CREATE:'Cadastro de cliente',CUSTOMER_UPDATE:'Alteração de cliente',CUSTOMER_READ:'Consulta de cliente',PRODUCT_CREATE:'Cadastro de livro',PRODUCT_UPDATE:'Alteração de livro',STOCK_RECEIVED:'Entrada de estoque',STOCK_ADJUSTED:'Correção de estoque',SALE_COMMITTED:'Venda concluída',SALE_REJECTED:'Venda recusada',SALE_REVERSED:'Estorno integral',SALE_LIST:'Consulta de vendas',SALE_READ:'Consulta de venda',NICHE_CREATE:'Criação de nicho',NICHE_UPDATE:'Alteração de nicho',SCHEDULE_CREATE:'Rascunho de escala',SCHEDULE_UPDATE:'Alteração de escala',SCHEDULE_PUBLISH:'Publicação de escala',SCHEDULE_CANCEL:'Cancelamento de escala',STOCK_ALERT_OPENED:'Alerta de estoque aberto',STOCK_ALERT_RESOLVED:'Alerta de estoque resolvido',STOCK_ALERT_STATE:'Atendimento de alerta',STOCK_REPORT_VIEW:'Consulta do relatório de reposição',STOCK_REPORT_EXPORT:'Exportação do relatório de reposição',AUDIT_EXPORT:'Exportação da auditoria'};
 const fields={reportType:'Relatório',revokedSessions:'Sessões revogadas',retryAfterSeconds:'Espera (segundos)',phase:'Etapa',priceCents:'Preço de venda',minimumStock:'Estoque mínimo',year:'Ano',pages:'Páginas',hasPhoto:'Tem foto privada',hasExternalCover:'Tem capa externa',coverChanged:'Capa alterada',synopsisChanged:'Sinopse alterada',isbn:'ISBN',internalCode:'Código interno',author:'Autor',publisher:'Editora',edition:'Edição',supplier:'Fornecedor',category:'Categoria',nicheIds:'Nichos',version:'Versão',revision:'Revisão',stock:'Estoque',quantity:'Quantidade',totalCents:'Valor total',authorizationVersion:'Versão de autorização',notifications:'Notificações',count:'Registros',sourceCount:'Registros na origem',order:'Ordem',otherSessionsRevoked:'Outras sessões revogadas',avatarChanged:'Foto alterada',emailVerified:'E-mail verificado',reasonRecorded:'Justificativa registrada',reenrollmentRequired:'Novo primeiro acesso exigido',found:'Encontrado',marketingConsent:'Consentimento de marketing',imageChanged:'Imagem alterada',descriptionChanged:'Descrição alterada',notesChanged:'Conteúdo da escala alterado',active:'Ativo',employeeId:'Funcionário',customerId:'ID do cliente',role:'Perfil',status:'Situação',paymentMethod:'Pagamento',code:'Código do resultado',state:'Situação',reason:'Motivo',date:'Data',start:'Início',end:'Fim',color:'Cor',name:'Nome',items:'Itens',lines:'Movimentos',productId:'ID do produto',title:'Título',unitPriceCents:'Preço unitário',subtotalCents:'Subtotal',id:'ID',expectedVersion:'Versão anterior',before:'Saldo anterior',after:'Saldo posterior'};
 const values={SALES:'Vendas e faturamento',STOCK:'Posição de estoque',MOVEMENTS:'Movimentações',LOGIN:'Entrada na conta',START:'Primeiro acesso',RECOVER:'Recuperação',EMAIL:'Confirmação de e-mail',PIN:'Definição do PIN',OPTIONS:'Preparação da passkey',COMPLETE:'Verificação da passkey',LIMITER:'Limite de tentativas',CREDENTIALS_REJECTED:'Credenciais não confirmadas',EMAIL_PROOF_REJECTED:'Código de e-mail não confirmado',PASSKEY_REJECTED:'Passkey não confirmada',FLOW_REJECTED:'Fluxo de acesso recusado',ACCOUNT_LIMIT:'Limite por identificador',ORIGIN_LIMIT:'Limite por origem',ACCOUNT_AND_ORIGIN_LIMIT:'Limite por identificador e origem',EMAIL_PROOF_LIMIT:'Limite de confirmação de e-mail'};
 const entities={Autenticacao:'Autenticação',Usuarios:'Equipe',Logs_Auditoria:'Auditoria',Notificacoes:'Notificações'};
 const results={BLOQUEADO:'Bloqueado',SUCESSO:'Sucesso',NEGADO:'Negado',FALHA:'Falha',ERRO:'Erro'};
 let csrf='',userId='',offset=0,data=null,filters=null,pending=null,busy=false,urls=new Set();
 let access=false,version=0,viewTimer;
 const online=()=>navigator.onLine!==false;
 function invalidate(){version++;clear(true);controls();}
 function armRetention(){clearTimeout(viewTimer);viewTimer=setTimeout(()=>{version++;clear();controls();$('status').textContent='A visualização e a referência local foram encerradas após cinco minutos. Autorizações já registradas permanecem no histórico. Confira o acesso para consultar novamente.';},300000);}
 function day(){const p=new Intl.DateTimeFormat('en',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>p.find(v=>v.type===k).value).join('-');}
 function describe(e){ if(e.code==='OFFLINE')return 'Sem conexão. Mantenha a aba aberta se houver exportação pendente.';if(e.code==='CONTEXT_CHANGED')return 'A conexão ou o contexto mudou. Esta resposta não gerou arquivo nem resultados; confira a referência pendente ou faça uma nova consulta.';if(e.status===401||e.status===403)return 'Confirme seu acesso administrativo com PIN e confirmação pelo aparelho. A consulta exige autenticação recente.';if(e.code?.includes('CHANGED'))return 'O histórico mudou desde a consulta. Atualize os resultados antes de continuar.';if(e.code?.includes('EXPORT_LIMIT'))return 'Reduza o período ou refine os filtros: a exportação admite até 500 registros e 30 mil campos de detalhes.';if(e.code?.includes('CAPACITY'))return 'O resultado ultrapassou o limite seguro. Reduza o período ou os filtros.';if(e.code?.includes('NOT_ACTIVATED')||e.code?.includes('UNAVAILABLE'))return 'A auditoria ainda não está disponível nesta instalação.';if(e.code?.includes('INVALID'))return 'Confira as datas e os identificadores. Consulte até um ano por vez.';if(e.code?.includes('CONFLICT'))return 'Este pedido não corresponde à exportação anterior. Atualize a consulta.';const common = globalThis.LivrariaMessages?.describe(e); if (common) return common;return 'Não foi possível confirmar agora. Confira a conexão e tente novamente.';}
 function clear(keepPending=false){
  const retained=keepPending?pending:null;csrf='';access=false;data=null;filters=null;pending=retained;offset=0;if(!retained)clearTimeout(viewTimer);
  $('records').replaceChildren();$('detail-content').replaceChildren();$('count').textContent='';
  for(const id of ['employee','operation','result'])$(id).replaceChildren(new Option('Todos',''));
  $('product').value='';$('sale').value='';$('audit').hidden=true;$('export-audit').hidden=true;$('export-retry').hidden=!retained;
  if($('detail').open)$('detail').close();for(const url of urls)URL.revokeObjectURL(url);urls.clear();
 }
 function clearResult(){data=null;$('records').replaceChildren();$('detail-content').replaceChildren();if($('detail').open)$('detail').close();$('export-audit').hidden=true;$('next').hidden=true;$('previous').hidden=true;}
 async function fetchData(path,body,responseOnly=false){
  if(!online())throw {code:'OFFLINE'};if(location.origin!==ORIGIN)throw {status:403};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
   const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body?{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)}:{})});
   if(!response.ok){const out=await response.json();throw {status:response.status,code:out.error?.code,field:out.error?.field,readOnly:!body};}
   return responseOnly?response:(await response.json()).data;
  }catch(e){if(!e.status||e.status===401||e.status===403)invalidate();throw e;}finally{clearTimeout(timer);}
 }
 async function session(){
  const current=await fetchData('/api/v1/session');
  if(userId&&userId!==current.user.id){invalidate();throw {status:401};}
  if(!['ADMIN','SUPER_ADMIN'].includes(current.user.role)){invalidate();throw {status:403};}
  userId=current.user.id;csrf=current.csrfToken;access=true;document.body.dataset.sessionRole=current.user.role;window.dispatchEvent(new Event('livraria:session-ready'));
 }
 async function request(op,body){return fetchData('/api/v1/audit/'+op,body,!!body);}
 function dirty(){try{return !filters||JSON.stringify(readFilters())!==JSON.stringify(filters);}catch{return true;}}
 function controls(){
  const state=!online()?'offline':access?'ready':'stale';$('audit-connection').dataset.state=state;
  $('audit-connection').textContent=!online()?'Sem conexão. Os registros e detalhes foram ocultados. Mantenha a aba aberta se houver uma exportação pendente.':pending?'Há uma exportação aguardando conferência. Reconectar não baixa o arquivo automaticamente.':access?'Acesso conferido. Atualize a consulta para conferir o histórico atual.':'Confira a mesma conta administrativa para continuar.';
  for(const el of document.querySelectorAll('#filters input,#filters select,#filters button,#previous,#next,#export-audit'))el.disabled=busy||!!pending||!online()||!access;
  if(data)$('export-audit').disabled=busy||!!pending||!online()||!access||dirty()||data.total===0||data.total>500;
  $('retry-export').disabled=busy||!pending||!online();$('discard-export').disabled=busy||!pending;$('reconnect-audit').disabled=busy||!online();$('export-retry').hidden=!pending;
 }
 function readFilters(){const from=new Date($('from').value+'T00:00:00-03:00'),end=new Date($('to').value+'T00:00:00-03:00');end.setUTCDate(end.getUTCDate()+1);return {from:from.toISOString(),to:new Date(end.getTime()-1).toISOString(),employeeId:$('employee').value,operation:$('operation').value,productId:$('product').value.trim().toLowerCase(),saleId:$('sale').value.trim().toLowerCase(),result:$('result').value};}
 function options(id,list,label){const selected=$(id).value;$(id).replaceChildren(new Option('Todos',''),...list.map(v=>new Option(label(v),typeof v==='string'?v:v.id)));$(id).value=selected;}
 function render(){options('employee',data.people,p=>p.name);options('operation',data.operations,v=>operations[v]||v);options('result',data.results,v=>results[v]||v);$('records').replaceChildren();for(const r of data.items){const card=document.createElement('article');card.className='audit-record';const content=document.createElement('div'),h=document.createElement('h3'),p=document.createElement('p'),meta=document.createElement('p'),badge=document.createElement('span'),time=document.createElement('time'),button=document.createElement('button');h.textContent=operations[r.operation]||r.operation;p.textContent=(data.people.find(p=>p.id===r.actorId)?.name||r.actorId)+' · '+(entities[r.entity]||r.entity);badge.className='result'+(r.result==='SUCESSO'?'':' denied');badge.textContent=results[r.result]||r.result;time.dateTime=r.at;time.textContent=new Date(r.at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});meta.append(badge,time);content.append(h,p,meta);button.textContent='Ver detalhes';button.type='button';button.className='secondary';button.addEventListener('click',()=>detail(r));card.append(content,button);$('records').append(card);}if(!data.items.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Nenhum registro encontrado neste período e com estes filtros.';$('records').append(empty);}$('count').textContent=data.total+' registro(s) · Página '+(Math.floor(offset/25)+1);$('previous').hidden=offset===0;$('next').hidden=data.nextOffset===null;$('audit').hidden=false;$('export-audit').hidden=false;$('export-note').textContent=data.total>500?'Há mais de 500 registros. Refine os filtros para exportar todo o resultado.':'O Excel contém todo o resultado dos filtros, com alterações em uma aba separada.';}
 function pair(dl,key,value){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dl.append(dt,dd);}
 function detail(r){$('detail-content').replaceChildren();const dl=document.createElement('dl');dl.className='detail-grid';for(const[k,v]of [['Registro',r.id],['Data e hora',new Date(r.at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})],['Responsável',data.people.find(p=>p.id===r.actorId)?.name||r.actorId],['ID do responsável',r.actorId],['Perfil no evento',r.role],['Operação',operations[r.operation]||r.operation],['Entidade',entities[r.entity]||r.entity],['ID da entidade',r.entityId||'Não se aplica'],['Resultado',results[r.result]||r.result],['Requisição',r.requestId]])pair(dl,k,v);$('detail-content').append(dl);
  function flatten(target,v,path=[]){for(const[k,value]of Object.entries(v)){const label=[...path,fields[k]||(/^\d+$/.test(k)?String(Number(k)+1):k)];if(value&&typeof value==='object')flatten(target,value,label);else pair(target,label.join(' / '),typeof value==='boolean'?value?'Sim':'Não':k.endsWith('Cents')?(value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):values[value]||String(value));}}
  for(const[group,value]of [['Antes',r.before],['Depois',r.after]]){const section=document.createElement('section'),h=document.createElement('h3'),changes=document.createElement('dl');section.className='changes';h.textContent=group;changes.className='detail-grid';flatten(changes,value);if(!changes.children.length)pair(changes,'Detalhamento','Nenhum campo disponível neste registro.');section.append(h,changes);$('detail-content').append(section);}if(r.detailsOmitted){const p=document.createElement('p');p.className='privacy-note';p.textContent='Parte do conteúdo original foi omitida por proteção de dados ou por não pertencer ao contrato de consulta.';$('detail-content').append(p);}$('detail').showModal();}
 async function load(reset=false){
  if(busy||pending)return;
  if(!online()){$('status').textContent='Sem conexão. Confira o acesso ao reconectar para consultar o histórico.';controls();return;}
  if(!$('filters').reportValidity())return;
  const ticket=version,requestedOffset=reset?0:offset,snapshot=reset?'':data?.snapshot||'';
  let selected;busy=true;controls();
  try{
   selected=reset?readFilters():filters;clearResult();await session();
   if(ticket!==version||!online()||document.hidden)throw {code:'CONTEXT_CHANGED'};
   const query=new URLSearchParams({...selected,offset:String(requestedOffset),snapshot}),incoming=await request('list?'+query);await session();
   if(ticket!==version||!online()||document.hidden||JSON.stringify(selected)!==JSON.stringify(readFilters()))throw {code:'CONTEXT_CHANGED'};
   filters=selected;offset=requestedOffset;data=incoming;render();armRetention();$('access-help').hidden=true;$('status').textContent='Histórico consultado com segurança.';
  }catch(e){
   $('status').textContent=describe(e);
   if(e.status===401||e.status===403){clear(true);$('access-help').hidden=false;}
   else if(e.code?.includes('CHANGED')){clearResult();$('count').textContent='Atualize para consultar o histórico atual.';}
  }finally{busy=false;controls();}
 }
 async function exportFile(){
  if(busy||!online()||!pending&&(!access||!data||dirty()))return;
  if(!pending)pending={commandId:crypto.randomUUID(),filters:{...filters},snapshot:data.snapshot};
  const command=pending,ticket=version;busy=true;controls();
  try{
   await session();if(ticket!==version||pending!==command||!online()||document.hidden)throw {code:'CONTEXT_CHANGED'};
   const response=await request('export',command),blob=await response.blob();await session();
   if(ticket!==version||pending!==command||!online()||document.hidden)throw {code:'CONTEXT_CHANGED'};
   const url=URL.createObjectURL(blob);urls.add(url);const link=document.createElement('a');link.href=url;link.download='auditoria-livraria-'+command.commandId+'.xlsx';document.body.append(link);link.click();link.remove();
   setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},10000);pending=null;clearResult();$('audit').hidden=false;$('count').textContent='Exportação concluída. Atualize os resultados.';$('status').textContent='Arquivo Excel preparado. A exportação foi registrada no histórico. Atualize para consultar novamente.';
  }catch(e){
   $('status').textContent=describe(e);
   if(e.status===401||e.status===403){clear(true);$('access-help').hidden=false;}
   else if(e.code==='CONTEXT_CHANGED')clear(true);
   else if(e.code?.includes('CHANGED')||e.code?.includes('INVALID')||e.code?.includes('CONFLICT')){pending=null;clearResult();$('audit').hidden=!access;}
  }finally{busy=false;controls();}
 }
 $('filters').addEventListener('input',controls);$('filters').addEventListener('change',controls);
 $('filters').addEventListener('submit',e=>{e.preventDefault();load(true);});$('refresh').addEventListener('click',()=>load(true));$('next').addEventListener('click',()=>{if(data){offset=data.nextOffset;load();}});$('previous').addEventListener('click',()=>{offset=Math.max(0,offset-25);load();});$('export-audit').addEventListener('click',exportFile);$('retry-export').addEventListener('click',exportFile);$('close-detail').addEventListener('click',()=>{$('detail').close();$('detail-content').replaceChildren();});
 $('discard-export').addEventListener('click',()=>{if(busy||!pending)return;version++;clear();controls();$('status').textContent='Referência descartada nesta página. A autorização anterior permanece no histórico. Confira o acesso para consultar novamente.';check();});
 $('reconnect-audit').addEventListener('click',()=>check());
 async function check(announce=true){
  if(document.hidden||busy||!online()){controls();return;}const recovering=!access;
  try{await session();$('audit').hidden=false;$('access-help').hidden=true;if(announce&&recovering)$('status').textContent=pending?'Acesso conferido. Confira a referência de exportação pendente.':'Acesso conferido. Atualize para consultar o histórico.';}
  catch(e){clear(true);$('access-help').hidden=false;$('status').textContent=describe(e);}finally{controls();}
 }
 window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue='';}});
 window.addEventListener('pagehide',invalidate);window.addEventListener('pageshow',e=>{if(e.persisted){invalidate();check();}});
 window.addEventListener('offline',invalidate);window.addEventListener('online',()=>{invalidate();check();});
 window.addEventListener('focus',()=>check());document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else check();});setInterval(()=>check(false),60000);
 const end=day(),start=new Date(end+'T12:00Z');start.setUTCDate(start.getUTCDate()-30);$('from').value=start.toISOString().slice(0,10);$('to').value=end;if(location.origin===ORIGIN)load(true);
})();
