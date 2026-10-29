"""Actual UI + cookies + scrypt + Chromium WebAuthn signatures; local fake Google.
No live email is sent. No real Google identities, data, or TLS exceptions.
"""
import base64
import json
import os
import re
from pathlib import Path
import subprocess
import tomllib
import unittest
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app'
ARTIFACTS = Path(os.environ.get('QA_ARTIFACTS', '/workspace/qa-v17-owner-access'))

class OwnerAccess(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'), args=['--no-sandbox'])
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop()
    def setUp(self):
        self.server = subprocess.Popen([os.environ.get('NODE', 'node'), 'tests/helpers/owner-access-harness.mjs'], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        line = self.server.stdout.readline()
        if not line:
            raise RuntimeError(self.server.stderr.read())
        self.port = json.loads(line)['port']
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844} if 'mobile' in self.id() else {'width': 1280, 'height': 900}, is_mobile='mobile' in self.id(), has_touch='mobile' in self.id())
        self.context.route('**/*', self.relay)
        self.page = self.context.new_page(); self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.cdp = self.context.new_cdp_session(self.page); self.cdp.send('WebAuthn.enable')
        self.authenticator = self.cdp.send('WebAuthn.addVirtualAuthenticator', {'options': {'protocol': 'ctap2', 'transport': 'internal', 'hasResidentKey': True, 'hasUserVerification': True, 'isUserVerified': True, 'automaticPresenceSimulation': True}})['authenticatorId']
        self.corrupt_signature = False
        self.session_transport_failure = False
        self.state_response_invalid = False
        self.session_request_count = 0
        self.lost_step = None
        self.step_failure = None
        self.step_posts = {}
        self.complete_results = []
    def tearDown(self):
        self.context.close(); self.server.terminate(); self.server.communicate(timeout=10)
    def local(self, path, body=None, headers=None, method=None):
        req = Request(f'http://127.0.0.1:{self.port}{path}', data=None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode()), headers=headers or {'content-type': 'application/json'}, method=method)
        with urlopen(req, timeout=15) as response:
            return json.load(response)
    def relay(self, route):
        # Other module suites inherit this relay and own their server setup.
        # Initialize transport-fault controls for those fixtures too.
        if not getattr(self, '_transport_initialized', False):
            for name, value in [('session_request_count',0),('state_response_invalid',False),('session_transport_failure',False),('corrupt_signature',False),('lost_step',None),('step_failure',None),('step_posts',{})]:
                if not hasattr(self,name):setattr(self,name,value)
            self._transport_initialized = True
        request = route.request; path = urlsplit(request.url).path
        if path == '/api/v1/access/state' and self.state_response_invalid:
            route.fulfill(status=200, content_type='text/html', body='<html>PRIVATE_RESPONSE_SENTINEL</html>'); return
        if path == '/api/v1/session':
            self.session_request_count += 1
        if path == '/api/v1/session' and self.session_transport_failure:
            route.abort('failed'); return
        if path.startswith('/api/'):
            body = request.post_data_buffer
            if self.corrupt_signature and (path.endswith('/complete') or path.endswith('/device-login')):
                value = json.loads(body); signature = value['response']['response']['signature']
                raw = bytearray(base64.urlsafe_b64decode(signature + '=' * ((4-len(signature)%4)%4))); raw[-1] ^= 1
                value['response']['response']['signature'] = base64.urlsafe_b64encode(raw).decode().rstrip('='); body = json.dumps(value).encode()
            headers = {key: value for key, value in request.all_headers().items() if key not in ['host', 'content-length']}
            operation = path.rsplit('/', 1)[-1]
            if request.method == 'POST':
                self.step_posts[operation] = self.step_posts.get(operation, 0) + 1
            if operation == self.lost_step and (operation != 'complete' or self.step_posts.get(operation) == getattr(self,'lost_complete_at',1)) and self.step_failure == 'before':
                route.abort('failed'); return
            if operation == self.lost_step and (operation != 'complete' or self.step_posts.get(operation) == getattr(self,'lost_complete_at',1)) and self.step_failure == 'html-before':
                route.fulfill(status=502 if operation == 'options' else 504, content_type='text/html', body='<html>PRIVATE_PROVIDER_RESPONSE</html>'); return
            result = self.local(path, body=body, headers=headers, method=request.method)
            timing = re.search(r'rpc;desc="(\d+)"', result['headers'].get('server-timing', ''))
            if timing: self.last_rpc_count = int(timing.group(1))
            if operation == 'complete':
                if not hasattr(self, 'complete_results'): self.complete_results = []
                self.complete_results.append(result)
            if operation == self.lost_step and (operation != 'complete' or self.step_posts.get(operation) == getattr(self,'lost_complete_at',1)):
                if self.step_failure == 'html':
                    route.fulfill(status=502, content_type='text/html', body='<html>PRIVATE_PROVIDER_RESPONSE</html>'); return
                route.abort('failed'); return
            if result['cookies']:
                result['headers']['set-cookie'] = '\n'.join(result['cookies'])
            route.fulfill(status=result['status'], headers=result['headers'], body=result['body']); return
        files = {'/app-theme.css': 'text/css', '/acesso-dev.html': 'text/html', '/acesso-dev.js': 'application/javascript', '/acesso-dev.css': 'text/css'}
        if path in files:
            headers = {}
            for rule in tomllib.loads((ROOT / 'netlify.toml').read_text()).get('headers', []):
                if rule['for'] == path:
                    headers.update(rule['values'])
            route.fulfill(status=200, content_type=files[path], headers=headers, body=(ROOT / 'dist' / path[1:]).read_bytes()); return
        route.abort()  # No external requests or third-party scripts in this suite.
    def open(self):
        self.page.goto(ORIGIN + '/acesso-dev.html?verificar=1'); expect(self.page.locator('#initial')).to_be_visible()
    def activation_until_passkey(self):
        self.open(); self.page.get_by_text('É meu primeiro acesso', exact=True).click(); self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button', name='Receber código por e-mail').click()
        expect(self.page.locator('#email-form')).to_be_visible()
        self.page.locator('#email-code').fill(self.local('/test/code')['code']); self.page.get_by_role('button', name='Confirmar código').click()
        expect(self.page.locator('#pin-form')).to_be_visible()
        self.page.locator('#new-pin').fill('8274'); self.page.locator('#confirm-pin').fill('8274')
        self.page.get_by_role('button', name='Salvar PIN e continuar').click(); expect(self.page.locator('#passkey')).to_be_visible(); expect(self.page.locator('#passkey-button')).to_be_enabled()
    def activate(self):
        self.activation_until_passkey(); self.page.locator('#passkey-button').click(); expect(self.page.locator('#complete')).to_be_visible()
    def logout(self):
        # Test setup uses the authenticated API; the entry screen now leads into the app.
        status = self.page.evaluate("""async () => {
          const session = await fetch('/api/v1/session', {credentials:'same-origin'});
          const {data} = await session.json();
          return (await fetch('/api/v1/session/logout', {method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':data.csrfToken},body:'{}'})).status;
        }""")
        self.assertEqual(status, 200)
        self.page.reload(); expect(self.page.locator('#initial')).to_be_visible()
    def begin_login(self, pin='8274'):
        self.page.locator('#login-email').fill('owner@example.invalid'); self.page.locator('#login-pin').fill(pin)
        self.page.get_by_role('button', name='Entrar na minha conta', exact=True).first.click()
    def assert_no_secrets_in_browser_storage(self):
        state = self.page.evaluate('({local: {...localStorage}, session: {...sessionStorage}, cookie: document.cookie})')
        remembered=state['local'].pop('livraria.access.identifier.v1',None)
        if remembered is not None:
            hint=json.loads(remembered);self.assertEqual(set(hint),{'value','expires'});self.assertIsInstance(hint['value'],str);self.assertLessEqual(len(hint['value']),254)
        self.assertEqual(state, {'local': {}, 'session': {}, 'cookie': ''})
        cookie = next(c for c in self.context.cookies() if c['name'] == '__Host-livraria_session')
        self.assertTrue(cookie['httpOnly']); self.assertTrue(cookie['secure']); self.assertEqual(cookie['sameSite'], 'Lax')
    def test_complete_activation_then_login_and_logout_with_real_browser_signatures(self):
        self.activate(); self.assert_no_secrets_in_browser_storage()
        self.assertEqual(self.local('/test/state')['sessions'], 1)
        self.page.reload(); expect(self.page.locator('#complete')).to_be_visible()
        self.logout(); self.begin_login(); expect(self.page.locator('#passkey')).to_be_visible()
        self.assertEqual(self.local('/test/state')['activeSessions'], 0, 'PIN alone never grants a session')
        self.page.locator('#passkey-button').click(); expect(self.page.locator('#complete')).to_be_visible()
        state = self.local('/test/state'); self.assertEqual(state['sessions'], 2); self.assertEqual(state['pins'], 1); self.assertEqual(state['passkeys'], 1)
        self.page.screenshot(path=str(ARTIFACTS / 'acesso-desktop.png'), full_page=True)
        self.assert_no_secrets_in_browser_storage(); self.assertEqual(self.errors, [])
    def test_mobile_completed_entry_opens_app_without_logging_out(self):
        self.activate()
        expect(self.page.locator('#logout-button')).to_have_count(0)
        entry = self.page.get_by_role('link', name='Entrar no app Livraria')
        expect(entry).to_have_attribute('href', '/home-dev.html')
        entry.focus(); self.assertEqual(self.page.evaluate('document.activeElement.id'), 'enter-app')
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        self.page.screenshot(path=str(ARTIFACTS / 'entrada-app-mobile.png'), full_page=True)
        self.page.route(ORIGIN + '/home-dev.html', lambda route: route.fulfill(status=200, content_type='text/html', body='<h1>Catálogo da livraria</h1>'))
        entry.press('Enter'); expect(self.page).to_have_url(ORIGIN + '/home-dev.html')
        self.assertEqual(self.step_posts.get('logout', 0), 0)
        self.assertEqual(self.local('/test/state')['activeSessions'], 1)
        self.assertEqual(self.errors, [])
    def test_completion_uses_three_single_rpc_phases_without_extra_session_read(self):
        self.activation_until_passkey()
        before = self.session_request_count
        rpc_before = self.last_rpc_count
        self.page.locator('#passkey-button').click()
        expect(self.page.locator('#complete')).to_be_visible()
        self.assertEqual(len(self.complete_results), 3)
        first, saved, second = self.complete_results
        self.assertEqual(first['status'], 202)
        self.assertEqual(json.loads(first['body'])['data']['stage'], 'COMMITTING')
        self.assertEqual(first['cookies'], [])
        first_count = int(re.search(r'rpc;desc="(\d+)"', first['headers']['server-timing']).group(1))
        self.assertEqual(first_count - rpc_before, 1)
        self.assertIn('proofReceipt', json.loads(first['body'])['data'])
        saved_count=int(re.search(r'rpc;desc="(\d+)"', saved['headers']['server-timing']).group(1))
        self.assertEqual(saved_count-first_count,1)
        self.assertEqual(saved['cookies'],[])
        self.assertTrue(json.loads(saved['body'])['data']['proofSaved'])
        self.assertEqual(json.loads(second['body'])['data']['stage'], 'COMPLETE')
        second_count = int(re.search(r'rpc;desc="(\d+)"', second['headers']['server-timing']).group(1))
        self.assertEqual(second_count - saved_count, 1)
        self.assertEqual(self.session_request_count, before)
        self.assertEqual(self.local('/test/state')['sessions'], 1)
        self.assert_no_secrets_in_browser_storage()

    def test_lost_proof_ack_stops_without_auto_commit_and_reload_resumes_one_session(self):
        self.activation_until_passkey()
        self.lost_step = 'complete'; self.step_failure = 'html'; self.lost_complete_at=2
        self.page.locator('#passkey-button').click()
        expect(self.page.locator('#status')).to_contain_text('Não foi possível concluir sua entrada')
        self.assertEqual(self.step_posts.get('complete'), 2)
        state = self.local('/test/state')
        self.assertEqual(state['sessions'], 0)
        self.assertEqual(state['passkeys'], 1)
        self.page.screenshot(path=str(ARTIFACTS/'recuperacao-entrada.png'),full_page=True)
        self.lost_step = None; self.step_failure = None
        self.page.reload()
        expect(self.page.locator('#retry')).to_be_visible()
        self.page.locator('#retry-button').click()
        expect(self.page.locator('#complete')).to_be_visible()
        self.assertEqual(self.local('/test/state')['sessions'], 1)
        self.assertEqual(self.local('/test/state')['passkeys'], 1)
        self.assertEqual(self.errors, [])

    def test_lost_preparation_ack_offers_fresh_device_confirmation_without_replaying_consumed_proof(self):
        self.activate();self.logout();self.begin_login();self.lost_step='complete';self.step_failure='html';self.complete_results=[];self.step_posts['complete']=0
        self.page.locator('#passkey-button').click()
        expect(self.page.locator('#status')).to_contain_text('Não foi possível concluir sua entrada')
        expect(self.page.locator('#check-step')).to_be_hidden()
        expect(self.page.locator('#retry-button')).to_have_text('Tentar concluir entrada')
        self.assertEqual(self.local('/test/state')['passkeys'],1)
        self.lost_step=None;self.step_failure=None
        self.page.locator('#retry-button').click();expect(self.page.locator('#passkey-button')).to_have_text('Confirmar no meu aparelho')
        self.assertEqual(self.local('/test/state')['sessions'],1)
        self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible()
        self.assertEqual(self.local('/test/state')['sessions'],2)
        self.assertEqual(self.local('/test/state')['passkeys'],1)
        self.assertEqual(self.errors,[])
    def test_biometric_login_uses_registered_device_without_pin(self):
        self.activate();self.logout()
        expect(self.page.locator('#login-email')).to_have_value('owner@example.invalid')
        self.page.locator('#login-email').fill('')
        self.page.evaluate("""() => {const get=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=options=>{window.nativeLoginActive=navigator.userActivation.isActive;return get(options)}}""")
        before=self.step_posts.get('options',0)
        self.page.locator('#biometric-login').click()
        expect(self.page.locator('#complete')).to_be_visible()
        self.assertTrue(self.page.evaluate('nativeLoginActive'))
        self.assertEqual(self.step_posts.get('login',0),0)
        self.assertEqual(self.step_posts.get('biometric',0),0)
        self.assertEqual(self.step_posts.get('options',0),before)
        self.assertEqual(self.step_posts.get('device-login',0),1)
        self.assertEqual(self.local('/test/state')['sessions'],2)
        self.assertEqual(self.local('/test/state')['passkeys'],1)
        self.assertEqual(self.errors,[])

    def test_discoverable_login_rejects_corrupted_native_signature_without_issuing_session(self):
        self.activate();self.logout();self.corrupt_signature=True
        self.page.locator('#biometric-login').click()
        expect(self.page.locator('#status')).to_contain_text('Não foi possível confirmar sua identidade')
        self.assertEqual(self.local('/test/state')['sessions'],1)
        self.assertEqual(self.local('/test/state')['activeSessions'],0)
        expect(self.page.locator('#complete')).to_be_hidden()
        self.assertEqual(self.errors,[])

    def test_identifier_memory_can_be_cleared_without_storing_pin_or_credentials(self):
        self.activate();self.logout()
        expect(self.page.locator('#login-email')).to_have_value('owner@example.invalid')
        self.page.locator('#remember-identifier').uncheck()
        self.page.locator('#biometric-login').click();expect(self.page.locator('#complete')).to_be_visible()
        self.assertIsNone(self.page.evaluate("localStorage.getItem('livraria.access.identifier.v1')"))
        self.assert_no_secrets_in_browser_storage();self.assertEqual(self.errors,[])

    def test_expired_completion_continuation_offers_restart_instead_of_repeating_failed_action(self):
        self.activation_until_passkey()
        self.page.route(ORIGIN+'/api/v1/access/complete',lambda route:route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'ACCESS_CONTINUATION_EXPIRED'}})))
        self.page.locator('#passkey-button').click()
        expect(self.page.locator('#retry-button')).to_be_hidden()
        expect(self.page.locator('#check-step')).to_be_hidden()
        expect(self.page.locator('#restart')).to_be_visible()
        self.assertEqual(self.local('/test/state')['sessions'],0)
        self.assertEqual(self.errors,[])

    def test_start_timeout_recovers_delivered_code_with_rotated_cookie_without_resending(self):
        self.open(); self.page.get_by_text('É meu primeiro acesso',exact=True).click()
        self.page.locator('#activation-email').fill('owner@example.invalid')
        self.local('/test/start-timeout', {'after': True})
        self.page.get_by_role('button',name='Receber código por e-mail').click()
        expect(self.page.locator('#status')).to_contain_text('Não conseguimos confirmar esta etapa')
        self.assertEqual(self.step_posts.get('start'),1)
        self.assertEqual(self.local('/test/state')['outbox'],1)
        self.assertFalse(any(c['name']=='__Host-livraria_session' for c in self.context.cookies()))
        self.page.get_by_role('button',name='Conferir etapa salva',exact=True).click()
        expect(self.page.locator('#email-form')).to_be_visible()
        self.page.locator('#email-code').fill(self.local('/test/code')['code'])
        self.page.get_by_role('button',name='Confirmar código',exact=True).click()
        expect(self.page.locator('#pin-form')).to_be_visible()
        self.assertEqual(self.step_posts.get('start'),1)
        self.assertEqual(self.local('/test/state')['outbox'],1)
        self.assertEqual(self.local('/test/state')['sessions'],0)
        self.assertEqual(self.errors,[])

    def test_mobile_activation_has_no_horizontal_overflow_and_preserves_verified_session(self):
        self.activate(); self.assert_no_secrets_in_browser_storage()
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        self.page.screenshot(path=str(ARTIFACTS / 'acesso-celular.png'), full_page=True)
        self.assertEqual(self.errors, [])
    def test_interrupted_commit_survives_reload_and_retries_one_session(self):
        self.recover_commit('session')
    def test_lost_final_acknowledgement_survives_reload_without_a_second_session(self):
        self.recover_commit('marker')
    def recover_commit(self, stage):
        self.activation_until_passkey(); self.local('/test/fault', {'stage': stage, 'after': True})
        self.page.locator('#passkey-button').click()
        expect(self.page.locator('#status')).to_contain_text('Não foi possível concluir sua entrada')
        expect(self.page.locator('#access-progress')).to_be_hidden()
        expect(self.page.locator('#status')).to_have_attribute('data-tone', 'error')
        self.assertFalse(any(c['name'] == '__Host-livraria_session' for c in self.context.cookies()))
        if stage == 'session':
            expect(self.page.locator('#check-step')).to_be_hidden()
        else:
            self.page.reload()
        expect(self.page.locator('#retry')).to_be_visible()
        self.page.locator('#retry-button').click(); expect(self.page.locator('#complete')).to_be_visible()
        self.assertEqual(self.local('/test/state')['sessions'], 1); self.assertEqual(self.errors, [])
    def test_wrong_pin_and_corrupted_signature_never_grant_another_session(self):
        self.activate(); self.logout(); self.begin_login('0193')
        expect(self.page.locator('#status')).to_contain_text('Não foi possível entrar com os dados informados')
        self.assertEqual(self.local('/test/state')['activeSessions'], 0)
        self.begin_login(); expect(self.page.locator('#passkey')).to_be_visible(); self.corrupt_signature = True
        self.page.locator('#passkey-button').click(); expect(self.page.locator('#status')).to_contain_text('Não foi possível confirmar sua identidade')
        self.assertEqual(self.local('/test/state')['sessions'], 1); self.assertEqual(self.local('/test/state')['activeSessions'], 0)
    def test_session_read_failure_preserves_first_access_form_without_grant(self):
        self.session_transport_failure = True
        self.page.goto(ORIGIN + '/acesso-dev.html?verificar=1')
        expect(self.page.locator('#initial')).to_be_visible()
        expect(self.page.locator('#status')).to_contain_text('Continue pelo formulário')
        expect(self.page.locator('#access-diagnostic')).to_contain_text('SESSION / ACCESS_NETWORK_UNAVAILABLE')
        self.page.screenshot(path=str(ARTIFACTS / 'primeiro-acesso-falha-sessao.png'), full_page=True)
        self.page.get_by_text('É meu primeiro acesso', exact=True).click()
        self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button', name='Receber código por e-mail').click()
        expect(self.page.locator('#email-form')).to_be_visible()
        self.assertEqual(self.local('/test/state')['sessions'], 0)
        self.assertEqual(self.local('/test/state')['outbox'], 1)
    def test_session_read_failure_on_reload_preserves_email_flow(self):
        self.page.goto(ORIGIN + '/acesso-dev.html?verificar=1')
        self.page.get_by_text('É meu primeiro acesso', exact=True).click()
        self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button', name='Receber código por e-mail').click()
        expect(self.page.locator('#email-form')).to_be_visible()
        code = self.local('/test/code')['code']
        self.session_transport_failure = True
        self.page.reload()
        expect(self.page.locator('#email-form')).to_be_visible()
        expect(self.page.locator('#status')).to_contain_text('Escolha como deseja acessar sua conta.')
        self.page.locator('#email-code').fill(code)
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#pin-form')).to_be_visible()
        self.assertEqual(self.local('/test/state')['outbox'], 1)
        self.assertEqual(self.local('/test/state')['sessions'], 0)
    def test_complete_flow_never_shows_authenticated_view_when_session_check_fails(self):
        self.activate()
        self.session_transport_failure = True
        self.page.reload()
        expect(self.page.locator('#initial')).to_be_visible()
        expect(self.page.locator('#complete')).to_be_hidden()
        self.session_transport_failure = False
        self.page.reload()
        expect(self.page.locator('#complete')).to_be_visible()
        self.assertEqual(self.local('/test/state')['sessions'], 1)

    def begin_email(self):
        self.open()
        self.page.get_by_text('É meu primeiro acesso', exact=True).click()
        self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button', name='Receber código por e-mail').click()
        expect(self.page.locator('#email-form')).to_be_visible()
        self.page.locator('#email-code').fill(self.local('/test/code')['code'])

    def test_email_lost_acknowledgement_resumes_pin_without_repeating_code(self):
        self.begin_email(); self.lost_step = 'email'
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#pin-form')).to_be_visible()
        expect(self.page.locator('#access-progress')).to_be_hidden()
        expect(self.page.locator('#status')).to_have_attribute('data-tone', 'success')
        self.assertEqual(self.step_posts['email'], 1)
        self.assertEqual(self.local('/test/state')['sessions'], 0)
        self.assertEqual(self.local('/test/state')['outbox'], 1)

    def test_pin_saved_with_provider_html_resumes_passkey_without_resubmitting(self):
        self.begin_email()
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#pin-form')).to_be_visible()
        self.lost_step = 'pin'; self.step_failure = 'html'
        self.page.locator('#new-pin').fill('8274'); self.page.locator('#confirm-pin').fill('8274')
        self.page.get_by_role('button', name='Salvar PIN e continuar').click()
        expect(self.page.locator('#passkey')).to_be_visible()
        self.assertEqual(self.step_posts['pin'], 1)
        self.assertEqual(self.local('/test/state')['sessions'], 0)
        self.assertNotIn('PRIVATE_PROVIDER_RESPONSE', self.page.locator('body').inner_text())
        self.assertEqual(self.page.locator('#new-pin').input_value(), '')
        self.assertEqual(self.page.locator('#confirm-pin').input_value(), '')

    def test_email_stalled_body_has_bounded_wait_and_resumes_saved_stage(self):
        self.page.add_init_script("""(() => {
          const original = window.fetch;
          window.fetch = async (url, options) => {
            const response = await original(url, options);
            if (!String(url).endsWith('/access/email')) return response;
            window.testBodyWaiting = true;
            return {ok: response.ok, json: () => new Promise((resolve, reject) => {
              options.signal.addEventListener('abort', () => reject(new Error('test timeout')), {once:true});
            })};
          };
        })();""")
        self.page.clock.install()
        self.begin_email()
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        self.page.wait_for_function('window.testBodyWaiting === true')
        self.page.clock.fast_forward(8001)
        expect(self.page.locator('#access-progress')).to_be_visible()
        expect(self.page.locator('#access-progress')).to_contain_text('Aguarde')
        expect(self.page.locator('#status')).to_be_hidden()
        expect(self.page.get_by_role('button', name='Confirmar código', exact=True)).to_be_disabled()
        expect(self.page.locator('#email-form')).to_have_attribute('aria-busy', 'true')
        self.page.emulate_media(reduced_motion='reduce')
        self.assertEqual(self.page.locator('.access-spinner').evaluate('(el) => getComputedStyle(el).animationName'), 'none')
        self.page.screenshot(path=str(ARTIFACTS / 'acesso-carregando.png'), full_page=True)
        self.page.clock.fast_forward(52000)
        expect(self.page.locator('#pin-form')).to_be_visible()
        expect(self.page.locator('#access-progress')).to_be_hidden()
        expect(self.page.locator('#status')).to_have_attribute('data-tone', 'success')
        self.assertEqual(self.step_posts['email'], 1)
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_first_access_errors_stay_inside_its_box_and_name_the_actual_cause(self):
        for code, status, expected in [('ACCESS_EMAIL_NOT_REGISTERED',404,'E-mail não cadastrado'),('ACCESS_ALREADY_ACTIVATED',409,'já tem acesso ativo'),('AUTH_DELIVERY_RATE_LIMITED',429,'Confira o e-mail mais recente'),('ACCESS_EMAIL_DELIVERY_UNAVAILABLE',503,'confirmar o envio')]:
            with self.subTest(code=code):
                self.page.route('**/api/v1/access/start',lambda route, request, c=code, s=status: route.fulfill(status=s,json={'error':{'code':c,'message':'PRIVATE_PROVIDER_SENTINEL'}}))
                self.page.goto(ORIGIN + '/acesso-dev.html?verificar=1')
                self.page.get_by_text('É meu primeiro acesso', exact=True).click()
                self.page.locator('#activation-email').fill('pessoa@example.invalid')
                self.page.get_by_role('button',name='Receber código por e-mail',exact=True).click()
                expect(self.page.locator('#first-access-box #status')).to_contain_text(expected)
                expect(self.page.locator('#email-form')).to_be_hidden()
                self.assertNotIn('PRIVATE_PROVIDER_SENTINEL',self.page.locator('body').inner_text())
                self.assertNotIn(code,self.page.locator('body').inner_text())
                self.page.unroute('**/api/v1/access/start')
        self.assertEqual(self.local('/test/state')['sessions'],0)

    def test_first_access_invalid_email_is_local_and_cpf_missing_keys_is_explained_in_its_box(self):
        self.page.goto(ORIGIN + '/acesso-dev.html?verificar=1')
        self.page.get_by_text('É meu primeiro acesso',exact=True).click()
        self.page.locator('#activation-email').fill('incompleto@')
        self.page.get_by_role('button',name='Receber código por e-mail',exact=True).click()
        expect(self.page.locator('#first-access-box')).to_contain_text('E-mail inválido')
        self.assertEqual(self.step_posts,{})
        self.page.locator('#activation-email').fill('52998224725')
        self.page.get_by_role('button',name='Receber código por e-mail',exact=True).click()
        expect(self.page.locator('#first-access-box #status')).to_contain_text('Use seu e-mail cadastrado')
        expect(self.page.locator('#email-form')).to_be_hidden()
        self.assertEqual(self.local('/test/state')['sessions'],0)

    def test_opening_state_timeout_offers_read_retry_without_claiming_data_saved(self):
        self.lost_step = 'state'; self.step_failure = 'html-before'
        self.page.goto(ORIGIN + '/acesso-dev.html?verificar=1')
        expect(self.page.locator('#status')).to_contain_text('Não conseguimos carregar seu acesso agora')
        self.assertNotIn('salvos', self.page.locator('#status').inner_text())
        expect(self.page.locator('#complete')).to_be_hidden()
        expect(self.page.locator('#support-details')).to_be_visible()
        self.assertEqual(self.step_posts, {})
        self.lost_step = None
        self.page.get_by_role('button', name='Tentar carregar novamente', exact=True).click()
        expect(self.page.locator('#initial')).to_be_visible()
        expect(self.page.locator('#check-step')).to_be_hidden()
        self.assertEqual(self.step_posts, {})
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_saved_step_without_readable_state_stays_closed_until_reload(self):
        self.begin_email(); self.lost_step = 'email'; self.state_response_invalid = True
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#access-diagnostic')).to_contain_text('ACCESS_NETWORK_UNAVAILABLE')
        expect(self.page.locator('#pin-form')).to_be_hidden()
        expect(self.page.locator('#complete')).to_be_hidden()
        self.assertEqual(self.step_posts['email'], 1)
        expect(self.page.locator('#status')).to_contain_text('Conferir etapa salva')
        expect(self.page.locator('#access-diagnostic')).to_be_hidden()
        self.assertFalse(self.page.locator('#support-details').evaluate('(node) => node.open'))
        self.page.get_by_text('Informações para o suporte', exact=True).click()
        expect(self.page.locator('#access-diagnostic')).to_be_visible()
        self.state_response_invalid = False
        self.page.get_by_role('button', name='Conferir etapa salva', exact=True).click()
        expect(self.page.locator('#pin-form')).to_be_visible()
        expect(self.page.locator('#support-details')).to_be_hidden()
        expect(self.page.locator('#check-step')).to_be_hidden()
        self.assertEqual(self.step_posts['email'], 1)
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_failed_code_transport_without_commit_does_not_advance(self):
        self.begin_email(); self.lost_step = 'email'; self.step_failure = 'before'
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#access-diagnostic')).to_contain_text('ACCESS_NETWORK_UNAVAILABLE')
        expect(self.page.locator('#email-form')).to_be_visible()
        expect(self.page.locator('#pin-form')).to_be_hidden()
        self.assertEqual(self.step_posts['email'], 1)
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_wrong_email_code_has_specific_guidance_without_visible_technical_code(self):
        self.begin_email()
        self.page.locator('#email-code').fill('A' * 43)
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#status')).to_contain_text('Confira se copiou o código completo')
        expect(self.page.locator('#email-form')).to_be_visible()
        expect(self.page.locator('#pin-form')).to_be_hidden()
        expect(self.page.locator('#check-step')).to_be_hidden()
        expect(self.page.locator('#access-diagnostic')).to_be_hidden()
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_pin_visibility_buttons_are_accessible_and_remask_on_submission(self):
        self.open(); self.page.locator('#login-pin').fill('8274')
        toggle = self.page.get_by_role('button', name='Mostrar PIN de entrada', exact=True)
        toggle.click(); expect(self.page.locator('#login-pin')).to_have_attribute('type', 'text')
        expect(self.page.get_by_role('button', name='Ocultar PIN de entrada')).to_have_attribute('aria-pressed', 'true')
        self.page.get_by_role('button', name='Ocultar PIN de entrada').click()
        expect(self.page.locator('#login-pin')).to_have_attribute('type', 'password')
        self.page.locator('#login-email').fill('unknown@example.invalid')
        toggle.click(); self.page.get_by_role('button', name='Entrar na minha conta', exact=True).click()
        expect(self.page.locator('#status')).to_contain_text('Não foi possível entrar')
        expect(self.page.locator('#login-pin')).to_have_attribute('type', 'password')
        self.assertEqual(self.page.locator('#login-pin').input_value(), '')
        self.assertEqual(self.errors, [])

    def test_new_pin_repeats_are_explained_before_network_and_valid_pin_continues(self):
        self.begin_email()
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#pin-form')).to_be_visible()
        self.page.locator('#new-pin').fill('1123'); self.page.locator('#confirm-pin').fill('1123')
        self.page.get_by_role('button', name='Mostrar novo PIN', exact=True).click()
        self.page.get_by_role('button', name='Mostrar confirmação do PIN', exact=True).click()
        expect(self.page.locator('#new-pin')).to_have_attribute('type', 'text')
        expect(self.page.locator('#confirm-pin')).to_have_attribute('type', 'text')
        self.page.get_by_role('button', name='Salvar PIN e continuar').click()
        expect(self.page.locator('#status')).to_contain_text('sem números iguais lado a lado')
        self.assertEqual(self.step_posts.get('pin', 0), 0)
        self.page.screenshot(path=str(ARTIFACTS / 'pin-regra-e-olhos.png'), full_page=True)
        expect(self.page.locator('#new-pin')).to_have_attribute('type', 'password')
        self.page.locator('#new-pin').fill('8274'); self.page.locator('#confirm-pin').fill('8274')
        self.page.get_by_role('button', name='Salvar PIN e continuar').click()
        expect(self.page.get_by_role('button', name='Confirmar no meu aparelho', exact=True)).to_be_visible()
        self.assertEqual(self.step_posts['pin'], 1)
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_slow_previous_session_does_not_block_form_or_override_new_email_flow(self):
        self.activate()
        self.page.add_init_script("""(() => {
          const original = window.fetch;
          window.fetch = async (url, options) => {
            const response = await original(url, options);
            if (String(url) !== '/api/v1/session') return response;
            window.sessionLookupWaiting = true;
            await new Promise(resolve => window.releaseSessionLookup = resolve);
            window.sessionLookupReleased = true;
            return response;
          };
        })();""")
        self.page.reload()
        expect(self.page.locator('#initial')).to_be_visible()
        self.page.wait_for_function('window.sessionLookupWaiting === true')
        expect(self.page.get_by_role('button', name='Entrar na minha conta', exact=True)).to_be_enabled()
        self.page.get_by_text('É meu primeiro acesso', exact=True).click()
        self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button', name='Receber código por e-mail').click()
        expect(self.page.locator('#first-access-box #status')).to_contain_text('já tem acesso ativo')
        self.page.evaluate('window.releaseSessionLookup()')
        self.page.wait_for_function('window.sessionLookupReleased === true')
        expect(self.page.locator('#first-access-box #status')).to_contain_text('já tem acesso ativo')
        expect(self.page.locator('#complete')).to_be_hidden()
        self.assertEqual(self.errors, [])

    def test_seven_character_email_code_accepts_lowercase_and_preserves_second_factor(self):
        self.begin_email()
        proof = self.page.locator('#email-code').input_value()
        self.assertEqual(len(proof), 7)
        self.page.locator('#email-code').fill(proof.lower())
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#pin-form')).to_be_visible()
        expect(self.page.locator('#complete')).to_be_hidden()
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_pin_provider_failure_ends_spinner_and_exposes_only_safe_support_metadata(self):
        self.begin_email()
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#pin-form')).to_be_visible()
        self.lost_step = 'pin'; self.step_failure = 'html-before'
        self.page.locator('#new-pin').fill('8274'); self.page.locator('#confirm-pin').fill('8274')
        self.page.get_by_role('button', name='Salvar PIN e continuar').click()
        expect(self.page.locator('#status')).to_contain_text('Não conseguimos confirmar esta etapa')
        expect(self.page.locator('#status')).to_have_attribute('data-tone', 'error')
        expect(self.page.locator('#access-progress')).to_be_hidden()
        expect(self.page.locator('#pin-form')).to_be_visible()
        expect(self.page.locator('#passkey')).to_be_hidden()
        self.assertNotIn('HTTP: 504', self.page.locator('body').inner_text())
        self.page.get_by_text('Informações para o suporte', exact=True).click()
        expect(self.page.locator('#access-diagnostic')).to_contain_text('etapa: PIN / HTTP: 504 / espera:')
        self.assertNotIn('PRIVATE_PROVIDER_RESPONSE', self.page.locator('body').inner_text())
        self.assertEqual(self.page.locator('#new-pin').input_value(), '')
        self.assertEqual(self.step_posts['pin'], 1)
        self.assertEqual(self.local('/test/state')['sessions'], 0)
        self.page.screenshot(path=str(ARTIFACTS / 'pin-falha-confirmacao.png'), full_page=True)

    def test_options_provider_failure_explains_device_preparation_without_restarting_pin(self):
        self.lost_step = 'options'; self.step_failure = 'html-before'
        self.activation_until_passkey()
        expect(self.page.locator('#status')).to_contain_text('Não conseguimos preparar a confirmação do aparelho')
        expect(self.page.locator('#access-progress')).to_be_hidden()
        expect(self.page.locator('#passkey')).to_be_visible()
        expect(self.page.locator('#pin-form')).to_be_hidden()
        self.assertEqual(self.step_posts['options'], 1)
        self.assertEqual(self.local('/test/state')['sessions'], 0)
        self.page.get_by_text('Informações para o suporte', exact=True).click()
        expect(self.page.locator('#access-diagnostic')).to_contain_text('etapa: OPTIONS / HTTP: 502')
        expect(self.page.locator('#check-step')).to_be_hidden()
        expect(self.page.locator('#passkey h2')).to_have_text('Confirme seu acesso')
        expect(self.page.get_by_role('link',name='Notificações')).to_have_count(0)
        expect(self.page.locator('#passkey-button')).to_have_text('Tentar novamente')
        self.lost_step=None
        self.page.locator('#passkey-button').click()
        expect(self.page.locator('#passkey-button')).to_have_text('Confirmar no meu aparelho')
        self.assertEqual(self.step_posts['options'],2);self.assertEqual(self.local('/test/state')['sessions'],0)
        self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible()
        self.assertEqual(self.step_posts['options'],2);self.assertEqual(self.local('/test/state')['sessions'],1)


    def test_hosting_auth_gate_is_not_reported_as_google_or_pin_failure(self):
        self.page.route(ORIGIN+'/api/v1/access/state',lambda route:route.fulfill(status=401,content_type='text/html',body='<title>Login Redirect</title><script>window.location="https://app.netlify.com/edge-access?private-marker"</script>'))
        self.page.goto(ORIGIN+'/acesso-dev.html?verificar=1')
        expect(self.page.locator('#status')).to_contain_text('Netlify precisa autorizar')
        expect(self.page.locator('#environment-access')).to_be_visible();expect(self.page.locator('#environment-access')).to_have_attribute('href','/')
        expect(self.page.locator('#initial')).to_be_hidden();expect(self.page.locator('#check-step')).to_be_hidden()
        self.assertEqual(self.session_request_count,0);self.assertNotIn('private-marker',self.page.locator('body').inner_text());self.assertEqual(self.errors,[])

    def test_device_prompt_starts_in_user_click_without_another_network_request(self):
        self.activation_until_passkey()
        self.assertEqual(self.step_posts.get('options'), 1)
        self.page.evaluate("""() => {
          const create = navigator.credentials.create.bind(navigator.credentials);
          navigator.credentials.create = options => {
            window.deviceActivation = navigator.userActivation.isActive;
            return create(options);
          };
        }""")
        self.page.locator('#passkey-button').click()
        expect(self.page.locator('#complete')).to_be_visible()
        self.assertTrue(self.page.evaluate('window.deviceActivation'))
        self.assertEqual(self.step_posts.get('options'), 1)
        self.assertEqual(self.errors, [])

    def test_device_failure_names_browser_cause_and_does_not_reset_pin_or_create_a_session(self):
        self.activation_until_passkey()
        self.page.evaluate("""() => { navigator.credentials.create = () => Promise.reject(new DOMException('PRIVATE_BROWSER_SENTINEL', 'NotAllowedError')); }""")
        self.page.locator('#passkey-button').click()
        expect(self.page.locator('#status')).to_contain_text('não abriu, foi cancelada ou expirou')
        expect(self.page.locator('#passkey')).to_be_visible()
        self.page.get_by_text('Informações para o suporte', exact=True).click()
        expect(self.page.locator('#access-diagnostic')).to_contain_text('DEVICE / DEVICE_NOT_ALLOWED')
        self.assertNotIn('PRIVATE_BROWSER_SENTINEL', self.page.locator('body').inner_text())
        self.assertEqual(self.local('/test/state')['sessions'], 0)
        self.assertEqual(self.step_posts.get('options'), 1)
        self.page.locator('#passkey-button').click()
        self.assertEqual(self.step_posts.get('options'), 1)

    def test_old_preparation_requires_a_fresh_click_after_renewal(self):
        self.activation_until_passkey()
        self.page.evaluate("""() => { const now = performance.now.bind(performance); performance.now = () => now() + 121000; }""")
        self.page.locator('#passkey-button').click()
        expect(self.page.locator('#status')).to_contain_text('Tudo pronto. Clique')
        expect(self.page.locator('#complete')).to_be_hidden()
        self.assertEqual(self.step_posts.get('options'), 2)
        self.page.locator('#passkey-button').click()
        expect(self.page.locator('#complete')).to_be_visible()
        self.assertEqual(self.step_posts.get('options'), 2)

    def test_expired_initial_cookie_renews_once_and_sends_only_one_email(self):
        self.open()
        self.context.clear_cookies(name='__Host-livraria_access')
        self.page.get_by_text('É meu primeiro acesso', exact=True).click()
        self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button', name='Receber código por e-mail').click()
        expect(self.page.locator('#email-form')).to_be_visible()
        self.assertEqual(self.step_posts.get('start'), 2)
        state=self.local('/test/state')
        self.assertEqual(state['outbox'],1); self.assertEqual(state['sessions'],0)
        self.assertEqual(state['flowStates'],['EMAIL'])
        self.assertNotIn('PIN',self.page.locator('#status').inner_text())

    def test_expired_login_cookie_renews_without_skipping_pin_or_device(self):
        self.activate(); self.logout()
        self.context.clear_cookies(name='__Host-livraria_access')
        self.begin_login()
        expect(self.page.locator('#passkey')).to_be_visible()
        expect(self.page.locator('#passkey-button')).to_be_enabled()
        expect(self.page.locator('#complete')).to_be_hidden()
        self.assertEqual(self.step_posts.get('login'),2)
        state=self.local('/test/state')
        self.assertEqual(state['outbox'],1); self.assertEqual(state['activeSessions'],0)

    def test_expired_email_context_does_not_repeat_the_code_guess(self):
        self.begin_email()
        self.page.locator('#email-code').fill(self.local('/test/code')['code'])
        self.context.clear_cookies(name='__Host-livraria_access')
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#status')).to_contain_text('Sua tentativa de acesso expirou')
        expect(self.page.locator('#pin-form')).to_be_hidden()
        self.assertEqual(self.step_posts.get('email'),1)
        self.assertEqual(self.local('/test/state')['sessions'],0)

    def test_missing_cookie_after_renewal_stops_without_an_infinite_loop(self):
        self.open(); self.context.clear_cookies(name='__Host-livraria_access')
        self.page.route('**/api/v1/access/state',lambda route:route.fulfill(status=200,json={'data':{'stage':'INITIAL','csrfToken':'A'*43}}))
        self.page.get_by_text('É meu primeiro acesso',exact=True).click()
        self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button',name='Receber código por e-mail').click()
        expect(self.page.locator('#first-access-box #status')).to_contain_text('Não conseguimos renovar sua tentativa')
        expect(self.page.locator('#access-progress')).to_be_hidden()
        self.assertEqual(self.step_posts.get('start'),2)
        self.assertEqual(self.local('/test/state')['outbox'],0)

    def test_rejected_start_is_not_a_pin_error_and_is_not_replayed(self):
        self.open()
        self.page.route('**/api/v1/access/start',lambda route:route.fulfill(status=401,json={'error':{'code':'ACCESS_REJECTED'}}))
        self.page.get_by_text('É meu primeiro acesso',exact=True).click()
        self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button',name='Receber código por e-mail').click()
        expect(self.page.locator('#first-access-box #status')).to_contain_text('Não foi possível iniciar seu acesso')
        self.assertNotIn('PIN',self.page.locator('#status').inner_text())
        self.assertEqual(self.local('/test/state')['outbox'],0)

    def test_uncertain_start_does_not_renew_or_repeat_a_command(self):
        self.open(); self.lost_step='start'; self.step_failure='html-before'
        self.page.get_by_text('É meu primeiro acesso',exact=True).click()
        self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button',name='Receber código por e-mail').click()
        expect(self.page.locator('#status')).to_contain_text('Não conseguimos confirmar esta etapa')
        self.assertEqual(self.step_posts.get('start'),1)
        self.assertEqual(self.local('/test/state')['outbox'],0)

    def test_another_flow_after_context_renewal_does_not_start_a_new_command(self):
        self.open(); self.context.clear_cookies(name='__Host-livraria_access')
        self.page.route('**/api/v1/access/state',lambda route:route.fulfill(status=200,json={'data':{'stage':'EMAIL','csrfToken':'A'*43}}))
        self.page.get_by_text('É meu primeiro acesso',exact=True).click()
        self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button',name='Receber código por e-mail').click()
        expect(self.page.locator('#status')).to_contain_text('A tentativa de acesso foi atualizada')
        self.assertEqual(self.step_posts.get('start'),1)
        self.assertEqual(self.local('/test/state')['outbox'],0)

    def test_first_access_copy_is_short_and_has_no_internal_account_instructions(self):
        self.open()
        self.page.get_by_text('É meu primeiro acesso', exact=True).click()
        expect(self.page.locator('#start-form')).to_contain_text('Informe seu CPF ou e-mail cadastrado para receber o código por e-mail.')
        self.assertNotIn('master', self.page.locator('body').inner_text().lower())

    def test_login_validation_names_one_field_and_does_not_send_incomplete_inputs(self):
        self.open()
        submit = self.page.get_by_role('button', name='Entrar na minha conta', exact=True)
        for value, explanation in [('1234','11 números do CPF'), ('12345678900','CPF inválido'), ('person@','E-mail inválido')]:
            self.page.locator('#login-email').fill(value)
            self.page.locator('#login-pin').fill('8274')
            submit.click()
            expect(self.page.locator('#status')).to_contain_text(explanation)
            expect(self.page.locator('#login-email')).to_have_attribute('aria-invalid','true')
            expect(self.page.locator('#login-email')).to_be_focused()
            expect(self.page.locator('#login-email-error')).to_be_visible()
            expect(self.page.locator('#support-details')).to_be_hidden()
            self.assertEqual(self.step_posts.get('login',0),0)
        self.page.locator('#login-email').fill('owner@example.invalid')
        self.page.locator('#login-pin').fill('')
        submit.click()
        expect(self.page.locator('#status')).to_contain_text('Digite seu PIN de quatro números')
        expect(self.page.locator('#login-pin')).to_have_attribute('aria-invalid','true')
        expect(self.page.locator('#login-pin')).to_be_focused()
        self.assertEqual(self.step_posts.get('login',0),0)
        self.page.screenshot(path=str(ARTIFACTS / 'acesso-validacao-campo.png'),full_page=True)
        self.page.locator('#login-pin').fill('8274')
        expect(self.page.locator('#login-pin-error')).to_be_hidden()
        submit.click()
        expect(self.page.locator('#status')).to_contain_text('Não foi possível entrar')
        self.assertEqual(self.step_posts['login'],1)

    def test_server_validation_error_does_not_blame_correct_pin(self):
        self.page.route('**/api/v1/access/login',lambda route:route.fulfill(status=400,content_type='application/json',body='{"error":{"code":"INVALID_AUTH_REQUEST"}}'))
        self.open()
        self.page.locator('#login-email').fill('529.982.247-25')
        self.page.locator('#login-pin').fill('8274')
        self.page.get_by_role('button',name='Entrar na minha conta',exact=True).click()
        expect(self.page.locator('#status')).to_contain_text('Tente usar seu e-mail cadastrado')
        self.assertNotIn('PIN tem quatro',self.page.locator('#status').inner_text())
        self.assertEqual(self.page.locator('#login-pin').input_value(),'')
        self.assertEqual(self.local('/test/state')['sessions'],0)

    def test_explicit_entry_keeps_required_state_check_and_skips_optional_session_lookup(self):
        self.session_transport_failure = True
        self.page.goto(ORIGIN + '/acesso-dev.html?verificar=1#entrar')
        expect(self.page.locator('#initial')).to_be_visible()
        self.assertEqual(self.session_request_count, 0)
        self.assertEqual(self.local('/test/state')['sessions'], 0)
        self.state_response_invalid = True
        self.page.reload()
        expect(self.page.locator('#initial')).to_be_hidden()
        expect(self.page.locator('#access-diagnostic')).to_contain_text('STATE / ACCESS_RESPONSE_INVALID')

    def test_invalid_state_response_shows_only_safe_diagnostic_and_keeps_forms_closed(self):
        self.state_response_invalid = True
        self.page.goto(ORIGIN + '/acesso-dev.html?verificar=1')
        expect(self.page.locator('#access-diagnostic')).to_contain_text('STATE / ACCESS_RESPONSE_INVALID')
        expect(self.page.locator('#initial')).to_be_hidden()
        expect(self.page.locator('#status')).to_contain_text('Não conseguimos carregar seu acesso agora')
        expect(self.page.locator('#access-progress')).to_be_hidden()
        expect(self.page.locator('#status')).to_have_attribute('data-tone', 'error')
        expect(self.page.locator('#access-diagnostic')).to_be_hidden()
        self.assertNotIn('ACCESS_RESPONSE_INVALID', self.page.locator('body').inner_text())
        self.assertNotIn('PRIVATE_RESPONSE_SENTINEL', self.page.locator('body').inner_text())
        self.page.screenshot(path=str(ARTIFACTS / 'erro-acesso-mensagem-clara.png'), full_page=True)
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_disabled_installation_and_production_page_expose_no_active_forms(self):
        self.local('/test/disable', {}); self.page.goto(ORIGIN + '/acesso-dev.html?verificar=1')
        expect(self.page.locator('#status')).to_contain_text('acesso está indisponível')
        expect(self.page.locator('#initial')).to_be_hidden()
        self.page.goto('https://merry-chimera-49a1f3.netlify.app/acesso-dev.html')
        expect(self.page.locator('#status')).to_contain_text('exclusivamente no endereço DEV')
        expect(self.page.locator('#initial')).to_be_hidden(); self.assertEqual(self.local('/test/state')['sessions'], 0)

if __name__ == '__main__':
    unittest.main(verbosity=2)
