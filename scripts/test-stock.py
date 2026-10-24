"""Same-book replenishment and admin-only logical exclusion, local Google double."""
import importlib.util
import json
from pathlib import Path
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect

spec=importlib.util.spec_from_file_location('checkout_qa',Path(__file__).with_name('test-checkout.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)


class Stock(qa.Checkout):
    def setUp(self):
        super().setUp();self.lose_receipt=False;self.receipt_requests=[]

    def relay(self,route):
        if urlsplit(route.request.url).path=='/api/v1/catalog/receive':
            request=route.request;self.receipt_requests.append(json.loads(request.post_data))
            headers={k:v for k,v in request.all_headers().items() if k not in ['host','content-length']}
            result=self.local('/api/v1/catalog/receive',body=request.post_data_buffer,headers=headers,method=request.method)
            if self.lose_receipt:self.lose_receipt=False;route.abort();return
            route.fulfill(status=result['status'],headers=result['headers'],body=result['body']);return
        super().relay(route)

    def prepare(self):
        self.activate();self.catalog();self.create(title='Livro que será reposto');self.save()

    def receive(self,quantity=2):
        self.page.get_by_role('button',name='Adicionar unidades',exact=True).click()
        expect(self.page.locator('#stock-editor')).to_be_visible();self.page.locator('#stock-quantity').fill(str(quantity))
        self.page.locator('#stock-save').click();expect(self.page.locator('#stock-editor')).not_to_be_visible()

    def test_stock_mobile_sell_out_edit_replenish_and_sell_same_book(self):
        self.prepare();expect(self.page.locator('.book')).to_contain_text('Sem estoque');self.receive(2)
        self.page.goto(qa.qa.ORIGIN+'/caixa-dev.html');expect(self.page.locator('.book')).to_have_count(1)
        self.page.get_by_role('button',name='Adicionar',exact=True).click();quantity=self.page.locator('.cart-line input');quantity.fill('2');quantity.press('Tab');self.confirm()
        self.catalog();expect(self.page.locator('.book')).to_contain_text('Sem estoque')
        self.page.get_by_role('button',name='Detalhes e edição',exact=True).click();expect(self.page.locator('#stock-info')).to_contain_text('continua editável')
        self.page.locator('#title').fill('Mesmo livro editado e reposto');self.page.locator('#price').fill('45,00');self.save();self.receive(3)
        self.page.goto(qa.qa.ORIGIN+'/caixa-dev.html');expect(self.page.locator('.book h2')).to_have_text('Mesmo livro editado e reposto')
        self.page.get_by_role('button',name='Adicionar',exact=True).click();self.confirm()
        self.assertEqual(self.local('/test/checkout-state'),{'sales':2,'stock':2,'journals':4});self.assertEqual(self.local('/test/state')['products'],1)
        self.catalog();self.page.get_by_role('button',name='Detalhes e edição',exact=True).click();expect(self.page.locator('#title')).to_have_value('Mesmo livro editado e reposto')
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.errors,[])

    def test_stock_lost_receipt_recovers_after_reload_with_original_command(self):
        self.prepare();self.lose_receipt=True
        self.page.get_by_role('button',name='Adicionar unidades',exact=True).click();self.page.locator('#stock-quantity').fill('4');self.page.locator('#stock-save').click()
        expect(self.page.locator('#stock-status')).to_contain_text('Não foi possível confirmar o resultado');first=self.receipt_requests[0]
        self.page.reload();expect(self.page.locator('#resume-stock')).to_be_visible();self.page.locator('#resume-stock').click()
        expect(self.page.locator('#stock-quantity')).to_be_disabled();expect(self.page.locator('#stock-quantity')).to_have_value('4')
        self.page.locator('#stock-save').click();expect(self.page.locator('#stock-editor')).not_to_be_visible()
        self.assertEqual(self.receipt_requests,[first,first]);self.assertEqual(self.local('/test/checkout-state'),{'sales':0,'stock':4,'journals':1})
        self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[])

    def test_stock_attendant_edits_receives_but_cannot_exclude_or_forge_activity(self):
        self.prepare();self.local('/test/set-role',{'role':'ATENDENTE'});self.page.reload();expect(self.page.locator('#catalog')).to_be_visible()
        expect(self.page.get_by_role('button',name='Excluir livro',exact=True)).to_have_count(0);self.receive(2)
        self.page.get_by_role('button',name='Detalhes e edição',exact=True).click();expect(self.page.locator('#active')).to_be_disabled()
        self.page.locator('#active').evaluate('(input)=>input.checked=false');self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_contain_text('Somente administradores')
        self.page.locator('#active').evaluate('(input)=>input.checked=true');self.page.locator('#title').fill('Atendente mantém cadastro');self.save()
        self.local('/test/set-role',{'role':'ADMIN'});self.page.reload();expect(self.page.get_by_role('button',name='Excluir livro',exact=True)).to_be_visible()
        self.page.once('dialog',lambda dialog:dialog.accept());self.page.get_by_role('button',name='Excluir livro',exact=True).click()
        expect(self.page.locator('.book')).to_have_count(0);self.assertEqual(self.local('/test/state')['products'],1)
        self.page.locator('#inactive').check();self.page.get_by_role('button',name='Pesquisar',exact=True).click();expect(self.page.locator('.book')).to_contain_text('Inativo')
        self.page.get_by_role('button',name='Detalhes e edição',exact=True).click();expect(self.page.locator('#editor')).to_be_visible();expect(self.page.locator('#active')).not_to_be_checked();self.page.locator('#active').check();expect(self.page.locator('#active')).to_be_checked();self.save();expect(self.page.locator('.book')).not_to_contain_text('Inativo')
        self.assertEqual(self.errors,[])

    def test_stock_zero_book_and_excess_quantity_cannot_advance_checkout(self):
        self.checkout();expect(self.page.locator('.book').filter(has=self.page.get_by_role('heading',name='Livro sem estoque',exact=True)).get_by_role('button')).to_be_disabled()
        self.add();quantity=self.page.locator('.cart-line input');quantity.fill('3');quantity.press('Tab');expect(self.page.locator('#confirm')).to_be_disabled()
        expect(self.page.locator('.cart-line')).to_contain_text('Quantidade indisponível')
        self.assertEqual(self.local('/test/checkout-state')['sales'],0)
        quantity.fill('1');quantity.press('Tab');expect(self.page.locator('#confirm')).to_be_enabled();self.confirm()

    def test_stock_browser_quota_prevents_receipt_submission(self):
        self.prepare();self.page.get_by_role('button',name='Adicionar unidades',exact=True).click()
        self.page.evaluate("() => { Storage.prototype.setItem=()=>{throw Error('test quota')}; }")
        self.page.locator('#stock-save').click();expect(self.page.locator('#stock-status')).to_contain_text('Nenhuma entrada foi enviada')
        self.assertEqual(self.receipt_requests,[]);self.assertEqual(self.local('/test/checkout-state')['journals'],0)


if __name__=='__main__':
    suite=unittest.TestSuite(Stock(name) for name in unittest.defaultTestLoader.getTestCaseNames(Stock) if name.startswith('test_stock_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
