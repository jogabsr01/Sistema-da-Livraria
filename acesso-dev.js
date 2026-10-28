'use strict';
(() => {
  const DEV = 'dev--merry-chimera-49a1f3.netlify.app';
  const $ = id => document.getElementById(id);
  const message = text => { $('status').textContent = text; };
  let accessPhase = 'STATE';
  const diagnosticCodes = new Set(['UPSTREAM_TIMEOUT','UPSTREAM_UNAVAILABLE','UPSTREAM_UNTRUSTED','ACCESS_NETWORK_UNAVAILABLE','ACCESS_RESPONSE_INVALID','IDENTITY_NOT_ACTIVATED','IDENTITY_CONFIGURATION_UNAVAILABLE','CONFIGURATION_UNAVAILABLE','SERVICE_NOT_ACTIVATED','WORKSPACE_IDENTITY_UNAVAILABLE','AUTH_RATE_LIMITED','ACCESS_REJECTED','WORKSPACE_ACCESS_REJECTED','FORBIDDEN']);
  function diagnostic(error) {
    const node = document.getElementById('access-diagnostic');
    if (!node || location.hostname !== DEV) return;
    node.textContent = 'Detalhe do teste: ' + accessPhase + ' / ' + (diagnosticCodes.has(error?.code) ? error.code : 'ACCESS_PAGE_UNAVAILABLE');
    node.hidden = false;
  }
  function unavailable(code) { const error = new Error('ACCESS_FAILED'); error.code = code; return error; }
  let csrfToken = '', busy = false, sessionCsrf = '', pendingResponse = null,recoveryFlow=false,replacementReady=false,emergencyEnabled=false;
  const panels = ['initial', 'email-form', 'pin-form', 'passkey', 'retry', 'complete'];
  function show(stage) {
    const panel = { INITIAL: 'initial', EMAIL: 'email-form', PIN: 'pin-form', PASSKEY: 'passkey', COMMITTING: 'retry', COMPLETE: 'complete' }[stage];
    panels.forEach(id => { $(id).hidden = id !== panel; });
    if(stage!=='COMPLETE')$('identity-result').textContent='';
    $('rescue-choice').hidden=stage!=='PIN'||!recoveryFlow||!emergencyEnabled;
    if(stage==='PIN'&&replacementReady){$('use-rescue').checked=true;$('rescue-inputs').hidden=false;$('rescue-status').textContent='Código já validado nesta tentativa. Defina seu PIN novo.';}
    $('restart').hidden = !panel || ['initial', 'complete'].includes(panel);
  }
  function describe(error) {
    const code = error.code || '';
    if (code === 'IDENTITY_NOT_ACTIVATED' || code.includes('CONFIGURATION') || code.includes('IDENTITY_UNAVAILABLE')) return 'O acesso verificado ainda não foi habilitado nesta instalação DEV. Confira a configuração com a administração.';
    if (code === 'UPSTREAM_TIMEOUT') return 'O serviço demorou para responder. Aguarde alguns instantes e tente novamente.';
    if (code === 'AUTH_RATE_LIMITED') return 'Muitas tentativas. Aguarde o prazo indicado e tente novamente.';
    if (error.name === 'NotAllowedError' || error.name === 'NotSupportedError') return 'A passkey não foi confirmada. Tente novamente e siga a janela do navegador; seu aparelho precisa oferecer uma passkey.';
    if (code.includes('REJECTED')) return 'Não foi possível confirmar os dados. Confira o código ou o PIN; se o prazo venceu, volte ao início.';
    return 'Não foi possível concluir agora. Confira a conexão e tente novamente.';
  }
  async function api(operation, body) {
    let response; try { response = await fetch('/api/v1/access/' + operation, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) }); } catch { throw unavailable('ACCESS_NETWORK_UNAVAILABLE'); }
    let result; try { result = await response.json(); } catch { throw unavailable('ACCESS_RESPONSE_INVALID'); }
    if (!response.ok) throw unavailable(typeof result?.error?.code === 'string' ? result.error.code : 'ACCESS_RESPONSE_INVALID');
    if (!result?.data || typeof result.data.csrfToken !== 'string') throw unavailable('ACCESS_RESPONSE_INVALID');
    if (result.data.csrfToken) csrfToken = result.data.csrfToken;
    if(operation==='recover'){recoveryFlow=true;replacementReady=false;$('use-rescue').checked=false;$('rescue-status').textContent='';$('rescue-inputs').hidden=true;}if(operation==='start'||operation==='login'){recoveryFlow=false;replacementReady=false;}if(result.data.purpose)recoveryFlow=result.data.purpose==='RECOVER';if(result.data.replacementAllowed!==undefined)replacementReady=result.data.replacementAllowed===true;if(result.data.emergencyRecoveryEnabled!==undefined)emergencyEnabled=result.data.emergencyRecoveryEnabled;
    if(result.data.recoveryEnabled!==undefined)$('recovery-choice').hidden=!result.data.recoveryEnabled;
    return result.data;
  }
  async function run(action) {
    if (busy) return;
    accessPhase = 'ACCESS';
    busy = true; document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    const detail = document.getElementById('access-diagnostic'); if (detail) detail.hidden = true;
    try { await action(); } catch (error) { diagnostic(error); message(describe(error)); }
    finally { busy = false; document.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  }
  function submit(id, action) { $(id).addEventListener('submit', event => { event.preventDefault(); run(action); }); }
  function clearSecrets() { ['login-pin', 'new-pin', 'confirm-pin', 'email-code','rescue-code'].forEach(id => { $(id).value = ''; }); }
  const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  function serialize(credential) {
    const response = credential.response, result = { id: credential.id, rawId: encode(credential.rawId), type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(), response: { clientDataJSON: encode(response.clientDataJSON) } };
    if (credential.authenticatorAttachment) result.authenticatorAttachment = credential.authenticatorAttachment;
    if (response.attestationObject) { result.response.attestationObject = encode(response.attestationObject); result.response.transports = response.getTransports ? response.getTransports() : []; }
    else { result.response.authenticatorData = encode(response.authenticatorData); result.response.signature = encode(response.signature); result.response.userHandle = response.userHandle ? encode(response.userHandle) : null; }
    return result;
  }
  async function current() {
    let response; try { response = await fetch('/api/v1/session', { credentials: 'same-origin', cache: 'no-store' }); }
    catch { throw unavailable('ACCESS_NETWORK_UNAVAILABLE'); }
    if ([401,403].includes(response.status)) return false;
    if (!response.ok) throw unavailable('UPSTREAM_UNAVAILABLE');
    let result; try { result = await response.json(); } catch { throw unavailable('ACCESS_RESPONSE_INVALID'); }
    const data = result?.data;
    if (!['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(data?.user?.role) || data.user.assurance !== 'passkey' || typeof data.csrfToken !== 'string') throw unavailable('ACCESS_RESPONSE_INVALID');
    sessionCsrf = data.csrfToken; show('COMPLETE'); message('Acesso verificado com sucesso.');
    $('identity-result').textContent = data.user.role==='SUPER_ADMIN'?'Conta master autenticada com PIN e passkey.':data.user.role==='ADMIN'?'Conta administrativa autenticada com PIN e passkey.':'Conta de atendente autenticada com PIN e passkey.'; $('team-link').hidden=!['SUPER_ADMIN','ADMIN'].includes(data.user.role); return true;
  }
  async function finish() {
    await api('complete', { response: pendingResponse }); pendingResponse = null; clearSecrets();
    if (!await current()) throw new Error('SESSION_NOT_CONFIRMED');
  }
  $('recovery-open').addEventListener('click',()=>{$('recovery-form').hidden=!$('recovery-form').hidden;});
  submit('recovery-form',async()=>{const data=await api('recover',{email:$('recovery-email').value});clearSecrets();show(data.stage);message(data.message);});
  submit('start-form', async () => {
    const data = await api('start', { email: $('activation-email').value }); clearSecrets(); show(data.stage); message(data.message);
  });
  submit('login-form', async () => {
    try { const data = await api('login', { email: $('login-email').value, pin: $('login-pin').value }); show(data.stage); message('Confirme sua identidade com a passkey cadastrada.'); }
    finally { $('login-pin').value = ''; }
  });
  submit('email-form', async () => {
    const data = await api('email', { code: $('email-code').value.trim() }); $('email-code').value = ''; show(data.stage); message('E-mail confirmado. Defina seu PIN novo.');
  });
  $('use-rescue').addEventListener('change',()=>{$('rescue-inputs').hidden=!$('use-rescue').checked;});
  $('rescue-confirm').addEventListener('click',()=>run(async()=>{try{await api('rescue',{recoveryCode:$('rescue-code').value});$('rescue-status').textContent='Código confirmado. Defina um PIN novo e cadastre uma passkey nova.';}finally{$('rescue-code').value='';}}));
  submit('pin-form', async () => {
    if(recoveryFlow&&emergencyEnabled&&$('use-rescue').checked&&!replacementReady){message('Valide o código de recuperação antes de continuar.');return;}
    if ($('new-pin').value !== $('confirm-pin').value) { message('Os PINs precisam ser iguais.'); return; }
    try { const data = await api('pin', { pin: $('new-pin').value }); show(data.stage); message('Continue com a passkey para proteger sua conta.'); }
    finally { $('new-pin').value = ''; $('confirm-pin').value = ''; }
  });
  $('passkey-button').addEventListener('click', () => run(async () => {
    if (!window.PublicKeyCredential || !navigator.credentials) { message('Este navegador não oferece passkeys. Use um navegador atualizado em um aparelho com bloqueio de tela.'); return; }
    const data = await api('options', {}), options = data.options;
    options.challenge = decode(options.challenge);
    if (data.kind === 'create') { options.user.id = decode(options.user.id); options.excludeCredentials = (options.excludeCredentials || []).map(key => ({ ...key, id: decode(key.id) })); }
    else options.allowCredentials = (options.allowCredentials || []).map(key => ({ ...key, id: decode(key.id) }));
    const credential = await navigator.credentials[data.kind]({ publicKey: options });
    pendingResponse = serialize(credential);
    // A transport failure can happen after a durable commit; offer a safe retry.
    show('COMMITTING'); message('Confirmando e salvando o acesso…'); await finish();
  }));
  $('retry-button').addEventListener('click', () => run(finish));
  $('restart').addEventListener('click', () => { clearSecrets(); pendingResponse = null; show('INITIAL'); message('Solicite um novo código ou entre na conta já ativada.'); });
  $('logout-button').addEventListener('click', () => run(async () => {
    const response = await fetch('/api/v1/session/logout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': sessionCsrf }, body: '{}' });
    if (!response.ok) throw new Error('LOGOUT_FAILED'); sessionCsrf = ''; show('INITIAL'); message('Você saiu da conta verificada.');
    const state = await api('state'); csrfToken = state.csrfToken;
  }));
  function requestedView(state){if(!['#entrar','#recuperar-pin'].includes(location.hash))return false;clearSecrets();pendingResponse=null;show('INITIAL');$('recovery-form').hidden=location.hash!=='#recuperar-pin'||!state.recoveryEnabled;message('Confirme sua identidade para continuar.');return true;}
  window.addEventListener('pagehide',()=>{clearSecrets();pendingResponse=null;});
  window.addEventListener('hashchange',()=>{if(location.hostname===DEV&&location.protocol==='https:')run(async()=>{accessPhase='STATE';const state=await api('state');accessPhase='RENDER';requestedView(state);});});
  if (location.hostname !== DEV || location.protocol !== 'https:') { show('UNAVAILABLE'); message('Esta tela de acesso está disponível exclusivamente no endereço DEV da livraria.'); return; }
  run(async () => {
    accessPhase = 'STATE';
    const state = await api('state');
    accessPhase = 'RENDER';
    if(requestedView(state))return;
    // A session lookup is optional here: never hide a server-confirmed access
    // flow because that separate read failed. Authentication still happens only
    // after the session endpoint confirms a passkey-backed principal.
    accessPhase = 'RENDER';
    show(state.stage === 'COMPLETE' ? 'COMMITTING' : state.stage);
    message('Escolha como deseja acessar sua conta.');
    accessPhase = 'SESSION';
    try { await current(); }
    catch (error) { diagnostic(error); message('Não foi possível conferir uma sessão anterior. Continue pelo formulário de acesso.'); }
  });
})();
