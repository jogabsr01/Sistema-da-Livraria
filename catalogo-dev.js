'use strict';
(() => {
  const $ = id => document.getElementById(id), message = text => { $('status').textContent = text; };
  const entryParams = new URL(location.href).searchParams;
  $('query').value = (entryParams.get('q') || '').slice(0,100);
  let csrf = '', niches = [], offset = 0, nextOffset = null, editing = null, command = null, draftId = '', busy = false, lookupGeneration = 0, lookupController = null, photosEnabled = false, pendingPhoto, photoPreview = '', cameraStream = null, cameraGeneration = 0;
  const pendingImages = new Set();
  let canDelete = false, stockTarget = null, pendingStock = null, stockStorageKey = '', archiveCommand = null;
  let userId = '', ready = false, checkedAt = 0, connectionVersion = 0, reconnectQueued = false, reconciling = false, freshnessTimer, dirty = false, initialized = false, archiveUncertain = false;
  const online = () => navigator.onLine !== false;
  const fresh = () => ready && online() && performance.now() - checkedAt < 90000;
  function controls() {
    const uncertain = !!command?.pending, other = uncertain || !!archiveCommand;
    const state = !online() ? 'offline' : fresh() ? 'ready' : reconciling ? 'checking' : 'stale';
    const text = !online() ? 'Sem conexão. O formulário permanece nesta aba; nenhuma gravação será enviada.'
      : other || pendingStock ? 'Há um pedido aguardando confirmação. Confira o mesmo pedido antes de iniciar outro; reconectar não o reenvia.'
      : fresh() ? 'Catálogo conferido. Os dados serão validados novamente pelo servidor ao salvar.'
      : 'Confira a conexão e o catálogo antes de gravar. Seus campos não serão substituídos pela atualização.';
    document.querySelectorAll('[data-catalog-network]').forEach(el => { el.dataset.state = state; el.textContent = text; });
    document.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    $('new').disabled = busy || !fresh() || other || !!pendingStock;
    document.querySelectorAll('.book button').forEach(button => { button.disabled = busy || !fresh() || other || !!pendingStock; if (button.dataset.catalogDelete) button.hidden = !canDelete; });
    for (const id of ['refresh','previous','next','resume-stock','resume-archive']) $(id).disabled = busy || !online();
    document.querySelectorAll('[data-catalog-refresh],#search-form button').forEach(button => { button.disabled = busy || !online(); });
    $('resume-archive').hidden = !archiveCommand;
    $('save').disabled = busy || !online() || !uncertain && !fresh() || !!archiveCommand || !!pendingStock;
    $('save').textContent = uncertain ? 'Verificar cadastro / tentar novamente' : 'Salvar livro';
    $('close').disabled = busy || uncertain;
    $('reload-book').disabled = busy || uncertain || !fresh();
    document.querySelectorAll('#book-form input,#book-form select,#book-form textarea').forEach(input => { input.disabled = busy && !reconciling || uncertain; });
    $('active').disabled = busy && !reconciling || uncertain || !canDelete;
    for (const id of ['isbn-lookup','gallery-open','camera-open','camera-capture','photo-remove']) $(id).disabled = busy || uncertain || id === 'isbn-lookup' && !fresh();
    $('stock-save').disabled = busy || !online() || !pendingStock && !fresh() || other;
    $('stock-quantity').disabled = busy || !!pendingStock; $('stock-reason').disabled = busy || !!pendingStock;
  }
  function invalidate() { connectionVersion++; ready = false; clearTimeout(freshnessTimer); controls(); }
  async function requestData(path, body) {
    if (!online()) throw Object.assign(Error('OFFLINE'), {code:'OFFLINE'});
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),25000);
    try {
      const response = await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:body?{'content-type':'application/json','x-csrf-token':csrf}:{},body:body?JSON.stringify(body):undefined});
      const value = await response.json();
      if (!response.ok) throw Object.assign(Error('CATALOG_FAILED'),{status:response.status,code:value.error?.code,field:value.error?.field,readOnly:!body});
      return value.data;
    } catch(error) { if (!error.status || error.status===401 || error.status===403) invalidate(); throw error; }
    finally { clearTimeout(timeout); }
  }
  async function sameAccount() {
    const data = await requestData('/api/v1/session');
    if (data.user.id !== userId) { invalidate(); throw Object.assign(Error('ACCOUNT_CHANGED'),{status:401,code:'UNAUTHENTICATED'}); }
    csrf = data.csrfToken; canDelete = ['ADMIN','SUPER_ADMIN'].includes(data.user.role); $('niche-admin-link').hidden = !canDelete;
  }
  const money = cents => (cents / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  function explain(error) { if(error.code==='CATALOG_NOT_ACTIVATED')return 'O cadastro de produtos ainda não foi ativado. Peça à administração para liberar o catálogo.'; const common = globalThis.LivrariaMessages?.describe(error); if (common) return common;
    if (error.code === 'OFFLINE') return 'Sem conexão. Mantenha a aba aberta e confira a conexão antes de tentar novamente.';
    if (error.code?.includes('COVER_PHOTO')) return 'A foto não pôde ser salva. Use uma imagem JPEG, PNG ou WebP, ou confira se as fotos estão habilitadas nesta instalação DEV.';
    if (error.code === 'UNAUTHENTICATED') return 'Entre na conta verificada para usar o catálogo.';
    if (error.code?.includes('CONFLICT')) return 'Outro acesso alterou este livro. Carregue a versão mais recente antes de salvar de novo.';
    if (error.code?.includes('DUPLICATE')) return 'Já existe um livro ativo com esse ISBN ou código interno.';
    if (error.code === 'FORBIDDEN' || error.code === 'WORKSPACE_FORBIDDEN') return 'Somente administradores podem excluir ou alterar a ativação de livros.';
    if (error.code?.includes('STOCK_LIMIT')) return 'Esta entrada excede o limite de um milhão de unidades. Confira a quantidade.';
    if (error.code === 'INVALID_PRODUCT' || error.code?.includes('CATALOG_INVALID')) return 'Confira ISBN, preço, nichos e link HTTPS da capa. Use valores válidos e ao menos um nicho.';
    if (error.code?.includes('NOT_ACTIVATED') || error.code === 'WORKSPACE_CATALOG_UNAVAILABLE' || error.code?.includes('CONFIGURATION')) return 'O catálogo compartilhado ainda não está disponível nesta instalação DEV.';
    return 'Não foi possível confirmar o resultado. Confira a conexão e tente novamente; o mesmo pedido não será duplicado.';
  }
  async function api(operation, body, query = '') {
    if (body) await sameAccount();
    try { return await requestData('/api/v1/catalog/' + operation + query,body); }
    catch(error) { if(body && error.status===403) reconnectQueued = true; throw error; }
  }
  async function run(action, form = false) {
    if (busy) return; busy = true; controls();
    try { await action(); } catch (error) { const text = explain(error); if (form) { $('form-status').textContent = text; globalThis.LivrariaMessages?.highlight($('book-form'),error,'form-status'); $('reload-book').hidden = !editing || !error.code?.includes('CONFLICT'); } else {message(text);$('catalog-error-actions').hidden=false;} }
    finally { busy = false; controls(); if (reconnectQueued) { reconnectQueued = false; reconnect(); } }
  }
  function cover(url, parent, preview = false) {
    parent.replaceChildren(); const fallback = document.createElement('span'); fallback.className = 'fallback'; fallback.textContent = preview ? 'Capa não informada' : '📖';
    if (!url) { parent.append(fallback); return; }
    const img = document.createElement('img'); img.alt = 'Capa do livro'; img.referrerPolicy = 'no-referrer'; img.src = url;
    img.addEventListener('error', () => { fallback.textContent = preview ? 'A imagem não carregou. Confira o link da capa.' : '📖'; parent.replaceChildren(fallback); }, { once:true }); parent.append(img);
  }
  let deferredCatalogRead=false;
  async function list(preloaded = null) {
    if(preloaded&&deferredCatalogRead){$('books').replaceChildren();$('count').textContent='Novo cadastro de produto';nextOffset=null;return true;}
    deferredCatalogRead=false;
    const ticket=++listSequence, version=connectionVersion;
    const params = new URLSearchParams({ q:$('query').value, offset:String(offset), niche:$('niche-filter').value, inactive:String($('inactive').checked) });
    const data = preloaded || await api('list', null, '?' + params);if(ticket!==listSequence || version!==connectionVersion || !online())return false; nextOffset = data.nextOffset; $('books').replaceChildren();
    data.products.forEach(book => {
      const article = document.createElement('article'); article.className = 'book';
      const image = document.createElement('span'); cover(book.photoUrl || book.coverUrl, image); const content = document.createElement('div');
      const title = document.createElement('h2'); title.textContent = book.title;
      const author = document.createElement('p'); author.textContent = book.author || 'Autor não informado';
      const price = document.createElement('p'); price.textContent = money(book.priceCents) + ' · Estoque: ' + book.stock + (book.stock === 0 ? ' · Sem estoque' : '') + (book.active ? '' : ' · Inativo');
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Detalhes e edição'; edit.addEventListener('click', () => run(() => openBook(book.id)));
      content.append(title, author, price, edit);
      if (book.active) {
        const stock = document.createElement('button'); stock.type = 'button'; stock.className = 'secondary'; stock.textContent = 'Adicionar unidades';
        stock.addEventListener('click', () => run(() => openStock(book.id))); content.append(stock);
        if (canDelete) {
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = 'Excluir livro';
          remove.dataset.catalogDelete='true'; remove.addEventListener('click', () => run(async () => {
            if (!fresh() || command?.pending || pendingStock || archiveCommand) return;
            if (!confirm('Excluir “' + book.title + '” do catálogo ativo? O cadastro e seu histórico serão preservados.')) return;
            if (!archiveCommand || archiveCommand.id !== book.id || archiveCommand.expectedVersion !== book.version) { archiveCommand = { commandId:crypto.randomUUID(),id:book.id,expectedVersion:book.version }; archiveUncertain = false; }
            await finishArchive();
          })); content.append(remove);
        }
      }
      article.append(image, content); $('books').append(article);
    });
    $('count').textContent = data.total ? `${data.total} livro(s) encontrado(s). Página ${Math.floor(offset / 10) + 1}.` : 'Nenhum livro encontrado.';
    $('previous').hidden = offset === 0; $('next').hidden = nextOffset === null; message('Catálogo atualizado com os dados do servidor.'); return true;
  }
  let nicheLoading=false,listSequence=0;
  async function refreshNiches(preloaded=null){if(nicheLoading)return;nicheLoading=true;try{const data=preloaded||await api('niches'),selected=$('niche-filter').value;niches=data.niches.sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name));$('niche-filter').replaceChildren(new Option('Todos os nichos',''));for(const n of niches.filter(n=>n.active))$('niche-filter').append(new Option(n.name,n.id));$('niche-filter').value=niches.some(n=>n.active&&n.id===selected)?selected:'';if($('editor').open&&!command)choices([...document.querySelectorAll('#niche-choices input:checked')].map(n=>n.value));}finally{nicheLoading=false;}}
  function choices(selected) {
    $('niche-choices').replaceChildren(); niches.filter(n => n.active||editing?.nicheIds.includes(n.id)).forEach(niche => {
      const label = document.createElement('label'); label.className = 'check'; const input = document.createElement('input'); input.type = 'checkbox'; input.value = niche.id; input.checked = selected.includes(niche.id);
      label.append(input, document.createTextNode(niche.name+(niche.active?'':' (desativado)'))); $('niche-choices').append(label);
    });
  }
  async function openBook(id) {
    if (!fresh() || command?.pending || pendingStock || archiveCommand) return;
    cancelLookup(); cleanupPhoto();
    editing = id ? (await api('get', null, '?id=' + encodeURIComponent(id))).product : null; command = null;
    draftId = editing?.id || crypto.randomUUID();
    $('book-form').reset(); $('editor-title').textContent = editing ? 'Detalhes e edição' : 'Cadastrar livro'; $('form-status').textContent = ''; $('reload-book').hidden = true; $('isbn-status').textContent = 'A consulta sugere dados e verifica capas disponíveis. Confira a edição antes de salvar.';
    const mappings = { isbn:'isbn',title:'title',author:'author',publisher:'publisher',edition:'edition',supplier:'supplier',category:'category',cover:'coverUrl',synopsis:'synopsis' };
    Object.entries(mappings).forEach(([input,key]) => { $(input).value = editing?.[key] || ''; });
    $('price').value = editing ? (editing.priceCents / 100).toFixed(2).replace('.',',') : '';
    $('minimum-stock').value = editing?.minimumStock ?? 0; $('year').value = editing?.year || ''; $('pages').value = editing?.pages || ''; $('active').checked = editing?.active ?? true;
    $('active').disabled = !canDelete;
    $('stock-info').textContent = editing ? `Estoque atual: ${editing.stock}. ${editing.stock === 0 ? 'Sem estoque: o livro continua editável. ' : ''}Para repor, use Adicionar unidades no catálogo.` : 'Estoque inicial: 0. Após salvar, use Adicionar unidades para registrar uma entrada.';
    choices(editing?.nicheIds || (niches.filter(n => n.active).length === 1 ? [niches.find(n => n.active).id] : [])); cover(editing?.photoUrl || $('cover').value, $('cover-preview'), true);
    if (!$('editor').open) $('editor').showModal();
    dirty = false;
  }
  async function finishArchive() {
    if (!archiveCommand || !online()) return;
    try { await api('remove',archiveCommand); }
    catch(error) {
      if (!archiveUncertain && ['INVALID_PRODUCT','WORKSPACE_CATALOG_CONFLICT','FORBIDDEN','WORKSPACE_FORBIDDEN'].includes(error.code)) archiveCommand=null;
      else archiveUncertain=true;
      throw error;
    }
    window.dispatchEvent(new Event('livraria:stock-changed')); archiveCommand = null; archiveUncertain = false;
    try { await list(); message('Livro excluído do catálogo ativo. Cadastro e histórico preservados.'); }
    catch { message('Exclusão confirmada. Confira a conexão para atualizar a lista.'); }
  }
  $('resume-archive').addEventListener('click',() => run(finishArchive));
  $('book-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
    if (!online() || !command?.pending && !fresh() || pendingStock || archiveCommand) return;
    cancelLookup(); stopCamera();
    if (!command?.pending) {
    const price = $('price').value.trim(); if (!/^\d{1,7}(?:[,.]\d{1,2})?$/.test(price)) { $('form-status').textContent = 'Informe o preço como 12,90, sem separador de milhares.'; return; }
    const [units, fractional = ''] = price.split(/[,.]/), priceCents = Number(units) * 100 + Number(fractional.padEnd(2,'0'));
    const fields = { isbn:$('isbn').value, internalCode:$('isbn').value.trim() ? '' : editing?.internalCode || '', title:$('title').value, author:$('author').value,
      publisher:$('publisher').value,edition:$('edition').value,supplier:$('supplier').value,priceCents,minimumStock:Number($('minimum-stock').value),category:$('category').value,
      coverUrl:$('cover').value,year:Number($('year').value),pages:Number($('pages').value),synopsis:$('synopsis').value,
      nicheIds:[...document.querySelectorAll('#niche-choices input:checked')].map(input => input.value),active:$('active').checked };
    const signature = JSON.stringify({fields,photo:pendingPhoto}); if (!command || command.signature !== signature) command = { signature, id:crypto.randomUUID() };
    command.payload = { commandId:command.id,id:draftId,expectedVersion:editing?.version || 0,record:fields,...(pendingPhoto === undefined ? {}:{photo:pendingPhoto}) };
    command.pending = true;
    }
    $('form-status').textContent = 'Salvando e aguardando a confirmação…';
    const uncertain = command.uncertain === true;
    try { await api('save', command.payload); }
    catch(error) {
      const rejected = ['INVALID_PRODUCT','INVALID_COVER_PHOTO','COVER_PHOTO_TOO_LARGE','WORKSPACE_CATALOG_INVALID','WORKSPACE_CATALOG_DUPLICATE','WORKSPACE_CATALOG_CONFLICT','FORBIDDEN','WORKSPACE_FORBIDDEN'].includes(error.code);
      if (rejected && !uncertain) command = null; else command.uncertain = true;
      throw error;
    }
    command = null; dirty = false; reconnectQueued = true;
    window.dispatchEvent(new Event('livraria:stock-changed'));
    $('editor').close();
    try { await list(); message('Livro salvo com confirmação do servidor.'); }
    catch { message('Livro salvo com confirmação do servidor. Não foi possível atualizar a lista; use Atualizar catálogo.'); }
  }, true); });
  $('new').addEventListener('click', () => run(() => openBook(null))); $('close').addEventListener('click', () => $('editor').close());
  async function openStock(id) {
    if (!online() || command?.pending || archiveCommand) return;
    if (pendingStock && pendingStock.id !== id) { message('Verifique a entrada pendente antes de iniciar outra.'); return; }
    stockTarget = (await api('get', null, '?id=' + encodeURIComponent(id))).product;
    $('stock-product').textContent = stockTarget.title + ' · Estoque atual: ' + stockTarget.stock;
    $('stock-quantity').value = pendingStock?.quantity || 1; $('stock-reason').value = pendingStock?.reason || 'REPOSICAO';
    $('stock-quantity').disabled = !!pendingStock; $('stock-reason').disabled = !!pendingStock;
    $('stock-save').textContent = pendingStock ? 'Verificar entrada / tentar novamente' : 'Confirmar entrada';
    $('stock-status').textContent = pendingStock ? 'Há uma entrada aguardando confirmação. A mesma referência será usada para evitar duplicidade.' : 'As unidades serão adicionadas ao saldo atual deste mesmo livro.';
    if (!$('stock-editor').open) $('stock-editor').showModal();
  }
  $('stock-close').addEventListener('click', () => $('stock-editor').close());
  $('stock-editor').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('resume-stock').addEventListener('click', () => { if (pendingStock) run(() => openStock(pendingStock.id)); });
  $('stock-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
    if (!online() || !pendingStock && !fresh() || command?.pending || archiveCommand) return;
    if (!stockTarget) return;
    if (!pendingStock) {
      const quantity = Number($('stock-quantity').value);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) { $('stock-status').textContent = 'Informe uma quantidade inteira de 1 a 1.000.000.'; return; }
      const value = { commandId:crypto.randomUUID(),id:stockTarget.id,expectedVersion:stockTarget.version,quantity,reason:$('stock-reason').value };
      try { sessionStorage.setItem(stockStorageKey, JSON.stringify(value)); } catch { $('stock-status').textContent = 'Não foi possível guardar a referência neste navegador. Nenhuma entrada foi enviada.'; return; }
      pendingStock = value; $('resume-stock').hidden = false;
    }
    $('stock-quantity').disabled = true; $('stock-reason').disabled = true;
    $('stock-save').textContent = 'Verificar entrada / tentar novamente'; $('stock-status').textContent = 'Registrando a entrada e conferindo o saldo…';
    try {
      const result = await api('receive', pendingStock);
      window.dispatchEvent(new Event('livraria:stock-changed'));
      try { sessionStorage.removeItem(stockStorageKey); } catch { $('stock-status').textContent = 'Entrada confirmada. Não foi possível limpar a referência local. Use Verificar entrada para recuperar este mesmo resultado antes de iniciar outra.'; return; }
      pendingStock = null; $('resume-stock').hidden = true; $('stock-editor').close();
      let updated = true; try { await list(); } catch { updated = false; }
      message('Entrada confirmada: ' + result.quantity + ' unidade(s). Saldo após esta entrada: ' + result.stockAfter + '.' + (updated ? '' : ' Use Atualizar catálogo para conferir os dados mais recentes.'));
    } catch (error) {
      if (['WORKSPACE_CATALOG_CONFLICT','WORKSPACE_STOCK_LIMIT','WORKSPACE_PRODUCT_UNAVAILABLE','INVALID_STOCK_RECEIPT','WORKSPACE_INVALID_STOCK_RECEIPT'].includes(error.code)) {
        try { sessionStorage.removeItem(stockStorageKey); pendingStock = null; $('resume-stock').hidden = true; } catch { $('stock-status').textContent = 'Não foi possível limpar a referência. Verifique esta entrada antes de iniciar outra.'; return; }
        await openStock(stockTarget.id); $('stock-status').textContent = 'Entrada não registrada. Confira o saldo atualizado, o status do livro e a quantidade antes de confirmar novamente.';
      } else $('stock-status').textContent = 'Não foi possível confirmar o resultado. Use Verificar entrada / tentar novamente. A referência será recuperada nesta aba após recarga com a mesma conta.';
    }
  }); });
  $('reload-book').addEventListener('click', () => run(() => openBook(editing.id), true));
  $('editor').addEventListener('cancel', event => { if (busy || command?.pending) event.preventDefault(); });
  $('editor').addEventListener('close',()=>{cancelLookup();cleanupPhoto();dirty=false;if(deferredCatalogRead&&!busy){$('count').textContent='Carregando produtos…';run(()=>list());}});
  $('book-form').addEventListener('input',()=>{dirty=true;});
  window.addEventListener('beforeunload',event=>{if(dirty || command?.pending || pendingStock || archiveCommand || busy){event.preventDefault();event.returnValue='';}});
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
    cancelLookup(); dirty = true; pendingPhoto = btoa(binary); releasePreview(); photoPreview = URL.createObjectURL(blob); $('cover').value = '';
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
  $('photo-remove').addEventListener('click', () => { cancelLookup(); stopCamera(); releasePreview(); dirty = true; pendingPhoto = null; $('cover').value = ''; cover('',$('cover-preview'),true); $('photo-status').textContent = 'Capa removida deste cadastro. Salve para confirmar.'; });
  function cancelLookup() {
    lookupGeneration++; lookupController?.abort(); lookupController = null;
    [...pendingImages].forEach(cancel => cancel()); $('isbn-cancel').hidden = true;
    $('isbn-lookup').disabled = busy || !!command?.pending || !fresh();
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
    if (busy || command?.pending || !fresh()) return; cancelLookup(); const generation = lookupGeneration, raw = $('isbn').value;
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
        if (!before[id].trim() && $(id).value === before[id] && data.metadata[key]) { $(id).value = String(data.metadata[key]); dirty = true; }
      });
      const trace = data.sources.map(source => source.name + ': ' + ({found:'dados encontrados',not_found:'sem registro',timeout:'tempo esgotado',unavailable:'sem conexão',invalid_response:'resposta inválida',http_error:'HTTP '+source.httpStatus}[source.status] || 'indisponível')).join(' · ');
      let found = null, preserveCover = before.cover.trim() || (pendingPhoto === undefined ? editing?.hasPhoto : pendingPhoto !== null);
      if (!preserveCover && $('cover').value === before.cover) {
        $('isbn-status').textContent = 'Verificando se as imagens de capa carregam…';
        const local = data.covers.filter(item => item.cachedAsset === true && new URL(item.url).origin === location.origin);
        const cached = await Promise.all(local.map(testCover)); if (!current()) return; found = cached.find(Boolean);
        if (!found) { const candidates = await Promise.all(data.covers.filter(item => !local.includes(item)).map(testCover)); if (!current()) return; found = candidates.find(Boolean); }
        if ($('cover').value !== before.cover || (pendingPhoto === undefined ? editing?.hasPhoto : pendingPhoto !== null)) { preserveCover = true; found = null; }
        else if (found) { dirty = true; $('cover').value = found.url; found.image.alt = 'Capa do livro'; $('cover-preview').replaceChildren(found.image); }
      }
      const summary = data.metadata ? 'Sugestões recebidas. Confira os dados e a edição antes de salvar.' : 'Nenhuma ficha exata foi encontrada. Preencha os dados manualmente.';
      $('isbn-status').textContent = summary + (preserveCover ? ' A capa existente foi preservada.' : found ? ' Capa carregada: '+found.source+'.' : ' Nenhuma capa disponível carregou; use câmera, galeria ou um link, ou continue sem capa.') + (data.cached ? ' Fontes em cache recente: ' : ' Consultas: ') + trace;
    } catch (error) {
      if (current() && error.name !== 'AbortError') $('isbn-status').textContent = 'Falha de conexão na consulta. Seus campos foram preservados; continue manualmente.';
    } finally {
      if (generation === lookupGeneration) { lookupController = null; $('isbn-cancel').hidden = true; $('isbn-lookup').disabled = busy; }
    }
  });
  $('search-form').addEventListener('submit', event => { event.preventDefault(); offset = 0; reconnect(); });
  $('refresh').addEventListener('click', reconnect); $('next').addEventListener('click', () => { offset = nextOffset; reconnect(); }); $('previous').addEventListener('click', () => { offset = Math.max(0,offset-10); reconnect(); });
  document.querySelectorAll('[data-catalog-refresh]').forEach(button=>button.addEventListener('click',reconnect));
  if (location.hostname !== 'dev--merry-chimera-49a1f3.netlify.app' || location.protocol !== 'https:') { message('Este catálogo está disponível exclusivamente no endereço DEV da livraria.'); return; }
  window.addEventListener('offline',()=>{invalidate();cancelLookup();});
  window.addEventListener('online',()=>{invalidate();reconnect();});
  window.addEventListener('focus',reconnect);
  window.addEventListener('pageshow',event=>{if(event.persisted){invalidate();reconnect();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else reconnect();});
  setInterval(reconnect,30000);
  async function initialize() {
    const params=new URLSearchParams({q:$('query').value,offset:String(offset),niche:$('niche-filter').value,inactive:String($('inactive').checked),create:String(!initialized&&entryParams.get('novo')==='1')});
    const data=await requestData('/api/v1/catalog/bootstrap?'+params);deferredCatalogRead=params.get('create')==='true';
    if (userId && userId !== data.user.id) throw Object.assign(Error('ACCOUNT_CHANGED'),{code:'UNAUTHENTICATED',status:401});
    userId = data.user.id; csrf = data.csrfToken; canDelete = ['ADMIN','SUPER_ADMIN'].includes(data.user.role);$('niche-admin-link').hidden=!canDelete; stockStorageKey = 'catalog.stock.pending.' + data.user.id;
    const stored = sessionStorage.getItem(stockStorageKey);
    if (stored) {
      const value = JSON.parse(stored), uuid = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
      if (stored.length > 2000 || !value || Object.keys(value).sort().join() !== 'commandId,expectedVersion,id,quantity,reason' || !uuid(value.commandId) || !uuid(value.id) ||
          !Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1 || value.expectedVersion >= 1000000000 || !Number.isSafeInteger(value.quantity) || value.quantity < 1 || value.quantity > 1000000 || !['REPOSICAO','ESTOQUE_INICIAL','RECEBIMENTO'].includes(value.reason)) throw Error('INVALID_RECOVERY');
      pendingStock = value; $('resume-stock').hidden = false;
    }
    document.body.dataset.sessionRole=data.user.role;if($('module-account'))$('module-account').hidden=false;window.dispatchEvent(new Event('livraria:session-ready'));const capabilities = data; $('isbn-tools').hidden = capabilities.lookupEnabled !== true; photosEnabled = capabilities.photosEnabled === true; $('photo-controls').hidden = !photosEnabled;return data;
  }
  async function reconnect() {
    if (!online() || document.hidden) { controls(); if (!initialized && !online()) message('Sem conexão. Mantenha esta aba aberta; o acesso será conferido ao reconectar.'); return; }
    if (busy) { reconnectQueued = true; return; }
    reconciling = true;
    await run(async()=>{
      reconciling = true; ready = false; clearTimeout(freshnessTimer); controls();
      const version = connectionVersion, first = !initialized;
      try {
        const bootstrap=await initialize();
        await refreshNiches(bootstrap);
        if (await list(bootstrap) && version === connectionVersion && online() && !document.hidden) {
          ready = true; checkedAt = performance.now();
          freshnessTimer = setTimeout(()=>{ready=false;controls();},90000);
          initialized = true; $('catalog').hidden = false;$('catalog-error-actions').hidden=true;
          if (first) {
            const params = new URL(location.href).searchParams, focusId = params.get('livro'), stockId = params.get('entrada');
            const validId = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
            if (validId(stockId)) await openStock(stockId); else if (validId(focusId)) await openBook(focusId); else if (entryParams.get('novo') === '1') await openBook(null);
          }
        }
      } finally { reconciling = false; }
    });
  }
  if(entryParams.get('novo')==='1'){$('catalog-title').textContent='Novo produto';$('catalog-intro').textContent='Cadastre os dados do livro e organize seu catálogo.';}
  $('catalog-retry').addEventListener('click',reconnect);
  reconnect();
})();
