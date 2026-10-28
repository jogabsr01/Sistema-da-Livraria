"""Profile/avatar and PIN recovery with real virtual-authenticator signatures."""
import importlib.util
import json
import os
from pathlib import Path
import tomllib
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('catalog_qa',Path(__file__).with_name('test-catalog.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
class Profile(qa.Catalog):
    def setUp(self):
        super().setUp();self.lose_profile=False;self.commands=[]
    def relay(self,route):
        path=urlsplit(route.request.url).path
        if path in ['/meu-perfil-dev.html','/meu-perfil-dev.js','/meu-perfil-dev.css','/account-menu.js','/email-change-dev.js','/account-menu.css','/equipe-dev.css']:
            headers={}
            for rule in tomllib.loads((qa.ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],headers=headers,body=(qa.ROOT/'dist'/path[1:]).read_bytes());return
        if path.startswith('/api/v1/profile/'):
            req=route.request;headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};out=self.local(path+('?' + urlsplit(req.url).query if urlsplit(req.url).query else ''),body=req.post_data_buffer,headers=headers,method=req.method)
            if path.endswith('/save'):
                self.commands.append(json.loads(req.post_data))
                if self.lose_profile:self.lose_profile=False;route.abort();return
            if 'bodyBase64' in out:import base64;route.fulfill(status=out['status'],headers=out['headers'],body=base64.b64decode(out['bodyBase64']));return
            route.fulfill(status=out['status'],headers=out['headers'],body=out['body']);return
        super().relay(route)
    def profile(self):
        self.activate();self.local('/test/enable-profile',{});self.page.goto(qa.ORIGIN+'/meu-perfil-dev.html');expect(self.page.locator('#profile')).to_be_visible()
    def test_profile_menu_uses_existing_profile_and_generic_navigation_has_no_background_requests(self):
        self.activate();self.local('/test/enable-profile',{})
        calls=[]
        self.page.on('request',lambda req:calls.append(req.url) if '/api/v1/profile/get' in req.url else None)
        self.page.goto(qa.ORIGIN+'/meu-perfil-dev.html')
        expect(self.page.locator('#profile')).to_be_visible()
        expect(self.page.locator('.account-menu summary')).to_have_attribute('aria-label','Abrir menu de Conta proprietária')
        self.assertEqual(len(calls),1,'header must reuse the profile already fetched by the page')
        self.catalog()
        self.page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(self.page.locator('.account-menu summary')).to_have_attribute('aria-label','Abrir menu da conta')
        self.assertEqual(len(calls),1,'focus must not launch another personal-data lookup')
        self.page.get_by_label('Abrir menu da conta',exact=True).click()
        expect(self.page.locator('.account-menu summary')).to_have_attribute('aria-label','Abrir menu de Conta proprietária')
        self.assertEqual(len(calls),2,'opening the menu performs one authorized profile request')

    def test_profile_master_cpf_error_stays_in_form_and_success_links_once_with_masked_display(self):
        self.profile()
        self.page.locator('#owner-cpf-input').fill('123')
        self.page.locator('#save').click()
        expect(self.page.locator('#form-status')).to_contain_text('CPF inválido')
        expect(self.page.locator('#owner-cpf-input')).to_have_attribute('aria-invalid','true')
        expect(self.page.locator('#owner-cpf-input')).to_be_focused()
        expect(self.page.locator('#owner-cpf')).to_be_visible()
        self.page.locator('#owner-cpf-input').fill('52998224725')
        expect(self.page.locator('#owner-cpf-input')).not_to_have_attribute('aria-invalid','true')
        self.page.locator('#save').click()
        expect(self.page.locator('#form-status')).to_have_text('Alterações salvas.')
        expect(self.page.locator('#cpf')).to_have_text('***.982.247-**')
        expect(self.page.locator('#owner-cpf')).to_be_hidden()
        self.assertNotIn('52998224725',self.page.locator('body').inner_text())
        self.assertEqual(self.page.evaluate('Object.keys(localStorage)'),[])
        self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[])

    def test_profile_mobile_save_and_avatar_updates_header_without_browser_persistence(self):
        self.profile();self.page.locator('#display-name').fill('Responsável de teste');self.page.locator('#phone').fill('11988887777')
        from PIL import Image
        import io
        image=io.BytesIO();Image.new('RGB',(300,300),'#205b43').save(image,format='JPEG');self.page.locator('#photo').set_input_files({'name':'avatar.jpg','mimeType':'image/jpeg','buffer':image.getvalue()});expect(self.page.locator('#form-status')).to_contain_text('Foto preparada');self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_have_text('Alterações salvas.');expect(self.page.locator('#identity-heading')).to_have_text('Responsável de teste');expect(self.page.locator('#avatar-preview')).to_be_visible();expect(self.page.locator('.account-menu img')).to_have_count(1)
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[]);self.assertEqual(self.page.evaluate('Object.keys(localStorage)'),[]);self.assertEqual(self.errors,[])
        target=Path(os.environ.get('QA_ARTIFACTS','work/qa-profile'));target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'perfil-celular.png'),full_page=True)
    def test_profile_lost_ack_retries_exact_command_and_removal_is_explicit(self):
        self.profile();self.page.locator('#phone').fill('11988887777');self.lose_profile=True;self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_contain_text('tente novamente');expect(self.page.locator('#phone')).to_be_disabled();self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_have_text('Alterações salvas.');self.assertEqual(self.commands[0],self.commands[1]);self.page.locator('#photo-remove').click();self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_have_text('Alterações salvas.');expect(self.page.locator('#avatar-preview')).to_be_hidden()
    def test_profile_pin_recovery_requires_real_existing_passkey_and_revokes_old_cookie(self):
        self.profile();old=next(c['value'] for c in self.context.cookies() if c['name']=='__Host-livraria_session');self.page.goto(qa.ORIGIN+'/acesso-dev.html#recuperar-pin');expect(self.page.locator('#recovery-form')).to_be_visible();self.page.locator('#recovery-email').fill('owner@example.invalid');self.page.get_by_role('button',name='Enviar código de recuperação').click();expect(self.page.locator('#email-form')).to_be_visible();self.page.locator('#email-code').fill(self.local('/test/code')['code']);self.page.get_by_role('button',name='Confirmar código').click();expect(self.page.locator('#pin-form')).to_be_visible();self.page.locator('#new-pin').fill('9382');self.page.locator('#confirm-pin').fill('9382');self.page.get_by_role('button',name='Salvar PIN e continuar').click();expect(self.page.locator('#passkey')).to_be_visible();self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible();new=next(c['value'] for c in self.context.cookies() if c['name']=='__Host-livraria_session');self.assertNotEqual(old,new)
        out=self.local('/api/v1/session',headers={'cookie':'__Host-livraria_session='+old});self.assertEqual(out['status'],401);self.logout();self.begin_login('8274');expect(self.page.locator('#status')).to_contain_text('Não foi possível entrar com os dados informados');self.begin_login('9382');expect(self.page.locator('#passkey')).to_be_visible();self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible();self.assertEqual(self.errors,[])
    def test_profile_other_sessions_button_keeps_current_session(self):
        self.profile();self.page.locator('#revoke-others').click();expect(self.page.locator('#status')).to_contain_text('outras sessões foram encerradas');self.page.reload();expect(self.page.locator('#profile')).to_be_visible()
    def test_profile_default_disabled_and_unknown_account_recovery_stays_generic(self):
        self.page.goto(qa.ORIGIN+'/meu-perfil-dev.html');expect(self.page.locator('#profile')).to_be_hidden();self.profile();self.page.goto(qa.ORIGIN+'/acesso-dev.html#recuperar-pin');self.page.locator('#recovery-email').fill('unknown@example.invalid');self.page.get_by_role('button',name='Enviar código de recuperação').click();expect(self.page.locator('#status')).to_contain_text('Se houver uma conta elegível');expect(self.page.locator('#email-form')).to_be_visible()
if __name__=='__main__':
    suite=unittest.TestSuite(Profile(name) for name in unittest.defaultTestLoader.getTestCaseNames(Profile) if name.startswith('test_profile_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
