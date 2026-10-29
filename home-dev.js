'use strict';
(() => {
  const ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app';
  const $=id=>document.getElementById(id);
  let memberAssetsLoaded=false;
  function memberAssets(){
    if(memberAssetsLoaded)return;memberAssetsLoaded=true;
    for(const src of ['/account-menu.js','/notification-badge.js']){const script=document.createElement('script');script.src=src;script.defer=true;document.head.append(script);}
  }
  let authenticated=false, destination='/catalogo-dev.html', stream=null, reader=null, generation=0, checking=false;
  function stopCamera(){
    generation++;reader?.reset();reader=null;
    stream?.getTracks().forEach(track=>track.stop());stream=null;
    $('barcode-video').srcObject=null;$('camera-panel').hidden=true;$('open-camera').disabled=false;
  }
  function go(query){
    if(!authenticated||!query.trim()||query.length>100)return;
    stopCamera();location.assign(destination+'?'+new URLSearchParams({q:query.trim()}));
  }
  function openLookup(purchase){
    if(!authenticated)return;
    stopCamera();destination=purchase?'/caixa-dev.html':'/catalogo-dev.html';
    $('lookup-title').textContent=purchase?'Nova compra':'Pesquisar produto';
    $('lookup-status').textContent='';$('book-query').value='';$('lookup').showModal();$('open-camera').focus();
  }
  $('new-purchase').addEventListener('click',()=>openLookup(true));
  $('search-product').addEventListener('click',()=>openLookup(false));
  $('close-lookup').addEventListener('click',()=>$('lookup').close());
  $('lookup').addEventListener('close',stopCamera);
  $('lookup').addEventListener('cancel',stopCamera);
  $('search-name').addEventListener('click',()=>{stopCamera();$('lookup-status').textContent='Digite o nome do livro para pesquisar.';$('book-query').focus();});
  $('stop-camera').addEventListener('click',()=>{stopCamera();$('lookup-status').textContent='Câmera desligada. Você também pode digitar o código ou o nome.';});
  $('lookup-form').addEventListener('submit',event=>{event.preventDefault();go($('book-query').value);});
  $('open-camera').addEventListener('click',async()=>{
    stopCamera();const ticket=generation;
    if(!authenticated||!$('lookup').open)return;
    if(!navigator.mediaDevices?.getUserMedia||!globalThis.ZXing){$('lookup-status').textContent='A leitura pela câmera não está disponível neste navegador. Digite o código de barras ou busque pelo nome.';return;}
    $('open-camera').disabled=true;$('lookup-status').textContent='Autorize a câmera para ler o código de barras.';
    try{
      const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
      if(ticket!==generation||!$('lookup').open||document.hidden){acquired.getTracks().forEach(track=>track.stop());return;}
      stream=acquired;$('camera-panel').hidden=false;
      const formats=['EAN_13','EAN_8','UPC_A','UPC_E','CODE_128','CODE_39','ITF'].map(name=>ZXing.BarcodeFormat[name]);
      reader=new ZXing.BrowserMultiFormatReader(new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS,formats]]),250);
      $('lookup-status').textContent='Aponte a câmera para o código de barras do livro.';
      await reader.decodeFromStream(stream,$('barcode-video'),result=>{
        if(ticket!==generation||!$('lookup').open||!result)return;
        const code=result.getText();
        if(typeof code==='string'&&/^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,99}$/.test(code))go(code);
      });
    }catch{
      if(ticket!==generation)return;
      stopCamera();$('lookup-status').textContent='Não foi possível abrir a câmera. Confira a permissão do navegador ou digite o código ou nome do livro.';
    }
  });
  async function load(){
    if(checking)return;checking=true;authenticated=false;$('home').hidden=true;$('welcome').hidden=false;$('member-intro').hidden=true;$('account-navigation').hidden=true;$('retry').hidden=true;document.body.classList.remove('is-member');delete document.body.dataset.sessionRole;
    document.querySelectorAll('[data-admin]').forEach(node=>node.hidden=true);
    if(location.origin!==ORIGIN){$('status').textContent='Abra o endereço DEV da livraria para continuar.';checking=false;return;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    try{
      $('status').textContent='Conferindo seu acesso…';
      const response=await fetch('/api/v1/session',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if(response.status===401||response.status===403){$('status').textContent='Entre na sua conta para abrir a livraria.';$('sign-in').hidden=false;return;}
      if(!response.ok)throw Error('UNAVAILABLE');
      const {data}=await response.json();
      if(!['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(data?.user?.role))throw Error('INVALID_SESSION');
      authenticated=true;document.body.dataset.sessionRole=data.user.role;$('welcome').hidden=true;$('member-intro').hidden=false;$('account-navigation').hidden=false;document.body.classList.add('is-member');$('home').hidden=false;$('status').textContent='O que você quer fazer agora?';memberAssets();
      document.querySelectorAll('[data-admin]').forEach(node=>node.hidden=!['SUPER_ADMIN','ADMIN'].includes(data.user.role));
    }catch{$('status').textContent='Não foi possível conferir seu acesso. Tente novamente.';$('retry').hidden=false;}
    finally{clearTimeout(timer);checking=false;}
  }
  $('retry').addEventListener('click',load);
  window.addEventListener('pagehide',stopCamera);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});
  window.addEventListener('pageshow',event=>{if(event.persisted){$('lookup').close();load();}});
  load();
})();
