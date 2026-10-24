"""Verified self email change; real browser WebAuthn, disposable Google/MailApp."""
import importlib.util
import json
import os
from pathlib import Path
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('profile_qa',Path(__file__).with_name('test-profile.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
class EmailChange(qa.Profile):
    def setUp(self):
        super().setUp();self.lose_email=None;self.email_commands=[]
    def relay(self,route):
        path=urlsplit(route.request.url).path
        if path.startswith('/api/v1/email-change/'):
            req=route.request;headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};out=self.local(path,body=req.post_data_buffer,headers=headers,method=req.method)
            if req.method=='POST':self.email_commands.append((path,json.loads(req.post_data)))
            if self.lose_email==path.rsplit('/',1)[-1]:self.lose_email=None;route.abort();return
            route.fulfill(status=out['status'],headers=out['headers'],body=out['body']);return
        super().relay(route)
    def email_profile(self):
        self.profile();self.local('/test/enable-email-change',{});self.page.reload();expect(self.page.locator('#email-change')).to_be_visible();expect(self.page.locator('#email-status')).to_contain_text('Solicite um código')
    def start_email(self):
        self.page.locator('#new-email').fill('novo@example.invalid');self.page.locator('#email-send').click();expect(self.page.locator('#email-confirm-form')).to_be_visible()
    def confirm_email(self):
        self.page.locator('#email-change-code').fill(self.local('/test/code')['code']);self.page.locator('#email-confirm').click()
    def test_email_mobile_verified_change_then_login_with_new_email_and_same_passkey(self):
        self.email_profile();self.start_email();expect(self.page.locator('#email')).to_have_text('owner@example.invalid');self.confirm_email();expect(self.page.locator('#email-status')).to_contain_text('Novo e-mail confirmado');expect(self.page.locator('#email')).to_have_text('novo@example.invalid');delivery=self.local('/test/email-delivery');self.assertEqual(delivery['lastTo'],'novo@example.invalid');self.assertEqual(delivery['googleOwner'],'owner@example.invalid')
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));target=Path(os.environ.get('QA_ARTIFACTS','work/qa-email-change'));target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'email-confirmado-celular.png'),full_page=True)
        self.page.goto(qa.qa.ORIGIN+'/acesso-dev.html');expect(self.page.locator('#complete')).to_be_visible();self.logout();self.begin_login();expect(self.page.locator('#status')).to_contain_text('Não foi possível confirmar os dados');self.page.locator('#login-email').fill('novo@example.invalid');self.page.locator('#login-pin').fill('8274');self.page.get_by_role('button',name='Continuar com a passkey',exact=True).first.click();expect(self.page.locator('#passkey')).to_be_visible();self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible();self.assert_no_secrets_in_browser_storage();self.assertEqual(self.errors,[])
        # Recovery email is delivered to the verified login address, not Google owner.
        self.page.goto(qa.qa.ORIGIN+'/acesso-dev.html#recuperar-pin');self.page.locator('#recovery-email').fill('novo@example.invalid');self.page.get_by_role('button',name='Enviar código de recuperação').click();expect(self.page.locator('#email-form')).to_be_visible();self.assertEqual(self.local('/test/email-delivery')['lastTo'],'novo@example.invalid')
    def test_email_lost_start_and_confirm_ack_reuse_exact_command_without_duplicate_mail(self):
        self.email_profile();self.lose_email='start';self.page.locator('#new-email').fill('novo@example.invalid');self.page.locator('#email-send').click();expect(self.page.locator('#email-retry')).to_be_visible();expect(self.page.locator('#new-email')).to_be_disabled();self.page.locator('#email-retry').click();expect(self.page.locator('#email-confirm-form')).to_be_visible();self.assertEqual(self.email_commands[0],self.email_commands[1]);self.assertEqual(self.local('/test/email-delivery')['count'],2)
        self.lose_email='confirm';self.confirm_email();expect(self.page.locator('#email-retry')).to_be_visible();expect(self.page.locator('#email-change-code')).to_be_disabled();self.page.locator('#email-retry').click();expect(self.page.locator('#email')).to_have_text('novo@example.invalid');self.assertEqual(self.email_commands[-2],self.email_commands[-1]);self.assertEqual(self.errors,[])
    def test_email_reload_resumes_bound_flow_without_persisting_email_or_code_and_cancel_is_explicit(self):
        self.email_profile();self.start_email();self.page.reload();expect(self.page.locator('#email-confirm-form')).to_be_visible();expect(self.page.locator('#email-change-code')).to_have_value('');expect(self.page.locator('#new-email')).to_have_value('');self.assertEqual(self.page.evaluate('Object.keys(localStorage)'),[]);self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[])
        self.page.locator('#email-change-code').fill('A'*43);self.page.locator('#email-confirm').click();expect(self.page.locator('#email-status')).to_contain_text('Código incorreto');self.page.locator('#email-cancel').click();expect(self.page.locator('#email-start-form')).to_be_visible();expect(self.page.locator('#email')).to_have_text('owner@example.invalid');self.assertEqual(self.errors,[])
    def test_email_conflicting_profile_edit_preserves_current_email_and_requires_new_code(self):
        self.email_profile();self.start_email();self.page.locator('#phone').fill('11988887777');self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_have_text('Alterações salvas.');self.confirm_email();expect(self.page.locator('#email-status')).to_contain_text('cadastro mudou');expect(self.page.locator('#email')).to_have_text('owner@example.invalid');expect(self.page.locator('#phone')).to_have_value('11988887777');self.assertEqual(self.errors,[])
    def test_email_module_is_closed_by_default(self):
        self.profile();expect(self.page.locator('#email-change')).to_be_hidden();out=self.local('/api/v1/email-change/state');self.assertEqual(out['status'],503);self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(EmailChange(name) for name in unittest.defaultTestLoader.getTestCaseNames(EmailChange) if name.startswith('test_email_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
