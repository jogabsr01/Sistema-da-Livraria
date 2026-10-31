(()=>{'use strict';const ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app';const $=id=>document.getElementById(id),money=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),date=s=>s?new Date(s).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Sem compras confirmadas';let csrf='',userId='',data=null,busy=false,page=0,pending=null,prepared=null,epoch=0;
 const selected=()=>[...document.querySelectorAll('.book-choice:checked')].map(el=>el.value);
 let access=false,previewTimer;
 const online=()=>navigator.onLine!==false;
 function wipeResult(keepPending=false){
  const retained=keepPending?pending:null;epoch++;data=null;pending=retained;prepared=null;page=0;if(!retained)clearTimeout(previewTimer);
  for(const id of ['metrics','niches','books','recommendations','history'])$(id).replaceChildren();
  for(const id of ['customer-name','as-of','frequency','price-band','recommendation-count','consent-note','history-count','page'])$(id).textContent='';
  $('draft').value='';$('profile').hidden=true;$('draft-panel').hidden=true;$('pending-panel').hidden=!retained;
 }
 function clear(keepPending=false){wipeResult(keepPending);csrf='';access=false;$('cpf').value='';$('workspace').hidden=true;}
 function invalidate(){clear(true);controls();}
 function armExpiry(expiresAt){clearTimeout(previewTimer);const delay=Math.max(0,Math.min(300000,expiresAt-Date.now()));previewTimer=setTimeout(()=>{clear();controls();$('status').textContent='A consulta venceu. Os dados e a referência local foram removidos. Confira o acesso e consulte novamente.';},Number.isFinite(delay)?delay:0);}
 function controls(){
  const state=!online()?'offline':access?'ready':'stale';$('insight-connection').dataset.state=state;
  $('insight-connection').textContent=!online()?'Sem conexão. Histórico e texto foram ocultados. Mantenha a aba aberta se houver preparação pendente.':pending?'Há uma preparação aguardando conferência. Reconectar não prepara, copia ou envia texto automaticamente.':access?'Acesso conferido. Consulte o cliente para revisar o histórico e as sugestões atuais.':'Confira a mesma conta administrativa para continuar.';
  for(const el of document.querySelectorAll('#search input,#search button,.book-choice,#previous,#next'))el.disabled=busy||!!pending||!online()||!access;
  const choices=selected();$('prepare').disabled=busy||!!pending||!online()||!access||!data?.messageEligible||choices.length<1||choices.length>3;
  $('copy').disabled=busy||!!pending||!online()||!access||!prepared||!$('draft').value;
  $('retry').disabled=busy||!pending||!online();$('pending-panel').hidden=!pending;
  $('discard-preparation').disabled=busy||!pending;$('reconnect-insight').disabled=busy||!online();
 }
 async function request(path,p){
  if(!online())throw {code:'OFFLINE'};if(location.origin!==ORIGIN)throw {status:403};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...(p?{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(p)}:{})}),out=await response.json();if(!response.ok)throw {status:response.status,code:out.error?.code,field:out.error?.field,readOnly:!p};return out.data;}
  catch(e){if(!e.status||e.status===401||e.status===403)invalidate();throw e;}finally{clearTimeout(timer);}
 }
 async function session(){
  const current=await request('/api/v1/session');
  if(userId&&current.user.id!==userId){invalidate();throw {status:401};}
  if(!['ADMIN','SUPER_ADMIN'].includes(current.user.role)){invalidate();throw {status:403};}
  userId=current.user.id;csrf=current.csrfToken;access=true;document.body.dataset.sessionRole=current.user.role;window.dispatchEvent(new Event('livraria:session-ready'));$('workspace').hidden=false;$('access-help').hidden=true;
 }
 async function api(path,p){return request('/api/v1/'+path,p);}
 function describe(e){ if(e.code==='OFFLINE')return 'Sem conexão. Mantenha a aba aberta se houver preparação pendente.';if(e.code==='CONTEXT_CHANGED')return 'A conexão, a seleção ou o contexto mudou. Esta resposta não foi exibida nem copiada. Confira a referência pendente ou consulte novamente.';if(e.code?.includes('CONTACT_NOT_AUTHORIZED'))return 'A autorização de contato não está válida. Consulte o perfil novamente.';if(e.code?.includes('CHANGED')||e.code?.includes('PREVIEW_EXPIRED'))return 'Os dados mudaram ou a consulta venceu. Consulte novamente para preparar o texto.';if(e.status===401||e.status===403)return 'Confirme seu acesso administrativo com PIN e confirmação pelo aparelho. A consulta exige autenticação recente.';if(e.code?.includes('CAPACITY'))return 'O histórico ultrapassou o limite seguro desta instalação. Solicite a revisão da capacidade.';if(e.code?.includes('NOT_ACTIVATED')||e.code?.includes('UNAVAILABLE'))return 'O perfil de compra ainda não está disponível nesta instalação.';if(e.code?.includes('INVALID'))return 'Confira o CPF e selecione de um a três livros disponíveis.';if(e.status===404)return 'Cliente não encontrado. Confira o cadastro e consulte novamente.';const common = globalThis.LivrariaMessages?.describe(e); if (common) return common;return 'Não foi possível confirmar agora. Confira a conexão e tente novamente.';}
 function failed(e){
  $('status').textContent=describe(e);
  if(e.code==='CONTEXT_CHANGED')clear(true);
  else if(e.code?.includes('CHANGED')||e.code?.includes('PREVIEW_EXPIRED')||e.code?.includes('CONTACT_NOT_AUTHORIZED')||e.code?.includes('INVALID')||e.code?.includes('CONFLICT'))wipeResult();
  else if(e.status===401||e.status===403){clear(true);$('access-help').hidden=false;}
 }
 function metric(name,value){const a=document.createElement('article'),p=document.createElement('p'),n=document.createElement('strong');a.className='metric';p.textContent=name;n.textContent=value;a.append(p,n);$('metrics').append(a);}
 function stat(target,label,value){const p=document.createElement('div'),a=document.createElement('span'),b=document.createElement('strong');p.className='stat';a.textContent=label;b.textContent=value;p.append(a,b);$(target).append(p);}
 function history(){const start=page*25;$('history').replaceChildren();for(const sale of data.history.slice(start,start+25)){const d=document.createElement('details'),s=document.createElement('summary'),label=document.createElement('strong'),amount=document.createElement('span');d.className='history-row';label.textContent=date(sale.at)+' · '+(sale.status==='CONFIRMADA'?'Confirmada':'Estornada');amount.textContent=money(sale.totalCents);s.append(label,amount);d.append(s);for(const item of sale.items){const p=document.createElement('p');p.textContent=item.quantity+' × '+item.title+' · '+money(item.unitPriceCents)+' cada · '+money(item.subtotalCents);d.append(p);}if(sale.reversedAt){const p=document.createElement('p');p.textContent='Estorno em '+date(sale.reversedAt)+'. Valor excluído dos indicadores.';d.append(p);}$('history').append(d);}if(!data.history.length)$('history').textContent='Nenhuma compra identificada neste histórico.';$('history-count').textContent=data.history.length+' compra(s)';$('page').textContent='Página '+(page+1)+' de '+Math.max(1,Math.ceil(data.history.length/25));$('previous').hidden=page===0;$('next').hidden=start+25>=data.history.length;}
 function render(){const s=data.summary;$('customer-name').textContent=data.customer.name;$('as-of').textContent='Consultado em '+new Date(data.generatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});metric('Compras confirmadas',s.confirmedPurchases);metric('Valor em compras',money(s.totalCents));metric('Ticket médio',money(s.averageTicketCents));metric('Livros adquiridos',s.units);$('frequency').textContent=s.confirmedPurchases?'Primeira compra: '+date(s.firstPurchase)+' · Última: '+date(s.lastPurchase)+' · '+(s.averageIntervalDays===null?'Ainda não há duas compras para calcular o intervalo.':'Intervalo médio entre compras: '+s.averageIntervalDays.toLocaleString('pt-BR')+' dia(s).')+' · '+s.reversedPurchases+' estorno(s).':'O cliente ainda não tem compras confirmadas para formar um perfil.';if(data.legacyExcluded)$('frequency').textContent+=' Registros de ensaio técnico não compõem o perfil comercial.';
 for(const n of data.niches)stat('niches',n.name,n.units+' un.');if(!data.niches.length)$('niches').textContent='Sem nichos adquiridos.';for(const p of data.books.slice(0,8))stat('books',p.title,p.units+' un.');if(!data.books.length)$('books').textContent='Sem compras confirmadas.';
 const band=data.priceBand;$('price-band').textContent=band?'Preços pagos por unidade: '+money(band.minCents)+' a '+money(band.maxCents)+'. Sugestões dentro de '+money(band.compatibleMinCents)+' a '+money(band.compatibleMaxCents)+' (margem de 20%).':'A faixa habitual será calculada a partir das compras confirmadas.';$('recommendation-count').textContent=data.recommendationsCount?'Exibindo '+data.recommendations.length+' de '+data.recommendationsCount+' sugestão(ões), por afinidade de nichos e proximidade de preço.':'Nenhuma sugestão atende aos critérios agora.';
 for(const p of data.recommendations){const a=document.createElement('article'),h=document.createElement('h3'),author=document.createElement('p'),price=document.createElement('p'),reason=document.createElement('p');a.className='suggestion';h.textContent=p.title;author.textContent=p.author||'Autor não informado';price.className='price';price.textContent=money(p.priceCents);reason.textContent='Em comum: '+p.niches.map(n=>n.name).join(', ')+' · '+p.stock+' un. disponíveis';a.append(h,author,price,reason);if(data.messageEligible){const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='checkbox';input.className='book-choice';input.value=p.id;span.textContent='Incluir no texto';label.append(input,span);input.addEventListener('change',()=>{if(pending){invalidate();return;}epoch++;prepared=null;$('draft').value='';$('draft-panel').hidden=true;controls();});a.append(label);}$('recommendations').append(a);}
 $('consent-note').textContent=data.messageEligible?'Preferência WhatsApp e autorização registradas. Selecione até três livros para preparar um texto individual.':'A preparação para WhatsApp exige preferência compatível e consentimento de marketing registrado no cadastro.';$('prepare').hidden=!data.messageEligible||!data.recommendations.length;history();$('profile').hidden=false;controls();}
 async function query(e){
  e?.preventDefault();if(busy||pending||!online()||!$('search').reportValidity())return;
  const cpf=$('cpf').value;wipeResult();const current=epoch;busy=true;controls();
  try{
   await session();if(current!==epoch||!online()||document.hidden)throw {code:'CONTEXT_CHANGED'};
   const found=await api('customers/find',{cpf});if(!found.customer)throw {status:404};
   if(current!==epoch||!online()||document.hidden)throw {code:'CONTEXT_CHANGED'};
   const incoming=await api('customer-insights/query',{customerId:found.customer.id});await session();
   if(current!==epoch||!online()||document.hidden||$('cpf').value!==cpf)throw {code:'CONTEXT_CHANGED'};
   data=incoming;render();armExpiry(data.expiresAt);$('status').textContent='Perfil pronto para conferir.';$('access-help').hidden=true;
  }catch(e){failed(e);}finally{busy=false;controls();}
 }
 async function message(copy=false){
  if(busy||!online()||!pending&&!prepared&&!data)return;
  if(!pending){if(prepared)pending=prepared;else{const ids=selected();if(!data?.messageEligible||ids.length<1||ids.length>3)return;pending={commandId:crypto.randomUUID(),customerId:data.customer.id,productIds:ids,sourceSnapshot:data.sourceSnapshot,expiresAt:data.expiresAt,proof:data.proof};}}
  const current=epoch,command=pending;busy=true;controls();
  try{
   await session();if(current!==epoch||pending!==command||!online()||document.hidden)throw {code:'CONTEXT_CHANGED'};
   const result=await api('customer-insights/message',command);await session();
   if(current!==epoch||pending!==command||!online()||document.hidden)throw {code:'CONTEXT_CHANGED'};
   prepared=command;pending=null;$('draft').value=result.text;$('draft-panel').hidden=false;$('status').textContent='Texto preparado. Revise antes de enviar pelo contato autorizado.';
   if(copy){
    try{if(current!==epoch||!online()||document.hidden)return;await navigator.clipboard.writeText(result.text);if(current!==epoch||!online()||document.hidden)return;$('status').textContent='Texto copiado. Revise e envie manualmente pelo contato autorizado.';}
    catch{if(current!==epoch||!online()||document.hidden)return;$('draft').focus();$('draft').select();$('status').textContent='Selecione e copie o texto para continuar.';}
   }
  }catch(e){failed(e);}finally{busy=false;controls();}
 }
 $('search').addEventListener('submit',query);$('clear').addEventListener('click',()=>{if(busy||pending)return;wipeResult();$('cpf').value='';$('status').textContent='Consulte outro cliente.';controls();});$('cpf').addEventListener('input',()=>{if(pending){invalidate();return;}wipeResult();controls();});$('prepare').addEventListener('click',()=>message());$('copy').addEventListener('click',()=>message(true));$('retry').addEventListener('click',()=>message());$('previous').addEventListener('click',()=>{if(data&&!busy&&!pending&&page){page--;history();}});$('next').addEventListener('click',()=>{if(data&&!busy&&!pending){page++;history();}});
 $('discard-preparation').addEventListener('click',()=>{if(busy||!pending)return;clear();controls();$('status').textContent='Referência descartada nesta página. Preparações anteriores permanecem na auditoria. Confira o acesso e consulte novamente.';refresh(false);});
 $('reconnect-insight').addEventListener('click',()=>refresh());
 async function refresh(announce=true){
  if(busy||document.hidden||!online()){controls();return;}const recovering=!access;
  try{await session();if(announce&&recovering&&!data&&!prepared)$('status').textContent=pending?'Acesso conferido. Confira a preparação pendente.':'Informe o CPF para consultar o perfil de compra.';}
  catch(e){failed(e);}finally{controls();}
 }
 window.addEventListener('focus',()=>refresh());window.addEventListener('offline',invalidate);window.addEventListener('online',()=>{invalidate();refresh();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else refresh();});window.addEventListener('pagehide',invalidate);window.addEventListener('pageshow',e=>{if(e.persisted){invalidate();refresh();}});
 window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue='';}});setInterval(()=>refresh(false),60000);
 if(location.origin===ORIGIN)refresh();else{$('status').textContent='Esta tela funciona exclusivamente no endereço DEV autorizado.';controls();}
})();
