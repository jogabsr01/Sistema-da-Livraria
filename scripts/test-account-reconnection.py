"""Profile, verified email and credential reconnection with disposable services."""
import importlib.util,json,unittest,io
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];ORIGIN='https://dev--merry-chimera-49a1f3.netlify.app'
def module(name,file):
    s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
profile=module('profile_qa','test-profile.py');email=module('email_qa','test-email-change.py');emergency=module('emergency_qa','test-emergency-recovery.py')
class Context:
    def setUp(self):
        super().setUp();self.deny=False;self.other=False;self.fail_path=None;self.hold_path=None;self.held=None
    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path;headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
        if path=='/api/v1/session' and (self.deny or self.other):
            if self.deny:route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'UNAUTHENTICATED'}}));return
            out=self.local(path,headers=headers);body=json.loads(out['body']);body['data']['user']['id']='00000000-0000-4000-8000-000000000001';route.fulfill(status=out['status'],headers=out['headers'],body=json.dumps(body));return
        if path==self.fail_path:route.abort();return
        if path==self.hold_path:
            self.held=(route,self.local(path,body=req.post_data_buffer,headers=headers,method=req.method));return
        super().relay(route)
    def network(self,on):self.page.evaluate("on=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>on});window.dispatchEvent(new Event(on?'online':'offline'));}",on)
    def wait_held(self):
        for _ in range(100):
            if self.held:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held)
    def release(self):
        route,out=self.held;self.hold_path=None;route.fulfill(status=out['status'],headers=out['headers'],body=out['body'])
