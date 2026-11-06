"""Real Chromium/WebAuthn against local app/Google doubles, with delayed reads.
No real account, password, credential or Google API is used.
"""
import importlib.util,json,unittest
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('home_qa',Path(__file__).with_name('test-home.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.ROOT,qa.ORIGIN
class LoginContention(qa.Home):
    def setUp(self):
        super().setUp();self.hold_session=False;self.held_session=None;self.overlap=[];self.device_bodies=[];self.busy_device=0;self.busy_login=0;self.busy_complete=0
    def relay(self,route):
        path=urlsplit(route.request.url).path
        if path=='/api/v1/session' and self.hold_session:
            self.held_session=route;return
        if path in ['/api/v1/access/login','/api/v1/access/device-login']:
            if self.held_session:self.overlap.append(path)
            if path.endswith('/device-login'):self.device_bodies.append(json.loads(route.request.post_data))
            field='busy_device' if path.endswith('/device-login') else 'busy_login'
            if getattr(self,field):
                setattr(self,field,getattr(self,field)-1)
                route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'code':'WORKSPACE_BUSY'}}));return
        if path=='/api/v1/access/complete' and self.busy_complete:
            self.busy_complete-=1;route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'code':'WORKSPACE_BUSY'}}));return
        super().relay(route)
    def opening_with_slow_session(self):
        self.activate();self.local('/test/seed-checkout',{});self.hold_session=True
        self.page.goto(ORIGIN+'/acesso-dev.html#entrar');expect(self.page.locator('#initial')).to_be_visible()
        for _ in range(100):
            if self.held_session:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held_session)
    def release_session(self):
        held=self.held_session;self.held_session=None;self.hold_session=False
        # Emulate an old, delayed response, including the former cookie clearing.
        held.fulfill(status=401,content_type='application/json',headers={'set-cookie':'__Host-livraria_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'},body=json.dumps({'error':{'code':'UNAUTHENTICATED'}}))
    def test_login_slow_session_cannot_overlap_native_login_or_erase_new_session(self):
        self.opening_with_slow_session();self.page.locator('#biometric-login').click();self.page.wait_for_timeout(300)
        self.assertEqual(self.overlap,[],'Google session read must finish before the login RPC starts')
        self.release_session();expect(self.page).to_have_url(ORIGIN+'/home-dev.html?entrada=confirmada');expect(self.page.locator('#home')).to_be_visible()
        self.page.get_by_role('link',name='Adicionar novo produto').click();expect(self.page.locator('#editor')).to_be_visible()
        self.page.go_back();expect(self.page.locator('#home')).to_be_visible();self.assertEqual(self.local('/test/login-state')['sessions'],2);self.assertEqual(self.errors,[])
    def test_login_slow_session_does_not_force_reentry_of_email_and_pin(self):
        self.opening_with_slow_session();self.page.locator('#login-email').fill('owner@example.invalid');self.page.locator('#login-pin').fill('8274')
        self.page.get_by_role('button',name='Entrar na minha conta',exact=True).click();self.page.wait_for_timeout(300)
        self.assertEqual(self.overlap,[]);self.release_session();expect(self.page.locator('#passkey')).to_be_visible()
        self.page.locator('#passkey-button').click();expect(self.page).to_have_url(ORIGIN+'/home-dev.html?entrada=confirmada');expect(self.page.locator('#home')).to_be_visible()
        self.assertEqual(self.step_posts.get('login'),1);self.assertEqual(self.errors,[])
    def test_login_busy_before_native_prepare_retains_one_signature_and_retry(self):
        self.activate();self.logout();self.busy_device=2
        self.page.evaluate("""() => {window.nativeCount=0;const get=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=o=>{nativeCount++;return get(o)}}""")
        self.page.locator('#biometric-login').click();expect(self.page.locator('#retry-button')).to_be_visible()
        expect(self.page.locator('#access-diagnostic')).to_contain_text('WORKSPACE_BUSY')
        self.assertEqual(self.page.evaluate('nativeCount'),1)
        self.page.locator('#support-details summary').click()
        with self.page.expect_download() as download:self.page.locator('#download-access-diagnostic').click()
        report=json.loads(download.value.path().read_text());self.assertEqual(report['environment'],'dev')
        self.assertEqual(sum(s['code']=='WORKSPACE_BUSY' for s in report['steps']),2)
        self.assertEqual(set(report['steps'][-1]),{'operation','at','queuedMs','http','elapsedMs','code'})
        self.assertNotIn('owner@example.invalid',json.dumps(report))
        self.page.locator('#retry-button').click();expect(self.page.locator('#complete')).to_be_visible()
        self.assertEqual(len(self.device_bodies),3);self.assertEqual(self.device_bodies[0],self.device_bodies[1]);self.assertEqual(self.device_bodies[1],self.device_bodies[2])
        self.assertEqual(self.page.evaluate('nativeCount'),1);self.assertEqual(self.local('/test/login-state')['sessions'],2);self.assertEqual(self.errors,[])
    def test_login_busy_during_proof_save_keeps_one_native_confirmation(self):
        self.activate();self.logout();self.busy_complete=2
        self.page.evaluate("""() => {window.nativeCount=0;const get=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=o=>{nativeCount++;return get(o)}}""")
        self.page.locator('#biometric-login').click();expect(self.page.locator('#retry-button')).to_be_visible();expect(self.page.locator('#access-diagnostic')).to_contain_text('WORKSPACE_BUSY')
        self.page.locator('#retry-button').click();expect(self.page.locator('#complete')).to_be_visible();self.assertEqual(self.page.evaluate('nativeCount'),1);self.assertEqual(len(self.device_bodies),1);self.assertEqual(self.local('/test/login-state')['sessions'],2)
    def test_login_ambiguous_native_preparation_is_not_automatically_replayed(self):
        self.activate();self.logout();self.lost_step='device-login';self.step_failure='after'
        self.page.locator('#biometric-login').click();expect(self.page.locator('#retry-button')).to_be_visible();self.assertEqual(len(self.device_bodies),1)
        self.page.locator('#retry-button').click();expect(self.page.locator('#passkey')).to_be_visible();self.assertEqual(len(self.device_bodies),1)
        self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible();self.assertEqual(self.local('/test/login-state')['sessions'],2)
    def test_login_busy_during_pin_login_retries_without_repeating_form(self):
        self.activate();self.logout();self.busy_login=1;self.begin_login();expect(self.page.locator('#passkey')).to_be_visible()
        self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible();self.assertEqual(self.local('/test/login-state')['sessions'],2);self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(LoginContention(name) for name in unittest.defaultTestLoader.getTestCaseNames(LoginContention) if name in LoginContention.__dict__ and name.startswith('test_login_'))
    r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
