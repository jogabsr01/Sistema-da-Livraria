(() => {
  'use strict';
  const $ = id => document.getElementById(id), ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app';
  const labels = { ABERTA:'Aberta', EM_ATENDIMENTO:'Em atendimento', RESOLVIDA:'Resolvida' };
  const date = value => new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  let csrf = '', userId = '', admin = false, offset = 0, nextOffset = null, busy = false, loading = false, refreshAgain = false, report = null;
  async function api(operation, body, query = '') {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/v1/notifications/' + operation + query, { credentials:'same-origin', cache:'no-store', signal:controller.signal,
        ...(body ? {method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)}:{}) });
      const result = await response.json(); if (!response.ok) throw Object.assign(Error('REQUEST_FAILED'),{code:result.error?.code,status:response.status}); return result.data;
    } finally { clearTimeout(timer); }
  }
  function explain(error) {
    if (error.status === 401 || error.status === 403) return 'Entre novamente na conta verificada. Relatórios exigem acesso administrativo e autenticação forte recente.';
    if (error.code?.includes('CAPACITY')) return 'O limite seguro foi atingido. Não foi gerado um relatório parcial. Filtre por fornecedor ou solicite a revisão da capacidade.';
    if (error.code?.includes('NOT_ACTIVATED') || error.code === 'WORKSPACE_NOTIFICATIONS_UNAVAILABLE') return 'As notificações ainda não foram habilitadas nesta instalação DEV.';
    return 'Não foi possível confirmar a operação. Atualize para conferir o estado antes de tentar novamente.';
  }
  async function session() {
    const response = await fetch('/api/v1/session',{credentials:'same-origin',cache:'no-store'}), result = await response.json();
    if (!response.ok || userId && userId !== result.data?.user?.id) throw Object.assign(Error('SESSION_CHANGED'),{status:401});
    userId = result.data.user.id; csrf = result.data.csrfToken; admin = ['ADMIN','SUPER_ADMIN'].includes(result.data.user.role);
    $('report-tools').hidden = !admin; if (!admin) clearReport();
  }
  function clearReport() { report = null; $('report').hidden = true; $('report-groups').replaceChildren(); $('draft-label').hidden = true; $('draft').value = ''; ['export','print','copy'].forEach(id => $(id).disabled = true); }
  async function refresh() {
    if (document.hidden || !userId) return;
    if (loading) { refreshAgain = true; return; } loading = true;
    try {
      await session();
      const [data, summary] = await Promise.all([api('list',null,'?'+new URLSearchParams({offset:String(offset),history:String($('history').checked)})), api('summary')]);
      $('unread').textContent = '(' + summary.unread + ' não lida(s))'; $('alerts').replaceChildren(); nextOffset = data.nextOffset;
      if (!data.items.length) { const p = document.createElement('p'); p.textContent = 'Nenhum alerta neste filtro.'; $('alerts').append(p); }
      for (const item of data.items) {
        const card = document.createElement('article'); card.className = 'book alert'; card.dataset.id = item.id;
        const title = document.createElement('h3'), info = document.createElement('p'), since = document.createElement('p'), tools = document.createElement('div'); tools.className = 'toolbar';
        title.textContent = item.title; info.textContent = (item.type === 'STOCK_ZERO' ? 'Sem estoque' : 'Abaixo do mínimo') + ' · Saldo atual: ' + item.stock + ' · Mínimo: ' + item.minimumStock + ' · ' + labels[item.state] + (item.read ? ' · Lida' : ' · Não lida');
        const schedule=item.type.startsWith('SCHEDULE_');if(schedule)info.textContent=item.message+' · '+(item.read?'Lida':'Não lida');
        since.textContent = 'Alerta desde ' + date(item.createdAt) + (item.resolvedAt ? ' · Resolvido em ' + date(item.resolvedAt) : '');
        const link = document.createElement('a'); link.href = schedule?'/escalas-dev.html?data='+item.date+'&escala='+item.scheduleId:'/catalogo-dev.html?livro=' + item.productId; link.textContent = schedule?'Abrir minha escala':'Abrir livro'; tools.append(link);
        if (!schedule&&item.state !== 'RESOLVIDA') { const receive = document.createElement('a'); receive.href = '/catalogo-dev.html?entrada=' + item.productId; receive.textContent = 'Adicionar unidades'; tools.append(receive); }
        if (!item.read) {
          const read = document.createElement('button'); read.type = 'button'; read.className = 'secondary'; read.textContent = 'Marcar como lida'; read.disabled = busy;
          read.addEventListener('click', () => mutate(async () => { await api('read',{id:item.id}); })); tools.append(read);
        }
        if (!schedule&&admin && item.state !== 'RESOLVIDA') {
          const state = document.createElement('button'); state.type = 'button'; state.textContent = item.state === 'ABERTA' ? 'Marcar em atendimento' : 'Voltar para aberta'; state.disabled = busy;
          const command = {commandId:crypto.randomUUID(),id:item.id,state:item.state === 'ABERTA' ? 'EM_ATENDIMENTO' : 'ABERTA'};
          state.addEventListener('click', () => mutate(async () => { await api('state',command); })); tools.append(state);
        }
        card.append(title,info,since,tools); $('alerts').append(card);
      }
      $('previous').hidden = offset === 0; $('next').hidden = nextOffset === null;
      $('status').textContent = summary.total + ' alerta(s) pendente(s). Atualizado às ' + new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'});
    } catch (error) { $('status').textContent = explain(error); if (error.status === 401 || error.status === 403) { $('notifications').hidden = true; $('report-tools').hidden = true; clearReport(); } }
    finally { loading = false; if (refreshAgain) { refreshAgain = false; refresh(); } }
  }
  async function mutate(fn) {
    if (busy) return; busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true);
    try { await session(); await fn();window.dispatchEvent(new Event('livraria:notifications-changed')); await refresh(); } catch (error) { $('status').textContent = explain(error); if (error.status === 401 || error.status === 403) { clearReport(); $('report-tools').hidden = true; } }
    finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); ['export','print','copy'].forEach(id => $(id).disabled = !report); }
  }
  function showReport(data) {
    report = data; $('report').hidden = false; $('draft-label').hidden = true; $('draft').value = '';
    $('report-meta').textContent = 'Gerado em ' + date(data.generatedAt) + ' · ' + (data.scope === 'zero' ? 'Somente sem estoque' : 'Sem estoque e abaixo do mínimo');
    $('report-summary').textContent = data.totalBooks + ' livro(s) · ' + data.groups.length + ' fornecedor(es)/grupo(s) · ' + data.suggestedUnits + ' unidade(s) sugerida(s).';
    $('supplier-warning').textContent = data.missingSupplier ? data.missingSupplier + ' livro(s) sem fornecedor informado. Complete o cadastro antes de preparar o pedido.' : '';
    $('report-groups').replaceChildren();
    for (const group of data.groups) {
      const section = document.createElement('section'), title = document.createElement('h3'), scroll = document.createElement('div'), table = document.createElement('table');
      title.textContent = group.supplier || 'Fornecedor não informado'; scroll.className = 'report-scroll'; scroll.tabIndex = 0; scroll.setAttribute('aria-label','Livros de '+title.textContent);
      const head = document.createElement('thead'), header = document.createElement('tr');
      ['Livro','Fornecedor','ISBN / código','Saldo','Mínimo','Qtd. sugerida','Acompanhamento'].forEach(name => { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = name; header.append(cell); }); head.append(header);
      const body = document.createElement('tbody');
      for (const item of group.items) {
        const row = document.createElement('tr');
        [item.title,group.supplier || 'Não informado',item.isbn || item.internalCode,item.stock,item.minimumStock,item.suggestedQuantity,labels[item.alertState]].forEach(value => { const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell); }); body.append(row);
      }
      table.append(head,body); scroll.append(table); section.append(title,scroll); $('report-groups').append(section);
    }
    if (!data.totalBooks) $('report-groups').textContent = 'Nenhum livro precisa de reposição neste filtro.';
    if ($('supplier').value === 'null') {
      $('supplier').replaceChildren(new Option('Todos os fornecedores','null'));
      data.groups.forEach(group => $('supplier').append(new Option(group.supplier || 'Fornecedor não informado',JSON.stringify(group.supplier))));
    }
    ['export','print','copy'].forEach(id => $(id).disabled = false);
  }
  // RFC4180 quoting, UTF-8 BOM and formula protection for spreadsheet readers.
  function csvCell(value) { let s = String(value); if (/^[\s\uFEFF]*[=+@-]/u.test(s) || /^[\t\r\n]/.test(s) || /^\d{10,}$/.test(s)) s = "'" + s; return '"' + s.replaceAll('"','""') + '"'; }
  async function generate(format) {
    if (busy) return; busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true);
    $('scope').disabled = true; $('supplier').disabled = true;
    try {
      await session(); if (!admin) throw Object.assign(Error('FORBIDDEN'),{status:403});
      const data = await api('report',{scope:$('scope').value,supplier:JSON.parse($('supplier').value),format}); showReport(data);
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
    finally { busy = false; $('scope').disabled = false; $('supplier').disabled = false; document.querySelectorAll('button').forEach(b => b.disabled = false); ['export','print','copy'].forEach(id => $(id).disabled = !report); }
  }
  $('refresh').addEventListener('click',refresh); $('history').addEventListener('change',()=>{offset=0;refresh();});
  $('next').addEventListener('click',()=>{if (!loading && nextOffset !== null) {offset=nextOffset;refresh();}}); $('previous').addEventListener('click',()=>{if (!loading) {offset=Math.max(0,offset-25);refresh();}});
  $('report-form').addEventListener('submit',event=>{event.preventDefault();generate('view');});
  $('export').addEventListener('click',()=>generate('csv')); $('print').addEventListener('click',()=>generate('print')); $('copy').addEventListener('click',()=>generate('copy'));
  ['scope','supplier'].forEach(id=>$(id).addEventListener('change',()=>{clearReport();$('report-status').textContent='Filtro alterado. Gere o relatório para conferir a lista atual.';}));
  window.addEventListener('focus',refresh); window.addEventListener('online',refresh);
  document.addEventListener('visibilitychange',()=>{if (!document.hidden) refresh();});
  (async()=>{
    if (location.origin !== ORIGIN) { $('status').textContent='Esta tela funciona exclusivamente no endereço DEV autorizado.';return; }
    try { await session(); await api('summary'); $('notifications').hidden=false;await refresh();setInterval(refresh,60000); }
    catch(error){$('status').textContent=explain(error);$('report-tools').hidden=true;}
  })();
})();
