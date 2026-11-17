'use strict';
(() => {
 if(location.origin!==(globalThis.LivrariaOrigin?.current(location.origin)||'https://dev--merry-chimera-49a1f3.netlify.app')||window.livrariaNavigationMounted)return;
 const header=document.querySelector('[data-app-header]');if(!header)return;window.livrariaNavigationMounted=true;
 const nav=header.querySelector('nav'),account=header.querySelector('.account-menu'),avatar=header.querySelector('[data-account-avatar]'),status=header.querySelector('[data-account-status]');
 const toggle=header.querySelector('.app-menu-toggle');
 const backdrop=document.createElement('div');backdrop.className='menu-overlay';backdrop.dataset.menuBackdrop='';backdrop.hidden=true;backdrop.setAttribute('aria-hidden','true');document.body.append(backdrop);
 function syncBackdrop(){backdrop.hidden=!(typeof matchMedia==='function'&&matchMedia('(max-width: 768px)').matches&&!!header.querySelector('details[open]'));}
 backdrop.addEventListener('click',()=>{closeMenus();closeMobile();});
 function closeMobile(){if(!toggle)return;toggle.setAttribute('aria-expanded','false');header.classList.remove('mobile-menu-open');}
 if(toggle)toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));header.classList.toggle('mobile-menu-open',open);if(!open)closeMenus();});
 let identity='',role='',loggingOut=false,profileRequest=0,profileLoaded=false,sessionRequest=0;
 const profileCacheKey='livraria.navigation.profile.v1';
 const validPhoto=url=>typeof url==='string'&&/^\/api\/v1\/profile\/photo\?v=\d{1,7}$/.test(url);
 function cacheProfile(profile){try{sessionStorage.setItem(profileCacheKey,JSON.stringify({id:profile.id,name:profile.name,role:profile.role,photoUrl:validPhoto(profile.photoUrl)?profile.photoUrl:'',at:Date.now()}));}catch{}}
 function clearProfileCache(){try{sessionStorage.removeItem(profileCacheKey);sessionStorage.removeItem('livraria.navigation.session.v1');}catch{}}
 function restoreProfile(){try{const p=JSON.parse(sessionStorage.getItem(profileCacheKey)||'null');if(p&&Number.isFinite(p.at)&&Date.now()>=p.at&&Date.now()-p.at<60000)showProfile(p);}catch{clearProfileCache();}}
 function restoreSessionNavigation(){try{const s=JSON.parse(sessionStorage.getItem('livraria.navigation.session.v1')||'null'),now=Date.now();if(s&&typeof s.id==='string'&&s.id&&['ADMIN','SUPER_ADMIN','ATENDENTE'].includes(s.role)&&Number.isFinite(s.at)&&s.at<=now&&now-s.at<60000&&Number.isFinite(s.expiresAt)&&s.expiresAt>now){document.body.dataset.sessionRole=s.role;return true;}}catch{}return false;}
 const administrative=()=>['ADMIN','SUPER_ADMIN'].includes(role);
 function synchronize(){role=document.body.dataset.sessionRole||'';header.querySelectorAll('[data-navigation-admin]').forEach(a=>a.hidden=!administrative());if(document.body.classList.contains('page-home'))nav.hidden=!['ADMIN','SUPER_ADMIN','ATENDENTE'].includes(role);else nav.hidden=false;if(toggle)toggle.hidden=nav.hidden;if(nav.hidden)closeMobile();}
 function clearPersonal(){profileRequest++;sessionRequest++;profileLoaded=false;identity='';avatar.replaceChildren(document.createTextNode('Conta'));account.querySelector('summary').setAttribute('aria-label','Abrir menu da conta');}
 function showProfile(p){if(!p||typeof p.id!=='string'||typeof p.name!=='string'||p.name.length>160||!['ADMIN','SUPER_ADMIN','ATENDENTE'].includes(p.role))return false;profileLoaded=true;identity=p.id;document.body.dataset.sessionRole=p.role;synchronize();account.querySelector('summary').setAttribute('aria-label','Abrir menu de '+p.name);const initials=p.name.trim().split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase()||'Conta';avatar.replaceChildren(document.createTextNode(initials));if(validPhoto(p.photoUrl)){const photo=document.createElement('img');photo.alt='';photo.addEventListener('error',()=>{if(avatar.contains(photo))avatar.replaceChildren(document.createTextNode(initials));});photo.src=p.photoUrl;avatar.replaceChildren(photo);}return true;}
 async function refreshProfile(){if(document.hidden||navigator.onLine===false||document.body.classList.contains('page-meu-perfil'))return;const ticket=++profileRequest;try{const response=await fetch('/api/v1/profile/get',{credentials:'same-origin',cache:'no-store'});if(ticket!==profileRequest)return;if(response.status===401||response.status===403){clearProfileCache();clearPersonal();return;}if(!response.ok)return;const {data}=await response.json();if(ticket===profileRequest&&!document.hidden&&showProfile(data))cacheProfile(data);}catch{}}
 async function refreshNavigationSession(){const ticket=++sessionRequest;try{const response=await fetch('/api/v1/session',{credentials:'same-origin',cache:'no-store'});if(!response.ok)return;const {data}=await response.json();if(ticket!==sessionRequest||document.hidden||!['ADMIN','SUPER_ADMIN','ATENDENTE'].includes(data?.user?.role))return;document.body.dataset.sessionRole=data.user.role;synchronize();if(!profileLoaded)refreshProfile();}catch{}}
 function closeMenus(except=null){header.querySelectorAll('details[open]').forEach(menu=>{if(menu!==except)menu.open=false;});syncBackdrop();}
 header.querySelectorAll('.account-options').forEach(options=>{
  // Do not activate on touchstart: browsers synthesize click after touchend,
  // and firing twice would break scrolling, navigation and logout retries.
  options.addEventListener('touchstart',event=>event.stopPropagation(),{passive:true});
  options.addEventListener('click',event=>{
  const link=event.target.closest('a[href]');
  if(!link||!options.contains(link))return;
  event.stopPropagation();
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.target&&link.target!=='_self'||link.hasAttribute('download'))return;
  const destination=new URL(link.href,location.href);
  if(destination.origin!==location.origin)return;
  event.preventDefault();closeMenus();closeMobile();location.assign(destination.href);
  });
 });
 const lightbox=document.createElement('dialog'),lightboxImage=document.createElement('img'),lightboxClose=document.createElement('button');
 lightbox.className='avatar-lightbox';lightbox.setAttribute('aria-label','Foto de perfil ampliada');lightboxClose.type='button';lightboxClose.className='avatar-lightbox-close';lightboxClose.setAttribute('aria-label','Fechar foto');lightboxClose.textContent='×';lightboxImage.alt='Foto de perfil ampliada';lightbox.append(lightboxClose,lightboxImage);document.body.append(lightbox);
 function openPhoto(src){if(!src)return;lightboxImage.src=src;if(!lightbox.open)lightbox.showModal();}
 function closePhoto(){if(lightbox.open)lightbox.close();lightboxImage.removeAttribute('src');}
 lightboxClose.addEventListener('click',closePhoto);lightbox.addEventListener('click',e=>{if(e.target===lightbox)closePhoto();});lightbox.addEventListener('close',()=>lightboxImage.removeAttribute('src'));
 document.addEventListener('click',e=>{if(document.body.classList.contains('page-meu-perfil')&&e.target?.id==='avatar-preview'&&!e.target.hidden)openPhoto(e.target.src);});
 window.addEventListener('livraria:profile-invalidated',closePhoto);window.addEventListener('pagehide',closePhoto);
 header.querySelectorAll('details').forEach(menu=>{
  const summary=menu.querySelector('summary');
  summary.addEventListener('click',event=>{event.preventDefault();const opening=!menu.open;closeMenus(menu);menu.open=opening;if(opening)menu.style.setProperty('--module-menu-top',Math.min(summary.getBoundingClientRect().bottom+8,innerHeight-90)+'px');syncBackdrop();});
  menu.addEventListener('toggle',()=>{if(menu.open){closeMenus(menu);menu.style.setProperty('--module-menu-top',Math.min(summary.getBoundingClientRect().bottom+8,innerHeight-90)+'px');}syncBackdrop();});
 });
 window.addEventListener('resize',syncBackdrop);
 // Menu opening is local and immediate. Page bootstraps own the only data reads.
 window.addEventListener('livraria:session-ready',()=>{sessionRequest++;synchronize();if(!profileLoaded)refreshProfile();});
 window.addEventListener('livraria:profile-loaded',event=>{profileRequest++;const profile=event.detail?.profile;if(showProfile(profile))cacheProfile(profile);});
 window.addEventListener('livraria:profile-changed',()=>{profileLoaded=false;refreshProfile();});
 window.addEventListener('livraria:profile-invalidated',event=>{if(event.detail?.wipe)clearProfileCache();clearPersonal();});
 window.addEventListener('offline',()=>{clearPersonal();closeMenus();closeMobile();});
 window.addEventListener('pagehide',()=>{clearPersonal();closeMenus();closeMobile();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearPersonal();closeMenus();}else if(document.body.dataset.sessionRole)refreshProfile();});
 window.addEventListener('pageshow',e=>{if(e.persisted&&document.body.dataset.sessionRole)refreshProfile();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMenus();closeMobile();}});
 document.addEventListener('click',event=>{if(!header.contains(event.target)){closeMenus();closeMobile();}});
 const logoutButton=header.querySelector('[data-account-logout]'),retryLogoutButton=header.querySelector('[data-account-logout-retry]');
 async function attemptLogout(){
  if(loggingOut)return;clearProfileCache();loggingOut=true;logoutButton.disabled=true;retryLogoutButton.disabled=true;status.hidden=true;
  try{const session=await fetch('/api/v1/session',{credentials:'same-origin',cache:'no-store'});if(session.status===401){location.assign('/acesso-dev.html');return;}if(!session.ok)throw Error('SESSION_UNAVAILABLE');const{data}=await session.json();if(identity&&data?.user?.id!==identity)throw Error('ACCOUNT_CHANGED');const out=await fetch('/api/v1/session/logout',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':data.csrfToken},body:'{}'});if(!out.ok)throw Error('LOGOUT_UNCONFIRMED');location.assign('/acesso-dev.html');}
  catch{logoutButton.hidden=true;retryLogoutButton.hidden=false;retryLogoutButton.disabled=false;status.textContent='Não foi possível confirmar a saída. Tente novamente.';status.hidden=false;}
  finally{loggingOut=false;logoutButton.disabled=false;}
 }
 logoutButton.addEventListener('click',attemptLogout);
 retryLogoutButton.addEventListener('click',attemptLogout);
 const cachedNavigation=restoreSessionNavigation();restoreProfile();synchronize();if(cachedNavigation||document.body.dataset.sessionRole)refreshProfile();else refreshNavigationSession();
})();
