"""Identified checkout, consent and privacy with disposable Google emulation."""
import importlib.util
import json
import os
from pathlib import Path
import unittest
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('checkout_qa',Path(__file__).with_name('test-checkout.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
class Customers(qa.Checkout):
    def setUp(self):
        super().setUp();self.lose_customer=False;self.customer_commands=[]
    def relay(self,route):
        if route.request.url.endswith('/api/v1/customers/save'):
            req=route.request;self.customer_commands.append(json.loads(req.post_data));headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};out=self.local('/api/v1/customers/save',body=req.post_data_buffer,headers=headers,method=req.method)
            if self.lose_customer:self.lose_customer=False;route.abort();return
            route.fulfill(status=out['status'],headers=out['headers'],body=out['body']);return
        super().relay(route)
    def prepare(self):
        self.checkout();self.local('/test/enable-customers',{});self.page.reload();expect(self.page.locator('#customer-options')).to_be_visible();self.add()
    def identify(self):
        self.page.locator('#customer-identified').check();expect(self.page.locator('#customer-lookup')).to_be_visible();self.page.locator('#customer-search-cpf').fill('529.982.247-25');self.page.locator('#customer-search').click()
    def new_customer(self):
        self.identify();expect(self.page.locator('#customer-new')).to_be_visible();self.page.locator('#customer-new').click();expect(self.page.locator('#customer-editor')).to_be_visible();self.page.locator('#customer-name').fill('Cliente fictício da livraria')
    def finish_customer(self):
        self.page.locator('#customer-save').click();expect(self.page.locator('#customer-editor')).not_to_be_visible();expect(self.page.locator('#customer-selection')).to_be_visible()
    def test_customers_mobile_identified_sale_then_anonymous_clears_all_customer_data(self):
        self.prepare();self.new_customer();self.page.locator('#customer-email').fill('cliente@example.invalid');self.page.locator('#customer-phone').fill('11999999999');self.page.locator('#customer-contactPreference').select_option('WHATSAPP');self.page.locator('#customer-marketingConsent').check();self.page.locator('#customer-editor summary').click();self.page.locator('#customer-postalCode').fill('05500-000');self.page.locator('#customer-street').fill('Rua de teste');self.page.locator('#customer-number').fill('10');self.page.locator('#customer-city').fill('Cidade fictícia');self.page.locator('#customer-state').fill('SP');self.finish_customer();expect(self.page.locator('#customer-selection')).to_contain_text('***.982.247-**')
        self.confirm();self.assertIsNotNone(self.last_command['customerId']);expect(self.page.locator('#receipt-text')).to_contain_text('Cliente identificado');self.page.locator('#new-sale').click();expect(self.page.locator('#customer-anonymous')).to_be_checked();expect(self.page.locator('#customer-search-cpf')).to_have_value('');expect(self.page.locator('#customer-name')).to_have_value('');expect(self.page.locator('#customer-selection')).to_be_hidden();self.assertEqual(self.page.locator('#customer-match-text').inner_text(),'')
        self.add();self.confirm();self.assertIsNone(self.last_command['customerId']);expect(self.page.locator('#receipt-text')).to_contain_text('Sem cadastro de cliente');self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[]);self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.errors,[])
        target=Path(os.environ.get('QA_ARTIFACTS','work/qa-customers'));target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'caixa-cliente-celular.png'),full_page=True)
    def test_customers_lookup_requires_explicit_selection_and_preserves_marketing_opt_out(self):
        self.prepare();self.new_customer();expect(self.page.locator('#customer-contactPreference')).to_have_value('NONE');expect(self.page.locator('#customer-marketingConsent')).not_to_be_checked();self.finish_customer();self.page.locator('#customer-anonymous').check();self.identify();expect(self.page.locator('#customer-match')).to_be_visible();expect(self.page.locator('#confirm')).to_be_disabled();self.page.locator('#customer-use').click();expect(self.page.locator('#confirm')).to_be_enabled();self.page.locator('#customer-edit').click();expect(self.page.locator('#customer-cpf')).to_be_disabled();expect(self.page.locator('#customer-contactPreference')).to_have_value('NONE');expect(self.page.locator('#customer-marketingConsent')).not_to_be_checked();self.page.locator('#customer-name').fill('Nome atualizado do cliente');self.finish_customer();expect(self.page.locator('#customer-selection')).to_contain_text('Nome atualizado')
    def test_customers_lost_customer_response_retries_same_command_once(self):
        self.prepare();self.new_customer();self.lose_customer=True;self.page.locator('#customer-save').click();expect(self.page.locator('#customer-form-status')).to_contain_text('tente novamente');expect(self.page.locator('#customer-name')).to_be_disabled();expect(self.page.locator('#customer-close')).to_be_disabled();self.page.locator('#customer-save').click();expect(self.page.locator('#customer-editor')).not_to_be_visible();self.assertEqual(self.customer_commands[0],self.customer_commands[1]);self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[])
    def test_customers_identified_sale_ack_loss_recovers_with_technical_reference_only(self):
        self.prepare();self.new_customer();self.finish_customer();self.lose_checkout_response=True;self.page.locator('#confirm').click();expect(self.page.locator('#sale-status')).to_contain_text('Não foi possível confirmar o resultado');original=self.last_command.copy();stored=self.page.evaluate('JSON.stringify(sessionStorage)');self.assertNotIn('Cliente fictício',stored);self.assertNotIn('52998224725',stored);self.assertNotIn('cliente@example.invalid',stored)
        self.page.reload();expect(self.page.locator('#sale-status')).to_contain_text('Há uma compra');expect(self.page.locator('#customer-selection')).to_contain_text('dados pessoais não foram carregados');self.confirm();self.assertEqual(self.last_command,original);self.assertEqual(self.local('/test/checkout-state')['sales'],1)
    def test_customers_identification_blocks_sale_until_valid_selection_and_resets_when_switching(self):
        self.prepare();self.page.locator('#customer-identified').check();expect(self.page.locator('#confirm')).to_be_disabled();self.page.locator('#customer-search-cpf').fill('00000000000');self.page.locator('#customer-search').click();expect(self.page.locator('#customer-status')).to_contain_text('Confira o CPF');self.assertIsNone(self.last_command);self.page.locator('#customer-anonymous').check();expect(self.page.locator('#confirm')).to_be_enabled();self.confirm();self.assertIsNone(self.last_command['customerId'])
    def test_customers_no_marketing_without_compatible_contact_and_cancel_clears_fields(self):
        self.prepare();self.new_customer();self.page.locator('#customer-marketingConsent').check();self.page.locator('#customer-save').click();expect(self.page.locator('#customer-form-status')).to_contain_text('canal com contato válido');self.page.locator('#customer-marketingConsent').uncheck();self.page.locator('#customer-close').click();expect(self.page.locator('#customer-name')).to_have_value('');expect(self.page.locator('#customer-editor')).not_to_be_visible()
if __name__=='__main__':
    suite=unittest.TestSuite(Customers(name) for name in unittest.defaultTestLoader.getTestCaseNames(Customers) if name.startswith('test_customers_'))
    r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
