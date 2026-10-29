'use strict';
(() => {
  const DEV = 'dev--merry-chimera-49a1f3.netlify.app';
  const $ = id => document.getElementById(id);
  let pendingMessage = null;
  const message = (text, tone = 'info') => { if (busy) { pendingMessage = { text, tone }; return; } $('status').textContent = text; $('status').dataset.tone = tone; $('status').hidden = false; };
  let accessPhase = 'STATE', actionRevision = 0, preparedDevice = null, preparedAt = 0;
  const diagnosticCodes = new Set(['UPSTREAM_TIMEOUT','UPSTREAM_UNAVAILABLE','UPSTREAM_UNTRUSTED','ACCESS_NETWORK_UNAVAILABLE','ACCESS_REQUEST_TIMEOUT','ACCESS_RESPONSE_INVALID','IDENTITY_NOT_ACTIVATED','IDENTITY_CONFIGURATION_UNAVAILABLE','CONFIGURATION_UNAVAILABLE','SERVICE_NOT_ACTIVATED','WORKSPACE_IDENTITY_UNAVAILABLE','AUTH_RATE_LIMITED','ACCESS_REJECTED','WORKSPACE_ACCESS_REJECTED','FORBIDDEN','DEVICE_NOT_ALLOWED','DEVICE_NOT_SUPPORTED','DEVICE_SECURITY_ERROR','DEVICE_ALREADY_REGISTERED','DEVICE_ABORTED','DEVICE_RESPONSE_INVALID','ACCESS_CONTEXT_EXPIRED','ACCESS_CONTEXT_CHANGED']);
  function diagnostic(error) {
    const node = document.getElementById('access-diagnostic');
    if (!node || location.hostname !== DEV) return;
    node.textContent = 'Referência para suporte: ' + accessPhase + ' / ' + (diagnosticCodes.has(error?.code) ? error.code : 'ACCESS_PAGE_UNAVAILABLE');
    const info = error.transport;
    if (info && ['state','start','recover','login','email','pin','options','complete','rescue','session'].includes(info.operation) && Number.isInteger(info.status) && info.status >= 0 && info.status <= 599 && Number.isFinite(info.elapsedMs) && info.elapsedMs >= 0 && info.elapsedMs <= 3600000) node.textContent += ' / etapa: ' + info.operation.toUpperCase() + ' / HTTP: ' + info.status + ' / espera: ' + (info.elapsedMs / 1000).toFixed(1) + 's';
    node.hidden = false;
    $('support-details').hidden = false;
  }
  function unavailable(code) { const error = new Error('ACCESS_FAILED'); error.code = code; return error; }
  let csrfToken = '', busy = false, pendingResponse = null,recoveryFlow=false,replacementReady=false,emergencyEnabled=false;
  const panels = ['initial', 'email-form', 'pin-form', 'passkey', 'retry', 'complete'];
  function feedbackIn(id) {
    const target = $(id), feedback = $('access-feedback');
    if (!target || !feedback || target.contains(feedback)) return;
    const heading = target.querySelector('h2');
    if (heading) heading.after(feedback); else target.prepend(feedback);
  }
  function show(stage) {
    preparedDevice = null; preparedAt = 0;
    const panel = { INITIAL: 'initial', EMAIL: 'email-form', PIN: 'pin-form', PASSKEY: 'passkey', COMMITTING: 'retry', COMPLETE: 'complete' }[stage];
    panels.forEach(id => { $(id).hidden = id !== panel; });
    if (panel) feedbackIn(panel === 'initial' ? 'login-form' : panel);
    if(stage!=='COMPLETE')$('identity-result').textContent='';
    $('rescue-choice').hidden=stage!=='PIN'||!recoveryFlow||!emergencyEnabled;
    if(stage==='PIN'&&replacementReady){$('use-rescue').checked=true;$('rescue-inputs').hidden=false;$('rescue-status').textContent='Código já validado nesta tentativa. Defina seu PIN novo.';}
    $('restart').hidden = !panel || ['initial', 'complete'].includes(panel);
  }
  const uncertainCodes = new Set(['ACCESS_NETWORK_UNAVAILABLE','ACCESS_REQUEST_TIMEOUT','ACCESS_RESPONSE_INVALID','UPSTREAM_TIMEOUT','UPSTREAM_UNAVAILABLE']);
  function describe(error) { const common = globalThis.LivrariaMessages?.describe(error); if (common && !uncertainCodes.has(error.code)) return common;
    const code = error.code || '';
    if (uncertainCodes.has(code) && ['state','session'].includes(error.transport?.operation)) return 'Não conseguimos carregar seu acesso agora. Aguarde alguns instantes e clique em “Tentar carregar novamente”. Se continuar, peça ajuda à administração.';
    if (code === 'IDENTITY_NOT_ACTIVATED' || code.includes('CONFIGURATION') || code.includes('IDENTITY_UNAVAILABLE') || code === 'SERVICE_NOT_ACTIVATED') return 'O acesso está indisponível no momento. Entre em contato com a administração da livraria para verificar a disponibilidade.';
    if (uncertainCodes.has(code) && error.transport?.operation === 'options') return 'Não conseguimos preparar a confirmação do aparelho agora. Aguarde alguns instantes e tente novamente em “Confirmar no meu aparelho”. Se continuar, peça ajuda à administração.';
    if (uncertainCodes.has(code)) return 'Não conseguimos confirmar esta etapa agora. Seus dados podem ter sido salvos. Aguarde alguns instantes e clique em “Conferir etapa salva” para continuar.';
    if (code === 'INVALID_CPF') return 'CPF inválido. Confira os números digitados.';
    if (code === 'INVALID_AUTH_REQUEST') {
      const field = {login:'login-email',start:'activation-email',recover:'recovery-email'}[error.transport?.operation];
      if (field && !$(field).value.includes('@')) return 'Não conseguimos iniciar o acesso com este CPF. Tente usar seu e-mail cadastrado. Se não conseguir, peça ajuda à administração.';
      return 'Não conseguimos iniciar o acesso agora. Tente novamente. Se continuar, peça ajuda à administração.';
    }
    if (code === 'PIN_ADJACENT_REPETITION') return 'Escolha um PIN sem números iguais lado a lado. Por exemplo, não use dois números 1 seguidos.';
    if (code === 'INVALID_PIN') return 'O PIN precisa ter exatamente quatro números. Confira os campos e tente novamente.';
    if (code === 'AUTH_RATE_LIMITED') return 'Você fez várias tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente. Se precisar, peça ajuda à administração.';
    if (code === 'DEVICE_NOT_ALLOWED') return 'A confirmação do aparelho não abriu, foi cancelada ou expirou. Tente novamente. Se a janela não abrir, confira se o Chrome está atualizado e se o bloqueio de tela está configurado.';
    if (code === 'DEVICE_NOT_SUPPORTED') return 'Este navegador ou aparelho não oferece a confirmação necessária. Use um navegador atualizado em um aparelho com bloqueio de tela.';
    if (code === 'DEVICE_SECURITY_ERROR') return 'O navegador bloqueou a confirmação neste endereço. Abra o link da livraria diretamente em uma nova aba e tente novamente.';
    if (code === 'DEVICE_ALREADY_REGISTERED') return 'Este aparelho já possui uma chave de acesso para a conta. Volte ao início e tente entrar com seu CPF ou e-mail e PIN.';
    if (code === 'DEVICE_ABORTED') return 'A confirmação do aparelho foi interrompida. Tente novamente.';
    if (code === 'DEVICE_RESPONSE_INVALID') return 'O aparelho não retornou a confirmação. Tente novamente.';
    if (code === 'ACCESS_CONTEXT_EXPIRED') return ['start','login','recover'].includes(error.transport?.operation) ? 'Não conseguimos renovar sua tentativa de acesso. Atualize a página e tente novamente.' : 'Sua tentativa de acesso expirou. Volte ao início e solicite um novo código.';
    if (code === 'ACCESS_CONTEXT_CHANGED') return 'A tentativa de acesso foi atualizada. Recarregue a página para continuar.';
    if (code.includes('REJECTED')) {
      if (error.transport?.operation === 'start') return 'Não foi possível iniciar seu acesso. Atualize a página e tente novamente.';
      if (error.transport?.operation === 'recover') return 'Não foi possível iniciar a recuperação. Atualize a página e tente novamente.';
      if (!$('email-form').hidden) return 'Não foi possível validar o código. Confira se copiou o código completo do e-mail mais recente. Ele vale por 10 minutos. Se venceu, volte ao início para solicitar outro.';
      if (!$('initial').hidden) return 'Não foi possível entrar com os dados informados. Confira o CPF ou e-mail e o PIN. Se ainda não cadastrou seu acesso, escolha “É meu primeiro acesso”.';
      return 'Não foi possível confirmar sua identidade nesta tentativa. Volte ao início para entrar novamente. Se o problema continuar, peça ajuda à administração.';
    }
    if (code === 'FORBIDDEN') return 'Não foi possível validar esta tentativa de acesso. Atualize a página e tente novamente no endereço da livraria. Se continuar, peça ajuda à administração.';
    return 'Não foi possível concluir esta etapa. Aguarde alguns instantes e tente novamente. Se o problema continuar, peça ajuda à administração da livraria.';
  }
  async function requestJson(operation, options) {
    const controller = new AbortController(), started = performance.now();
    const timer = setTimeout(() => controller.abort(), 60000);
    let response;
    const failure = code => {
      const error = unavailable(code);
      error.transport = {operation, status: response?.status || 0, elapsedMs: Math.round(performance.now() - started)};
      return error;
    };
    try {
      try { response = await fetch(operation === 'session' ? '/api/v1/session' : '/api/v1/access/' + operation, {...options, signal: controller.signal}); }
      catch { throw failure(controller.signal.aborted ? 'ACCESS_REQUEST_TIMEOUT' : 'ACCESS_NETWORK_UNAVAILABLE'); }
      if (operation === 'session' && [401,403].includes(response.status)) return {response, result:null, failure};
      let result; try { result = await response.json(); }
      catch { throw failure(controller.signal.aborted ? 'ACCESS_REQUEST_TIMEOUT' : 'ACCESS_RESPONSE_INVALID'); }
      return {response, result, failure};
    } finally { clearTimeout(timer); }
  }
  async function api(operation, body, canRenew = true) {
    const {response, result, failure} = await requestJson(operation, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrfToken, ...(operation==='complete'?{'x-access-completion-version':'2'}:{}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) {
      // Renew only a server-confirmed preflight rejection: no command ran.
      // Never replay a timeout, invalid response, PIN/code guess or ceremony.
      if (canRenew && response.status === 401 && result?.error?.code === 'ACCESS_CONTEXT_EXPIRED' && ['start','login','recover'].includes(operation)) {
        const fresh = await api('state', undefined, false);
        if (fresh.stage !== 'INITIAL') throw failure('ACCESS_CONTEXT_CHANGED');
        return api(operation, body, false);
      }
      throw failure(typeof result?.error?.code === 'string' ? result.error.code : 'ACCESS_RESPONSE_INVALID');
    }
    if (!result?.data || typeof result.data.csrfToken !== 'string') throw failure('ACCESS_RESPONSE_INVALID');
    if (result.data.csrfToken) csrfToken = result.data.csrfToken;
    if(operation==='recover'){recoveryFlow=true;replacementReady=false;$('use-rescue').checked=false;$('rescue-status').textContent='';$('rescue-inputs').hidden=true;}if(operation==='start'||operation==='login'){recoveryFlow=false;replacementReady=false;}if(result.data.purpose)recoveryFlow=result.data.purpose==='RECOVER';if(result.data.replacementAllowed!==undefined)replacementReady=result.data.replacementAllowed===true;if(result.data.emergencyRecoveryEnabled!==undefined)emergencyEnabled=result.data.emergencyRecoveryEnabled;
    if(result.data.recoveryEnabled!==undefined)$('recovery-choice').hidden=!result.data.recoveryEnabled;
    return result.data;
  }
  async function run(action, scope) {
    if (busy) return;
    if (scope) feedbackIn(scope);
    accessPhase = 'ACCESS';
    actionRevision++;
    maskPins();
    busy = true; document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    const detail = document.getElementById('access-diagnostic'); if (detail) { detail.hidden = true; detail.textContent = ''; }
    $('support-details').hidden = true; $('support-details').open = false; $('check-step').hidden = true;
    pendingMessage = null; $('status').hidden = true; $('access-progress').hidden = false;
    document.querySelectorAll('form').forEach(form => form.setAttribute('aria-busy', 'true'));
    try { await action(); if (!$('passkey').hidden && !preparedDevice) await prepareDevice(); } catch (error) { diagnostic(error); message(describe(error), 'error'); $('check-step').textContent = error.transport?.operation === 'options' ? 'Preparar confirmação novamente' : ['state','session'].includes(error.transport?.operation) ? 'Tentar carregar novamente' : 'Conferir etapa salva'; $('check-step').hidden = !uncertainCodes.has(error.code); }
    finally { busy = false; $('access-progress').hidden = true; document.querySelectorAll('form').forEach(form => form.setAttribute('aria-busy', 'false')); document.querySelectorAll('button').forEach(button => { button.disabled = false; }); const result = pendingMessage; pendingMessage = null; if (result) message(result.text, result.tone); else $('status').hidden = false; }
  }
  function clearFieldError(field) {
    $(field).removeAttribute('aria-invalid');
    const node = $(field + '-error'); if (node) {node.hidden = true; node.textContent = '';}
  }
  function identifierError(value) {
    const text = value.trim();
    if (!text) return 'Digite seu CPF ou e-mail.';
    if (text.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && text.length <= 254 ? '' : 'E-mail inválido. Confira o endereço digitado.';
    if (!/^[0-9.\-\s]+$/.test(text)) return 'Digite um CPF ou um endereço de e-mail completo.';
    const cpf = text.replace(/[.\-\s]/g, '');
    if (cpf.length !== 11) return 'Digite os 11 números do CPF.';
    if (/^(\d)\1+$/.test(cpf)) return 'CPF inválido. Confira os números digitados.';
    for (let size = 9; size < 11; size++) {
      let sum = 0; for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
      if (Number(cpf[size]) !== ((sum * 10) % 11) % 10) return 'CPF inválido. Confira os números digitados.';
    }
    return '';
  }
  function validateAccessForm(id) {
    const field = {'login-form':'login-email','start-form':'activation-email','recovery-form':'recovery-email'}[id];
    if (!field) return true;
    const fields = id === 'login-form' ? [field, 'login-pin'] : [field]; fields.forEach(clearFieldError);
    let error = identifierError($(field).value), target = field;
    if (!error && id === 'login-form' && !/^[0-9]{4}$/.test($('login-pin').value)) { target = 'login-pin'; error = 'Digite seu PIN de quatro números.'; }
    if (!error) return true;
    const node = $(target + '-error'); node.textContent = error; node.hidden = false;
    $(target).setAttribute('aria-invalid','true'); $(target).focus();
    $('support-details').hidden = true; $('check-step').hidden = true;
    message(error, 'error'); return false;
  }
  ['login-email','login-pin','activation-email','recovery-email'].forEach(field => $(field).addEventListener('input', () => {
    if ($(field).getAttribute('aria-invalid') === 'true') {
      clearFieldError(field); if (!busy) { $('status').hidden = true; $('status').textContent = ''; }
    }
  }));
  function submit(id, action) { $(id).addEventListener('submit', event => { event.preventDefault(); if (busy) return; feedbackIn(id); if (validateAccessForm(id)) run(action, id); }); }
  function clearSecrets() { ['login-email','login-pin','activation-email','recovery-email'].forEach(clearFieldError); maskPins(); ['login-pin', 'new-pin', 'confirm-pin', 'email-code','rescue-code'].forEach(id => { $(id).value = ''; }); }
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
  async function current(shouldApply = () => true) {
    // Read401/403 as expected absence without requiring its body to be JSON.
    const {response, result, failure} = await requestJson('session', {credentials:'same-origin', cache:'no-store'});
    if ([401,403].includes(response.status)) return false;
    if (!response.ok) throw failure('UPSTREAM_UNAVAILABLE');
    const data = result?.data;
    if (!['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(data?.user?.role) || data.user.assurance !== 'passkey' || typeof data.csrfToken !== 'string') throw unavailable('ACCESS_RESPONSE_INVALID');
    if (!shouldApply()) return false;
    show('COMPLETE'); message('Acesso verificado com sucesso.', 'success');
    $('identity-result').textContent = 'Sua conta está pronta para uso.'; $('team-link').hidden=!['SUPER_ADMIN','ADMIN'].includes(data.user.role); return true;
  }
  async function finish() {
    let result=await api('complete',{response:pendingResponse});
    if(result.stage==='COMMITTING'&&result.proofSaved===true){
      pendingResponse=null;
      result=await api('complete',{response:null});
    }
    if(result.stage!=='COMPLETE')throw unavailable('ACCESS_RESPONSE_INVALID');
    pendingResponse=null;clearSecrets();
    if(typeof result.sessionCsrfToken==='string'){
      if(!['SUPER_ADMIN','ADMIN','ATENDENTE'].includes(result.user?.role)||result.user.assurance!=='passkey'||!/^[A-Za-z0-9_-]{43}$/.test(result.sessionCsrfToken))throw unavailable('ACCESS_RESPONSE_INVALID');
      show('COMPLETE');message('Acesso verificado com sucesso.','success');
      $('identity-result').textContent='Sua conta está pronta para uso.';$('team-link').hidden=!['SUPER_ADMIN','ADMIN'].includes(result.user.role);
    }else if(!await current())throw new Error('SESSION_NOT_CONFIRMED');
  }
  $('check-step').addEventListener('click', () => run(async () => {
    const state = await api('state');
    if (!['INITIAL','EMAIL','PIN','PASSKEY','COMMITTING','COMPLETE'].includes(state.stage)) throw unavailable('ACCESS_RESPONSE_INVALID');
    show(state.stage === 'COMPLETE' ? 'COMMITTING' : state.stage);
    if (state.stage === 'COMPLETE' && await current()) return;
    message({ INITIAL: 'Escolha como deseja acessar sua conta.', EMAIL: 'Cole o código do e-mail mais recente para continuar.', PIN: 'E-mail confirmado. Crie seu PIN para continuar.', PASSKEY: 'A etapa anterior foi confirmada. Clique em “Confirmar no meu aparelho” para continuar.' }[state.stage] || 'A confirmação final ainda precisa ser conferida. Clique em “Conferir e concluir acesso”.');
  }));
  $('recovery-open').addEventListener('click',()=>{if(busy)return;$('recovery-form').hidden=!$('recovery-form').hidden;if(!$('recovery-form').hidden){feedbackIn('recovery-form');$('status').hidden=true;}});
  $('first-access-box').addEventListener('toggle',()=>{if(!busy&&$('first-access-box').open){feedbackIn('start-form');$('status').hidden=true;}});
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
    const data = await saveAccessStep('email', { code: $('email-code').value.trim() }, 'PIN'); $('email-code').value = ''; show(data.stage); message('E-mail confirmado. Defina seu PIN novo.', 'success');
  });
  $('use-rescue').addEventListener('change',()=>{$('rescue-inputs').hidden=!$('use-rescue').checked;});
  $('rescue-confirm').addEventListener('click',()=>run(async()=>{try{await api('rescue',{recoveryCode:$('rescue-code').value});$('rescue-status').textContent='Código confirmado. Defina um PIN novo e cadastre novamente a confirmação pelo aparelho.';}finally{$('rescue-code').value='';}}));
  submit('pin-form', async () => {
    if(recoveryFlow&&emergencyEnabled&&$('use-rescue').checked&&!replacementReady){message('Valide o código de recuperação antes de continuar.', 'error');return;}
    if (/([0-9])\1/.test($('new-pin').value)) { message('Escolha um PIN sem números iguais lado a lado. Por exemplo, não use dois números 1 seguidos.', 'error'); return; }
    if ($('new-pin').value !== $('confirm-pin').value) { message('Os PINs precisam ser iguais.', 'error'); return; }
    try { const data = await saveAccessStep('pin', { pin: $('new-pin').value }, 'PASSKEY'); show(data.stage); message('Agora confirme sua identidade pelo aparelho para proteger sua conta.', 'success'); }
    finally { $('new-pin').value = ''; $('confirm-pin').value = ''; }
  });
  async function prepareDevice() {
    accessPhase = 'PREPARE';
    if (!window.PublicKeyCredential || !navigator.credentials) throw unavailable('DEVICE_NOT_SUPPORTED');
    const data = await api('options', {}), options = data.options;
    if (!['create', 'get'].includes(data.kind) || !options || typeof options.challenge !== 'string') throw unavailable('ACCESS_RESPONSE_INVALID');
    options.challenge = decode(options.challenge);
    if (data.kind === 'create') { options.user.id = decode(options.user.id); options.excludeCredentials = (options.excludeCredentials || []).map(key => ({ ...key, id: decode(key.id) })); }
    else options.allowCredentials = (options.allowCredentials || []).map(key => ({ ...key, id: decode(key.id) }));
    preparedDevice = {kind:data.kind, options}; preparedAt = performance.now();
  }
  $('passkey-button').addEventListener('click', () => run(async () => {
    // The Google round trip happens before this button is enabled. Call the
    // native browser API in the click turn, before any await loses activation.
    if (!preparedDevice || performance.now() - preparedAt > 120000) {
      preparedDevice = null; await prepareDevice();
      message('Tudo pronto. Clique em “Confirmar no meu aparelho” para continuar.'); return;
    }
    const prepared = preparedDevice; preparedDevice = null; accessPhase = 'DEVICE';
    let credential;
    try { credential = await navigator.credentials[prepared.kind]({ publicKey: prepared.options }); }
    catch (error) {
      const code = {NotAllowedError:'DEVICE_NOT_ALLOWED',NotSupportedError:'DEVICE_NOT_SUPPORTED',SecurityError:'DEVICE_SECURITY_ERROR',InvalidStateError:'DEVICE_ALREADY_REGISTERED',AbortError:'DEVICE_ABORTED'}[error?.name];
      // Retain an unconsumed challenge for a new explicit click; no automatic
      // retry of a ceremony or mutation, and never expose browser error text.
      preparedDevice = prepared;
      throw unavailable(code || 'DEVICE_RESPONSE_INVALID');
    }
    if (!credential) { preparedDevice = prepared; throw unavailable('DEVICE_RESPONSE_INVALID'); }
    pendingResponse = serialize(credential);
    show('COMMITTING'); accessPhase = 'COMPLETE'; await finish();
  }));
  $('retry-button').addEventListener('click', () => run(finish));
  $('restart').addEventListener('click', () => { clearSecrets(); pendingResponse = null; show('INITIAL'); message('Solicite um novo código ou entre na conta já ativada.'); });
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
    // A slow optional lookup must not disable the visible form. Ignore late
    // results after any user action, so they cannot replace the newer flow.
    if (!['INITIAL','COMPLETE'].includes(state.stage)) return;
    const openingRevision = actionRevision;
    setTimeout(() => {
      if (openingRevision !== actionRevision) return;
      current(() => openingRevision === actionRevision).catch(error => {
        if (openingRevision !== actionRevision) return;
        accessPhase = 'SESSION'; diagnostic(error);
        message('Não conseguimos conferir se você já estava conectado. Continue pelo formulário de acesso.');
      });
    }, 0);
  });
})();
