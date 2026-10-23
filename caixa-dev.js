/* Session storage retains only an anonymous command for response-loss recovery.
 * Server sessions/permissions/prices/stock are always authoritative. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app';
  const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const methods = { PIX:'PIX', DINHEIRO:'Dinheiro', DEBITO:'Débito', CREDITO:'Crédito' };
  const records = new Map(), cart = new Map();
  let csrf = '', storageKey = '', pending = null, receipt = null, busy = false, refreshing = false, offset = 0, nextOffset = null;
  const locked = () => !!pending || busy || !!receipt;
  async function api(path, body) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(path, { credentials:'same-origin', cache:'no-store', signal:controller.signal,
        ...(body ? { method:'POST', headers:{ 'content-type':'application/json', 'x-csrf-token':csrf }, body:JSON.stringify(body) } : {}) });
      const value = await response.json();
      if (!response.ok) throw Object.assign(Error('REQUEST_FAILED'), { code:value.error?.code, status:response.status });
      return value.data;
    } finally { clearTimeout(timeout); }
  }
  function message(error) {
    if (error.status === 401) return 'Entre na conta verificada para continuar. Se houver uma venda pendente, volte com a mesma conta para conferir o resultado.';
    if (error.status === 403) return 'Esta conta não pode concluir esta operação. Confira seu acesso.';
    if (error.code === 'CHECKOUT_NOT_ACTIVATED' || error.code === 'WORKSPACE_CHECKOUT_UNAVAILABLE') return 'O Caixa compartilhado ainda não está disponível nesta instalação DEV.';
    return 'Não foi possível atualizar. Confira sua conexão e tente novamente.';
  }
  function renderCart() {
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
    $('confirm').textContent = pending ? 'Verificar resultado / tentar novamente' : 'Confirmar venda sem cadastro';
    $('confirm').disabled = busy || !!receipt || !cart.size || !pending && (!Number.isSafeInteger(total) || [...cart].some(([id, quantity]) => { const p = records.get(id); return !p || !p.active || p.stock < quantity; }));
    $('new-sale').disabled = busy || !!pending;
    document.querySelectorAll('[data-add]').forEach(button => { const p = records.get(button.dataset.add); button.disabled = locked() || !p?.active || p.stock < 1; });
    return total;
  }
  async function refresh() {
    if (refreshing || document.hidden || !csrf) return;
    refreshing = true;
    try {
      const query = new URLSearchParams({ q:$('query').value.trim(), offset:String(offset) });
      const data = await api('/api/v1/catalog/list?' + query);
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
      // Refresh selected products outside the current page too, before the next
      // confirmation. A pending command keeps its original expected total.
      for (const id of cart.keys()) if (!data.products.some(p => p.id === id)) {
        const detail = await api('/api/v1/catalog/get?id=' + encodeURIComponent(id)); records.set(id, detail.product);
      }
      $('count').textContent = data.total + ' livro(s) · Estoque conferido às ' + new Date().toLocaleTimeString('pt-BR', { timeZone:'America/Sao_Paulo' });
      $('previous').hidden = offset === 0; $('next').hidden = nextOffset === null;
      $('status').textContent = 'Estoque compartilhado atualizado.'; renderCart();
    } catch (error) { $('status').textContent = message(error); }
    finally { refreshing = false; }
  }
  function showReceipt(data) {
    receipt = data; $('receipt').hidden = false;
    $('receipt-text').textContent = 'Venda ' + data.saleId + ' · ' + money(data.totalCents) + ' · ' + methods[data.paymentMethod] + ' · ' +
      new Date(data.createdAt).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo' }) + ' · Sem cadastro de cliente.';
    $('sale-status').textContent = 'Venda confirmada pelo servidor. Estoque atualizado.';
    $('receipt').scrollIntoView({ block:'nearest' });
  }
  $('payment-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || receipt || !cart.size) return;
    if (!pending) {
      const total = renderCart();
      if ($('confirm').disabled || !Number.isSafeInteger(total)) return;
      const command = { idempotencyKey:crypto.randomUUID(), items:[...cart].map(([productId, quantity]) => ({ productId, quantity })), paymentMethod:$('payment').value, customerId:null, expectedTotalCents:total };
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
      const rejected = ['WORKSPACE_INSUFFICIENT_STOCK', 'WORKSPACE_PRODUCT_UNAVAILABLE', 'WORKSPACE_SALE_PRICE_CHANGED', 'INVALID_SALE', 'WORKSPACE_INVALID_SALE'].includes(error.code);
      if (rejected) {
        try { sessionStorage.removeItem(storageKey); pending = null; }
        catch { $('sale-status').textContent = 'Venda rejeitada. Não foi possível limpar a referência local; confira novamente antes de iniciar outra compra.'; return; }
        $('sale-status').textContent = error.code === 'WORKSPACE_SALE_PRICE_CHANGED' ? 'O preço mudou. Confira o total atualizado antes de confirmar novamente.' : 'Venda não registrada: confira os livros e as quantidades disponíveis.';
        await refresh();
      } else $('sale-status').textContent = 'Não foi possível confirmar o resultado. Não inicie outra compra para estes itens. Use “Verificar resultado / tentar novamente”, ou retorne a esta página com a mesma conta. ' + (error.status === 401 || error.status === 403 ? message(error) : '');
    } finally { busy = false; renderCart(); }
  });
  $('new-sale').addEventListener('click', () => {
    if (pending || busy) return;
    receipt = null; cart.clear(); $('receipt').hidden = true; $('sale-status').textContent = ''; $('payment').value = 'PIX'; renderCart(); refresh();
  });
  $('search-form').addEventListener('submit', event => { event.preventDefault(); if (!refreshing) { offset = 0; refresh(); } });
  $('refresh').addEventListener('click', refresh);
  $('previous').addEventListener('click', () => { if (!refreshing) { offset = Math.max(0, offset - 10); refresh(); } });
  $('next').addEventListener('click', () => { if (!refreshing && nextOffset !== null) { offset = nextOffset; refresh(); } });
  window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  async function start() {
    if (location.origin !== ORIGIN) { $('status').textContent = 'Esta tela funciona exclusivamente no endereço DEV autorizado.'; return; }
    try {
      const session = await api('/api/v1/session'); csrf = session.csrfToken; storageKey = 'checkout.pending.' + session.user.id;
      const capabilities = await api('/api/v1/catalog/niches');
      if (capabilities.checkoutEnabled !== true) { $('status').textContent = 'O Caixa compartilhado ainda não está disponível nesta instalação DEV.'; return; }
      let raw; try { raw = sessionStorage.getItem(storageKey); } catch { throw Error('STORAGE_UNAVAILABLE'); }
      if (raw) {
        // Strictly validate local recovery data; never load identity or prices
        // from storage as authentication or authoritative business records.
        const value = JSON.parse(raw), uuid = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
        if (raw.length > 16000 || !value || Object.keys(value).sort().join() !== 'customerId,expectedTotalCents,idempotencyKey,items,paymentMethod' ||
            !uuid(value.idempotencyKey) || value.customerId !== null || !Object.hasOwn(methods, value.paymentMethod) || !Number.isSafeInteger(value.expectedTotalCents) || value.expectedTotalCents < 0 ||
            !Array.isArray(value.items) || !value.items.length || value.items.length > 100 || value.items.some(item => !item || Object.keys(item).sort().join() !== 'productId,quantity' || !uuid(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) || new Set(value.items.map(item => item.productId)).size !== value.items.length) throw Error('INVALID_RECOVERY');
        pending = value; for (const line of pending.items) cart.set(line.productId, line.quantity);
        $('payment').value = pending.paymentMethod; $('sale-status').textContent = 'Há uma compra aguardando confirmação. Verifique o resultado antes de iniciar outra.';
      }
      $('checkout').hidden = false; renderCart(); await refresh(); setInterval(refresh, 30000);
    } catch (error) { $('status').textContent = error.status ? message(error) : 'Não foi possível recuperar o Caixa com segurança neste navegador. Preserve a aba e confira o acesso antes de continuar.'; }
  }
  start();
})();