class ProfileReconnect(Context,profile.Profile):
    def ready(self):expect(self.page.locator('#profile-connection')).to_have_attribute('data-state','ready')
    def uncertain(self):
        self.profile();self.page.locator('#phone').fill('11988887777');self.lose_profile=True;self.page.locator('#save').click()
        expect(self.page.locator('#form-status')).to_contain_text('tente novamente');expect(self.page.locator('#save')).to_be_enabled()
    def test_reconnection_profile_offline_preserves_draft_hides_identity(self):
        self.profile();self.page.locator('#phone').fill('11988887777');self.network(False)
        expect(self.page.locator('#profile-fields')).to_be_hidden();expect(self.page.locator('#email')).to_be_empty();expect(self.page.locator('.account-menu')).to_have_count(0)
        self.page.locator('#profile-form').dispatch_event('submit');self.assertEqual(self.commands,[]);self.network(True);self.ready();expect(self.page.locator('#phone')).to_have_value('11988887777')
        self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_have_text('Alterações salvas.');self.assertEqual(len(self.commands),1)
    def test_reconnection_profile_unknown_preserves_original_payload(self):
        self.uncertain();original=self.commands[0];self.page.locator('#phone').evaluate("el=>el.value='11888888888'");self.network(False);self.network(True);self.ready()
        self.assertEqual(len(self.commands),1);self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_have_text('Alterações salvas.');self.assertEqual(self.commands,[original,original]);expect(self.page.locator('#phone')).to_have_value('11988887777')
    def test_reconnection_profile_expired_session_keeps_pending_outside(self):
        self.uncertain();original=self.commands[0];self.deny=True;self.network(False);self.network(True);expect(self.page.locator('#profile')).to_be_hidden()
        expect(self.page.locator('#phone')).to_have_value('');expect(self.page.locator('#profile-pending')).to_be_visible();self.deny=False;self.page.locator('#profile-check').click();self.ready()
        self.page.locator('#profile-resume').click();expect(self.page.locator('#profile-pending')).to_be_hidden();expect(self.page.locator('#form-status')).to_have_text('Alterações salvas.');self.assertEqual(self.commands,[original,original])
    def test_reconnection_profile_other_account_cannot_replay(self):
        self.uncertain();self.other=True;self.network(False);self.network(True);expect(self.page.locator('#profile')).to_be_hidden();self.page.locator('#profile-resume').click()
        expect(self.page.locator('#profile-resume')).to_be_enabled();self.assertEqual(len(self.commands),1);self.other=False;self.page.locator('#profile-check').click();self.ready();self.page.locator('#profile-resume').click();expect(self.page.locator('#profile-pending')).to_be_hidden()
    def test_reconnection_profile_known_save_read_failure_not_unknown(self):
        self.profile();self.page.locator('#phone').fill('11988887777');self.fail_path='/api/v1/profile/get';self.page.locator('#save').click()
        expect(self.page.locator('#status')).to_contain_text('Alterações salvas. Não foi possível atualizar');expect(self.page.locator('#profile-pending')).to_be_hidden()
        self.fail_path=None;self.page.locator('#profile-check').click();self.ready();self.assertEqual(len(self.commands),1);expect(self.page.locator('#phone')).to_have_value('11988887777')
    def test_reconnection_profile_revision_requires_explicit_discard(self):
        self.profile();self.page.locator('#phone').fill('11988887777');self.network(False)
        status=self.page.evaluate("""async()=>{const s=(await(await fetch('/api/v1/session')).json()).data,d=(await(await fetch('/api/v1/profile/get')).json()).data;return(await fetch('/api/v1/profile/save',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},body:JSON.stringify({commandId:crypto.randomUUID(),expectedRevision:d.revision,phone:'11888888888',displayName:'Versão atual'})})).status;}""")
        self.assertEqual(status,200);self.network(True);self.ready();expect(self.page.locator('#save')).to_be_disabled();expect(self.page.locator('#phone')).to_have_value('11988887777')
        self.page.locator('#profile-discard').click();expect(self.page.locator('#phone')).to_have_value('11888888888');self.page.locator('#phone').fill('11777777777');self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_have_text('Alterações salvas.');self.assertEqual(self.commands[-1]['expectedRevision'],1)
    def test_reconnection_profile_pagehide_keeps_pending(self):
        self.uncertain();original=self.commands[0];self.page.evaluate("window.dispatchEvent(new Event('pagehide'))");expect(self.page.locator('#profile-fields')).to_be_hidden();expect(self.page.locator('#profile-pending')).to_be_visible()
        self.page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");self.ready();self.page.locator('#profile-resume').click();expect(self.page.locator('#profile-pending')).to_be_hidden();self.assertEqual(self.commands,[original,original])
    def test_reconnection_profile_late_avatar_does_not_restore_preview(self):
        self.profile();self.page.evaluate("()=>{const original=createImageBitmap;window.createImageBitmap=(...args)=>new Promise(resolve=>{window.finishImage=()=>resolve(original(...args));});}")
        photo=io.BytesIO();Image.new('RGB',(300,300),'red').save(photo,format='JPEG');self.page.locator('#photo').set_input_files({'name':'photo.jpg','mimeType':'image/jpeg','buffer':photo.getvalue()})
        self.network(False);self.page.evaluate('window.finishImage()');expect(self.page.locator('#avatar-preview')).not_to_have_attribute('src');self.network(True);self.ready();self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_have_text('Alterações salvas.');self.assertNotIn('photo',self.commands[0])
    def test_reconnection_profile_freshness_expires_without_saving(self):
        self.page.clock.install();self.profile();self.page.locator('#phone').fill('11988887777');self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})");self.page.clock.fast_forward(91000)
        expect(self.page.locator('#save')).to_be_disabled();expect(self.page.locator('#phone')).to_have_value('11988887777');self.assertEqual(self.commands,[])
    def test_reconnection_profile_mobile_masks_draft(self):
        self.profile();self.page.locator('#phone').fill('11988887777');self.network(False);expect(self.page.locator('#profile-fields')).to_be_hidden();self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.errors,[])
        target=ROOT/'work/qa-account-reconnection';target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'perfil-protegido.png'),full_page=True)
