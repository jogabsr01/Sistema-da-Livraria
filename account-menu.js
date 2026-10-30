'use strict';
(() => {
  if (location.origin !== 'https://dev--merry-chimera-49a1f3.netlify.app') return;
  let node=null, epoch=0, user='', role='', loadedAt=0, loading=false;
  const knownRole=()=>['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(document.body.dataset.sessionRole);
  const online=()=>navigator.onLine!==false;
  function clear(){epoch++;loadedAt=0;user='';role='';node?.remove();node=null;}
  function check(ticket){if(ticket!==epoch||!online()||document.hidden)throw Error('CONTEXT_CHANGED');}
  async function request(path,body,csrf){
    if(!online())throw Error('OFFLINE');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{const r=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body?{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)}:{})});if(!r.ok)throw {status:r.status};return (await r.json()).data;}finally{clearTimeout(timer);}
  }
  function valid(p){return p&&typeof p.name==='string'&&p.name.length<=160&&typeof p.id==='string'&&['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(p.role)&&(!p.photoUrl||/^\/api\/v1\/profile\/photo\?v=\d+$/.test(p.photoUrl));}
  function groupedNavigation(host){
    if(!host.querySelector('a')||host.dataset.grouped==='true')return;
    host.dataset.grouped='true';host.replaceChildren();
    const home=document.createElement('a');home.href='/home-dev.html';home.textContent='Início';home.className='home-link';host.append(home);
    for(const [label,items] of [['Catálogo',[['Pesquisar produto','/catalogo-dev.html'],['Adicionar novo produto','/catalogo-dev.html?novo=1'],['Nichos','/nichos-dev.html',true]]],['Rotina',[['Nova compra','/caixa-dev.html'],['Histórico e operações','/operacoes-dev.html'],['Notificações','/notificacoes-dev.html'],['Escalas','/escalas-dev.html']]]]){
      const group=document.createElement('details');group.className='module-menu';const title=document.createElement('summary');title.textContent=label;group.append(title);const options=document.createElement('div');options.className='account-options';
      for(const [text,href,admin]of items){const a=document.createElement('a');a.href=href;a.textContent=text;if(admin)a.dataset.navigationAdmin='true';options.append(a);}group.append(options);group.addEventListener('toggle',()=>{if(group.open)group.style.setProperty('--module-menu-top',Math.min(group.getBoundingClientRect().bottom+8,innerHeight-90)+'px');});host.append(group);
    }
  }
  function refreshAdministrativeLinks(){for(const a of document.querySelectorAll('[data-navigation-admin]'))a.hidden=!['ADMIN','SUPER_ADMIN'].includes(document.body.dataset.sessionRole);}
  function render(p=null,open=false){
    if(!online()||document.hidden)return;
    const host=document.querySelector('header nav')||document.querySelector('nav');if(!host)return;
    if(p&&!valid(p))return;groupedNavigation(host);refreshAdministrativeLinks();
    const menu=document.createElement('details');menu.className='account-menu';
    const summary=document.createElement('summary');summary.setAttribute('aria-label',p?'Abrir menu de '+p.name:'Abrir menu da conta');
    const avatar=document.createElement(p?.photoUrl?'img':'span');
    if(p?.photoUrl){avatar.src=p.photoUrl;avatar.alt='';}else avatar.textContent=p?p.name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase():'Conta';
    summary.append(avatar);menu.append(summary);
    const list=document.createElement('div');list.className='account-options';
    const currentRole=p?.role||document.body.dataset.sessionRole;
    const administrative=['ADMIN','SUPER_ADMIN'].includes(currentRole)?[['Gerenciar equipe','/equipe-dev.html'],['Relatórios','/relatorios-dev.html']]:[];
    for(const [label,href] of [['Meu perfil','/meu-perfil-dev.html'],...administrative,...(p?.recoveryEnabled?[['Alterar PIN','/acesso-dev.html#recuperar-pin']]:[]),...(p?.schedulesEnabled?[['Minha escala','/escalas-dev.html']]:[]),['Notificações','/notificacoes-dev.html']]){const link=document.createElement('a');link.textContent=label;link.href=href;list.append(link);}
    const status=document.createElement('p');status.setAttribute('role','status');status.hidden=true;
    const logout=document.createElement('button');logout.type='button';logout.textContent='Sair';
    logout.addEventListener('click',async()=>{
      logout.disabled=true;const ticket=epoch;
      try{const s=await request('/api/v1/session');check(ticket);if(user&&(s.user.id!==user||s.user.role!==role))throw Error('CONTEXT_CHANGED');await request('/api/v1/session/logout',{},s.csrfToken);clear();location.assign('/acesso-dev.html');}
      catch(e){if(e.status===401){clear();location.assign('/acesso-dev.html');return;}status.textContent='Não conseguimos confirmar a saída. Aguarde alguns instantes e tente novamente.';status.hidden=false;}
      finally{logout.disabled=false;}
    });
    list.append(logout,status);menu.append(list);menu.open=open;
    menu.addEventListener('toggle',()=>{if(menu.open){menu.style.setProperty('--module-menu-top',Math.min(menu.getBoundingClientRect().bottom+8,innerHeight-90)+'px');load();}});
    node?.remove();node=menu;host.append(menu);
    if(p){user=p.id;role=p.role;loadedAt=Date.now();}
  }
  async function load(){
    if(loading||!online()||document.hidden||Date.now()-loadedAt<60000)return;
    loading=true;const ticket=epoch;
    try{const p=await request('/api/v1/profile/bootstrap');check(ticket);if(!valid(p)||user&&(p.id!==user||p.role!==role))throw Error('CONTEXT_CHANGED');render(p,true);}
    catch(e){
      if(ticket===epoch&&e.status===401){delete document.body.dataset.sessionRole;clear();refreshAdministrativeLinks();}
      else if(ticket===epoch&&knownRole()){loadedAt=Date.now();}
      else if(ticket===epoch&&!knownRole()){
        try{const session=await request('/api/v1/session');check(ticket);if(!['ADMIN','SUPER_ADMIN','ATENDENTE'].includes(session?.user?.role))throw Error('INVALID_SESSION');document.body.dataset.sessionRole=session.user.role;render(null,node?.open===true);loadedAt=Date.now();}
        catch(failure){if(ticket===epoch&&failure.status===401){delete document.body.dataset.sessionRole;clear();refreshAdministrativeLinks();}}
      }
    }
    finally{loading=false;}
  }
  // The main profile page already fetched this self-service DTO. Reuse it only
  // for presentation. Every operation still authenticates on the server.
  window.addEventListener('livraria:session-ready',()=>{clear();render();});
  window.addEventListener('livraria:profile-loaded',e=>{if(valid(e.detail?.profile))render(e.detail.profile,node?.open===true);});
  window.addEventListener('livraria:profile-changed',()=>{clear();render();});
  window.addEventListener('livraria:profile-invalidated',()=>{delete document.body.dataset.sessionRole;clear();refreshAdministrativeLinks();});
  window.addEventListener('livraria:module-unavailable',load);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('header details[open]').forEach(menu=>menu.open=false);});
  document.addEventListener('click',event=>{document.querySelectorAll('header details[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});});
  window.addEventListener('offline',clear);window.addEventListener('online',()=>{clear();render();});
  window.addEventListener('focus',()=>{clear();render();});
  document.addEventListener('visibilitychange',()=>{clear();if(!document.hidden)render();});
  window.addEventListener('pagehide',clear);window.addEventListener('pageshow',e=>{if(e.persisted){clear();render();}});
  // Navigation needs no personal lookup. Fetch personalization on demand only.
  render();
})();
