'use strict';
(() => {
  const DEV = 'dev--merry-chimera-49a1f3.netlify.app';
  const $ = id => document.getElementById(id);
  const message = text => { $('status').textContent = text; };
  let csrfToken = '', busy = false, sessionCsrf = '', pendingResponse = null;
  const panels = ['initial', 'email-form', 'pin-form', 'passkey', 'retry', 'complete'];
  function show(stage) {
    const panel = { INITIAL: 'initial', EMAIL: 'email-form', PIN: 'pin-form', PASSKEY: 'passkey', COMMITTING: 'retry', COMPLETE: 'complete' }[stage];
    panels.forEach(id => { $(id).hidden = id !== panel; });
    $('restart').hidden = !panel || ['initial', 'complete'].includes(panel);
  }
  function describe(error) {
    const code = error.code || '';
    if (code === 'IDENTITY_NOT_ACTIVATED' || code.includes('CONFIGURATION') || code.includes('IDENTITY_UNAVAILABLE')) return 'O acesso verificado ainda não foi habilitado nesta instalação DEV. O protótipo continua disponível no link abaixo.';
    if (code === 'AUTH_RATE_LIMITED') return 'Muitas tentativas. Aguarde o prazo indicado e tente novamente.';
    if (error.name === 'NotAllowedError' || error.name === 'NotSupportedError') return 'A passkey não foi confirmada. Tente novamente e siga a janela do navegador; seu aparelho precisa oferecer uma passkey.';
    if (code.includes('REJECTED')) return 'Não foi possível confirmar os dados. Confira o código ou o PIN; se o prazo venceu, volte ao início.';
    return 'Não foi possível concluir agora. Confira a conexão e tente novamente.';
  }
  async function api(operation, body) {
    const response = await fetch('/api/v1/access/' + operation, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { const error = new Error('ACCESS_FAILED'); error.code = result.error?.code; throw error; }
    if (result.data.csrfToken) csrfToken = result.data.csrfToken;
    return result.data;
  }
  async function run(action) {
    if (busy) return;
    busy = true; document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try { await action(); } catch (error) { message(describe(error)); }
    finally { busy = false; document.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  }
  function submit(id, action) { $(id).addEventListener('submit', event => { event.preventDefault(); run(action); }); }
  function clearSecrets() { ['login-pin', 'new-pin', 'confirm-pin', 'email-code'].forEach(id => { $(id).value = ''; }); }
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
    const response = await fetch('/api/v1/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return false;
    const { data } = await response.json();
    if (data.user.role !== 'SUPER_ADMIN' || data.user.assurance !== 'passkey') return false;
    sessionCsrf = data.csrfToken; show('COMPLETE'); message('Acesso verificado com sucesso.');
    $('identity-result').textContent = 'Conta master autenticada com PIN e passkey.'; return true;
  }
  async function finish() {
    await api('complete', { response: pendingResponse }); pendingResponse = null; clearSecrets();
    if (!await current()) throw new Error('SESSION_NOT_CONFIRMED');
  }
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
  submit('pin-form', async () => {
    if ($('new-pin').value !== $('confirm-pin').value) { message('Os PINs precisam ser iguais.'); return; }
    try { const data = await api('pin', { pin: $('new-pin').value }); show(data.stage); message('Agora cadastre a passkey para proteger a conta master.'); }
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
  if (location.hostname !== DEV || location.protocol !== 'https:') { show('UNAVAILABLE'); message('Esta tela de acesso está disponível exclusivamente no endereço DEV da livraria.'); return; }
  run(async () => {
    const state = await api('state');
    if (!await current()) { show(state.stage === 'COMPLETE' ? 'COMMITTING' : state.stage); message('Acesso verificado da instalação DEV.'); }
  });
})();