class EmailReconnect(Context,email.EmailChange):
    def ready(self):expect(self.page.locator('#profile-connection')).to_have_attribute('data-state','ready')
    def uncertain(self,op='start'):
        self.email_profile();self.lose_email=op;self.start_email() if op!='start' else None
        if op=='start':
            self.page.locator('#new-email').fill('novo@example.invalid');self.page.locator('#email-send').click()
        else:self.confirm_email()
        expect(self.page.locator('#email-resume')).to_be_enabled();expect(self.page.locator('#email-pending')).to_be_visible()
    def test_reconnection_email_start_replay_does_not_send_twice(self):
        self.uncertain();original=self.email_commands[0];count=self.local('/test/email-delivery')['count'];self.network(False);self.network(True);self.ready();self.assertEqual(len(self.email_commands),1)
        self.page.locator('#email-resume').click();expect(self.page.locator('#email-confirm-form')).to_be_visible();self.assertEqual(self.email_commands,[original,original]);self.assertEqual(self.local('/test/email-delivery')['count'],count)
    def test_reconnection_email_confirm_unknown_keeps_same_code_in_memory(self):
        self.uncertain('confirm');original=self.email_commands[-1];self.network(False);self.network(True);self.ready();expect(self.page.locator('#email-change-code')).to_have_value('')
        self.page.locator('#email-resume').click();expect(self.page.locator('#email-pending')).to_be_hidden();expect(self.page.locator('#email')).to_have_text('novo@example.invalid');self.assertEqual(self.email_commands[-1],original);self.assertEqual(self.email_commands[-2],original)
    def test_reconnection_email_expired_session_pending_remains_generic(self):
        self.uncertain();original=self.email_commands[0];self.deny=True;self.network(False);self.network(True);expect(self.page.locator('#profile')).to_be_hidden();expect(self.page.locator('#new-email')).to_have_value('')
        expect(self.page.locator('#email-pending')).to_be_visible();self.deny=False;self.page.locator('#profile-check').click();self.ready();self.page.locator('#email-resume').click();expect(self.page.locator('#email-pending')).to_be_hidden();self.assertEqual(self.email_commands,[original,original])
    def test_reconnection_email_other_account_cannot_retry(self):
        self.uncertain();self.other=True;self.network(False);self.network(True);expect(self.page.locator('#profile')).to_be_hidden();self.page.locator('#email-resume').click();expect(self.page.locator('#email-resume')).to_be_enabled();self.assertEqual(len(self.email_commands),1)
    def test_reconnection_email_pagehide_preserves_request_not_fields(self):
        self.uncertain();original=self.email_commands[0];self.page.evaluate("window.dispatchEvent(new Event('pagehide'))");expect(self.page.locator('#new-email')).to_have_value('');expect(self.page.locator('#email-change-code')).to_have_value('');expect(self.page.locator('#email-pending')).to_be_visible()
        self.page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");self.ready();self.page.locator('#email-resume').click();expect(self.page.locator('#email-confirm-form')).to_be_visible();self.assertEqual(self.email_commands,[original,original])
    def test_reconnection_email_offline_blocks_new_send(self):
        self.email_profile();self.page.locator('#new-email').fill('novo@example.invalid');self.network(False);expect(self.page.locator('#new-email')).to_have_value('');self.page.locator('#email-start-form').dispatch_event('submit');self.assertEqual(self.email_commands,[])
