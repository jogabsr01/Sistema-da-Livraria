'use strict';
(() => {
 if(location.origin!=='https://dev--merry-chimera-49a1f3.netlify.app'||window.livrariaNavigationMounted)return;
 const header=document.querySelector('[data-app-header]');if(!header)return;window.livrariaNavigationMounted=true;
 const nav=header.querySelector('nav'),account=header.querySelector('.account-menu'),avatar=header.querySelector('[data-account-avatar]'),status=header.querySelector('[data-account-status]');
 let identity='',role='',loggingOut=false;
 const administrative=()=>['ADMIN','SUPER_ADMIN'].includes(role);
 function synchronize(){role=document.body.dataset.sessionRole||'';header.querySelectorAll('[data-navigation-admin]').forEach(a=>a.hidden=!administrative());if(document.body.classList.contains('page-home'))nav.hidden=!['ADMIN','SUPER_ADMIN','ATENDENTE'].includes(role);else nav.hidden=false;}
 function clearPersonal(){identity='';avatar.replaceChildren(document.createTextNode('Conta'));account.querySelector('summary').setAttribute('aria-label','Abrir menu da conta');}
 function closeMenus(except=null){header.querySelectorAll('details[open]').forEach(menu=>{if(menu!==except)menu.open=false;});}
 header.querySelectorAll('details').forEach(menu=>menu.addEventListener('toggle',()=>{if(menu.open){closeMenus(menu);menu.style.setProperty('--module-menu-top',Math.min(menu.querySelector('summary').getBoundingClientRect().bottom+8,innerHeight-90)+'px');}}));
 // Menu opening is local and immediate. Page bootstraps own the only data reads.
 window.addEventListener('livraria:session-ready',synchronize);
 window.addEventListener('livraria:profile-loaded',event=>{const p=event.detail?.profile;if(!p||typeof p.id!=='string'||typeof p.name!=='string'||p.name.length>160||!['ADMIN','SUPER_ADMIN','ATENDENTE'].includes(p.role))return;identity=p.id;document.body.dataset.sessionRole=p.role;synchronize();account.querySelector('summary').setAttribute('aria-label','Abrir menu de '+p.name);avatar.replaceChildren(document.createTextNode(p.name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase()));if(p.photoUrl&&/^\/api\/v1\/profile\/photo\?v=\d+$/.test(p.photoUrl)){const photo=document.createElement('img');photo.alt='';photo.src=p.photoUrl;avatar.replaceChildren(photo);}});
 window.addEventListener('livraria:profile-invalidated',()=>{clearPersonal();delete document.body.dataset.sessionRole;synchronize();});
 window.addEventListener('offline',()=>{clearPersonal();closeMenus();});
 window.addEventListener('pagehide',()=>{clearPersonal();closeMenus();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearPersonal();closeMenus();}});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenus();});
 document.addEventListener('click',event=>{if(!header.contains(event.target))closeMenus();});
 header.querySelector('[data-account-logout]').addEventListener('click',async event=>{
  if(loggingOut)return;loggingOut=true;event.target.disabled=true;status.hidden=true;
  try{const session=await fetch('/api/v1/session',{credentials:'same-origin',cache:'no-store'});if(session.status===401){location.assign('/acesso-dev.html');return;}if(!session.ok)throw Error('SESSION_UNAVAILABLE');const{data}=await session.json();if(identity&&data?.user?.id!==identity)throw Error('ACCOUNT_CHANGED');const out=await fetch('/api/v1/session/logout',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':data.csrfToken},body:'{}'});if(!out.ok)throw Error('LOGOUT_UNCONFIRMED');location.assign('/acesso-dev.html');}
  catch{status.textContent='Não foi possível confirmar a saída. Tente novamente.';status.hidden=false;}
  finally{loggingOut=false;event.target.disabled=false;}
 });
 synchronize();
})();
