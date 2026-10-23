'use strict';
(() => {
  const $ = id => document.getElementById(id), message = text => { $('status').textContent = text; };
  let csrf = '', niches = [], offset = 0, nextOffset = null, editing = null, command = null, draftId = '', busy = false;
  const money = cents => (cents / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  function explain(error) {
    if (error.code === 'UNAUTHENTICATED') return 'Entre na conta verificada para usar o catálogo.';
    if (error.code?.includes('CONFLICT')) return 'Outro acesso alterou este livro. Carregue a versão mais recente antes de salvar de novo.';
    if (error.code?.includes('DUPLICATE')) return 'Já existe um livro ativo com esse ISBN ou código interno.';
    if (error.code?.includes('STOCK_HISTORY')) return 'Este livro já possui histórico de vendas. Sua edição aguarda a integração da etapa de estoque.';
    if (error.code === 'INVALID_PRODUCT' || error.code?.includes('CATALOG_INVALID')) return 'Confira ISBN, preço, nichos e link HTTPS da capa. Use valores válidos e ao menos um nicho.';
    if (error.code?.includes('NOT_ACTIVATED') || error.code === 'WORKSPACE_CATALOG_UNAVAILABLE' || error.code?.includes('CONFIGURATION')) return 'O catálogo compartilhado ainda não está disponível nesta instalação DEV.';
    return 'Não foi possível confirmar o resultado. Confira a conexão e tente novamente; o mesmo pedido não será duplicado.';
  }
  async function api(operation, body, query = '') {
    const response = await fetch('/api/v1/catalog/' + operation + query, { method:body ? 'POST':'GET', credentials:'same-origin', cache:'no-store',
      headers:body ? { 'content-type':'application/json','x-csrf-token':csrf }: {}, body:body ? JSON.stringify(body):undefined });
    const result = await response.json(); if (!response.ok) { const error = Error('CATALOG_FAILED'); error.code = result.error?.code; throw error; } return result.data;
  }
  async function run(action, form = false) {
    if (busy) return; busy = true; document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try { await action(); } catch (error) { const text = explain(error); if (form) { $('form-status').textContent = text; $('reload-book').hidden = !editing || !error.code?.includes('CONFLICT'); } else message(text); }
    finally { busy = false; document.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  }
  function cover(url, parent, preview = false) {
    parent.replaceChildren(); const fallback = document.createElement('span'); fallback.className = 'fallback'; fallback.textContent = preview ? 'Capa não informada' : '📖';
    if (!url) { parent.append(fallback); return; }
    const img = document.createElement('img'); img.alt = 'Capa do livro'; img.referrerPolicy = 'no-referrer'; img.src = url;
    img.addEventListener('error', () => { fallback.textContent = preview ? 'A imagem não carregou. Confira o link da capa.' : '📖'; parent.replaceChildren(fallback); }, { once:true }); parent.append(img);
  }
  async function list() {
    const params = new URLSearchParams({ q:$('query').value, offset:String(offset), niche:$('niche-filter').value, inactive:String($('inactive').checked) });
    const data = await api('list', null, '?' + params); nextOffset = data.nextOffset; $('books').replaceChildren();
    data.products.forEach(book => {
      const article = document.createElement('article'); article.className = 'book';
      const image = document.createElement('span'); cover(book.coverUrl, image); const content = document.createElement('div');
      const title = document.createElement('h2'); title.textContent = book.title;
      const author = document.createElement('p'); author.textContent = book.author || 'Autor não informado';
      const price = document.createElement('p'); price.textContent = money(book.priceCents) + ' · Estoque: ' + book.stock + (book.active ? '' : ' · Inativo');
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Detalhes e edição'; edit.addEventListener('click', () => run(() => openBook(book.id)));
      content.append(title, author, price, edit); article.append(image, content); $('books').append(article);
    });
    $('count').textContent = data.total ? `${data.total} livro(s) encontrado(s). Página ${Math.floor(offset / 10) + 1}.` : 'Nenhum livro encontrado.';
    $('previous').hidden = offset === 0; $('next').hidden = nextOffset === null; message('Catálogo atualizado com os dados do servidor.');
  }
  function choices(selected) {
    $('niche-choices').replaceChildren(); niches.filter(n => n.active).forEach(niche => {
      const label = document.createElement('label'); label.className = 'check'; const input = document.createElement('input'); input.type = 'checkbox'; input.value = niche.id; input.checked = selected.includes(niche.id);
      label.append(input, document.createTextNode(niche.name)); $('niche-choices').append(label);
    });
  }
  async function openBook(id) {
    editing = id ? (await api('get', null, '?id=' + encodeURIComponent(id))).product : null; command = null;
    draftId = editing?.id || crypto.randomUUID();
    $('book-form').reset(); $('editor-title').textContent = editing ? 'Detalhes e edição' : 'Cadastrar livro'; $('form-status').textContent = ''; $('reload-book').hidden = true;
    const mappings = { isbn:'isbn',title:'title',author:'author',publisher:'publisher',edition:'edition',supplier:'supplier',category:'category',cover:'coverUrl',synopsis:'synopsis' };
    Object.entries(mappings).forEach(([input,key]) => { $(input).value = editing?.[key] || ''; });
    $('price').value = editing ? (editing.priceCents / 100).toFixed(2).replace('.',',') : '';
    $('minimum-stock').value = editing?.minimumStock ?? 0; $('year').value = editing?.year || ''; $('pages').value = editing?.pages || ''; $('active').checked = editing?.active ?? true;
    $('stock-info').textContent = editing ? `Estoque atual: ${editing.stock}. O cadastro não altera o saldo.` : 'Estoque inicial: 0. Entradas e vendas serão integradas na etapa de estoque.';
    choices(editing?.nicheIds || (niches.filter(n => n.active).length === 1 ? [niches.find(n => n.active).id] : [])); cover($('cover').value, $('cover-preview'), true);
    if (!$('editor').open) $('editor').showModal();
  }
  $('book-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
    const price = $('price').value.trim(); if (!/^\d{1,7}(?:[,.]\d{1,2})?$/.test(price)) { $('form-status').textContent = 'Informe o preço como 12,90, sem separador de milhares.'; return; }
    const [units, fractional = ''] = price.split(/[,.]/), priceCents = Number(units) * 100 + Number(fractional.padEnd(2,'0'));
    const fields = { isbn:$('isbn').value, internalCode:$('isbn').value.trim() ? '' : editing?.internalCode || '', title:$('title').value, author:$('author').value,
      publisher:$('publisher').value,edition:$('edition').value,supplier:$('supplier').value,priceCents,minimumStock:Number($('minimum-stock').value),category:$('category').value,
      coverUrl:$('cover').value,year:Number($('year').value),pages:Number($('pages').value),synopsis:$('synopsis').value,
      nicheIds:[...document.querySelectorAll('#niche-choices input:checked')].map(input => input.value),active:$('active').checked };
    const signature = JSON.stringify(fields); if (!command || command.signature !== signature) command = { signature, id:crypto.randomUUID() };
    $('form-status').textContent = 'Salvando e aguardando a confirmação…';
    await api('save', { commandId:command.id,id:draftId,expectedVersion:editing?.version || 0,record:fields });
    $('editor').close();
    try { await list(); message('Livro salvo com confirmação do servidor.'); }
    catch { message('Livro salvo com confirmação do servidor. Não foi possível atualizar a lista; use Atualizar catálogo.'); }
  }, true); });
  $('new').addEventListener('click', () => run(() => openBook(null))); $('close').addEventListener('click', () => $('editor').close());
  $('reload-book').addEventListener('click', () => run(() => openBook(editing.id), true));
  $('editor').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('cover').addEventListener('change', () => { let url; try { url = new URL($('cover').value); } catch { url = null; }
    const valid = url?.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && url.hostname.includes('.') && !url.hostname.endsWith('.') &&
      !/^(?:[\d.]+|\[.*\])$/.test(url.hostname) && !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname);
    cover(valid ? url.href : '', $('cover-preview'), true); });
  $('search-form').addEventListener('submit', event => { event.preventDefault(); offset = 0; run(list); });
  $('refresh').addEventListener('click', () => run(list)); $('next').addEventListener('click', () => { offset = nextOffset; run(list); }); $('previous').addEventListener('click', () => { offset = Math.max(0,offset-10); run(list); });
  if (location.hostname !== 'dev--merry-chimera-49a1f3.netlify.app' || location.protocol !== 'https:') { message('Este catálogo está disponível exclusivamente no endereço DEV da livraria.'); return; }
  run(async () => {
    const response = await fetch('/api/v1/session', { credentials:'same-origin',cache:'no-store' }); if (!response.ok) { message('Entre na conta verificada para usar o catálogo.'); return; }
    const { data } = await response.json(); csrf = data.csrfToken;
    niches = (await api('niches')).niches.sort((a,b) => a.order-b.order || a.name.localeCompare(b.name));
    niches.filter(n => n.active).forEach(niche => { const option = document.createElement('option'); option.value = niche.id; option.textContent = niche.name; $('niche-filter').append(option); });
    await list(); $('catalog').hidden = false;
  });
})();