class KeysReconnect(Context,emergency.Emergency):
    def ready(self):expect(self.page.locator('#keys-connection')).to_have_attribute('data-state','ready')
    def uncertain(self,op='start'):
        self.keys()
        if op!='start':self.start_add()
        self.lose_key=op
        if op=='start':self.page.locator('#add').click()
        elif op=='prove':self.page.locator('#prove').click()
        expect(self.page.locator('#retry')).to_be_enabled();expect(self.page.locator('#keys-pending')).to_be_visible()
    def test_reconnection_keys_unknown_start_replay_exact_once(self):
        self.uncertain();original=self.key_commands[0];self.network(False);self.network(True);self.assertEqual(len(self.key_commands),1)
        self.page.locator('#retry').click();expect(self.page.locator('#prove')).to_be_visible();self.assertEqual(self.key_commands,[original,original]);self.assertEqual(self.local('/test/keys-state')['active'],1)
    def test_reconnection_keys_unknown_proof_survives_pagehide(self):
        self.uncertain('prove');original=self.key_commands[-1];self.page.evaluate("window.dispatchEvent(new Event('pagehide'))");expect(self.page.locator('#keys')).to_be_empty();expect(self.page.locator('#keys-pending')).to_be_visible()
        self.page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");self.page.locator('#retry').click();expect(self.page.locator('#register')).to_be_visible();self.assertEqual(self.key_commands[-1],original)
    def test_reconnection_keys_expired_session_keeps_request_outside_workspace(self):
        self.uncertain();original=self.key_commands[0];self.deny=True;self.page.locator('#retry').click();expect(self.page.locator('#access-help')).to_be_visible();expect(self.page.locator('#keys-pending')).to_be_visible()
        self.assertEqual(len(self.key_commands),1);self.deny=False;self.page.locator('#retry').click();expect(self.page.locator('#prove')).to_be_visible();self.assertEqual(self.key_commands,[original,original])
    def test_reconnection_keys_other_account_no_replay(self):
        self.uncertain();self.other=True;self.page.locator('#retry').click();expect(self.page.locator('#access-help')).to_be_visible();self.assertEqual(len(self.key_commands),1)
    def test_reconnection_keys_late_credential_never_posts_proof(self):
        self.keys();self.start_add();self.page.evaluate("()=>{const original=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=options=>original(options).then(c=>new Promise(resolve=>{window.releaseCredential=()=>resolve(c);}));}")
        self.page.locator('#prove').click()
        for _ in range(300):
            if self.page.evaluate('typeof window.releaseCredential===\'function\''):break
            self.page.wait_for_timeout(10)
        self.assertTrue(self.page.evaluate('typeof window.releaseCredential===\'function\''));self.network(False);self.page.evaluate('window.releaseCredential()')
        expect(self.page.locator('#status')).to_contain_text('A conexão ou a conta mudou');self.assertEqual(len(self.key_commands),1);expect(self.page.locator('#workspace')).to_be_hidden()
    def test_reconnection_keys_codes_removed_and_not_redisclosed_online(self):
        self.prepare_codes();issued=self.local('/test/emergency-state')['issued'];self.network(False);expect(self.page.locator('#code-list li')).to_have_count(0)
        expect(self.page.locator('#workspace')).to_be_hidden();self.network(True);self.ready();expect(self.page.locator('#code-list li')).to_have_count(0);self.assertEqual(self.local('/test/emergency-state')['issued'],issued)
    def test_reconnection_keys_known_complete_list_failure_no_duplicate_key(self):
        self.keys();self.start_add();self.prove();self.second_authenticator();self.fail_path='/api/v1/keys/list';self.page.locator('#register').click()
        expect(self.page.locator('#status')).to_contain_text('Pedido confirmado. Não foi possível atualizar');expect(self.page.locator('#keys-pending')).to_be_hidden();self.assertEqual(self.local('/test/keys-state')['added'],1)
        self.fail_path=None;self.page.locator('#keys-check').click();self.ready();expect(self.page.locator('#count')).to_have_text('2 de 5 ativas');self.assertEqual(self.local('/test/keys-state')['added'],1)
    def test_reconnection_keys_freshness_expires_no_new_start(self):
        self.page.clock.install();self.keys();self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})");self.page.clock.fast_forward(91000)
        expect(self.page.locator('#add')).to_be_disabled();self.page.locator('#add').dispatch_event('click');self.assertEqual(self.key_commands,[])
    def test_reconnection_keys_mobile_codes_hidden_offline(self):
        self.prepare_codes();self.network(False);expect(self.page.locator('#code-list li')).to_have_count(0);self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.errors,[])
        target=ROOT/'work/qa-account-reconnection';target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'chaves-protegidas.png'),full_page=True)
if __name__=='__main__':
    suite=unittest.TestSuite(cls(n) for cls in [ProfileReconnect,EmailReconnect,KeysReconnect] for n in unittest.defaultTestLoader.getTestCaseNames(cls) if n.startswith('test_reconnection_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
