'use strict';
(()=>{
 const $=id=>document.getElementById(id),ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app',labels={RASCUNHO:'Rascunho',PUBLICADA:'Publicada',CANCELADA:'Cancelada'};
 let csrf='',userId='',admin=false,anchor=today(),view=innerWidth<640?'week':'month',items=[],people=new Map(),editing=null,draftId='',pending=null,busy=false,loading=false,refreshAgain=false;
 let access=false,ready=false,checkedAt=0,version=0,latest=null,freshnessTimer;
 const online=()=>navigator.onLine!==false;
 const fresh=()=>access&&ready&&online()&&performance.now()-checkedAt<90000;
 const validDate=d=>typeof d==='string'&&/^20\d\d-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T12:00Z'))&&new Date(d+'T12:00Z').toISOString().slice(0,10)===d;
 function today(){const p=new Intl.DateTimeFormat('en',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),get=k=>p.find(v=>v.type===k).value;return get('year')+'-'+get('month')+'-'+get('day');}
 const addDays=(d,n)=>{const x=new Date(d+'T12:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
 const monday=d=>addDays(d,-((new Date(d+'T12:00Z').getUTCDay()+6)%7));
 function range(){const from=view==='month'?monday(anchor.slice(0,7)+'-01'):monday(anchor);return {from:from<'2020-01-01'?'2020-01-01':from,to:addDays(from,view==='month'?41:6)>'2099-12-31'?'2099-12-31':addDays(from,view==='month'?41:6)};}
 const dateLabel=(d,options)=>new Date(d+'T12:00Z').toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',...options});
 function describe(e){ const common = globalThis.LivrariaMessages?.describe(e); if (common) return common;if(e.code==='OFFLINE')return 'Sem conexão. Mantenha a aba aberta; confira o calendário ao reconectar.';if(e.code==='CONTEXT_CHANGED')return 'A conexão ou a conta mudou. Esta resposta não foi exibida. Confira o pedido pendente ou atualize o calendário.';if(e.status===401||e.status===403)return 'Confirme seu acesso com PIN e confirmação pelo aparelho. Criar, publicar ou alterar escalas exige autenticação administrativa recente.';if(e.code?.includes('OVERLAP'))return 'Este funcionário já tem uma escala que cruza esse horário, inclusive rascunhos. Confira o calendário.';if(e.code?.includes('NO_CHANGE'))return 'A escala já contém estes dados. Nenhuma alteração foi registrada.';if(e.code?.includes('EMPLOYEE_UNAVAILABLE'))return 'Este funcionário não está ativo. Atualize o cadastro ou escolha outro funcionário.';if(e.code?.includes('CONFLICT'))return 'A escala mudou em outro atendimento. Atualize a consulta antes de editar novamente.';if(e.code?.includes('CAPACITY'))return 'O período ou o armazenamento atingiu o limite seguro. Não foi exibida uma lista parcial.';if(e.code?.includes('NOT_ACTIVATED')||e.code?.includes('UNAVAILABLE'))return 'As escalas ainda não estão disponíveis nesta instalação.';if(e.code?.includes('INVALID'))return 'Confira a data e os horários. O término deve ser posterior ao início no mesmo dia.';if(e.status===404)return 'Esta escala não está disponível para sua conta.';return 'Não foi possível confirmar agora. Mantenha a tela aberta e tente novamente.';}
 async function request(path,body){
  if(!online())throw {code:'OFFLINE'};if(location.origin!==ORIGIN)throw {status:403};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body?{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)}:{})}),out=await response.json();if(!response.ok)throw {status:response.status,code:out.error?.code,field:out.error?.field,readOnly:!body};return out.data;}
  catch(e){if(e.status===401||e.status===403)resetPrivate(true);else if(!e.status)invalidate();throw e;}finally{clearTimeout(timer);}
 }
 async function api(op,body){return request('/api/v1/schedules/'+op,body);}
 function resetPrivate(keepPending=false){
  const retained=keepPending?pending:null;version++;items=[];people.clear();pending=retained;editing=null;latest=null;admin=false;access=false;ready=false;csrf='';clearTimeout(freshnessTimer);
  $('new-shift').hidden=true;$('schedule').hidden=true;$('calendar').replaceChildren();$('shift-form').reset();$('shift-employee').replaceChildren();
  for(const id of ['publisher','shift-state','form-status','calendar-summary'])$(id).textContent='';if($('shift-editor').open)$('shift-editor').close();
 }
 function invalidate(){version++;access=false;ready=false;clearTimeout(freshnessTimer);items=[];$('calendar').replaceChildren();$('calendar-summary').textContent='';lock();}
 async function session(){
  const current=await request('/api/v1/session'),nextAdmin=['ADMIN','SUPER_ADMIN'].includes(current.user.role);
  if(userId&&userId!==current.user.id){resetPrivate(true);throw {status:401};}
  if(admin&&!nextAdmin){resetPrivate(true);refreshAgain=true;}
  userId=current.user.id;csrf=current.csrfToken;admin=nextAdmin;access=true;
  $('new-shift').hidden=!admin;document.querySelector('.legend .draft').hidden=!admin;
  $('scope-note').textContent=admin?'Calendário geral da equipe. Rascunhos permanecem na administração.':'Sua escala publicada e seu histórico de alterações.';
 }
 function render(){const r=range(),host=$('calendar');host.replaceChildren();host.className=view==='month'?'month-grid':'week-grid';$('weekdays').hidden=view!=='month';$('month-view').setAttribute('aria-pressed',String(view==='month'));$('week-view').setAttribute('aria-pressed',String(view==='week'));$('period-title').textContent=view==='month'?dateLabel(anchor,{month:'long',year:'numeric'}):dateLabel(r.from,{day:'2-digit',month:'short'})+' — '+dateLabel(r.to,{day:'2-digit',month:'short',year:'numeric'});for(let d=r.from;d<=r.to;d=addDays(d,1)){const day=document.createElement('section');day.dataset.date=d;if(view==='month'&&d===r.from)day.style.gridColumn=String((new Date(d+'T12:00Z').getUTCDay()+6)%7+1);day.className='day'+(view==='month'&&d.slice(0,7)!==anchor.slice(0,7)?' outside':'')+(d===today()?' today':'');const title=document.createElement('h3');title.textContent=view==='month'?String(Number(d.slice(-2))):dateLabel(d,{weekday:'long',day:'2-digit',month:'short'});day.append(title);const entries=items.filter(s=>s.date===d);for(const s of entries){const b=document.createElement('button');b.type='button';b.className='shift '+{RASCUNHO:'draft',PUBLICADA:'published',CANCELADA:'cancelled'}[s.status];b.dataset.id=s.id;const name=people.get(s.employeeId)?.name||'Funcionário',strong=document.createElement('strong'),time=document.createElement('span'),state=document.createElement('span');strong.textContent=name;time.textContent=s.start+'–'+s.end;state.textContent=labels[s.status];b.setAttribute('aria-label',name+', '+dateLabel(d,{day:'2-digit',month:'long'})+', '+s.start+' às '+s.end+', '+labels[s.status]);b.append(strong,time,state);b.addEventListener('click',()=>open(s));day.append(b);}if(!entries.length){const empty=document.createElement('span');empty.className='day-empty';empty.textContent='Sem escala';day.append(empty);}host.append(day);}$('calendar-summary').textContent=items.length+' escala(s) no período · Horários de Brasília.';}
 function lock(){
  const blocked=busy||!!pending;
  $('shift-editor').dataset.verified=String(access&&online());
  $('shift-fields').disabled=blocked||!admin||!access||!online()||editing?.status==='CANCELADA';
  $('close-editor').disabled=blocked;
  for(const id of ['save-draft','publish-shift','cancel-shift'])$(id).disabled=blocked||loading||!fresh()||!admin||!!latest;
  $('retry-shift').hidden=!pending;$('retry-shift').disabled=busy||loading||!online()||!admin;
  $('resume-pending').disabled=busy||loading||!online()||!admin;$('pending-schedule').hidden=!pending;
  for(const id of ['period-prev','period-next','today','month-view','week-view','new-shift'])$(id).disabled=loading||busy||!!pending||!fresh();
  $('refresh-schedules').disabled=loading||busy||!online();
  document.querySelectorAll('[data-schedule-refresh]').forEach(button=>{button.disabled=loading||busy||!online();});
  $('reload-shift').hidden=!latest||!!pending;$('reload-shift').disabled=loading||busy||!fresh();
  const state=!online()?'offline':fresh()?'ready':loading?'checking':'stale';
  const text=!online()?'Sem conexão. O calendário foi ocultado e o formulário fica protegido até conferir a conta. Mantenha esta aba aberta.':pending?'Há um pedido aguardando confirmação. Confira o mesmo pedido; reconectar não o reenvia.':fresh()?'Calendário conferido. Alterações continuam sendo validadas pelo servidor.':'Confira a conexão e o calendário antes de continuar. O rascunho desta aba será preservado enquanto o acesso permitir.';
  $('schedule-connection').dataset.state=state;$('schedule-connection').textContent=text;
  document.querySelectorAll('[data-editor-connection]').forEach(node=>{node.dataset.state=state;node.textContent=text;});
  document.querySelectorAll('.shift').forEach(button=>{button.disabled=busy||loading||!!pending||!fresh();});
 }
 async function load(){
  if(location.origin!==ORIGIN)return;
  if(document.hidden||!online()){lock();if(!online())$('status').textContent='Sem conexão. Confira o calendário ao reconectar.';return;}
  if(loading||busy){refreshAgain=true;return;}
  loading=true;ready=false;clearTimeout(freshnessTimer);lock();const ticket=version;
  try{
   await session();if(ticket!==version)return;
   const r=range(),data=await api('list?'+new URLSearchParams(r));
   const detail=!pending&&editing&&$('shift-editor').open?await api('get?id='+editing.id):null;
   await session();if(ticket!==version||!online()||document.hidden)return;
   items=data.items;people=new Map(data.people.map(p=>[p.id,p]));admin=data.canManage;
   if(detail){latest=detail.items[0].version===editing.version?null:detail.items[0];if(latest)$('form-status').textContent='A escala mudou em outro atendimento. O rascunho foi preservado. Revise ou descarte-o para abrir a versão atual antes de salvar.';}
   ready=true;checkedAt=performance.now();freshnessTimer=setTimeout(()=>{ready=false;lock();},90000);
   $('new-shift').hidden=!admin;render();$('schedule').hidden=false;$('access-help').hidden=true;$('status').textContent='Escalas atualizadas.';
  }catch(e){$('status').textContent=describe(e);if(e.status===401||e.status===403){resetPrivate(true);$('access-help').hidden=false;}}
  finally{loading=false;lock();if(refreshAgain){refreshAgain=false;load();}}
 }
 async function open(s){if(busy||pending||loading||!fresh())return;busy=true;lock();const ticket=version,expectedUser=userId,expectedAdmin=admin;try{await session();if(ticket!==version||!online()||document.hidden)throw {code:'CONTEXT_CHANGED'};if(userId!==expectedUser||expectedAdmin&&!admin)throw {status:401};if(s){const fresh=await api('get?id='+s.id);s=fresh.items[0];fresh.people.forEach(p=>people.set(p.id,p));}let choices;if(admin&&s?.status!=='CANCELADA')choices=(await api('people')).people;else choices=[...people.values()];if(s&&!choices.some(p=>p.id===s.employeeId))choices.push(people.get(s.employeeId)||{id:s.employeeId,name:'Funcionário desativado',active:false});await session();if(ticket!==version||!online()||document.hidden)throw {code:'CONTEXT_CHANGED'};if(userId!==expectedUser||expectedAdmin&&!admin)throw {status:401};choices.sort((a,b)=>a.name.localeCompare(b.name));$('shift-employee').replaceChildren(new Option('Selecione um funcionário',''),...choices.map(p=>new Option(p.name+(p.active?'':' (desativado)'),p.id)));editing=s;latest=null;draftId=s?.id||crypto.randomUUID();$('shift-date').value=s?.date||anchor;$('shift-start').value=s?.start||'09:00';$('shift-end').value=s?.end||'12:00';$('shift-notes').value=s?.notes||'';$('shift-employee').value=s?s.employeeId:'';$('editor-title').textContent=s?'Detalhes da escala':'Criar escala';$('shift-state').textContent=s?'Situação: '+labels[s.status]+' · Revisão '+s.version:'';$('publisher').textContent=s?.publishedBy?'Publicado por '+(people.get(s.publishedBy)?.name||'Administrador')+' em '+new Date(s.publishedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' · Última alteração por '+(people.get(s.updatedBy)?.name||'Administrador')+' em '+new Date(s.updatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Ainda não publicada.';$('editor-note').hidden=!admin;$('save-draft').hidden=!admin||!!s&&s.status!=='RASCUNHO';$('publish-shift').hidden=!admin||s?.status==='CANCELADA';$('publish-shift').textContent=s?.status==='PUBLICADA'?'Salvar alteração':'Publicar escala';$('cancel-shift').hidden=!admin||!s||s.status==='CANCELADA';$('form-status').textContent='';$('shift-editor').showModal();}catch(e){$('status').textContent=describe(e);if(e.status===401||e.status===403)$('access-help').hidden=false;}finally{busy=false;lock();}}
 async function send(op,status){
  if(busy||loading||!online()||!pending&&(!access||!admin||!fresh()||latest))return;
  if(!pending){
   if(op==='save'&&!$('shift-form').reportValidity())return;
   pending={op,uncertain:false,body:{commandId:crypto.randomUUID(),id:draftId,expectedRevision:editing?.version||0,...(op==='save'?{record:{employeeId:$('shift-employee').value,date:$('shift-date').value,start:$('shift-start').value,end:$('shift-end').value,notes:$('shift-notes').value,status}}:{})}};
  }
  const command=pending,ticket=version;busy=true;lock();let saved=false;
  try{
   await session();if(!admin)throw {status:403,code:'FORBIDDEN'};
   if(ticket!==version||pending!==command||!online()||document.hidden)throw {code:'CONTEXT_CHANGED'};
   await api(command.op,command.body);pending=null;saved=true;editing=null;latest=null;$('shift-editor').close();$('shift-form').reset();window.dispatchEvent(new Event('livraria:schedule-changed'));
  }catch(e){
   const text=describe(e);$('form-status').textContent=text;
   const rejected=['INVALID_SCHEDULE','WORKSPACE_INVALID_SCHEDULE','WORKSPACE_SCHEDULE_OVERLAP','WORKSPACE_SCHEDULE_NO_CHANGE','WORKSPACE_SCHEDULE_EMPLOYEE_UNAVAILABLE','WORKSPACE_SCHEDULE_CONFLICT','FORBIDDEN','WORKSPACE_FORBIDDEN'].includes(e.code);
   if(pending){if(rejected&&!pending.uncertain)pending=null;else pending.uncertain=true;}
   if(e.status===401||e.status===403)$('access-help').hidden=false;
  }finally{busy=false;lock();}
  if(saved){refreshAgain=false;await load();$('status').textContent='Escala salva. As notificações dos envolvidos foram atualizadas.'+(fresh()?'':' Não foi possível atualizar o calendário. Confira a conexão antes de continuar.');}
  else if(refreshAgain){refreshAgain=false;load();}
 }
 function navigate(n){if(loading||busy||pending)return;if(view==='week')anchor=addDays(anchor,7*n);else{const x=new Date(anchor.slice(0,7)+'-01T12:00Z');x.setUTCMonth(x.getUTCMonth()+n);anchor=x.toISOString().slice(0,10);}if(anchor<'2020-01-01')anchor='2020-01-01';if(anchor>'2099-12-31')anchor='2099-12-31';load();}
 $('period-prev').addEventListener('click',()=>navigate(-1));$('period-next').addEventListener('click',()=>navigate(1));$('today').addEventListener('click',()=>{if(!loading&&!busy&&!pending){anchor=today();load();}});$('month-view').addEventListener('click',()=>{if(!loading&&!busy&&!pending){view='month';load();}});$('week-view').addEventListener('click',()=>{if(!loading&&!busy&&!pending){view='week';load();}});$('refresh-schedules').addEventListener('click',load);$('new-shift').addEventListener('click',()=>open(null));$('close-editor').addEventListener('click',()=>{if(!busy&&!pending){$('shift-editor').close();$('shift-form').reset();}});$('save-draft').addEventListener('click',()=>send('save','RASCUNHO'));$('publish-shift').addEventListener('click',()=>send('save','PUBLICADA'));$('cancel-shift').addEventListener('click',()=>send('cancel'));$('retry-shift').addEventListener('click',()=>send());$('shift-form').addEventListener('submit',e=>e.preventDefault());$('shift-editor').addEventListener('cancel',e=>{if(busy||pending)e.preventDefault();});
 $('resume-pending').addEventListener('click',()=>send());
 $('reload-shift').addEventListener('click',()=>{if(!latest||busy||loading||pending)return;open(latest);});
 document.querySelectorAll('[data-schedule-refresh]').forEach(button=>button.addEventListener('click',load));
 window.addEventListener('focus',load);window.addEventListener('offline',invalidate);window.addEventListener('online',()=>{invalidate();load();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else load();});setInterval(()=>{if(!document.hidden&&!busy&&!loading&&!pending)load();},60000);
 window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue='';}});
 window.addEventListener('pagehide',invalidate);window.addEventListener('pageshow',e=>{if(e.persisted){invalidate();load();}});
 if(location.origin!==ORIGIN)return;const q=new URL(location.href).searchParams;if(validDate(q.get('data')))anchor=q.get('data');load().then(async()=>{const id=q.get('escala');if(/^[a-f0-9-]{36}$/.test(id||'')){try{const data=await api('get?id='+id);data.people.forEach(p=>people.set(p.id,p));await open(data.items[0]);}catch(e){$('status').textContent=describe(e);}}});
})();
