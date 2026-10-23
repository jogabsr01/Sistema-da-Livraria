'use strict';
(() => {
  const $ = id => document.getElementById(id), message = text => { $('status').textContent = text; };
  let csrf = '', niches = [], offset = 0, nextOffset = null, editing = null, command = null, draftId = '', busy = false, lookupGeneration = 0, lookupController = null, photosEnabled = false, pendingPhoto, photoPreview = '', cameraStream = null, cameraGeneration = 0;
  const pendingImages = new Set();
  const money = cents => (cents / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  function explain(error) {
    if (error.code?.includes('COVER_PHOTO')) return 'A foto não pôde ser salva. Use uma imagem JPEG, PNG ou WebP, ou confira se as fotos estão habilitadas nesta instalação DEV.';
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
      const image = document.createElement('span'); cover(book.photoUrl || book.coverUrl, image); const content = document.createElement('div');
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
    cancelLookup(); cleanupPhoto();
    editing = id ? (await api('get', null, '?id=' + encodeURIComponent(id))).product : null; command = null;
    draftId = editing?.id || crypto.randomUUID();
    $('book-form').reset(); $('editor-title').textContent = editing ? 'Detalhes e edição' : 'Cadastrar livro'; $('form-status').textContent = ''; $('reload-book').hidden = true; $('isbn-status').textContent = 'A consulta sugere dados e verifica capas disponíveis. Confira a edição antes de salvar.';
    const mappings = { isbn:'isbn',title:'title',author:'author',publisher:'publisher',edition:'edition',supplier:'supplier',category:'category',cover:'coverUrl',synopsis:'synopsis' };
    Object.entries(mappings).forEach(([input,key]) => { $(input).value = editing?.[key] || ''; });
    $('price').value = editing ? (editing.priceCents / 100).toFixed(2).replace('.',',') : '';
    $('minimum-stock').value = editing?.minimumStock ?? 0; $('year').value = editing?.year || ''; $('pages').value = editing?.pages || ''; $('active').checked = editing?.active ?? true;
    $('stock-info').textContent = editing ? `Estoque atual: ${editing.stock}. O cadastro não altera o saldo.` : 'Estoque inicial: 0. Entradas e vendas serão integradas na etapa de estoque.';
    choices(editing?.nicheIds || (niches.filter(n => n.active).length === 1 ? [niches.find(n => n.active).id] : [])); cover(editing?.photoUrl || $('cover').value, $('cover-preview'), true);
    if (!$('editor').open) $('editor').showModal();
  }
  $('book-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
    cancelLookup();
    const price = $('price').value.trim(); if (!/^\d{1,7}(?:[,.]\d{1,2})?$/.test(price)) { $('form-status').textContent = 'Informe o preço como 12,90, sem separador de milhares.'; return; }
    const [units, fractional = ''] = price.split(/[,.]/), priceCents = Number(units) * 100 + Number(fractional.padEnd(2,'0'));
    const fields = { isbn:$('isbn').value, internalCode:$('isbn').value.trim() ? '' : editing?.internalCode || '', title:$('title').value, author:$('author').value,
      publisher:$('publisher').value,edition:$('edition').value,supplier:$('supplier').value,priceCents,minimumStock:Number($('minimum-stock').value),category:$('category').value,
      coverUrl:$('cover').value,year:Number($('year').value),pages:Number($('pages').value),synopsis:$('synopsis').value,
      nicheIds:[...document.querySelectorAll('#niche-choices input:checked')].map(input => input.value),active:$('active').checked };
    const signature = JSON.stringify({fields,photo:pendingPhoto}); if (!command || command.signature !== signature) command = { signature, id:crypto.randomUUID() };
    $('form-status').textContent = 'Salvando e aguardando a confirmação…';
    await api('save', { commandId:command.id,id:draftId,expectedVersion:editing?.version || 0,record:fields,...(pendingPhoto === undefined ? {}:{photo:pendingPhoto}) });
    $('editor').close();
    try { await list(); message('Livro salvo com confirmação do servidor.'); }
    catch { message('Livro salvo com confirmação do servidor. Não foi possível atualizar a lista; use Atualizar catálogo.'); }
  }, true); });
  $('new').addEventListener('click', () => run(() => openBook(null))); $('close').addEventListener('click', () => $('editor').close());
  $('reload-book').addEventListener('click', () => run(() => openBook(editing.id), true));
  $('editor').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('editor').addEventListener('close',()=>{cancelLookup();cleanupPhoto();});
  window.addEventListener('pagehide',()=>{cancelLookup();cleanupPhoto();});
  $('isbn').addEventListener('input',() => { cancelLookup(); $('isbn-status').textContent = 'ISBN alterado. Consulte novamente ou preencha manualmente.'; });
  $('isbn').addEventListener('keydown',event => { if (event.key === 'Enter' && !$('isbn-tools').hidden) { event.preventDefault(); $('isbn-lookup').click(); } });
  $('cover').addEventListener('change', () => { let url; try { url = new URL($('cover').value); } catch { url = null; }
    const valid = url?.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && url.hostname.includes('.') && !url.hostname.endsWith('.') &&
      !/^(?:[\d.]+|\[.*\])$/.test(url.hostname) && !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname);
    if (valid && photosEnabled && (editing?.hasPhoto || pendingPhoto !== undefined)) { pendingPhoto = null; releasePreview(); stopCamera(); }
    cover(valid ? url.href : photoPreview || (pendingPhoto === undefined ? editing?.photoUrl : '') || '', $('cover-preview'), true); });
  function stopCamera() {
    cameraGeneration++; cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = null;
    $('camera-video').srcObject = null; $('camera-panel').hidden = true;
  }
  function releasePreview() { if (photoPreview) URL.revokeObjectURL(photoPreview); photoPreview = ''; }
  function cleanupPhoto() { stopCamera(); releasePreview(); pendingPhoto = undefined; $('photo-file').value = ''; $('photo-status').textContent = 'Use a câmera do celular ou a webcam do computador, ou escolha uma imagem.'; }
  async function acceptPhoto(source) {
    let width = source.width || source.videoWidth, height = source.height || source.videoHeight;
    if (!width || !height) throw Error('EMPTY_IMAGE');
    const ratio = Math.min(1, 1200 / Math.max(width,height)); width = Math.max(1,Math.round(width*ratio)); height = Math.max(1,Math.round(height*ratio));
    const canvas = document.createElement('canvas'); let blob;
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,width,height); ctx.drawImage(source,0,0,width,height);
      blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg', Math.max(.45,.8-attempt*.08)));
      if (blob && blob.size <= 60000) break;
      width = Math.max(1,Math.round(width*.8)); height = Math.max(1,Math.round(height*.8));
    }
    if (!blob || blob.size > 60000) throw Error('LARGE_IMAGE');
    // Only an in-memory preview; the server validates and re-encodes once more.
    const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    cancelLookup(); pendingPhoto = btoa(binary); releasePreview(); photoPreview = URL.createObjectURL(blob); $('cover').value = '';
    cover(photoPreview,$('cover-preview'),true); $('photo-status').textContent = 'Foto pronta. Clique em Salvar livro para enviá-la.';
  }
  $('gallery-open').addEventListener('click', () => { cancelLookup(); stopCamera(); $('photo-file').click(); });
  $('photo-file').addEventListener('change', () => {
    const file = $('photo-file').files[0]; if (!file) return; cancelLookup();
    run(async () => {
      let image;
      try {
        if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 12*1024*1024) throw Error('INVALID_IMAGE');
        image = await createImageBitmap(file); await acceptPhoto(image);
      } catch { $('photo-status').textContent = 'Não foi possível abrir esta imagem. Escolha JPEG, PNG ou WebP de até 12 MB.'; }
      finally { image?.close(); $('photo-file').value = ''; }
    },true);
  });
  $('camera-open').addEventListener('click', async () => {
    cancelLookup(); stopCamera(); const generation = cameraGeneration;
    $('photo-status').textContent = 'Autorize o uso da câmera quando o navegador pedir.';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('NO_CAMERA');
      const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},audio:false});
      if (generation !== cameraGeneration || !$('editor').open) { stream.getTracks().forEach(track => track.stop()); return; }
      cameraStream = stream; $('camera-video').srcObject = stream; $('camera-panel').hidden = false;
      await $('camera-video').play();
      if (generation === cameraGeneration) $('photo-status').textContent = 'Posicione a capa e clique em Usar foto.';
    } catch {
      if (generation === cameraGeneration) { stopCamera(); $('photo-status').textContent = 'A câmera não está disponível ou a permissão foi negada. Você pode escolher uma imagem da galeria.'; }
    }
  });
  $('camera-cancel').addEventListener('click', () => { stopCamera(); $('photo-status').textContent = 'Câmera encerrada. Você pode escolher uma imagem da galeria.'; });
  $('camera-capture').addEventListener('click', () => run(async () => {
    try { await acceptPhoto($('camera-video')); stopCamera(); }
    catch { $('photo-status').textContent = 'A câmera ainda não está pronta. Aguarde a prévia ou escolha uma imagem da galeria.'; }
  },true));
  $('photo-remove').addEventListener('click', () => { cancelLookup(); stopCamera(); releasePreview(); pendingPhoto = null; $('cover').value = ''; cover('',$('cover-preview'),true); $('photo-status').textContent = 'Capa removida deste cadastro. Salve para confirmar.'; });
  function cancelLookup() {
    lookupGeneration++; lookupController?.abort(); lookupController = null;
    [...pendingImages].forEach(cancel => cancel()); $('isbn-cancel').hidden = true;
    $('isbn-lookup').disabled = busy;
  }
  function testCover(candidate) {
    return new Promise(resolve => {
      let done = false; const img = new Image(); img.referrerPolicy = 'no-referrer';
      const finish = ok => { if (done) return; done = true; clearTimeout(timer); pendingImages.delete(cancel); img.onload = null; img.onerror = null; if (!ok) img.removeAttribute('src'); resolve(ok ? {...candidate,image:img} : null); };
      const cancel = () => finish(false), timer = setTimeout(cancel,4000); pendingImages.add(cancel);
      img.onload = () => finish(img.complete && img.naturalWidth >= 30 && img.naturalHeight >= 40);
      img.onerror = cancel; img.src = candidate.url;
    });
  }
  $('isbn-cancel').addEventListener('click', () => { cancelLookup(); $('isbn-status').textContent = 'Consulta cancelada. Você pode preencher e salvar manualmente.'; });
  $('isbn-lookup').addEventListener('click', async () => {
    if (busy) return; cancelLookup(); const generation = lookupGeneration, raw = $('isbn').value;
    if (!raw.trim()) { $('isbn-status').textContent = 'Informe um ISBN para consultar, ou continue o cadastro sem código.'; return; }
    const controller = new AbortController(); lookupController = controller; $('isbn-lookup').disabled = true; $('isbn-cancel').hidden = false;
    const mappings = {title:'title',author:'author',publisher:'publisher',edition:'edition',year:'year',pages:'pages',synopsis:'synopsis'};
    const before = Object.fromEntries([...Object.keys(mappings),'cover'].map(id => [id,$(id).value]));
    const current = () => generation === lookupGeneration && $('editor').open && $('isbn').value === raw;
    $('isbn-status').textContent = 'Consultando as fontes bibliográficas… Você pode continuar preenchendo o cadastro.';
    try {
      const response = await fetch('/api/v1/catalog/isbn',{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({isbn:raw})});
      const result = await response.json(); if (!current()) return;
      if (!response.ok) {
        const code = result.error?.code;
        $('isbn-status').textContent = code === 'INVALID_ISBN' ? 'ISBN inválido. Confira os dígitos na contracapa.' : code === 'ISBN_RATE_LIMITED' ? `Limite de consultas atingido. Aguarde ${result.error.retryAfterSeconds || 60} segundos ou preencha manualmente.` : code === 'ISBN_LOOKUP_NOT_ACTIVATED' ? 'A consulta por ISBN ainda não foi habilitada nesta instalação. Continue manualmente.' : 'A consulta está indisponível. Seus campos foram preservados; continue manualmente.'; return;
      }
      const data = result.data;
      if (data.metadata) Object.entries(mappings).forEach(([id,key]) => {
        if (!before[id].trim() && $(id).value === before[id] && data.metadata[key]) $(id).value = String(data.metadata[key]);
      });
      const trace = data.sources.map(source => source.name + ': ' + ({found:'dados encontrados',not_found:'sem registro',timeout:'tempo esgotado',unavailable:'sem conexão',invalid_response:'resposta inválida',http_error:'HTTP '+source.httpStatus}[source.status] || 'indisponível')).join(' · ');
      let found = null, preserveCover = before.cover.trim() || (pendingPhoto === undefined ? editing?.hasPhoto : pendingPhoto !== null);
      if (!preserveCover && $('cover').value === before.cover) {
        $('isbn-status').textContent = 'Verificando se as imagens de capa carregam…';
        const local = data.covers.filter(item => item.cachedAsset === true && new URL(item.url).origin === location.origin);
        const cached = await Promise.all(local.map(testCover)); if (!current()) return; found = cached.find(Boolean);
        if (!found) { const candidates = await Promise.all(data.covers.filter(item => !local.includes(item)).map(testCover)); if (!current()) return; found = candidates.find(Boolean); }
        if ($('cover').value !== before.cover || (pendingPhoto === undefined ? editing?.hasPhoto : pendingPhoto !== null)) { preserveCover = true; found = null; }
        else if (found) { $('cover').value = found.url; found.image.alt = 'Capa do livro'; $('cover-preview').replaceChildren(found.image); }
      }
      const summary = data.metadata ? 'Sugestões recebidas. Confira os dados e a edição antes de salvar.' : 'Nenhuma ficha exata foi encontrada. Preencha os dados manualmente.';
      $('isbn-status').textContent = summary + (preserveCover ? ' A capa existente foi preservada.' : found ? ' Capa carregada: '+found.source+'.' : ' Nenhuma capa disponível carregou; use câmera, galeria ou um link, ou continue sem capa.') + (data.cached ? ' Fontes em cache recente: ' : ' Consultas: ') + trace;
    } catch (error) {
      if (current() && error.name !== 'AbortError') $('isbn-status').textContent = 'Falha de conexão na consulta. Seus campos foram preservados; continue manualmente.';
    } finally {
      if (generation === lookupGeneration) { lookupController = null; $('isbn-cancel').hidden = true; $('isbn-lookup').disabled = busy; }
    }
  });
  $('search-form').addEventListener('submit', event => { event.preventDefault(); offset = 0; run(list); });
  $('refresh').addEventListener('click', () => run(list)); $('next').addEventListener('click', () => { offset = nextOffset; run(list); }); $('previous').addEventListener('click', () => { offset = Math.max(0,offset-10); run(list); });
  if (location.hostname !== 'dev--merry-chimera-49a1f3.netlify.app' || location.protocol !== 'https:') { message('Este catálogo está disponível exclusivamente no endereço DEV da livraria.'); return; }
  run(async () => {
    const response = await fetch('/api/v1/session', { credentials:'same-origin',cache:'no-store' }); if (!response.ok) { message('Entre na conta verificada para usar o catálogo.'); return; }
    const { data } = await response.json(); csrf = data.csrfToken;
    const capabilities = await api('niches'); $('isbn-tools').hidden = capabilities.lookupEnabled !== true; photosEnabled = capabilities.photosEnabled === true; $('photo-controls').hidden = !photosEnabled;
    niches = capabilities.niches.sort((a,b) => a.order-b.order || a.name.localeCompare(b.name));
    niches.filter(n => n.active).forEach(niche => { const option = document.createElement('option'); option.value = niche.id; option.textContent = niche.name; $('niche-filter').append(option); });
    await list(); $('catalog').hidden = false;
  });
})();
