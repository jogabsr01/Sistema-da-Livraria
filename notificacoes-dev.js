(() => {
  'use strict';
  const $ = id => document.getElementById(id), ORIGIN = (globalThis.LivrariaOrigin?.current(location.origin)||'https://dev--merry-chimera-49a1f3.netlify.app');
  const labels = { ABERTA:'Aberta', EM_ATENDIMENTO:'Em atendimento', RESOLVIDA:'Resolvida' };
  const date = value => new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  let csrf = '', userId = '', admin = false, offset = 0, nextOffset = null, busy = false, loading = false, refreshAgain = false, report = null;
  let access = false, available = false, ready = false, checkedAt = 0, version = 0, pending = null, expiryTimer, reportTimer;
  let supplierItem = null, supplierCommand = null;
  const online = () => navigator.onLine !== false;
  const fresh = () => ready && online() && access && performance.now() - checkedAt < 90000;
  function controls() {
    const state=!online()?'offline':fresh()?'ready':loading?'checking':'stale';
    $('notification-connection').dataset.state=state;
    $('notification-connection').textContent=!online()?'Sem conexão.':pending?'Atualização pendente.':fresh()?'Alertas atualizados.':loading?'Atualizando…':'Atualize os alertas.';
    $('pending-update').hidden=!pending;
    $('pending-description').textContent=pending?(access?(pending.operation==='state'?'Situação compartilhada':'Leitura pessoal')+' · '+pending.title+'. Mantenha esta aba aberta até conferir.':'Entre novamente na mesma conta para conferir a atualização original. Mantenha esta aba aberta.'):'';
    document.querySelectorAll('button').forEach(button=>{button.disabled=busy||loading||!online();});
    $('retry-update').disabled=busy||loading||!online()||!access||!pending||pending.operation==='state'&&!admin;
    document.querySelectorAll('#alerts button').forEach(button=>{button.disabled=busy||loading||!!pending||!fresh();if(button.dataset.administrative)button.hidden=!admin;});
    $('generate').disabled=busy||loading||!!pending||!online()||!access||!admin||!available;
    for(const id of ['export','print','copy'])$(id).disabled=busy||loading||!!pending||!online()||!access||!admin||!report;
    $('scope').disabled=busy; $('supplier').disabled=busy;
    $('report-tools').hidden=!admin||!access||!available;
  }
  function revokeView() {
    access=false;admin=false;available=false;clearReport();$('alerts').replaceChildren();$('unread').textContent='';$('notifications').hidden=true;
    $('supplier').replaceChildren(new Option('Todos os fornecedores','null'));
  }
  function invalidate() { const hadReport=!!report;version++;ready=false;clearTimeout(expiryTimer);clearReport();if(hadReport)$('report-status').textContent='Relatório ocultado. Confira a conexão e gere novamente para revisar os dados atuais.';controls(); }
  async function requestData(path,body) {
    if(!online())throw Object.assign(Error('OFFLINE'),{code:'OFFLINE'});
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try {
      const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body?{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)}:{})});
      const result=await response.json();if(!response.ok)throw Object.assign(Error('REQUEST_FAILED'),{code:result.error?.code,field:result.error?.field,readOnly:!body,status:response.status});return result.data;
    } catch(error) {if(error.status===401||error.status===403)revokeView();if(!error.status||error.status===401||error.status===403)invalidate();throw error;}
    finally {clearTimeout(timer);}
  }
  async function api(operation, body, query = '') {
    return requestData('/api/v1/notifications/'+operation+query,body);
  }
  function explain(error) { const common = globalThis.LivrariaMessages?.describe(error); if (common) return common;
    if(error.code==='OFFLINE')return 'Sem conexão. Mantenha a aba aberta e confira novamente ao reconectar.';
    if (error.status === 401 || error.status === 403) return 'Sua sessão ou perfil não permite esta operação. Entre novamente e confira seu acesso.';
    if (error.code?.includes('CAPACITY')) return 'O limite seguro foi atingido. Não foi gerado um relatório parcial. Filtre por fornecedor ou solicite a revisão da capacidade.';
    if (error.code?.includes('NOT_ACTIVATED') || error.code === 'WORKSPACE_NOTIFICATIONS_UNAVAILABLE') return 'As notificações ainda não foram habilitadas nesta instalação.';
    return 'Não foi possível confirmar a operação. Atualize para conferir o estado antes de tentar novamente.';
  }
  async function session() {
    const data=await requestData('/api/v1/session');
    if(userId&&userId!==data.user.id){revokeView();invalidate();throw Object.assign(Error('SESSION_CHANGED'),{status:401});}
    userId=data.user.id;csrf=data.csrfToken;admin=['ADMIN','SUPER_ADMIN'].includes(data.user.role);access=true;document.body.dataset.sessionRole=data.user.role;window.dispatchEvent(new Event('livraria:session-ready'));
    $('report-tools').hidden = !admin||!available; if (!admin) clearReport();
  }
  function clearReport() {clearTimeout(reportTimer);report=null;$('report').hidden=true;$('report-groups').replaceChildren();$('report-summary').replaceChildren();$('draft-label').hidden=true;$('draft').value='';['export','print','copy'].forEach(id=>$(id).disabled=true);}
  async function refresh() {
    if(location.origin!==ORIGIN){$('status').textContent='Esta tela funciona exclusivamente no endereço autorizado.';return;}
    if(document.hidden||!online()){controls();if(!online())$('status').textContent='Sem conexão. O acesso será conferido ao reconectar.';return;}
    if (loading||busy) { refreshAgain = true; return; } loading = true;ready=false;clearTimeout(expiryTimer);clearReport();controls();
    const ticket=version,filter=JSON.stringify([offset,$('history').checked]);
    try {
      const data=await api('bootstrap',null,'?'+new URLSearchParams({offset:String(offset),history:String($('history').checked)})),summary=data.summary;
      if(userId&&userId!==data.user.id){revokeView();invalidate();throw Object.assign(Error('SESSION_CHANGED'),{status:401});}
      userId=data.user.id;csrf=data.csrfToken;admin=['ADMIN','SUPER_ADMIN'].includes(data.user.role);access=true;document.body.dataset.sessionRole=data.user.role;window.dispatchEvent(new Event('livraria:session-ready'));

      if(ticket!==version||filter!==JSON.stringify([offset,$('history').checked])||!online()||document.hidden)return;
      $('unread').textContent = '(' + summary.unread + ' não lida(s))'; $('alerts').replaceChildren(); nextOffset = data.nextOffset;
      if (!data.items.length) { const p = document.createElement('p'); p.textContent = 'Nenhum alerta neste filtro.'; $('alerts').append(p); }
      for (const item of data.items) {
        const card = document.createElement('article'); card.className = 'book alert'; card.dataset.id = item.id;
        const title = document.createElement('h3'), info = document.createElement('p'), since = document.createElement('p'), tools = document.createElement('div'); tools.className = 'toolbar';
        title.textContent = item.title; info.textContent = (item.type === 'STOCK_ZERO' ? 'Sem estoque' : 'Abaixo do mínimo') + ' · Saldo atual: ' + item.stock + ' · Mínimo: ' + item.minimumStock + ' · ' + labels[item.state] + (item.read ? ' · Lida' : ' · Não lida');
        const maintenance=item.type==='MAINTENANCE_COMPLETED',schedule=item.type.startsWith('SCHEDULE_');if(schedule||maintenance)info.textContent=item.message+' · '+(item.read?'Lida':'Não lida');
        since.textContent = 'Alerta desde ' + date(item.createdAt) + (item.resolvedAt ? ' · Resolvido em ' + date(item.resolvedAt) : '');
        const link = document.createElement('a'); link.href = maintenance?'/auditoria-dev.html':schedule?'/escalas-dev.html?data='+item.date+'&escala='+item.scheduleId:'/catalogo-dev.html?livro=' + item.productId; link.textContent = maintenance?'Conferir auditoria':schedule?'Abrir minha escala':'Abrir livro'; tools.append(link);
        if (!schedule&&!maintenance&&item.state !== 'RESOLVIDA') { const receive = document.createElement('a'); receive.href = '/catalogo-dev.html?entrada=' + item.productId; receive.textContent = 'Adicionar unidades'; tools.append(receive); }
        if (!item.read) {
          const read = document.createElement('button'); read.type = 'button'; read.className = 'secondary'; read.textContent = 'Marcar como lida'; read.disabled = busy;
          read.addEventListener('click', () => mutate('read',{id:item.id},item.title)); tools.append(read);
        }
        if (!schedule&&!maintenance&&admin && item.state !== 'RESOLVIDA') {
          const state = document.createElement('button'); state.type = 'button'; state.dataset.administrative='true';state.textContent = item.state === 'ABERTA' ? 'Marcar em atendimento' : 'Voltar para aberta'; state.disabled = busy;
          const command = {commandId:crypto.randomUUID(),id:item.id,state:item.state === 'ABERTA' ? 'EM_ATENDIMENTO' : 'ABERTA'};
          state.addEventListener('click', () => mutate('state',command,item.title)); tools.append(state);
        }
        card.append(title,info,since,tools); $('alerts').append(card);
      }
      $('previous').hidden = offset === 0; $('next').hidden = nextOffset === null;
      $('status').textContent = '';
      available=true;ready=true;checkedAt=performance.now();$('notifications').hidden=false;expiryTimer=setTimeout(()=>{ready=false;controls();},90000);
    } catch (error) { $('status').textContent = explain(error); if(error.code?.includes('NOT_ACTIVATED')||error.code==='WORKSPACE_NOTIFICATIONS_UNAVAILABLE'){available=false;$('notifications').hidden=true;} if (error.status === 401 || error.status === 403) { $('notifications').hidden = true; $('report-tools').hidden = true; clearReport(); } }
    finally { loading = false;controls(); if (refreshAgain) { refreshAgain = false; refresh(); } }
  }
  async function mutate(operation,body,title='') {
    if(busy||loading||!online()||!access||!pending&&!fresh())return;
    if(!pending&&(!operation||!body))return;
    if(!pending)pending={operation,body:structuredClone(body),title,uncertain:false};
    busy=true;clearReport();controls();let accepted=false;
    try {
      await session();if(pending.operation==='state'&&!admin)throw Object.assign(Error('FORBIDDEN'),{status:403,code:'FORBIDDEN'});
      await api(pending.operation,pending.body);pending=null;accepted=true;window.dispatchEvent(new Event('livraria:notifications-changed'));
    } catch(error) {
      $('status').textContent=explain(error);
      const rejected=['INVALID_NOTIFICATION','WORKSPACE_INVALID_NOTIFICATION','WORKSPACE_NOTIFICATION_NOT_FOUND','WORKSPACE_NOTIFICATION_CONFLICT','FORBIDDEN','WORKSPACE_FORBIDDEN'].includes(error.code);
      if(pending){if(rejected&&!pending.uncertain)pending=null;else pending.uncertain=true;}
    } finally {busy=false;controls();}
    if(accepted){refreshAgain=false;await refresh();$('status').textContent='Atualização confirmada.'+(fresh()?' Alertas conferidos.':' Não foi possível atualizar a lista. Confira a conexão antes de continuar.');}
    else if(refreshAgain){refreshAgain=false;refresh();}
  }
  function showReport(data) {
    report = data; $('report').hidden = false; $('draft-label').hidden = true; $('draft').value = '';
    $('report-summary').replaceChildren();
    for(const [label,value] of [['Livros para repor',data.totalBooks],['Unidades sugeridas',data.suggestedUnits]]){const card=document.createElement('div'),name=document.createElement('span'),number=document.createElement('strong');card.className='report-metric';name.textContent=label;number.textContent=String(value);card.append(name,number);$('report-summary').append(card);}
    $('report-groups').replaceChildren();
    for (const group of data.groups) {
      const section = document.createElement('section'), title = document.createElement('h3'), scroll = document.createElement('div'), table = document.createElement('table');
      title.textContent = group.supplier || 'Fornecedor não informado'; scroll.className = 'report-scroll'; scroll.tabIndex = 0; scroll.setAttribute('aria-label','Livros de '+title.textContent);
      const head = document.createElement('thead'), header = document.createElement('tr');
      ['Livro','Fornecedor','ISBN / código','Saldo','Mínimo','Qtd. sugerida','Ações'].forEach(name => { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = name; header.append(cell); }); head.append(header);
      const body = document.createElement('tbody');
      for (const item of group.items) {
        const row = document.createElement('tr');
        const book=document.createElement('td'),cover=document.createElement('img'),name=document.createElement('span');book.className='report-book';cover.src='/api/v1/catalog/cover?id='+encodeURIComponent(item.id);cover.alt='';cover.loading='lazy';cover.addEventListener('error',()=>cover.remove());name.textContent=item.title;book.append(cover,name);row.append(book);
        [group.supplier || 'Não informado',item.isbn || item.internalCode,item.stock,item.minimumStock,item.suggestedQuantity].forEach(value => { const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell); });
        const actions=document.createElement('td');if(!group.supplier){const button=document.createElement('button');button.type='button';button.className='secondary supplier-action no-print';button.textContent='+ Vincular fornecedor';button.addEventListener('click',()=>openSupplier(item));actions.append(button);}row.append(actions);body.append(row);
      }
      table.append(head,body); scroll.append(table); section.append(title,scroll); $('report-groups').append(section);
    }
    if (!data.totalBooks) $('report-groups').textContent = 'Nenhum livro precisa de reposição neste filtro.';
    if ($('supplier').value === 'null') {
      $('supplier').replaceChildren(new Option('Todos os fornecedores','null'));
      data.groups.forEach(group => $('supplier').append(new Option(group.supplier || 'Fornecedor não informado',JSON.stringify(group.supplier))));
    }
    ['export','print','copy'].forEach(id => $(id).disabled = false);
    reportTimer=setTimeout(()=>{clearReport();$('report-status').textContent='O prazo de revisão terminou. Gere novamente para conferir os dados atuais.';controls();},90000);
  }
  function openSupplier(item) {
    if(!report||busy||!access||!admin||!online())return;
    clearTimeout(reportTimer);supplierItem=item;supplierCommand=null;$('supplier-book').textContent=item.title;$('supplier-name').value='';$('supplier-status').textContent='';
    $('supplier-options').replaceChildren();
    for(const group of report.groups)if(group.supplier){const option=document.createElement('option');option.value=group.supplier;$('supplier-options').append(option);}
    $('supplier-dialog').showModal();$('supplier-name').focus();
  }
  async function saveSupplier(event) {
    event.preventDefault();if(busy||!supplierItem||(!report&&!supplierCommand)||!online())return;
    const name=$('supplier-name').value.trim();if(!name||name.length>160||/^[=+@-]|[\x00-\x1f\x7f]/.test(name)){$('supplier-status').textContent='Informe um nome de fornecedor válido.';return;}
    if(supplierCommand&&supplierCommand.record.supplier!==name){$('supplier-status').textContent='Confirme primeiro o resultado da tentativa anterior usando o mesmo fornecedor.';return;}
    busy=true;controls();$('supplier-name').disabled=true;$('supplier-cancel').disabled=true;$('supplier-status').textContent='Salvando…';const ticket=version,productId=supplierItem.id;
    try {
      await session();if(!admin||ticket!==version||(!report&&!supplierCommand))throw Object.assign(Error('CONTEXT_CHANGED'),{code:'CONTEXT_CHANGED'});
      if(!supplierCommand){
        const product=(await requestData('/api/v1/catalog/get?id='+encodeURIComponent(productId))).product;
        if(ticket!==version||!report)throw Object.assign(Error('CONTEXT_CHANGED'),{code:'CONTEXT_CHANGED'});
        if(product.supplier){$('supplier-status').textContent='O livro já possui fornecedor. Gere novamente a lista para conferir.';return;}
        const keys=['isbn','internalCode','title','author','publisher','edition','supplier','priceCents','minimumStock','category','coverUrl','year','pages','synopsis','nicheIds','active','subtitle','costCents','sku','productType'];
        const record=Object.fromEntries(keys.filter(key=>product[key]!==undefined).map(key=>[key,product[key]]));record.supplier=name;
        supplierCommand={commandId:crypto.randomUUID(),id:productId,expectedVersion:product.version,record};
      }
      await requestData('/api/v1/catalog/save',supplierCommand);supplierCommand=null;
      $('supplier-dialog').close();supplierItem=null;
      if(ticket===version){const data=await api('report',{scope:$('scope').value,supplier:JSON.parse($('supplier').value),format:'view'});if(ticket===version){clearTimeout(reportTimer);showReport(data);$('report-status').textContent='Fornecedor atualizado.';}}
    } catch(error) {
      if(error.status===409){supplierCommand=null;$('supplier-status').textContent='O cadastro foi alterado em outra sessão. Gere a lista novamente antes de tentar.';}
      else if($('supplier-dialog').open)$('supplier-status').textContent=supplierCommand?'Não foi possível confirmar. Tente novamente com o mesmo fornecedor.':explain(error);
      else {clearReport();$('report-status').textContent='Fornecedor salvo. Gere novamente a lista para atualizá-la.';}
    } finally {busy=false;$('supplier-name').disabled=false;$('supplier-cancel').disabled=false;controls();}
  }
  // RFC4180 quoting, UTF-8 BOM and formula protection for spreadsheet readers.
  function csvCell(value) { let s = String(value); if (/^[\s\uFEFF]*[=+@-]/u.test(s) || /^[\t\r\n]/.test(s) || /^\d{10,}$/.test(s)) s = "'" + s; return '"' + s.replaceAll('"','""') + '"'; }
  async function generate(format) {
    if(busy||loading||pending||!online()||!access||!available)return;
    busy=true;$('action-loading-text').textContent={view:'Preparando relatório…',csv:'Preparando CSV…',print:'Preparando impressão…',copy:'Preparando texto…'}[format];$('action-loading').hidden=false;$('report-status').textContent=$('action-loading-text').textContent;clearReport();controls();
    const ticket=version,filter=JSON.stringify([$('scope').value,$('supplier').value]);
    try {
      await session(); if (!admin) throw Object.assign(Error('FORBIDDEN'),{status:403});
      const data = await api('report',{scope:$('scope').value,supplier:JSON.parse($('supplier').value),format});
      if(ticket!==version||filter!==JSON.stringify([$('scope').value,$('supplier').value])||!online()||document.hidden){$('report-status').textContent='A conexão, a página ou o filtro mudou. Gere novamente para conferir o relatório.';return;}
      showReport(data);
      if (format === 'csv') {
        const rows = [['Livro','Fornecedor','ISBN / código','Estoque atual','Estoque mínimo','Quantidade sugerida','Acompanhamento','Alerta desde','Gerado em']];
        data.groups.forEach(g => g.items.forEach(p => rows.push([p.title,g.supplier || 'Fornecedor não informado',p.isbn || p.internalCode,p.stock,p.minimumStock,p.suggestedQuantity,labels[p.alertState],date(p.since),date(data.generatedAt)])));
        const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}), url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = 'reposicao-livraria-' + data.generatedAt.slice(0,10) + '.csv'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),10000);
      } else if (format === 'print') window.print();
      else if (format === 'copy') {
        const lines = ['LISTA PARA REPOSIÇÃO — LIVRARIA','Gerada em '+date(data.generatedAt),'Sugestões para revisão; não é pedido confirmado.'];
        data.groups.forEach(g => { lines.push('', 'Fornecedor: '+(g.supplier || 'NÃO INFORMADO')); g.items.forEach(p => lines.push('- '+p.title+' | '+(p.isbn || p.internalCode)+' | saldo '+p.stock+' | sugestão: '+p.suggestedQuantity+' un. | '+labels[p.alertState])); });
        $('draft').value = lines.join('\n'); $('draft-label').hidden = false; $('draft').focus(); $('draft').select();
      }
      $('report-status').textContent = format === 'copy' ? 'Texto preparado e selecionado. Copie, revise as quantidades e escolha a pessoa para quem deseja encaminhar. Nada foi enviado.' : 'Relatório completo para o filtro selecionado, conferido no servidor. Nenhum pedido foi enviado.';
    } catch (error) { clearReport(); $('report-status').textContent = explain(error); }
    finally { busy = false;$('action-loading').hidden=true;controls();if(refreshAgain){refreshAgain=false;refresh();} }
  }
  $('refresh').addEventListener('click',refresh); $('history').addEventListener('change',()=>{offset=0;refresh();});
  $('next').addEventListener('click',()=>{if (!loading && nextOffset !== null) {offset=nextOffset;refresh();}}); $('previous').addEventListener('click',()=>{if (!loading) {offset=Math.max(0,offset-25);refresh();}});
  $('report-form').addEventListener('submit',event=>{event.preventDefault();generate('view');});
  $('supplier-form').addEventListener('submit',saveSupplier);$('supplier-cancel').addEventListener('click',()=>{if(!busy&&!supplierCommand){$('supplier-dialog').close();if(report){clearReport();$('report-status').textContent='Gere novamente a lista para conferir os dados atuais.';controls();}}});$('supplier-dialog').addEventListener('cancel',event=>{if(busy||supplierCommand)event.preventDefault();else if(report){clearReport();$('report-status').textContent='Gere novamente a lista para conferir os dados atuais.';controls();}});
  $('reconnect').addEventListener('click',refresh);$('retry-update').addEventListener('click',()=>mutate());
  $('export').addEventListener('click',()=>generate('csv')); $('print').addEventListener('click',()=>generate('print')); $('copy').addEventListener('click',()=>generate('copy'));
  ['scope','supplier'].forEach(id=>$(id).addEventListener('change',()=>{clearReport();$('report-status').textContent='Filtro alterado. Gere o relatório para conferir a lista atual.';}));
  window.addEventListener('focus',refresh);window.addEventListener('offline',invalidate);window.addEventListener('online',()=>{invalidate();refresh();});
  window.addEventListener('pageshow',event=>{if(event.persisted){invalidate();refresh();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else refresh();});
  window.addEventListener('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
  if(location.origin!==ORIGIN){$('status').textContent='Esta tela funciona exclusivamente no endereço autorizado.';return;}
  // Keep polling from interrupting a report review or an uncertain command.
  setInterval(()=>{if(!busy&&!loading&&!report&&!pending)refresh();},60000);
  refresh();
})();
