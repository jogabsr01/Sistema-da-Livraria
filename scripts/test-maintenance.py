"""Privileged maintenance fixture + browser enrollment and admin alerts; no real Google."""
import importlib.util,json,unittest,tomllib
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('emergency_qa',Path(__file__).with_name('test-emergency-recovery.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.ROOT,qa.ORIGIN
class Maintenance(qa.Emergency):
    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        if path in ['/notificacoes-dev.html','/notificacoes-dev.js','/notificacoes-dev.css','/notification-badge.js']:
            headers={}
            for rule in tomllib.loads((ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],headers=headers,body=(ROOT/'dist'/path[1:]).read_bytes());return
        if path.startswith('/api/v1/notifications/'):
            headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};out=self.local(path+('?' + urlsplit(req.url).query if urlsplit(req.url).query else ''),body=req.post_data_buffer,headers=headers,method=req.method)
            route.fulfill(status=out['status'],headers=out['headers'],body=out['body']);return
        super().relay(route)
    def test_maintenance_mobile_owner_reenrolls_with_new_email_new_pin_and_new_real_passkey(self):
        self.keys();old=next(c['value'] for c in self.context.cookies() if c['name']=='__Host-livraria_session');result=self.local('/test/maintenance-owner-recovery',{})
        self.assertTrue(result['reenrollmentRequired']);self.assertEqual(self.local('/api/v1/session',headers={'cookie':'__Host-livraria_session='+old})['status'],401)
        self.second_authenticator();self.open();self.page.get_by_text('É meu primeiro acesso',exact=True).click();self.page.locator('#activation-email').fill('new-owner@example.invalid');self.page.get_by_role('button',name='Receber código por e-mail').click()
        expect(self.page.locator('#email-form')).to_be_visible();self.page.locator('#email-code').fill(self.local('/test/code')['code']);self.page.get_by_role('button',name='Confirmar código').click()
        expect(self.page.locator('#pin-form')).to_be_visible();self.page.locator('#new-pin').fill('9382');self.page.locator('#confirm-pin').fill('9382');self.page.get_by_role('button',name='Salvar PIN e continuar').click()
        expect(self.page.locator('#passkey')).to_be_visible();self.page.locator('#passkey-button').click();expect(self.page.locator('#complete')).to_be_visible();self.assert_no_secrets_in_browser_storage();self.assertEqual(self.errors,[])
        self.page.goto(ORIGIN+'/meu-perfil-dev.html');expect(self.page.locator('#email')).to_have_text('new-owner@example.invalid');self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        target=ROOT/'work/qa-maintenance';target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'perfil-recuperado.png'),full_page=True)
    def test_maintenance_admin_alerts_have_audit_link_and_no_stock_mutations(self):
        self.profile();result=self.local('/test/maintenance-backup',{});self.assertTrue(result['isolated']);self.assertTrue(result['recovered']);self.page.goto(ORIGIN+'/notificacoes-dev.html')
        expect(self.page.locator('.alert')).to_have_count(2);card=self.page.locator('.alert').filter(has_text='Cópia de segurança criada');expect(card.get_by_role('link',name='Conferir auditoria')).to_have_attribute('href','/auditoria-dev.html')
        expect(card.get_by_role('link',name='Adicionar unidades')).to_have_count(0);expect(card.get_by_role('button',name='Marcar em atendimento')).to_have_count(0);card.get_by_role('button',name='Marcar como lida').click()
        expect(self.page.locator('.alert')).to_have_count(1);self.page.locator('#history').check();expect(self.page.locator('.alert')).to_have_count(2);self.assertEqual(self.errors,[])
    def test_maintenance_journal_reconciliation_preserves_unknown_command_for_explicit_retry(self):
        self.activate();self.catalog();self.create(cover='');self.local('/test/fault',{'stage':'product','after':False});self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_contain_text('O serviço está indisponível no momento')
        result=self.local('/test/maintenance-reconcile',{});self.assertTrue(result['reconciled']);self.save();expect(self.page.locator('.book')).to_have_count(1);self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(Maintenance(n) for n in unittest.defaultTestLoader.getTestCaseNames(Maintenance) if n.startswith('test_maintenance_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
