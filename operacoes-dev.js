'use strict';
(() => {
  const $ = id => document.getElementById(id), origin = 'https://dev--merry-chimera-49a1f3.netlify.app';
  const money = cents => (cents / 100).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
  const date = value => new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const el = (tag,value,cls) => { const node=document.createElement(tag); node.textContent=value; if(cls)node.className=cls; return node; };
  let csrf='', userId='', admin=false, initialized=false, accessValid=false, offset=0, next=null;
  let loading=false, busy=false, queued=false, pending=null, product=null, latestProduct=null, currentSale=null;
  let ready=false, checkedAt=0, productAt=0, receiptAt=0, generation=0, expiryTimer, receiptTimer;
  const online = () => navigator.onLine !== false;
  const recent = at => performance.now() - at < 90000;
  const fresh = () => ready && online() && accessValid && recent(checkedAt);
  function describe(error) { const common = globalThis.LivrariaMessages?.describe(error); if (common) return common;
    if(error.code==='OFFLINE')return 'Sem conexão. Mantenha esta aba aberta e confira novamente ao reconectar.';
    if(error.status===401)return 'Confirme novamente seu acesso com PIN e confirmação pelo aparelho para continuar.';
    if(error.status===403)return 'Seu perfil não permite esta operação.';
    if(error.code?.includes('CONFLICT')||error.code?.includes('NO_CHANGE'))return 'O registro mudou ou a operação já foi realizada. Atualize a consulta e confira o resultado.';
    if(error.code?.includes('NOT_ACTIVATED')||error.code?.includes('UNAVAILABLE'))return 'Este módulo ainda não está disponível nesta instalação.';
    if(error.code?.includes('INVALID_OPERATION'))return 'Confira o período, o saldo e o motivo informado.';
    return 'Não foi possível confirmar o resultado. Mantenha esta tela aberta e tente novamente com o mesmo comando.';
  }
  function lock() {
    const active=busy||!!pending, connected=online()&&accessValid;
    $('adjust-fields').disabled=active||!admin;
    $('reverse-fields').disabled=active||!admin;
    $('adjust-close').disabled=active; $('receipt-close').disabled=active;
    $('print').disabled=active||!connected||!currentSale||!recent(receiptAt);
    $('receipt-editor').dataset.printReady=String(!$('print').disabled);
    $('receipt-print').hidden=!accessValid;
    $('adjust-save').disabled=busy||loading||!connected||!admin||pending?.kind==='reverse'||!pending&&(!fresh()||!product||!recent(productAt)||!!latestProduct);
    $('reverse-save').disabled=busy||loading||!connected||pending?.kind==='adjust'||pending?.phase!=='RECEIPT'&&!admin||!pending&&(!fresh()||!currentSale||!recent(receiptAt)||currentSale.state!=='CONFIRMADA');
    $('adjust-save').textContent=pending?.kind==='adjust'?'Conferir / tentar novamente':'Confirmar ajuste';
    $('reverse-save').textContent=pending?.phase==='RECEIPT'?'Conferir comprovante':pending?.kind==='reverse'?'Conferir / tentar novamente':'Registrar estorno integral';
    $('reverse-form').hidden=pending?.kind==='reverse'?false:!admin||currentSale?.state!=='CONFIRMADA';
    $('adjust-panel').hidden=!admin;
    $('reload-product').hidden=!latestProduct||!!pending;
    $('reload-product').disabled=busy||loading||!fresh()||!admin;
    document.querySelectorAll('[data-operations-refresh],#sales-filter button').forEach(button=>{button.disabled=busy||loading||!online();});
    document.querySelectorAll('#product-search button,#product-results button,#sales button').forEach(button=>{button.disabled=busy||loading||!!pending||!fresh();});
    $('previous').disabled=busy||loading||!online()||offset===0;
    $('next').disabled=busy||loading||!online()||next===null;
    const state=!online()?'offline':fresh()?'ready':loading?'checking':'stale';
    const text=!online()?'Sem conexão. Nenhuma operação será enviada; mantenha a aba aberta.'
      :pending?.phase==='RECEIPT'?'Estorno confirmado. Falta conferir o comprovante; esta etapa faz somente uma consulta.'
      :pending?'Resultado pendente. Confira o mesmo pedido; a reconexão não o reenvia automaticamente.'
      :fresh()?'Consulta conferida. Estoque e permissões serão validados pelo servidor ao confirmar.'
      :'Confira a conexão e o histórico antes de iniciar uma operação. Seus campos serão preservados.';
    document.querySelectorAll('[data-operations-network]').forEach(node=>{node.dataset.state=state;if(node.textContent!==text)node.textContent=text;});
  }
  function invalidate() { generation++; ready=false; productAt=-Infinity; receiptAt=-Infinity; clearTimeout(expiryTimer); lock(); }
  async function api(path,body) {
    if(!online())throw Object.assign(Error('OFFLINE'),{code:'OFFLINE'});
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    try {
      const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body?{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)}:{})});
      const out=await response.json();
      if(!response.ok)throw Object.assign(Error('OPERATION_FAILED'),{status:response.status,code:out.error?.code,field:out.error?.field,readOnly:!body});
      return out.data;
    } catch(error) {
      if(error.status===401||error.status===403)accessValid=false;
      if(!error.status||error.status===401||error.status===403)invalidate();
      throw error;
    } finally {clearTimeout(timer);}
  }
  async function session() {
    const data=await api('/api/v1/session');
    if(userId&&data.user.id!==userId){accessValid=false;invalidate();throw Object.assign(Error('ACCOUNT_CHANGED'),{status:401});}
    userId=data.user.id;csrf=data.csrfToken;admin=['ADMIN','SUPER_ADMIN'].includes(data.user.role);accessValid=true;document.body.dataset.sessionRole=data.user.role;window.dispatchEvent(new Event('livraria:session-ready'));
    $('scope').textContent=admin?'Todas as vendas da livraria. Operações administrativas exigem acesso confirmado há menos de cinco minutos.':'Somente as vendas realizadas pela sua conta.';
    $('access-help').hidden=true;
  }
  function showReceipt(s,reset=true) {
    currentSale=s;receiptAt=performance.now();clearTimeout(receiptTimer);receiptTimer=setTimeout(lock,90000);
    $('receipt-title').textContent=s.state==='CANCELADA'?'Venda cancelada':'Comprovante de venda';
    $('receipt-state').textContent=s.state==='CANCELADA'?'CANCELADA — registro histórico':'CONFIRMADA';
    $('receipt-meta').textContent='Venda '+s.saleId+' · '+date(s.createdAt)+' · '+s.paymentMethod+' · Operador '+s.actorId;
    $('receipt-items').replaceChildren(...s.items.map(item=>{const row=el('div','','receipt-line');row.append(el('p',item.title||'Livro · '+item.productId),el('p',item.quantity+' × '+money(item.unitPriceCents)+' = '+money(item.subtotalCents)));return row;}));
    $('receipt-total').textContent='Total original: '+money(s.totalCents);
    $('receipt-customer').textContent=s.customerId?'Cliente identificado · dados pessoais preservados.':'Compra sem cadastro de cliente.';
    if(reset){$('reverse-form').reset();$('receipt-status').textContent='';}
    if(!$('receipt-editor').open)$('receipt-editor').showModal();lock();
  }
  function renderSales(data) {
    next=data.nextOffset;$('count').textContent=data.total+' venda(s) no período';
    $('sales').replaceChildren(...data.sales.map(sale=>{
      const card=el('article','','sale');card.append(el('h3',money(sale.totalCents)),el('span',sale.state,'pill'+(sale.state==='CANCELADA'?' cancelled':'')),el('p',date(sale.createdAt)+' · '+sale.paymentMethod),el('p','Referência: '+sale.saleId));
      const button=el('button','Ver comprovante','secondary');button.type='button';
      button.addEventListener('click',()=>read(async version=>{
        await session();const data=await api('/api/v1/operations/get?id='+sale.saleId);
        if(version===generation&&online())showReceipt(data.sale);
      }));card.append(button);return card;
    }));
  }
  async function read(action) {
    if(loading||busy||pending||!fresh())return;
    loading=true;lock();const version=generation;
    try{await action(version);}catch(error){$('status').textContent=describe(error);}finally{loading=false;lock();if(queued){queued=false;load();}}
  }
  async function load() {
    if(location.origin!==origin){$('status').textContent='Abra esta tela no endereço DEV da livraria.';return;}
    if(!online()||document.hidden){lock();if(!initialized&&!online())$('status').textContent='Sem conexão. O acesso será conferido ao reconectar.';return;}
    if(loading||busy){queued=true;return;}
    loading=true;ready=false;clearTimeout(expiryTimer);lock();const version=generation;
    try {
      await session();
      if(!initialized){const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});$('to').value=today;$('from').value=today;initialized=true;}
      const from=new Date($('from').value+'T00:00:00-03:00').toISOString(),to=new Date($('to').value+'T23:59:59.999-03:00').toISOString();
      const data=await api('/api/v1/operations/list?'+new URLSearchParams({from,to,offset:String(offset)}));
      const detail=!pending&&$('receipt-editor').open?await api('/api/v1/operations/get?id='+currentSale.saleId):null;
      const stock=!pending&&$('adjust-editor').open?await api('/api/v1/catalog/get?id='+product.id):null;
      if(version!==generation||!online()||document.hidden)return;
      renderSales(data);
      if(detail)showReceipt(detail.sale,false);
      if(stock){productAt=performance.now();latestProduct=stock.product.version===product.version?null:stock.product;$('reload-product').hidden=!latestProduct;if(latestProduct)$('adjust-status').textContent='O saldo ou cadastro mudou em outro atendimento. Use “Rever saldo atualizado” e confira a contagem antes de confirmar.';}
      ready=true;checkedAt=performance.now();expiryTimer=setTimeout(()=>{ready=false;lock();},90000);
      $('operations').hidden=false;$('status').textContent='Histórico atualizado.';
    } catch(error) {
      $('status').textContent=describe(error);
      if(error.status===401||error.status===403){$('access-help').hidden=false;$('sales').replaceChildren();}
      if(error.code==='OPERATIONS_NOT_ACTIVATED'||error.code==='WORKSPACE_OPERATIONS_UNAVAILABLE')$('operations').hidden=true;
    } finally {loading=false;lock();if(queued){queued=false;load();}}
  }
  async function finishReverse() {
    // A known successful POST is never repeated just to fetch its receipt.
    const data=await api('/api/v1/operations/get?id='+pending.body.saleId);
    if(data.sale.state!=='CANCELADA')throw Error('RECEIPT_NOT_READY');
    pending=null;showReceipt(data.sale);$('receipt-status').textContent='Estorno integral registrado. Estoque devolvido; histórico preservado.';
  }
  async function submit(kind) {
    if(busy||loading||!online()||!accessValid)return;
    if(!pending&&(!admin||!fresh()||kind==='adjust'&&(!product||!recent(productAt)||latestProduct)||kind==='reverse'&&(!currentSale||currentSale.state!=='CONFIRMADA'||!recent(receiptAt))))return;
    if(pending&&pending.kind!==kind)return;
    const status=$(kind==='adjust'?'adjust-status':'receipt-status');
    if(!pending)pending={kind,phase:'POST',uncertain:false,body:kind==='adjust'?{commandId:crypto.randomUUID(),id:product.id,expectedVersion:product.version,newStock:Number($('adjust-stock').value),reason:$('adjust-reason').value}:{commandId:crypto.randomUUID(),saleId:currentSale.saleId,reason:$('reverse-reason').value}};
    busy=true;lock();status.textContent=pending.phase==='RECEIPT'?'Estorno confirmado. Conferindo o comprovante…':'Conferindo e registrando…';
    let success='';
    try {
      await session();
      if(pending.phase==='POST'&&!admin)throw Object.assign(Error('ROLE_CHANGED'),{status:403,code:'FORBIDDEN'});
      if(pending.phase==='POST') {
        const result=await api('/api/v1/operations/'+kind,pending.body);
        window.dispatchEvent(new Event('livraria:stock-changed'));
        if(kind==='adjust') {
          pending=null;product=null;latestProduct=null;$('adjust-editor').close();$('adjust-form').reset();$('product-results').replaceChildren();
          success='Saldo ajustado: '+result.stockBefore+' → '+result.stockAfter+' unidades.';
        } else pending.phase='RECEIPT';
      }
      if(kind==='reverse'){await finishReverse();success='Estorno integral registrado. Estoque devolvido; histórico preservado.';}
    } catch(error) {
      const rejected=['INVALID_OPERATION','WORKSPACE_INVALID_OPERATION','WORKSPACE_CATALOG_CONFLICT','WORKSPACE_STOCK_NO_CHANGE','WORKSPACE_OPERATION_CONFLICT','WORKSPACE_PRODUCT_UNAVAILABLE','WORKSPACE_SALE_NOT_FOUND','WORKSPACE_STOCK_LIMIT','FORBIDDEN','WORKSPACE_FORBIDDEN'].includes(error.code);
      if(pending?.phase==='RECEIPT')status.textContent='Estorno confirmado. Não foi possível carregar o comprovante. Use “Conferir comprovante”; o estorno não será enviado novamente. '+describe(error);
      else {status.textContent=describe(error);if(pending){if(rejected&&!pending.uncertain)pending=null;else pending.uncertain=true;}}
    } finally {
      busy=false;lock();
      if(success){await load();$('status').textContent=success+(fresh()?'':' Não foi possível atualizar o histórico. Confira a conexão antes de iniciar outra operação.');}
      else if(queued){queued=false;load();}
    }
  }
  $('adjust-form').addEventListener('submit',event=>{event.preventDefault();submit('adjust');});
  $('reverse-form').addEventListener('submit',event=>{event.preventDefault();submit('reverse');});
  for(const [dialog,button] of [['adjust-editor','adjust-close'],['receipt-editor','receipt-close']]){
    $(button).addEventListener('click',()=>{if(!busy&&!pending)$(dialog).close();});
    $(dialog).addEventListener('cancel',event=>{if(busy||pending)event.preventDefault();});
  }
  $('reload-product').addEventListener('click',()=>{
    if(busy||loading||pending||!fresh()||!latestProduct)return;
    product=latestProduct;latestProduct=null;productAt=performance.now();$('adjust-current').textContent='Saldo registrado: '+product.stock+' unidades';$('adjust-book').textContent=product.title;
    $('adjust-status').textContent='Versão atual carregada. Confira novamente o saldo físico e o motivo antes de confirmar.';lock();
  });
  $('print').addEventListener('click',()=>{lock();if(!$('print').disabled)window.print();});
  $('sales-filter').addEventListener('submit',event=>{event.preventDefault();if(!loading&&!busy){offset=0;load();}});
  $('previous').addEventListener('click',()=>{if(!loading&&!busy){offset=Math.max(0,offset-20);load();}});
  $('next').addEventListener('click',()=>{if(!loading&&!busy&&next!==null){offset=next;load();}});
  $('product-search').addEventListener('submit',event=>{event.preventDefault();read(async version=>{
    await session();const data=await api('/api/v1/catalog/list?'+new URLSearchParams({q:$('product-query').value,offset:'0'}));
    if(version!==generation||!online())return;
    $('product-results').replaceChildren(...data.products.map(p=>{
      const card=el('article','','product');card.append(el('h3',p.title),el('p','Saldo atual: '+p.stock+' unidades'));
      const choose=el('button','Conferir e ajustar','secondary');choose.type='button';choose.addEventListener('click',()=>read(async ticket=>{
        await session();const data=await api('/api/v1/catalog/get?id='+p.id);
        if(ticket!==generation||!online())return;
        product=data.product;latestProduct=null;productAt=performance.now();$('adjust-book').textContent=product.title;$('adjust-current').textContent='Saldo registrado: '+product.stock+' unidades';
        $('adjust-form').reset();$('adjust-stock').value=product.stock;$('adjust-status').textContent='';lock();$('adjust-editor').showModal();$('adjust-stock').focus();
      }));card.append(choose);return card;
    }));if(!data.products.length)$('product-results').append(el('p','Nenhum livro encontrado.'));
  });});
  document.querySelectorAll('[data-operations-refresh]').forEach(button=>button.addEventListener('click',load));
  window.addEventListener('beforeunload',event=>{if(pending||busy){event.preventDefault();event.returnValue='';}});
  window.addEventListener('offline',invalidate);
  window.addEventListener('online',()=>{invalidate();load();});
  window.addEventListener('focus',load);
  window.addEventListener('pageshow',event=>{if(event.persisted){invalidate();load();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else load();});
  // Operation reads are audited. Do not create a recurring audit write by polling.
  load();
})();
