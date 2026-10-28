/* Session storage retains only a technical command (no names, CPF or contacts) for response-loss recovery.
 * Server sessions/permissions/prices/stock are always authoritative. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app';
  const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const methods = { PIX:'PIX', DINHEIRO:'Dinheiro', DEBITO:'Débito', CREDITO:'Crédito' };
  const records = new Map(), cart = new Map();
  let csrf = '', storageKey = '', pending = null, receipt = null, busy = false, refreshing = false, offset = 0, nextOffset = null;
  let stockReady = false, checkedAt = 0, connectionVersion = 0, refreshAgain = false, started = false, starting = false, freshnessTimer;
  const FRESH_FOR = 90000;
  const online = () => navigator.onLine !== false;
  const fresh = () => stockReady && online() && performance.now() - checkedAt < FRESH_FOR;
  function connectionStatus() {
    const state = !online() ? 'offline' : fresh() ? 'ready' : refreshing ? 'checking' : 'stale';
    $('connection').dataset.state = state;
    $('connection-title').textContent = {offline:'Sem conexão',ready:'Estoque conferido',checking:'Conferindo conexão e estoque',stale:'Estoque precisa ser conferido'}[state];
    $('connection-detail').textContent = !online()
      ? 'A confirmação está bloqueada. Mantenha esta aba aberta; uma venda pendente deve ser conferida ao reconectar.'
      : pending ? 'Há uma venda aguardando confirmação. Use “Verificar resultado / tentar novamente”. A reconexão não reenvia a venda automaticamente.'
      : fresh() ? 'Você pode continuar. Preços e quantidades serão validados novamente ao confirmar.'
      : 'Aguarde a atualização ou use “Atualizar estoque”. Novas vendas ficam bloqueadas até a conferência completa.';
  }
  function invalidateStock() {
    connectionVersion++; stockReady = false; clearTimeout(freshnessTimer); protectCustomer(); renderCart();
  }
  let customersEnabled=false,selectedCustomer=null,candidateCustomer=null,editingCustomer=null,customerPending=null,customerBusy=false,customerAccess=false,customerEpoch=0;
  const customerKeys=['name','cpf','email','phone','postalCode','street','number','complement','district','city','state','contactPreference','marketingConsent'];
  const identified=()=>pending?pending.customerId!==null:customersEnabled&&$('customer-identified').checked;
  const locked = () => !fresh() || !!pending || busy || !!receipt || customerBusy || !!customerPending;
  function clearCustomer(){selectedCustomer=null;candidateCustomer=null;editingCustomer=null;customerPending=null;$('customer-search-form').reset();$('customer-form').reset();$('customer-match').hidden=true;$('customer-new').hidden=true;$('customer-selection').hidden=true;$('customer-selection').textContent='';$('customer-match-text').textContent='';$('customer-status').textContent='';$('customer-cpf-hint').textContent='';$('customer-lookup').hidden=true;$('customer-anonymous').checked=true;$('customer-identified').checked=false;}
  function protectCustomer(wipe=false){customerEpoch++;customerAccess=false;selectedCustomer=null;candidateCustomer=null;$('customer-search-form').reset();$('customer-selection').hidden=true;$('customer-selection').textContent='';$('customer-match').hidden=true;$('customer-match-text').textContent='';$('customer-new').hidden=true;$('customer-status').textContent='';if(wipe){editingCustomer=null;$('customer-form').reset();$('customer-cpf-hint').textContent='';if($('customer-editor').open)$('customer-editor').close();}lockCustomer();}
  function lockCustomer(){const blocked=customerBusy||!!customerPending;$('customer-editor').dataset.verified=String(customerAccess&&online());$('customer-fields').disabled=blocked||!customerAccess||!online();$('customer-cpf').disabled=!!editingCustomer;$('customer-close').disabled=blocked;$('customer-save').disabled=customerBusy||!online()||!customerPending&&(!fresh()||!customerAccess);$('customer-save').textContent=customerPending?'Conferir e tentar novamente':'Salvar e usar neste atendimento';$('customer-pending').hidden=!customerPending;$('customer-resume').disabled=customerBusy||busy||!online();$('customer-refresh').disabled=customerBusy||busy||refreshing||!online();const state=!online()?'offline':customerAccess&&fresh()?'ready':'stale';$('customer-connection').dataset.state=state;$('customer-connection').textContent=!online()?'Sem conexão. Os dados da consulta foram removidos e o rascunho está protegido. Mantenha esta aba aberta.':customerPending?'Há um cadastro aguardando confirmação. Reconectar não o reenvia. Confira o mesmo pedido.':customerAccess&&fresh()?'Acesso conferido. Revise o cadastro antes de salvar.':'Confira a conexão e o acesso antes de continuar.';}
  function customerFailure(e){ const common = globalThis.LivrariaMessages?.describe(e); if (common) return common;if(e.code==='CONTEXT_CHANGED')return 'A conexão, a conta ou a busca mudou. Esta resposta não foi exibida. Confira novamente.';if(e.status===401||e.status===403)return 'Confirme novamente seu acesso antes de consultar dados de clientes.';if(e.code?.includes('DUPLICATE'))return 'Este CPF já está cadastrado. Cancele e busque o cadastro existente.';if(e.code?.includes('CONFLICT'))return 'O cadastro foi atualizado em outro atendimento. Busque o CPF novamente.';if(e.code?.includes('INVALID_CUSTOMER'))return 'Confira o CPF, o endereço e a preferência de contato. A autorização de mensagens exige um canal com contato válido.';return 'Não foi possível confirmar o resultado. Mantenha a tela aberta e tente novamente.';}
  function checkCustomer(ticket){if(ticket!==customerEpoch||!online()||document.hidden)throw {code:'CONTEXT_CHANGED'};}
  async function customerSession(){const s=await api('/api/v1/session');if('checkout.pending.'+s.user.id!==storageKey||!['ADMIN','SUPER_ADMIN','ATENDENTE'].includes(s.user.role)){invalidateStock();protectCustomer(true);throw {status:403};}csrf=s.csrfToken;customerAccess=true;}
  function selectCustomer(c){selectedCustomer=c;$('customer-selection').textContent=c?'Cliente desta compra: '+c.name+' · CPF '+c.cpfMasked:'';$('customer-selection').hidden=!c;$('customer-use').hidden=!!c&&candidateCustomer?.id===c.id;renderCart();}
  function openCustomer(c){if(locked()||!customerAccess)return;editingCustomer=c?{id:c.id,revision:c.revision}:null;$('customer-form').reset();for(const k of customerKeys){const el=$('customer-'+k);if(k==='marketingConsent')el.checked=c?.marketingConsent===true;else el.value=k==='cpf'?c?'':$('customer-search-cpf').value:c?.[k]??(k==='contactPreference'?'NONE':'');}$('customer-cpf').required=!c;$('customer-cpf-hint').textContent=c?'CPF '+c.cpfMasked+' — identidade preservada.':'';$('customer-editor-title').textContent=c?'Editar cliente':'Cadastrar cliente';$('customer-form-status').textContent='';lockCustomer();$('customer-editor').showModal();$('customer-name').focus();}
  async function saveCustomer(){if(customerBusy||busy||!online()||!customerPending&&(!fresh()||!customerAccess))return;if(!customerPending){if(!$('customer-form').reportValidity())return;const record={};for(const k of customerKeys)record[k]=k==='marketingConsent'?$('customer-'+k).checked:$('customer-'+k).value;customerPending={uncertain:false,body:{commandId:crypto.randomUUID(),id:editingCustomer?.id||crypto.randomUUID(),expectedRevision:editingCustomer?.revision||0,record}};}const command=customerPending,ticket=customerEpoch;customerBusy=true;renderCart();let saved=null,selected=false;
   try{await customerSession();checkCustomer(ticket);if(customerPending!==command)throw {code:'CONTEXT_CHANGED'};saved=await api('/api/v1/customers/save',command.body);customerPending=null;checkCustomer(ticket);const d=await api('/api/v1/customers/get',{id:saved.id});await customerSession();checkCustomer(ticket);if(!d.customer)throw Error('CUSTOMER_MISSING');candidateCustomer=d.customer;selectCustomer(d.customer);selected=true;
   }catch(e){$('customer-form-status').textContent=customerFailure(e);globalThis.LivrariaMessages?.highlight($('customer-form'),e,'customer-form-status');const rejected=e.code?.includes('INVALID_CUSTOMER')||e.code?.includes('DUPLICATE')||e.code?.includes('CONFLICT');if(customerPending){if(rejected&&!customerPending.uncertain)customerPending=null;else customerPending.uncertain=true;}}
   finally{customerBusy=false;if(saved){$('customer-editor').close();$('customer-form').reset();editingCustomer=null;$('customer-cpf-hint').textContent='';$('customer-match').hidden=true;$('customer-status').textContent=selected?'Cadastro salvo e selecionado para esta compra.':'Cadastro salvo. Não foi possível carregar os dados para esta compra. Confira o acesso e busque o CPF novamente antes de selecionar.';}renderCart();}
  }
  $('customer-cep').addEventListener('click',async()=>{if(customerBusy||customerPending||!fresh()||!customerAccess)return;const postalCode=$('customer-postalCode').value,ticket=customerEpoch;customerBusy=true;renderCart();try{await customerSession();checkCustomer(ticket);const data=await api('/api/v1/customers/postal-code',{postalCode});await customerSession();checkCustomer(ticket);if($('customer-postalCode').value!==postalCode)throw {code:'CONTEXT_CHANGED'};for(const k of ['postalCode','street','district','city','state'])$('customer-'+k).value=data[k];$('customer-form-status').textContent='Endereço sugerido pelo CEP. Confira os dados e informe o número.';}catch(e){if(ticket===customerEpoch)$('customer-form-status').textContent='Não foi possível consultar o CEP. Você pode preencher o endereço manualmente.';}finally{customerBusy=false;renderCart();}});
  $('customer-form').addEventListener('submit',e=>{e.preventDefault();saveCustomer();});$('customer-resume').addEventListener('click',saveCustomer);$('customer-refresh').addEventListener('click',refresh);$('customer-close').addEventListener('click',()=>{if(customerBusy||customerPending)return;$('customer-editor').close();$('customer-form').reset();editingCustomer=null;$('customer-cpf-hint').textContent='';});$('customer-editor').addEventListener('cancel',e=>{if(customerBusy||customerPending)e.preventDefault();else{$('customer-form').reset();editingCustomer=null;$('customer-cpf-hint').textContent='';}});
  for(const mode of ['customer-anonymous','customer-identified'])$(mode).addEventListener('change',()=>{if(locked())return;customerEpoch++;selectCustomer(null);candidateCustomer=null;$('customer-match').hidden=true;$('customer-new').hidden=true;$('customer-status').textContent='';$('customer-search-form').reset();$('customer-lookup').hidden=!identified();renderCart();});
  $('customer-search-form').addEventListener('submit',async e=>{e.preventDefault();if(locked()||!customerAccess)return;const cpf=$('customer-search-cpf').value,ticket=customerEpoch;customerBusy=true;candidateCustomer=null;selectCustomer(null);$('customer-match').hidden=true;$('customer-new').hidden=true;$('customer-status').textContent='Buscando cadastro…';renderCart();try{await customerSession();checkCustomer(ticket);const d=await api('/api/v1/customers/find',{cpf});await customerSession();checkCustomer(ticket);if($('customer-search-cpf').value!==cpf)throw {code:'CONTEXT_CHANGED'};candidateCustomer=d.customer;if(d.customer){$('customer-match-text').textContent=d.customer.name+' · CPF '+d.customer.cpfMasked;$('customer-match').hidden=false;$('customer-use').hidden=false;$('customer-status').textContent='Confira a pessoa antes de usar o cadastro.';}else{$('customer-status').textContent='Nenhum cadastro encontrado. Cadastre o cliente ou conclua sem identificação.';$('customer-new').hidden=false;}}catch(error){$('customer-status').textContent=customerFailure(error);}finally{customerBusy=false;renderCart();}});
  $('customer-search-cpf').addEventListener('input',()=>{customerEpoch++;candidateCustomer=null;$('customer-match').hidden=true;$('customer-new').hidden=true;selectCustomer(null);});$('customer-use').addEventListener('click',()=>{if(!locked()&&customerAccess&&candidateCustomer)selectCustomer(candidateCustomer);});$('customer-new').addEventListener('click',()=>openCustomer(null));$('customer-edit').addEventListener('click',()=>openCustomer(candidateCustomer));
  window.addEventListener('beforeunload',e=>{if(customerPending||pending||busy){e.preventDefault();e.returnValue='';}});window.addEventListener('pagehide',()=>{invalidateStock();});
  async function api(path, body) {
    if (!online()) throw Object.assign(Error('OFFLINE'), { code:'OFFLINE' });
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(path, { credentials:'same-origin', cache:'no-store', signal:controller.signal,
        ...(body ? { method:'POST', headers:{ 'content-type':'application/json', 'x-csrf-token':csrf }, body:JSON.stringify(body) } : {}) });
      const value = await response.json();
      if (!response.ok) throw Object.assign(Error('REQUEST_FAILED'), { code:value.error?.code,field:value.error?.field,readOnly:!body, status:response.status });
      return value.data;
    } catch (error) {
      if (!error.status || error.status === 401 || error.status === 403) invalidateStock();
      if (error.status === 401 || error.status === 403) protectCustomer(true);
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function message(error) {
    if (error.status === 401) return 'Entre na conta verificada para continuar. Se houver uma venda pendente, volte com a mesma conta para conferir o resultado.';
    if (error.status === 403) return 'Esta conta não pode concluir esta operação. Confira seu acesso.';
    if (error.code === 'CHECKOUT_NOT_ACTIVATED' || error.code === 'WORKSPACE_CHECKOUT_UNAVAILABLE') return 'O Caixa compartilhado ainda não está disponível nesta instalação DEV.';
    return 'Não foi possível atualizar. Confira sua conexão e tente novamente.';
  }
  function renderCart() {
    connectionStatus();
    $('cart-items').replaceChildren(); let total = 0;
    for (const [id, quantity] of cart) {
      const product = records.get(id), row = document.createElement('div'); row.className = 'cart-line';
      const title = document.createElement('p'); title.textContent = (product?.title || 'Livro ' + id) + (product ? ' — ' + money(product.priceCents) : '');
      const label = document.createElement('label'); label.textContent = 'Quantidade';
      const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '1000000'; input.step = '1'; input.value = quantity; input.disabled = locked();
      input.addEventListener('change', () => {
        if (locked()) return;
        const value = Number(input.value);
        if (Number.isSafeInteger(value) && value > 0 && value <= 1000000) cart.set(id, value);
        renderCart();
      });
      label.append(input);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = 'Remover'; remove.disabled = locked();
      remove.addEventListener('click', () => { if (!locked()) { cart.delete(id); renderCart(); } });
      row.append(title, label, remove); $('cart-items').append(row);
      if (product) total += product.priceCents * quantity;
      if (product && (!product.active || product.stock < quantity)) {
        const warning = document.createElement('p'); warning.textContent = product.stock === 0 ? 'Sem estoque. Reponha as unidades ou remova este livro para continuar.' : 'Quantidade indisponível. Estoque atual: ' + product.stock + '.'; row.append(warning);
      }
    }
    $('total').textContent = 'Total: ' + money(pending?.expectedTotalCents ?? receipt?.totalCents ?? total);
    $('payment').disabled = locked();
    $('customer-options').disabled=locked();
    $('cart-title').textContent=identified()?'Compra identificada':'Compra sem cadastro';
    $('confirm').textContent = pending ? 'Verificar resultado / tentar novamente' : identified()?'Confirmar venda identificada':'Confirmar venda sem cadastro';
    $('confirm').disabled = !online() || !pending && !fresh() || busy || customerBusy || !!customerPending || !!receipt || !cart.size || !pending&&identified()&&!selectedCustomer || !pending && (!Number.isSafeInteger(total) || [...cart].some(([id, quantity]) => { const p = records.get(id); return !p || !p.active || p.stock < quantity; }));
    $('new-sale').disabled = busy || !!pending || customerBusy || !!customerPending;
    document.querySelectorAll('[data-add]').forEach(button => { const p = records.get(button.dataset.add); button.disabled = locked() || !p?.active || p.stock < 1; });
    lockCustomer();
    return total;
  }
  let activeNiche='';
  async function loadCashNiches(){const d=await api('/api/v1/catalog/niches'),host=$('cash-niches');host.hidden=d.nichesEnabled!==true;if(host.hidden){activeNiche='';return;}const list=d.niches.filter(n=>n.active).sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name));if(activeNiche&&!list.some(n=>n.id===activeNiche)){activeNiche='';offset=0;}host.replaceChildren();for(const n of [{id:'',name:'Todos os livros',description:'Explore o catálogo completo',color:'#205b43'},...list]){const b=document.createElement('button');b.type='button';b.className='cash-niche';b.setAttribute('aria-pressed',String(activeNiche===n.id));b.style.borderColor=n.color;if(n.imageUrl){const img=document.createElement('img');img.src=n.imageUrl;img.alt='';img.loading='lazy';img.addEventListener('error',()=>img.remove(),{once:true});b.append(img);}const label=document.createElement('strong');label.textContent=n.name;const desc=document.createElement('span');desc.textContent=n.description;b.append(label,desc);b.addEventListener('click',()=>{if(refreshing)return;activeNiche=n.id;offset=0;refresh();});host.append(b);}}
  async function refresh() {
    if (refreshing || document.hidden || !csrf || !online()) return;
    refreshing = true; stockReady = false; clearTimeout(freshnessTimer); renderCart();
    const version = connectionVersion;
    try {
      const session = await api('/api/v1/session');
      if ('checkout.pending.' + session.user.id !== storageKey) { invalidateStock(); protectCustomer(true); throw Object.assign(Error('ACCOUNT_CHANGED'), {status:401}); }
      csrf = session.csrfToken;
      await loadCashNiches();
      const query = new URLSearchParams({ q:$('query').value.trim(), offset:String(offset),niche:activeNiche });
      const data = await api('/api/v1/catalog/list?' + query);
      // Do not unlock from a partial page, or from a response that crossed a
      // disconnect/reconnect. Selected books outside this page must also pass.
      const selected = new Map();
      for (const id of cart.keys()) if (!data.products.some(p => p.id === id)) {
        const detail = await api('/api/v1/catalog/get?id=' + encodeURIComponent(id)); selected.set(id, detail.product);
      }
      if (version !== connectionVersion || !online()) return;
      $('books').replaceChildren(); nextOffset = data.nextOffset;
      for (const product of data.products) {
        records.set(product.id, product);
        const article = document.createElement('article'); article.className = 'book';
        if (product.photoUrl || product.coverUrl) {
          const img = document.createElement('img'); img.src = product.photoUrl || product.coverUrl; img.alt = 'Capa de ' + product.title; img.referrerPolicy = 'no-referrer'; img.addEventListener('error', () => img.remove(), { once:true }); article.append(img);
        }
        const detail = document.createElement('div'), title = document.createElement('h2'), info = document.createElement('p'), add = document.createElement('button');
        title.textContent = product.title; info.textContent = money(product.priceCents) + ' · Estoque: ' + product.stock + (product.stock === 0 ? ' · Sem estoque' : '');
        add.type = 'button'; add.textContent = 'Adicionar'; add.dataset.add = product.id;
        add.addEventListener('click', () => {
          if (locked()) return;
          const quantity = cart.get(product.id) || 0, current = records.get(product.id);
          if (quantity >= current.stock) { $('sale-status').textContent = 'A quantidade selecionada já atingiu o estoque disponível.'; return; }
          if (!cart.has(product.id) && cart.size >= 100) { $('sale-status').textContent = 'Limite de 100 livros diferentes por compra.'; return; }
          cart.set(product.id, quantity + 1); renderCart();
        });
        detail.append(title, info, add); article.append(detail); $('books').append(article);
      }
      for (const [id, product] of selected) records.set(id, product);
      stockReady = true; customerAccess = true; checkedAt = performance.now();
      freshnessTimer = setTimeout(() => { stockReady = false; renderCart(); }, FRESH_FOR);
      $('count').textContent = data.total + ' livro(s) · Estoque conferido às ' + new Date().toLocaleTimeString('pt-BR', { timeZone:'America/Sao_Paulo' });
      $('previous').hidden = offset === 0; $('next').hidden = nextOffset === null;
      $('status').textContent = 'Estoque compartilhado atualizado.'; renderCart();
    } catch (error) { $('status').textContent = message(error); }
    finally {
      refreshing = false; renderCart();
      if (refreshAgain) { refreshAgain = false; refresh(); }
    }
  }
  function showReceipt(data) {
    window.dispatchEvent(new Event('livraria:stock-changed'));
    receipt = data; $('receipt').hidden = false;$('receipt').querySelector('h3').textContent=data.state==='CANCELADA'?'Venda cancelada':'Venda confirmada';
    $('receipt-text').textContent = 'Venda ' + data.saleId + ' · ' + money(data.totalCents) + ' · ' + methods[data.paymentMethod] + ' · ' +
      new Date(data.createdAt).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo' }) + (data.customerId?' · Cliente identificado.':' · Sem cadastro de cliente.');
    $('sale-status').textContent = data.state==='CANCELADA'?'Esta venda foi cancelada administrativamente. Consulte o histórico antes de iniciar outra operação.':'Venda confirmada pelo servidor. Estoque atualizado.';
    $('receipt').scrollIntoView({ block:'nearest' });
  }
  $('payment-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!online() || busy || receipt || !cart.size || !pending && !fresh()) { renderCart(); return; }
    if (!pending) {
      const total = renderCart();
      if ($('confirm').disabled || !Number.isSafeInteger(total)) return;
      const command = { idempotencyKey:crypto.randomUUID(), items:[...cart].map(([productId, quantity]) => ({ productId, quantity })), paymentMethod:$('payment').value, customerId:identified()?selectedCustomer.id:null, expectedTotalCents:total };
      try { sessionStorage.setItem(storageKey, JSON.stringify(command)); }
      catch { $('sale-status').textContent = 'Não foi possível guardar a referência desta compra neste navegador. Libere espaço antes de confirmar. Nenhuma venda foi enviada.'; return; }
      pending = command;
    }
    busy = true; renderCart(); $('sale-status').textContent = 'Conferindo e registrando a venda…';
    try {
      // Fetch a fresh CSRF value and verify the current user before retrying.
      const session = await api('/api/v1/session');
      if ('checkout.pending.' + session.user.id !== storageKey) throw Error('ACCOUNT_CHANGED');
      csrf = session.csrfToken;
      const data = await api('/api/v1/checkout', pending);
      showReceipt(data);
      try { sessionStorage.removeItem(storageKey); pending = null; }
      catch { $('sale-status').textContent = 'Venda confirmada. Recarregue esta página para recuperar o comprovante antes de iniciar outra compra.'; }
      await refresh();
    } catch (error) {
      const rejected = ['WORKSPACE_INSUFFICIENT_STOCK', 'WORKSPACE_PRODUCT_UNAVAILABLE', 'WORKSPACE_CUSTOMER_UNAVAILABLE', 'WORKSPACE_SALE_PRICE_CHANGED', 'INVALID_SALE', 'WORKSPACE_INVALID_SALE'].includes(error.code);
      if (rejected) {
        try { sessionStorage.removeItem(storageKey); pending = null; }
        catch { $('sale-status').textContent = 'Venda rejeitada. Não foi possível limpar a referência local; confira novamente antes de iniciar outra compra.'; return; }
        $('sale-status').textContent = error.code === 'WORKSPACE_SALE_PRICE_CHANGED' ? 'O preço mudou. Confira o total atualizado antes de confirmar novamente.' : 'Venda não registrada: confira os livros e as quantidades disponíveis.';
        await refresh();
      } else $('sale-status').textContent = 'Não foi possível confirmar o resultado. Não inicie outra compra para estes itens. Use “Verificar resultado / tentar novamente”, ou retorne a esta página com a mesma conta. ' + (error.status === 401 || error.status === 403 ? message(error) : '');
    } finally { busy = false; renderCart(); }
  });
  $('new-sale').addEventListener('click', () => {
    if (pending || busy || customerPending || customerBusy) return;
    clearCustomer(); receipt = null; cart.clear(); $('receipt').hidden = true; $('sale-status').textContent = ''; $('payment').value = 'PIX'; renderCart(); refresh();
  });
  $('search-form').addEventListener('submit', event => { event.preventDefault(); if (!refreshing) { offset = 0; refresh(); } });
  $('refresh').addEventListener('click', refresh);
  $('previous').addEventListener('click', () => { if (!refreshing) { offset = Math.max(0, offset - 10); refresh(); } });
  $('next').addEventListener('click', () => { if (!refreshing && nextOffset !== null) { offset = nextOffset; refresh(); } });
  window.addEventListener('focus', refresh);
  window.addEventListener('offline', invalidateStock);
  window.addEventListener('online', () => {
    invalidateStock();
    if (!started) { start(); return; }
    if (refreshing) refreshAgain = true; else refresh();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) invalidateStock(); else refresh(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { invalidateStock(); refresh(); } });
  async function start() {
    if (location.origin !== ORIGIN) { $('status').textContent = 'Esta tela funciona exclusivamente no endereço DEV autorizado.'; return; }
    if (starting || started) return;
    starting = true;
    const version = connectionVersion;
    try {
      const session = await api('/api/v1/session'); csrf = session.csrfToken; storageKey = 'checkout.pending.' + session.user.id;
      const capabilities = await api('/api/v1/catalog/niches');
      if (capabilities.checkoutEnabled !== true) { $('status').textContent = 'O Caixa compartilhado ainda não está disponível nesta instalação DEV.'; return; }
      customersEnabled=capabilities.customersEnabled===true;$('customer-options').hidden=!customersEnabled;
      let raw; try { raw = sessionStorage.getItem(storageKey); } catch { throw Error('STORAGE_UNAVAILABLE'); }
      if (raw) {
        // Strictly validate local recovery data; never load identity or prices
        // from storage as authentication or authoritative business records.
        const value = JSON.parse(raw), uuid = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
        if (raw.length > 16000 || !value || Object.keys(value).sort().join() !== 'customerId,expectedTotalCents,idempotencyKey,items,paymentMethod' ||
            !uuid(value.idempotencyKey) || value.customerId !== null && !uuid(value.customerId) || !Object.hasOwn(methods, value.paymentMethod) || !Number.isSafeInteger(value.expectedTotalCents) || value.expectedTotalCents < 0 ||
            !Array.isArray(value.items) || !value.items.length || value.items.length > 100 || value.items.some(item => !item || Object.keys(item).sort().join() !== 'productId,quantity' || !uuid(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) || new Set(value.items.map(item => item.productId)).size !== value.items.length) throw Error('INVALID_RECOVERY');
        if(value.customerId){$('customer-identified').checked=true;$('customer-anonymous').checked=false;$('customer-selection').hidden=false;$('customer-selection').textContent='Cliente identificado na compra pendente. Os dados pessoais não foram carregados.';}
        pending = value; for (const line of pending.items) cart.set(line.productId, line.quantity);
        $('payment').value = pending.paymentMethod; $('sale-status').textContent = 'Há uma compra aguardando confirmação. Verifique o resultado antes de iniciar outra.';
      }
      started = true; $('checkout').hidden = false; renderCart(); await refresh(); setInterval(refresh, 30000);
    } catch (error) { $('status').textContent = error.code === 'OFFLINE' ? 'Sem conexão. Mantenha a aba aberta; o acesso será conferido ao reconectar.' : error.status ? message(error) : 'Não foi possível recuperar o Caixa com segurança neste navegador. Preserve a aba e confira o acesso antes de continuar.'; }
    finally { starting = false; if (!started && online() && version !== connectionVersion) start(); }
  }
  start();
})();
