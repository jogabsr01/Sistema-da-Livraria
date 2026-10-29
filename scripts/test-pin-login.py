"""Chromium E2E of approved PIN-only DEV policy; disposable Google emulator."""
import importlib.util,os,unittest
from pathlib import Path
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('cookie_qa',Path(__file__).with_name('test-session-cookie-transport.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ORIGIN=qa.ORIGIN
class PinEntry(qa.CookieTransport):
    def setUp(self):
        previous=os.environ.get('LIVRARIA_TEST_ADMIN_PIN_LOGIN');os.environ['LIVRARIA_TEST_ADMIN_PIN_LOGIN']='1'
        try:super().setUp()
        finally:
            if previous is None:os.environ.pop('LIVRARIA_TEST_ADMIN_PIN_LOGIN',None)
            else:os.environ['LIVRARIA_TEST_ADMIN_PIN_LOGIN']=previous
    def relay(self,route):
        # Exercise the same coalescing proxy for PIN continuation as for passkeys.
        if '/api/v1/access/continue-login' in route.request.url:
            req=route.request;h={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};r=self.local('/api/v1/access/continue-login',body=req.post_data_buffer,headers=h,method=req.method)
            cookies=r['cookies']
            if self.drop_session:cookies=[c for c in cookies if not c.startswith('__Host-livraria_session=')]
            if cookies:r['headers']['set-cookie']=', '.join(cookies)
            route.fulfill(status=r['status'],headers=r['headers'],body=r['body']);return
        super().relay(route)
    def prepare_login(self):
        self.activate();self.local('/test/seed-checkout',{});self.logout()
        self.page.evaluate("""()=>{window.nativeCount=0;const get=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=o=>{nativeCount++;return get(o)}}""")
    def test_pin_direct_entry_product_and_back_without_biometric(self):
        self.prepare_login();self.begin_login();expect(self.page.locator('#complete')).to_be_visible();self.assertEqual(self.page.evaluate('nativeCount'),0)
        self.page.locator('#enter-app').click();expect(self.page.locator('#home')).to_be_visible();self.page.get_by_role('link',name='Adicionar novo produto').click();expect(self.page.locator('#editor')).to_be_visible();self.page.go_back();expect(self.page.locator('#home')).to_be_visible();self.assertEqual(self.errors,[])
    def test_pin_wrong_pin_and_missing_cookie_recovery(self):
        self.prepare_login();self.begin_login('0193');expect(self.page.locator('#status')).to_contain_text('Não foi possível entrar');expect(self.page.locator('#complete')).to_be_hidden();self.drop_session=True
        self.begin_login();expect(self.page.locator('#access-diagnostic')).to_contain_text('ACCESS_SESSION_COOKIE_MISSING');self.drop_session=False;self.page.locator('#retry-button').click();expect(self.page.locator('#complete')).to_be_visible();self.assertEqual(self.page.evaluate('nativeCount'),0);self.assertEqual(self.local('/test/login-state')['sessions'],2)
    def test_pin_explicit_security_stepup_remains_real_passkey(self):
        self.prepare_login();self.page.goto(ORIGIN+'/acesso-dev.html?confirmar=1#entrar');expect(self.page.locator('#initial')).to_be_visible();self.begin_login();expect(self.page.locator('#passkey')).to_be_visible();self.page.locator('#passkey-button').click();expect(self.page.locator('#home')).to_be_visible();self.assertEqual(self.errors,[])
    def test_pin_biometric_remains_alternative(self):
        self.prepare_login();self.page.locator('#biometric-login').click();expect(self.page.locator('#complete')).to_be_visible();self.assertEqual(self.page.evaluate('nativeCount'),1);self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(PinEntry(name) for name in PinEntry.__dict__ if name.startswith('test_pin_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
