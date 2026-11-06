"""Browser checks for the unified identifier without external services."""
import json
import os
from pathlib import Path
import unittest
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app'


class UnifiedAccess(unittest.TestCase):
    def test_production_retries_state_before_first_access_and_sends_csrf(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), args=['--no-sandbox'])
            try:
                page = browser.new_page()
                calls = []
                def relay(route):
                    request = route.request
                    path = urlsplit(request.url).path
                    if path == '/api/v1/access/state':
                        calls.append('state')
                        if calls.count('state') == 1:
                            route.fulfill(status=503, json={'error': {'code': 'UPSTREAM_UNAVAILABLE'}})
                        else:
                            route.fulfill(json={'data': {'stage': 'INITIAL', 'csrfToken': 'token-test'}})
                    elif path == '/api/v1/access/start':
                        calls.append('start')
                        self.assertEqual(request.headers.get('x-csrf-token'), 'token-test')
                        self.assertEqual(json.loads(request.post_data), {'email': 'pessoa@example.com'})
                        route.fulfill(json={'data': {'stage': 'EMAIL', 'csrfToken': 'next', 'message': 'Confira seu e-mail.'}})
                    elif path in ('/acesso-dev.html', '/acesso-dev.js', '/acesso-dev.css', '/app-theme.css'):
                        file = ROOT / path[1:]
                        route.fulfill(content_type={'html':'text/html','js':'application/javascript','css':'text/css'}[file.suffix[1:]], body=file.read_bytes())
                    else:
                        route.fulfill(status=404, body='')
                page.route('**/*', relay)
                page.goto('https://merry-chimera-49a1f3.netlify.app/acesso-dev.html')
                expect(page.locator('#login-form')).to_be_visible()
                page.locator('#login-email').fill('pessoa@example.com')
                page.locator('#first-access').click()
                expect(page.locator('#email-form')).to_be_visible()
                self.assertEqual(calls, ['state', 'state', 'start'])
            finally:
                browser.close()

    def test_production_form_remains_visible_if_backend_rejects_origin(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), args=['--no-sandbox'])
            try:
                page = browser.new_page()
                def relay(route):
                    path = urlsplit(route.request.url).path
                    if path.startswith('/api/'):
                        route.fulfill(status=403, json={'error': {'code': 'FORBIDDEN'}})
                    elif path in ('/acesso-dev.html', '/acesso-dev.js', '/acesso-dev.css', '/app-theme.css'):
                        file = ROOT / path[1:]
                        route.fulfill(content_type={'html':'text/html','js':'application/javascript','css':'text/css'}[file.suffix[1:]], body=file.read_bytes())
                    else:
                        route.fulfill(status=404, body='')
                page.route('**/*', relay)
                page.goto('https://merry-chimera-49a1f3.netlify.app/acesso-dev.html')
                expect(page.locator('#login-form')).to_be_visible()
                page.wait_for_timeout(300)
                expect(page.locator('#status')).to_be_hidden()
                page.locator('#login-email').fill('pessoa@example.com')
                page.locator('#login-password').fill('senha-segura')
                page.locator('#login-form button[type="submit"], #login-form button:not([type])').first.click()
                expect(page.locator('#status')).to_contain_text('não está habilitado neste endereço')
            finally:
                browser.close()

    def test_local_lab_keeps_login_visible_when_emulator_is_offline(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), args=['--no-sandbox'])
            try:
                page = browser.new_page()
                def relay(route):
                    path = urlsplit(route.request.url).path
                    if path.startswith('/api/'):
                        route.fulfill(status=503, json={'error': {'code': 'LOCAL_FIRESTORE_EMULATOR_UNAVAILABLE'}})
                    elif path in ('/acesso-dev.html', '/acesso-dev.js', '/acesso-dev.css', '/app-theme.css'):
                        file = ROOT / path[1:]
                        route.fulfill(content_type={'html':'text/html','js':'application/javascript','css':'text/css'}[file.suffix[1:]], body=file.read_bytes())
                    else:
                        route.fulfill(status=404, body='')
                page.route('**/*', relay)
                page.goto('https://localhost:8443/acesso-dev.html')
                expect(page.locator('#login-form')).to_be_visible()
                expect(page.locator('#status')).to_contain_text('laboratório')
                expect(page.locator('#status')).not_to_contain_text('O acesso está indisponível no momento')
                expect(page.locator('#first-access')).to_be_enabled()
            finally:
                browser.close()

    def test_first_access_and_validation(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), args=['--no-sandbox'])
            try:
                page = browser.new_page(viewport={'width': 320, 'height': 650})
                requests, errors = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))

                def relay(route):
                    request = route.request
                    path = urlsplit(request.url).path
                    if path == '/api/v1/access/state':
                        route.fulfill(json={'data': {'stage': 'INITIAL', 'csrfToken': 'test', 'recoveryEnabled': False}})
                    elif path == '/api/v1/session':
                        route.fulfill(status=401, json={})
                    elif path == '/api/v1/access/start':
                        requests.append(json.loads(request.post_data))
                        route.fulfill(json={'data': {'stage': 'EMAIL', 'csrfToken': 'test', 'message': 'Confira seu e-mail.'}})
                    elif path in ('/acesso-dev.html', '/acesso-dev.js', '/acesso-dev.css', '/app-theme.css'):
                        file = ROOT / path[1:]
                        route.fulfill(status=200, content_type={'html':'text/html','js':'application/javascript','css':'text/css'}[file.suffix[1:]], body=file.read_bytes())
                    else:
                        route.fulfill(status=404, body='')

                page.route('**/*', relay)
                page.goto(ORIGIN+'/acesso-dev.html')
                expect(page.locator('#initial')).to_be_visible()
                field = page.locator('#login-email')
                expect(page.locator('#status')).to_be_hidden()
                expect(page.locator('#biometric-login svg')).to_be_visible()
                password = page.locator('#login-password')
                self.assertAlmostEqual(password.bounding_box()['y'], page.locator('#biometric-login').bounding_box()['y'], delta=2)
                page.locator('[data-password-target="login-password"]').click()
                expect(password).to_have_attribute('type', 'text')
                page.locator('[data-password-target="login-password"]').click()
                expect(password).to_have_attribute('type', 'password')
                page.locator('.access-help summary').click()
                expect(page.locator('.access-help p')).to_be_visible()
                page.locator('.access-help summary').click()
                self.assertEqual(page.locator('#initial input[autocomplete^="username"]').count(), 2)  # recovery is hidden
                self.assertEqual(page.locator('#activation-email').count(), 0)
                page.locator('#first-access').click()
                expect(field).to_have_attribute('aria-invalid', 'true')
                field.fill('11111111111')
                expect(field).to_have_value('111.111.111-11')
                page.locator('#first-access').click()
                expect(page.locator('#login-email-error')).to_contain_text('inválido')
                self.assertEqual(requests, [])
                field.fill('pessoa..teste@example.com')
                page.locator('#first-access').click()
                expect(page.locator('#login-email-error')).to_contain_text('E-mail inválido')
                self.assertEqual(requests, [])
                field.fill('52998224725')
                expect(field).to_have_value('529.982.247-25')
                field.fill('')
                field.press_sequentially('123456789012@example.com')
                expect(field).to_have_value('123456789012@example.com')
                page.locator('#first-access').click()
                expect(page.locator('#email-form')).to_be_visible()
                self.assertEqual(requests, [{'email': '123456789012@example.com'}])
                self.assertTrue(page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                self.assertEqual(errors, [])
            finally:
                browser.close()


if __name__ == '__main__':
    unittest.main()