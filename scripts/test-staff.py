"""Equipe, browser WebAuthn and private contact contract; emulated Google only."""
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
class Staff(qa.Catalog):
    def setUp(self):
        super().setUp();self.lose_staff=False;self.commands=[]
    def relay(self,route):
        path=urlsplit(route.request.url).path
        if path in ['/equipe-dev.html','/equipe-dev.js','/equipe-dev.css']:
            headers={}
            for rule in tomllib.loads((qa.ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],headers=headers,body=(qa.ROOT/'dist'/path[1:]).read_bytes());return
        if path.startswith('/api/v1/staff/'):
            req=route.request;headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
            result=self.local(path,body=req.post_data_buffer,headers=headers,method=req.method)
            if path.endswith('/save'):
                self.commands.append(json.loads(req.post_data))
                if self.lose_staff:self.lose_staff=False;route.abort();return
            route.fulfill(status=result['status'],headers=result['headers'],body=result['body']);return
        super().relay(route)
    def team(self):
        self.activate();self.local('/test/enable-staff',{});self.page.goto(qa.ORIGIN+'/equipe-dev.html');expect(self.page.locator('.person')).to_have_count(1)
    def fill(self,name='Pessoa de teste'):
        self.page.locator('#new-user').click();self.page.locator('#staff-name').fill(name);self.page.locator('#staff-cpf').fill('52998224725');self.page.locator('#staff-email').fill('pessoa@example.invalid');self.page.locator('#staff-phone').fill('11999999999');self.page.locator('#staff-reason').fill('Cadastro fictício de homologação')
    def save_staff(self):
        self.page.locator('#save-user').click();expect(self.page.locator('#editor')).not_to_be_visible()
    def test_staff_mobile_create_edit_disable_with_masked_cpf(self):
        self.team();self.fill();self.save_staff();expect(self.page.locator('.person')).to_have_count(2)
        card=self.page.locator('.person').filter(has=self.page.get_by_role('heading',name='Pessoa de teste',exact=True));expect(card).to_contain_text('***.982.247-**');expect(card).to_contain_text('Aguardando primeiro acesso');card.get_by_role('button').click()
        self.page.locator('#staff-name').fill('Pessoa com cadastro atualizado');self.page.locator('#staff-reason').fill('Atualização de nome');self.save_staff();expect(self.page.locator('.person')).to_contain_text(['Conta proprietária','Pessoa com cadastro atualizado'])
        card=self.page.locator('.person').filter(has=self.page.get_by_role('heading',name='Pessoa com cadastro atualizado',exact=True));card.get_by_role('button').click();self.page.locator('#staff-status').select_option('INATIVO');self.page.locator('#staff-reason').fill('Encerramento do acesso de teste');self.save_staff();expect(card).to_contain_text('Desativado')
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assert_no_secrets_in_browser_storage();self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[]);self.assertEqual(self.errors,[])
        target=Path(os.environ.get('QA_ARTIFACTS','work/qa-staff'));target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'equipe-celular.png'),full_page=True)
    def test_staff_response_loss_retries_same_command_without_duplicate_or_browser_persistence(self):
        self.team();self.fill();self.lose_staff=True;self.page.locator('#save-user').click();expect(self.page.locator('#retry-save')).to_be_visible();expect(self.page.locator('#staff-name')).to_be_disabled();expect(self.page.locator('#cancel-editor')).to_be_disabled();self.page.locator('#retry-save').click();expect(self.page.locator('#editor')).not_to_be_visible();self.assertEqual(self.commands[0],self.commands[1]);expect(self.page.locator('.person')).to_have_count(2)
        self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[])
    def test_staff_invalid_cpf_and_duplicate_contact_preserve_form(self):
        self.team();self.fill();self.page.locator('#staff-cpf').fill('00000000000');self.page.locator('#save-user').click();expect(self.page.locator('#form-status')).to_contain_text('CPF inválido');expect(self.page.locator('#staff-cpf')).to_have_attribute('aria-invalid','true');self.page.locator('#cancel-editor').click();self.fill();expect(self.page.locator('#staff-cpf')).not_to_have_attribute('aria-invalid','true');self.save_staff();self.fill('Duplicado de teste');self.page.locator('#save-user').click();expect(self.page.locator('#form-status')).to_contain_text('CPF já cadastrado');expect(self.page.locator('#staff-name')).to_be_enabled()
    def test_staff_no_session_and_attendant_cannot_access_or_request_sensitive_list(self):
        self.page.goto(qa.ORIGIN+'/equipe-dev.html');expect(self.page.locator('#status')).to_contain_text('ainda não está disponível');expect(self.page.locator('#new-user')).not_to_be_visible();self.team();self.local('/test/set-role',{'role':'ATENDENTE'});self.page.reload();expect(self.page.locator('#status')).to_contain_text('Não foi possível autorizar esta ação');expect(self.page.locator('#team')).not_to_be_visible()
    def test_staff_first_access_and_login_by_cpf_use_real_passkey_signatures(self):
        self.team();self.fill();self.save_staff();self.page.goto(qa.ORIGIN+'/acesso-dev.html?verificar=1');expect(self.page.locator('#complete')).to_be_visible();self.logout()
        self.page.get_by_text('É meu primeiro acesso',exact=True).click();self.page.locator('#activation-email').fill('529.982.247-25');self.page.get_by_role('button',name='Receber código por e-mail').click();expect(self.page.locator('#email-form')).to_be_visible()
        self.page.locator('#email-code').fill(self.local('/test/code')['code']);self.page.get_by_role('button',name='Confirmar código').click();expect(self.page.locator('#pin-form')).to_be_visible()
        self.page.locator('#new-pin').fill('9382');self.page.locator('#confirm-pin').fill('9382');self.page.get_by_role('button',name='Salvar PIN e continuar').click();expect(self.page.locator('#passkey')).to_be_visible();self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible();expect(self.page.locator('#identity-result')).to_contain_text('Sua conta está pronta para uso.')
        expect(self.page.locator('#team-link')).not_to_be_visible();self.logout();self.page.locator('#login-email').fill('52998224725');self.page.locator('#login-pin').fill('9382');self.page.get_by_role('button',name='Entrar na minha conta',exact=True).first.click();expect(self.page.locator('#passkey')).to_be_visible();self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible();expect(self.page.locator('#identity-result')).to_contain_text('Sua conta está pronta para uso.');self.assert_no_secrets_in_browser_storage();self.assertEqual(self.errors,[])
    def test_staff_desktop_keyboard_modal_and_xss_safe_name(self):
        self.page.set_viewport_size({'width':1440,'height':1000});self.team();self.fill('<img src=x onerror=alert(1)>');self.save_staff();expect(self.page.locator('.person h3').filter(has_text='<img')).to_have_count(1);expect(self.page.locator('.person img')).to_have_count(0)
        self.page.get_by_role('button',name='Editar acesso e dados').click();expect(self.page.locator('#staff-name')).to_be_focused();self.page.keyboard.press('Escape');expect(self.page.locator('#editor')).not_to_be_visible();self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(Staff(name) for name in unittest.defaultTestLoader.getTestCaseNames(Staff) if name.startswith('test_staff_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
