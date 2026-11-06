"""Operations UI and recoverable stock bookkeeping, disposable Google only."""
import importlib.util
import json
import os
from pathlib import Path
import tomllib
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('checkout_qa',Path(__file__).with_name('test-checkout.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
class Operations(qa.Checkout):
    def setUp(self):
        super().setUp();self.lose_reverse=False;self.reverse_commands=[]
    def relay(self,route):
        path=urlsplit(route.request.url).path
        if path in ['/operacoes-dev.html','/operacoes-dev.js','/operacoes-dev.css','/equipe-dev.css']:
            headers={}
            for rule in tomllib.loads((qa.qa.ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],headers=headers,body=(qa.qa.ROOT/'dist'/path[1:]).read_bytes());return
        if path.startswith('/api/v1/operations/'):
            req=route.request;headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};out=self.local(path+('?' + urlsplit(req.url).query if urlsplit(req.url).query else ''),body=req.post_data_buffer,headers=headers,method=req.method)
            if path.endswith('/reverse'):
                self.reverse_commands.append(json.loads(req.post_data))
                if self.lose_reverse:self.lose_reverse=False;route.abort();return
            route.fulfill(status=out['status'],headers=out['headers'],body=out['body']);return
        super().relay(route)
    def operations(self,sell=True):
        self.checkout();self.local('/test/enable-operations',{})
        if sell:self.add();self.confirm()
        self.page.goto(qa.qa.ORIGIN+'/operacoes-dev.html');expect(self.page.locator('#status')).to_have_text('Histórico atualizado.')
    def open_receipt(self):
        self.page.get_by_role('button',name='Ver comprovante',exact=True).click();expect(self.page.locator('#receipt-editor')).to_be_visible()
    def reverse(self):
        self.page.locator('#reverse-reason').fill('Livros e acerto do pagamento conferidos');self.page.locator('#reverse-confirm').check();self.page.locator('#reverse-save').click()
    def test_operations_mobile_receipt_integral_reversal_restores_stock_and_preserves_history(self):
        self.operations();self.open_receipt();expect(self.page.locator('#receipt-items')).to_contain_text('Livro de teste do Caixa');expect(self.page.locator('#receipt-total')).to_contain_text('32,90');self.reverse();expect(self.page.locator('#receipt-title')).to_have_text('Venda cancelada');expect(self.page.locator('#reverse-form')).to_be_hidden();self.assertEqual(self.local('/test/checkout-state')['stock'],2);self.assertEqual(self.local('/test/checkout-state')['sales'],1);self.page.locator('#receipt-close').click();expect(self.page.locator('.sale')).to_contain_text('CANCELADA');self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.errors,[])
        target=Path(os.environ.get('QA_ARTIFACTS','work/qa-operations'));target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'operacoes-celular.png'),full_page=True)
    def test_operations_lost_reverse_ack_reuses_exact_command_and_blocks_form_changes(self):
        self.operations();self.open_receipt();self.lose_reverse=True;self.reverse();expect(self.page.locator('#receipt-status')).to_contain_text('tente novamente');expect(self.page.locator('#reverse-reason')).to_be_disabled();expect(self.page.locator('#receipt-close')).to_be_disabled();self.page.locator('#reverse-save').click();expect(self.page.locator('#receipt-title')).to_have_text('Venda cancelada');self.assertEqual(self.reverse_commands[0],self.reverse_commands[1]);self.assertEqual(self.local('/test/checkout-state')['stock'],2)
    def test_operations_negative_stock_correction_is_absolute_and_requires_reason(self):
        self.operations(False);self.page.locator('#product-query').fill('Livro de teste');self.page.get_by_role('button',name='Buscar livro',exact=True).click();self.page.get_by_role('button',name='Conferir e ajustar',exact=True).click();expect(self.page.locator('#adjust-editor')).to_be_visible();self.page.locator('#adjust-stock').fill('0');self.page.locator('#adjust-save').click();expect(self.page.locator('#adjust-editor')).to_be_visible();self.page.locator('#adjust-reason').fill('Conferência física');self.page.locator('#adjust-save').click();expect(self.page.locator('#adjust-editor')).not_to_be_visible();expect(self.page.locator('#status')).to_contain_text('2 → 0');self.assertEqual(self.local('/test/checkout-state')['stock'],0)
    def test_operations_attendant_sees_receipt_without_administrative_controls(self):
        self.operations();self.local('/test/set-role',{'role':'ATENDENTE'});self.page.reload();expect(self.page.locator('#scope')).to_contain_text('Somente as vendas');expect(self.page.locator('#adjust-panel')).to_be_hidden();self.open_receipt();expect(self.page.locator('#reverse-form')).to_be_hidden()
    def test_operations_print_view_preserves_values_and_keyboard_closes_modal(self):
        self.operations();self.open_receipt();self.page.evaluate('window.print=()=>{window.didPrint=true}');self.page.locator('#print').click();self.assertTrue(self.page.evaluate('window.didPrint===true'));self.page.emulate_media(media='print');expect(self.page.locator('main')).to_be_hidden();expect(self.page.locator('#receipt-print')).to_be_visible();expect(self.page.locator('#receipt-total')).to_contain_text('32,90');self.page.emulate_media(media='screen');self.page.keyboard.press('Escape');expect(self.page.locator('#receipt-editor')).to_be_hidden();self.assertEqual(self.errors,[])
    def test_operations_default_flag_closes_module(self):
        self.activate();self.page.goto(qa.qa.ORIGIN+'/operacoes-dev.html');expect(self.page.locator('#status')).to_contain_text('ainda não está disponível');expect(self.page.locator('.sale')).to_have_count(0)
if __name__=='__main__':
    suite=unittest.TestSuite(Operations(name) for name in unittest.defaultTestLoader.getTestCaseNames(Operations) if name.startswith('test_operations_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
