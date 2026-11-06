"""Exercise completed login across coalesced/dropped cookie response headers.
Actual Chromium and virtual WebAuthn; local disposable Google contract only.
"""
import importlib.util,json,unittest
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('home_qa',Path(__file__).with_name('test-home.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.ROOT,qa.ORIGIN
class CookieTransport(qa.Home):
    def setUp(self):
        super().setUp();self.fold=True;self.drop_session=False;self.break_cleanup=False;self.final_cookie_counts=[]
    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        if path in ['/api/v1/access/complete','/api/v1/access/cookie']:
            h={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};r=self.local(path,body=req.post_data_buffer,headers=h,method=req.method)
            cookies=r['cookies']
            if any(c.startswith('__Host-livraria_session=') for c in cookies):self.final_cookie_counts.append(len(cookies))
            if self.drop_session:cookies=[c for c in cookies if not c.startswith('__Host-livraria_session=')]
            if cookies:r['headers']['set-cookie']=(', ' if self.fold else '\n').join(cookies)
            if path.endswith('/cookie') and self.break_cleanup:
                self.break_cleanup=False;route.fulfill(status=200,content_type='text/html',headers=r['headers'],body='<html>UNREADABLE_ACK</html>');return
            route.fulfill(status=r['status'],headers=r['headers'],body=r['body']);return
        super().relay(route)
    def test_cookie_coalescing_does_not_delete_session_on_activation_or_pin_login(self):
        self.activate();self.local('/test/seed-checkout',{})
        self.page.locator('#enter-app').click();expect(self.page.locator('#home')).to_be_visible()
        self.page.get_by_role('link',name='Adicionar novo produto').click();expect(self.page.locator('#editor')).to_be_visible();self.page.go_back();expect(self.page.locator('#home')).to_be_visible()
        self.page.goto(ORIGIN+'/acesso-dev.html?verificar=1');expect(self.page.locator('#complete')).to_be_visible();self.logout();self.begin_login();expect(self.page.locator('#passkey')).to_be_visible();self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible()
        self.page.locator('#enter-app').click();expect(self.page.locator('#home')).to_be_visible();self.assertEqual(self.final_cookie_counts,[1,1]);self.assertEqual(self.errors,[])
    def test_cookie_missing_keeps_result_in_place_and_reissues_same_grant_without_new_biometric(self):
        self.activate();self.logout();self.drop_session=True
        self.page.evaluate("""()=>{window.nativeCount=0;const get=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=o=>{nativeCount++;return get(o)}}""")
        self.page.locator('#biometric-login').click();expect(self.page.locator('#access-diagnostic')).to_contain_text('ACCESS_SESSION_COOKIE_MISSING');expect(self.page.locator('#complete')).to_be_hidden()
        self.drop_session=False;self.page.locator('#retry-button').click();expect(self.page.locator('#complete')).to_be_visible();self.assertEqual(self.page.evaluate('nativeCount'),1);self.assertEqual(self.local('/test/login-state')['sessions'],2)
    def test_cookie_cleanup_unreadable_ack_recovers_existing_session_without_new_login(self):
        self.activate();self.logout();self.break_cleanup=True
        self.page.locator('#biometric-login').click();expect(self.page.locator('#retry-button')).to_be_visible();self.page.locator('#retry-button').click();expect(self.page.locator('#complete')).to_be_visible();self.assertEqual(self.local('/test/login-state')['sessions'],2);self.assertEqual(self.errors,[])
    def test_cookie_home_rejection_after_confirmation_offers_session_check_instead_of_another_login(self):
        self.activate();self.page.route(ORIGIN+'/api/v1/session',lambda route:route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'UNAUTHENTICATED'}})))
        self.page.locator('#enter-app').click();expect(self.page.locator('#entry-failure')).to_be_visible();expect(self.page.locator('#home')).to_be_hidden();expect(self.page.locator('#sign-in')).to_be_hidden();expect(self.page.locator('#retry')).to_be_visible()
        self.page.locator('#entry-failure summary').click()
        with self.page.expect_download() as item:self.page.locator('#download-entry-diagnostic').click()
        report=json.loads(item.value.path().read_text());self.assertEqual(report['http'],401);self.assertEqual(report['code'],'UNAUTHENTICATED');self.assertNotIn('owner@example.invalid',json.dumps(report));self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(CookieTransport(name) for name in CookieTransport.__dict__ if name.startswith('test_cookie_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
