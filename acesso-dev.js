'use strict';
(() => {
  const DEV = 'dev--merry-chimera-49a1f3.netlify.app';
  const $ = id => document.getElementById(id);
  const message = text => { $('status').textContent = text; };
  let accessPhase = 'STATE';
  const diagnosticCodes = new Set(['UPSTREAM_TIMEOUT','UPSTREAM_UNAVAILABLE','UPSTREAM_UNTRUSTED','ACCESS_NETWORK_UNAVAILABLE','ACCESS_REQUEST_TIMEOUT','ACCESS_RESPONSE_INVALID','IDENTITY_NOT_ACTIVATED','IDENTITY_CONFIGURATION_UNAVAILABLE','CONFIGURATION_UNAVAILABLE','SERVICE_NOT_ACTIVATED','WORKSPACE_IDENTITY_UNAVAILABLE','AUTH_RATE_LIMITED','ACCESS_REJECTED','WORKSPACE_ACCESS_REJECTED','FORBIDDEN']);
  function diagnostic(error) {
    const node = document.getElementById('access-diagnostic');
    if (!node || location.hostname !== DEV) return;
    node.textContent = 'Referência para suporte: ' + accessPhase + ' / ' + (diagnosticCodes.has(error?.code) ? error.code : 'ACCESS_PAGE_UNAVAILABLE');
    node.hidden = false;
    $('support-details').hidden = false;
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
  const uncertainCodes = new Set(['ACCESS_NETWORK_UNAVAILABLE','ACCESS_REQUEST_TIMEOUT','ACCESS_RESPONSE_INVALID','UPSTREAM_TIMEOUT','UPSTREAM_UNAVAILABLE']);
  function describe(error) {
    const code = error.code || '';
    if (code === 'IDENTITY_NOT_ACTIVATED' || code.includes('CONFIGURATION') || code.includes('IDENTITY_UNAVAILABLE') || code === 'SERVICE_NOT_ACTIVATED') return 'O acesso está indisponível no momento. Entre em contato com a administração da livraria para verificar a disponibilidade.';
    if (uncertainCodes.has(code)) return 'Não conseguimos confirmar esta etapa agora. Seus dados podem ter sido salvos. Aguarde alguns instantes e clique em “Conferir etapa salva” para continuar.';
    if (code === 'INVALID_AUTH_REQUEST' || code === 'INVALID_CPF') return 'Confira se o CPF ou e-mail está completo e se o PIN tem quatro números. Corrija os campos antes de continuar.';
    if (code === 'PIN_ADJACENT_REPETITION') return 'Escolha um PIN sem números iguais lado a lado. Por exemplo, não use dois números 1 seguidos.';
    if (code === 'INVALID_PIN') return 'O PIN precisa ter exatamente quatro números. Confira os campos e tente novamente.';
    if (code === 'AUTH_RATE_LIMITED') return 'Você fez várias tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente. Se precisar, peça ajuda à administração.';
    if (error.name === 'NotAllowedError' || error.name === 'NotSupportedError') return 'A confirmação pelo aparelho não foi concluída. Clique em “Confirmar no meu aparelho” e siga a janela do navegador. Use um aparelho com biometria ou bloqueio de tela configurado.';
    if (code.includes('REJECTED')) {
      if (!$('email-form').hidden) return 'Não foi possível validar o código. Confira se copiou o código completo do e-mail mais recente. Ele vale por 10 minutos. Se venceu, volte ao início para solicitar outro.';
      if (!$('initial').hidden) return 'Não foi possível entrar com os dados informados. Confira o CPF ou e-mail e o PIN. Se ainda não cadastrou seu acesso, escolha “É meu primeiro acesso”.';
      return 'Não foi possível confirmar sua identidade nesta tentativa. Volte ao início para entrar novamente. Se o problema continuar, peça ajuda à administração.';
    }
    if (code === 'FORBIDDEN') return 'Não foi possível validar esta tentativa de acesso. Atualize a página e tente novamente no endereço da livraria. Se continuar, peça ajuda à administração.';
    return 'Não foi possível concluir esta etapa. Aguarde alguns instantes e tente novamente. Se o problema continuar, peça ajuda à administração da livraria.';
  }
  async function api(operation, body) {
    // Bound both headers and body; a lost acknowledgement must not freeze the form.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    let response, result;
    try {
      try { response = await fetch('/api/v1/access/' + operation, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) }); }
      catch { throw unavailable(controller.signal.aborted ? 'ACCESS_REQUEST_TIMEOUT' : 'ACCESS_NETWORK_UNAVAILABLE'); }
      try { result = await response.json(); }
      catch { throw unavailable(controller.signal.aborted ? 'ACCESS_REQUEST_TIMEOUT' : 'ACCESS_RESPONSE_INVALID'); }
    } finally { clearTimeout(timer); }
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
    maskPins();
    busy = true; document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    const detail = document.getElementById('access-diagnostic'); if (detail) { detail.hidden = true; detail.textContent = ''; }
    $('support-details').hidden = true; $('support-details').open = false; $('check-step').hidden = true;
    const slow = setTimeout(() => message('Está demorando um pouco mais que o esperado. Aguarde sem clicar novamente; estamos conferindo sua solicitação.'), 8000);
    try { await action(); } catch (error) { diagnostic(error); message(describe(error)); $('check-step').hidden = !uncertainCodes.has(error.code); }
    finally { clearTimeout(slow); busy = false; document.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  }
  function submit(id, action) { $(id).addEventListener('submit', event => { event.preventDefault(); run(action); }); }
  function clearSecrets() { maskPins(); ['login-pin', 'new-pin', 'confirm-pin', 'email-code','rescue-code'].forEach(id => { $(id).value = ''; }); }
  function maskPins() {
    document.querySelectorAll('[data-pin-target]').forEach(button => {
      $(button.dataset.pinTarget).type = 'password'; button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', button.getAttribute('aria-label').replace(/^Ocultar /, 'Mostrar '));
    });
  }
  document.querySelectorAll('[data-pin-target]').forEach(button => button.addEventListener('click', () => {
    const field = $(button.dataset.pinTarget), reveal = field.type === 'password';
    field.type = reveal ? 'text' : 'password'; button.setAttribute('aria-pressed', String(reveal));
    button.setAttribute('aria-label', button.getAttribute('aria-label').replace(/^(Mostrar|Ocultar) /, reveal ? 'Ocultar ' : 'Mostrar '));
  }));
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
    $('identity-result').textContent = data.user.role==='SUPER_ADMIN'?'Conta master autenticada com PIN e confirmação pelo aparelho.':data.user.role==='ADMIN'?'Conta administrativa autenticada com PIN e confirmação pelo aparelho.':'Conta de atendente autenticada com PIN e confirmação pelo aparelho.'; $('team-link').hidden=!['SUPER_ADMIN','ADMIN'].includes(data.user.role); return true;
  }
  async function finish() {
    await api('complete', { response: pendingResponse }); pendingResponse = null; clearSecrets();
    if (!await current()) throw new Error('SESSION_NOT_CONFIRMED');
  }
  $('check-step').addEventListener('click', () => run(async () => {
    const state = await api('state');
    if (!['INITIAL','EMAIL','PIN','PASSKEY','COMMITTING','COMPLETE'].includes(state.stage)) throw unavailable('ACCESS_RESPONSE_INVALID');
    show(state.stage === 'COMPLETE' ? 'COMMITTING' : state.stage);
    if (state.stage === 'COMPLETE' && await current()) return;
    message({ INITIAL: 'Escolha como deseja acessar sua conta.', EMAIL: 'Cole o código do e-mail mais recente para continuar.', PIN: 'E-mail confirmado. Crie seu PIN para continuar.', PASSKEY: 'A etapa anterior foi confirmada. Clique em “Confirmar no meu aparelho” para continuar.' }[state.stage] || 'A confirmação final ainda precisa ser conferida. Clique em “Conferir e concluir acesso”.');
  }));
  $('recovery-open').addEventListener('click',()=>{$('recovery-form').hidden=!$('recovery-form').hidden;});
  submit('recovery-form',async()=>{const data=await api('recover',{email:$('recovery-email').value});clearSecrets();show(data.stage);message(data.message);});
  submit('start-form', async () => {
    const data = await api('start', { email: $('activation-email').value }); clearSecrets(); show(data.stage); message(data.message);
  });
  submit('login-form', async () => {
    try { const data = await api('login', { email: $('login-email').value, pin: $('login-pin').value }); show(data.stage); message('Confirme sua identidade pelo aparelho cadastrado.'); }
    finally { $('login-pin').value = ''; }
  });
  async function saveAccessStep(operation, body, expectedStage) {
    try { return await api(operation, body); }
    catch (error) {
      if (!uncertainCodes.has(error.code)) throw error;
      // Read once after an uncertain mutation. Never repeat a code/PIN guess,
      // resend mail, or interpret a local expectation as a verified transition.
      message('Conferindo se a etapa foi salva…');
      let state; try { state = await api('state'); } catch { throw error; }
      if (state.stage !== expectedStage) throw error;
      return state;
    }
  }
  submit('email-form', async () => {
    const data = await saveAccessStep('email', { code: $('email-code').value.trim() }, 'PIN'); $('email-code').value = ''; show(data.stage); message('E-mail confirmado. Defina seu PIN novo.');
  });
  $('use-rescue').addEventListener('change',()=>{$('rescue-inputs').hidden=!$('use-rescue').checked;});
  $('rescue-confirm').addEventListener('click',()=>run(async()=>{try{await api('rescue',{recoveryCode:$('rescue-code').value});$('rescue-status').textContent='Código confirmado. Defina um PIN novo e cadastre novamente a confirmação pelo aparelho.';}finally{$('rescue-code').value='';}}));
  submit('pin-form', async () => {
    if(recoveryFlow&&emergencyEnabled&&$('use-rescue').checked&&!replacementReady){message('Valide o código de recuperação antes de continuar.');return;}
    if (/([0-9])\1/.test($('new-pin').value)) { message('Escolha um PIN sem números iguais lado a lado. Por exemplo, não use dois números 1 seguidos.'); return; }
    if ($('new-pin').value !== $('confirm-pin').value) { message('Os PINs precisam ser iguais.'); return; }
    try { const data = await saveAccessStep('pin', { pin: $('new-pin').value }, 'PASSKEY'); show(data.stage); message('Agora confirme sua identidade pelo aparelho para proteger sua conta.'); }
    finally { $('new-pin').value = ''; $('confirm-pin').value = ''; }
  });
  $('passkey-button').addEventListener('click', () => run(async () => {
    if (!window.PublicKeyCredential || !navigator.credentials) { message('Este navegador não oferece confirmação pelo aparelho. Use um navegador atualizado em um aparelho com biometria ou bloqueio de tela.'); return; }
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
    catch (error) { diagnostic(error); message('Não conseguimos conferir se você já estava conectado. Continue pelo formulário de acesso.'); }
  });
})();
