"""Actual UI + cookies + scrypt + Chromium WebAuthn signatures; local fake Google.
No live email is sent. No real Google identities, data, or TLS exceptions.
"""
import base64
import json
import os
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
    def tearDown(self):
        self.context.close(); self.server.terminate(); self.server.communicate(timeout=10)
    def local(self, path, body=None, headers=None, method=None):
        req = Request(f'http://127.0.0.1:{self.port}{path}', data=None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode()), headers=headers or {'content-type': 'application/json'}, method=method)
        with urlopen(req, timeout=15) as response:
            return json.load(response)
    def relay(self, route):
        request = route.request; path = urlsplit(request.url).path
        if path == '/api/v1/access/state' and self.state_response_invalid:
            route.fulfill(status=200, content_type='text/html', body='<html>PRIVATE_RESPONSE_SENTINEL</html>'); return
        if path == '/api/v1/session':
            self.session_request_count += 1
        if path == '/api/v1/session' and self.session_transport_failure:
            route.abort('failed'); return
        if path.startswith('/api/'):
            body = request.post_data_buffer
            if self.corrupt_signature and path.endswith('/complete'):
                value = json.loads(body); signature = value['response']['response']['signature']
                raw = bytearray(base64.urlsafe_b64decode(signature + '=' * ((4-len(signature)%4)%4))); raw[-1] ^= 1
                value['response']['response']['signature'] = base64.urlsafe_b64encode(raw).decode().rstrip('='); body = json.dumps(value).encode()
            headers = {key: value for key, value in request.all_headers().items() if key not in ['host', 'content-length']}
            operation = path.rsplit('/', 1)[-1]
            if request.method == 'POST':
                self.step_posts[operation] = self.step_posts.get(operation, 0) + 1
            if operation == self.lost_step and self.step_failure == 'before':
                route.abort('failed'); return
            result = self.local(path, body=body, headers=headers, method=request.method)
            if operation == self.lost_step:
                if self.step_failure == 'html':
                    route.fulfill(status=502, content_type='text/html', body='<html>PRIVATE_PROVIDER_RESPONSE</html>'); return
                route.abort('failed'); return
            if result['cookies']:
                result['headers']['set-cookie'] = '\n'.join(result['cookies'])
            route.fulfill(status=result['status'], headers=result['headers'], body=result['body']); return
        files = {'/acesso-dev.html': 'text/html', '/acesso-dev.js': 'application/javascript', '/acesso-dev.css': 'text/css'}
        if path in files:
            headers = {}
            for rule in tomllib.loads((ROOT / 'netlify.toml').read_text()).get('headers', []):
                if rule['for'] == path:
                    headers.update(rule['values'])
            route.fulfill(status=200, content_type=files[path], headers=headers, body=(ROOT / 'dist' / path[1:]).read_bytes()); return
        route.abort()  # No external requests or third-party scripts in this suite.
    def open(self):
        self.page.goto(ORIGIN + '/acesso-dev.html'); expect(self.page.locator('#initial')).to_be_visible()
    def activation_until_passkey(self):
        self.open(); self.page.locator('summary').click(); self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button', name='Receber código por e-mail').click()
        expect(self.page.locator('#email-form')).to_be_visible()
        self.page.locator('#email-code').fill(self.local('/test/code')['code']); self.page.get_by_role('button', name='Confirmar código').click()
        expect(self.page.locator('#pin-form')).to_be_visible()
        self.page.locator('#new-pin').fill('8274'); self.page.locator('#confirm-pin').fill('8274')
        self.page.get_by_role('button', name='Salvar PIN e continuar').click(); expect(self.page.locator('#passkey')).to_be_visible()
    def activate(self):
        self.activation_until_passkey(); self.page.locator('#passkey-button').click(); expect(self.page.locator('#complete')).to_be_visible()
    def logout(self):
        self.page.locator('#logout-button').click(); expect(self.page.locator('#initial')).to_be_visible()
    def begin_login(self, pin='8274'):
        self.page.locator('#login-email').fill('owner@example.invalid'); self.page.locator('#login-pin').fill(pin)
        self.page.get_by_role('button', name='Continuar com a passkey', exact=True).first.click()
    def assert_no_secrets_in_browser_storage(self):
        state = self.page.evaluate('({local: {...localStorage}, session: {...sessionStorage}, cookie: document.cookie})')
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
        expect(self.page.locator('#status')).to_contain_text('Não foi possível concluir agora')
        self.assertFalse(any(c['name'] == '__Host-livraria_session' for c in self.context.cookies()))
        self.page.reload(); expect(self.page.locator('#retry')).to_be_visible()
        self.page.locator('#retry-button').click(); expect(self.page.locator('#complete')).to_be_visible()
        self.assertEqual(self.local('/test/state')['sessions'], 1); self.assertEqual(self.errors, [])
    def test_wrong_pin_and_corrupted_signature_never_grant_another_session(self):
        self.activate(); self.logout(); self.begin_login('0193')
        expect(self.page.locator('#status')).to_contain_text('Não foi possível confirmar os dados')
        self.assertEqual(self.local('/test/state')['activeSessions'], 0)
        self.begin_login(); expect(self.page.locator('#passkey')).to_be_visible(); self.corrupt_signature = True
        self.page.locator('#passkey-button').click(); expect(self.page.locator('#status')).to_contain_text('Não foi possível confirmar os dados')
        self.assertEqual(self.local('/test/state')['sessions'], 1); self.assertEqual(self.local('/test/state')['activeSessions'], 0)
    def test_session_read_failure_preserves_first_access_form_without_grant(self):
        self.session_transport_failure = True
        self.page.goto(ORIGIN + '/acesso-dev.html')
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
        self.page.goto(ORIGIN + '/acesso-dev.html')
        self.page.get_by_text('É meu primeiro acesso', exact=True).click()
        self.page.locator('#activation-email').fill('owner@example.invalid')
        self.page.get_by_role('button', name='Receber código por e-mail').click()
        expect(self.page.locator('#email-form')).to_be_visible()
        code = self.local('/test/code')['code']
        self.session_transport_failure = True
        self.page.reload()
        expect(self.page.locator('#email-form')).to_be_visible()
        expect(self.page.locator('#status')).to_contain_text('Continue pelo formulário')
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
        expect(self.page.locator('#status')).to_contain_text('está demorando')
        self.page.clock.fast_forward(52000)
        expect(self.page.locator('#pin-form')).to_be_visible()
        self.assertEqual(self.step_posts['email'], 1)
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_saved_step_without_readable_state_stays_closed_until_reload(self):
        self.begin_email(); self.lost_step = 'email'; self.state_response_invalid = True
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#access-diagnostic')).to_contain_text('ACCESS_NETWORK_UNAVAILABLE')
        expect(self.page.locator('#pin-form')).to_be_hidden()
        expect(self.page.locator('#complete')).to_be_hidden()
        self.assertEqual(self.step_posts['email'], 1)
        self.state_response_invalid = False; self.page.reload()
        expect(self.page.locator('#pin-form')).to_be_visible()
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_failed_code_transport_without_commit_does_not_advance(self):
        self.begin_email(); self.lost_step = 'email'; self.step_failure = 'before'
        self.page.get_by_role('button', name='Confirmar código', exact=True).click()
        expect(self.page.locator('#access-diagnostic')).to_contain_text('ACCESS_NETWORK_UNAVAILABLE')
        expect(self.page.locator('#email-form')).to_be_visible()
        expect(self.page.locator('#pin-form')).to_be_hidden()
        self.assertEqual(self.step_posts['email'], 1)
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_explicit_entry_keeps_required_state_check_and_skips_optional_session_lookup(self):
        self.session_transport_failure = True
        self.page.goto(ORIGIN + '/acesso-dev.html#entrar')
        expect(self.page.locator('#initial')).to_be_visible()
        self.assertEqual(self.session_request_count, 0)
        self.assertEqual(self.local('/test/state')['sessions'], 0)
        self.state_response_invalid = True
        self.page.reload()
        expect(self.page.locator('#initial')).to_be_hidden()
        expect(self.page.locator('#access-diagnostic')).to_contain_text('STATE / ACCESS_RESPONSE_INVALID')

    def test_invalid_state_response_shows_only_safe_diagnostic_and_keeps_forms_closed(self):
        self.state_response_invalid = True
        self.page.goto(ORIGIN + '/acesso-dev.html')
        expect(self.page.locator('#access-diagnostic')).to_contain_text('STATE / ACCESS_RESPONSE_INVALID')
        expect(self.page.locator('#initial')).to_be_hidden()
        self.assertNotIn('PRIVATE_RESPONSE_SENTINEL', self.page.locator('body').inner_text())
        self.assertEqual(self.local('/test/state')['sessions'], 0)

    def test_disabled_installation_and_production_page_expose_no_active_forms(self):
        self.local('/test/disable', {}); self.page.goto(ORIGIN + '/acesso-dev.html')
        expect(self.page.locator('#status')).to_contain_text('ainda não foi habilitado')
        expect(self.page.locator('#initial')).to_be_hidden()
        self.page.goto('https://merry-chimera-49a1f3.netlify.app/acesso-dev.html')
        expect(self.page.locator('#status')).to_contain_text('exclusivamente no endereço DEV')
        expect(self.page.locator('#initial')).to_be_hidden(); self.assertEqual(self.local('/test/state')['sessions'], 0)

if __name__ == '__main__':
    unittest.main(verbosity=2)
