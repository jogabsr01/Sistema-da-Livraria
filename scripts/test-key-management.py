"""Two real Chromium virtual authenticators; disposable Google and no live account."""
import importlib.util,json,unittest,tomllib
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('profile_qa',Path(__file__).with_name('test-profile.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.qa.ROOT,qa.qa.ORIGIN
class Keys(qa.Profile):
    def setUp(self):
        super().setUp();self.lose_key=None;self.key_commands=[];self.tamper_prove=False
    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        if path in ['/minhas-chaves-dev.html','/minhas-chaves-dev.js','/minhas-chaves-dev.css']:
            headers={}
            for rule in tomllib.loads((ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],headers=headers,body=(ROOT/'dist'/path[1:]).read_bytes());return
        if path.startswith('/api/v1/keys/'):
            headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};body=req.post_data_buffer
            if path.endswith('/prove') and self.tamper_prove:
                self.tamper_prove=False;p=json.loads(req.post_data);s=p['response']['response']['signature'];p['response']['response']['signature']=('B' if s[0]=='A' else 'A')+s[1:];body=json.dumps(p).encode()
            out=self.local(path,body=body,headers=headers,method=req.method)
            if req.method=='POST':self.key_commands.append((path,json.loads(req.post_data)))
            if self.lose_key==path.rsplit('/',1)[-1]:self.lose_key=None;route.abort();return
            route.fulfill(status=out['status'],headers=out['headers'],body=out['body']);return
        super().relay(route)
    def keys(self):
        self.profile();self.local('/test/enable-keys',{});self.page.goto(ORIGIN+'/minhas-chaves-dev.html');expect(self.page.locator('#workspace')).to_be_visible();expect(self.page.locator('#count')).to_have_text('1 de 5 ativas')
    def start_add(self):
        self.page.locator('#add').click();expect(self.page.locator('#prove')).to_be_visible()
    def prove(self):
        self.page.locator('#prove').click();expect(self.page.locator('#register')).to_be_visible()
    def second_authenticator(self):
        self.cdp.send('WebAuthn.removeVirtualAuthenticator',{'authenticatorId':self.authenticator})
        self.authenticator=self.cdp.send('WebAuthn.addVirtualAuthenticator',{'options':{'protocol':'ctap2','transport':'internal','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})['authenticatorId']
        return self.authenticator
    def register(self):
        self.second_authenticator();self.page.locator('#register').click();expect(self.page.locator('#count')).to_have_text('2 de 5 ativas')
    def test_keys_mobile_add_remove_with_different_key_and_login_with_remaining_passkey(self):
        self.keys();expect(self.page.locator('.remove')).to_be_disabled();self.start_add();self.prove();self.register();self.assertEqual(self.local('/test/keys-state'),{'active':2,'added':1,'removed':0});self.page.locator('.remove').first.click();expect(self.page.locator('#remove-dialog')).to_be_visible();self.page.locator('#remove-confirm').click();expect(self.page.locator('#prove')).to_be_visible();self.lose_key='prove';self.page.locator('#prove').click();expect(self.page.locator('#retry')).to_be_enabled();self.assertEqual(self.local('/test/keys-state')['removed'],1);self.page.locator('#retry').click();expect(self.page.locator('#count')).to_have_text('1 de 5 ativas');expect(self.page.locator('#flow-note')).to_contain_text('outras sessões foram encerradas');expect(self.page.locator('.remove')).to_be_disabled();self.assertEqual(self.local('/test/keys-state'),{'active':1,'added':1,'removed':1});self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));folder=ROOT/'work/qa-keys';folder.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(folder/'minhas-chaves-celular.png'),full_page=True)
        self.page.goto(ORIGIN+'/acesso-dev.html');expect(self.page.locator('#complete')).to_be_visible();self.logout();self.begin_login();expect(self.page.locator('#passkey')).to_be_visible();self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible();self.assert_no_secrets_in_browser_storage();self.assertEqual(self.errors,[])
    def test_keys_lost_start_proof_and_registration_ack_reuse_same_requests_without_duplicate_key(self):
        self.keys();self.lose_key='start';self.page.locator('#add').click();expect(self.page.locator('#retry')).to_be_visible();expect(self.page.locator('#retry')).to_be_enabled();self.page.locator('#retry').click();expect(self.page.locator('#prove')).to_be_visible();self.assertEqual(self.key_commands[0],self.key_commands[1]);self.lose_key='prove';self.page.locator('#prove').click();expect(self.page.locator('#retry')).to_be_visible();expect(self.page.locator('#retry')).to_be_enabled();self.page.locator('#retry').click();expect(self.page.locator('#register')).to_be_visible();self.assertEqual(self.key_commands[2],self.key_commands[3]);self.second_authenticator();self.lose_key='complete';self.page.locator('#register').click();expect(self.page.locator('#retry')).to_be_visible();expect(self.page.locator('#retry')).to_be_enabled();self.assertEqual(self.local('/test/keys-state')['added'],1);self.page.locator('#retry').click();expect(self.page.locator('#count')).to_have_text('2 de 5 ativas');self.assertEqual(self.key_commands[4],self.key_commands[5]);self.assertEqual(self.local('/test/keys-state'),{'active':2,'added':1,'removed':0});self.assertEqual(self.errors,[])
    def test_keys_reload_resumes_bound_challenges_without_browser_persistence(self):
        self.keys();self.start_add();self.page.reload();expect(self.page.locator('#prove')).to_be_visible();self.prove();self.page.reload();expect(self.page.locator('#register')).to_be_visible();self.assertEqual(self.page.evaluate('Object.keys(localStorage)'),[]);self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[]);self.register();self.assertEqual(self.local('/test/keys-state')['added'],1)
    def test_keys_cancel_after_proof_preserves_current_key_and_allows_new_confirmation(self):
        self.keys();self.start_add();self.prove();self.page.locator('#cancel').click();expect(self.page.locator('#flow-title')).to_have_text('Alteração cancelada');expect(self.page.locator('#add')).to_be_enabled();self.assertEqual(self.local('/test/keys-state'),{'active':1,'added':0,'removed':0});self.start_add();self.prove();self.register();self.assertEqual(self.errors,[])
    def test_keys_altered_real_signature_is_refused_and_cancel_restarts_with_fresh_challenge(self):
        self.keys();self.start_add();self.tamper_prove=True;self.page.locator('#prove').click();expect(self.page.locator('#status')).to_contain_text('Confirme novamente');expect(self.page.locator('#workspace')).to_be_hidden();self.assertEqual(self.local('/test/keys-state'),{'active':1,'added':0,'removed':0});self.page.reload();expect(self.page.locator('#cancel')).to_be_visible();self.page.locator('#cancel').click();expect(self.page.locator('#add')).to_be_enabled();self.start_add();self.prove();expect(self.page.locator('#register')).to_be_visible();self.assertEqual(self.local('/test/keys-state')['active'],1);self.assertEqual(self.errors,[])
    def test_keys_role_change_clears_key_list_dialog_and_flow(self):
        self.keys();self.start_add();self.local('/test/set-role',{'role':'ATENDENTE'});self.page.evaluate("window.dispatchEvent(new Event('focus'))");expect(self.page.locator('#workspace')).to_be_hidden();expect(self.page.locator('.key')).to_have_count(0);expect(self.page.locator('#flow')).to_be_hidden();expect(self.page.locator('#flow-note')).to_be_empty();self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(Keys(name) for name in unittest.defaultTestLoader.getTestCaseNames(Keys) if name.startswith('test_keys_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
