"""Customer privacy and fixed commands inside checkout; disposable services."""
import importlib.util,json,unittest
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('customers_qa',Path(__file__).with_name('test-customers.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.qa.qa.ROOT,qa.qa.qa.ORIGIN
class CustomersReconnection(qa.Customers):
    def setUp(self):
        super().setUp();self.deny=False;self.other=False;self.fail_get=False;self.hold_path=None;self.held=None;self.forbidden=False
    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path;headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
        if path=='/api/v1/session' and (self.deny or self.other):
            if self.deny:route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'UNAUTHENTICATED'}}));return
            out=self.local(path,headers=headers);body=json.loads(out['body']);body['data']['user']['id']='00000000-0000-4000-8000-000000000001';route.fulfill(status=out['status'],headers=out['headers'],body=json.dumps(body));return
        if path=='/api/v1/customers/get' and self.fail_get:route.abort();return
        if path==self.hold_path:
            self.held=(route,self.local(path,body=req.post_data_buffer,headers=headers,method=req.method));return
        if path=='/api/v1/customers/save' and self.forbidden:
            self.customer_commands.append(json.loads(req.post_data));self.forbidden=False;route.fulfill(status=403,content_type='application/json',body=json.dumps({'error':{'code':'FORBIDDEN'}}));return
        super().relay(route)
    def network(self,on):self.page.evaluate("on=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>on});window.dispatchEvent(new Event(on?'online':'offline'));}",on)
    def ready(self):expect(self.page.locator('#connection')).to_have_attribute('data-state','ready')
    def uncertain(self):
        self.prepare();self.new_customer();self.lose_customer=True;self.page.locator('#customer-save').click()
        expect(self.page.locator('#customer-form-status')).to_contain_text('tente novamente');expect(self.page.locator('#customer-save')).to_be_enabled()
    def release(self):
        self.assertIsNotNone(self.held);route,out=self.held;self.hold_path=None;route.fulfill(status=out['status'],headers=out['headers'],body=out['body'])
    def held_ready(self):
        for _ in range(100):
            if self.held:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held)
    def lookup_saved(self):
        self.prepare();self.new_customer();self.finish_customer();self.page.locator('#customer-anonymous').check();self.identify();expect(self.page.locator('#customer-match')).to_be_visible()
    def test_reconnection_unsent_draft_masked_and_restored_same_account(self):
        self.prepare();self.new_customer();self.network(False);expect(self.page.locator('#customer-fields')).to_be_hidden();expect(self.page.locator('#customer-save')).to_be_disabled()
        self.page.locator('#customer-form').dispatch_event('submit');self.assertEqual(self.customer_commands,[]);self.network(True);self.ready()
        expect(self.page.locator('#customer-name')).to_have_value('Cliente fictício da livraria');self.finish_customer();self.assertEqual(len(self.customer_commands),1)
    def test_reconnection_unknown_save_reuses_original_after_dom_changes(self):
        self.uncertain();original=self.customer_commands[0];self.page.locator('#customer-name').evaluate("el=>el.value='Não enviado'")
        self.network(False);self.network(True);self.ready();self.assertEqual(len(self.customer_commands),1)
        self.finish_customer();self.assertEqual(self.customer_commands,[original,original]);expect(self.page.locator('#customer-selection')).to_contain_text('Cliente fictício da livraria')
        self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[])
    def test_reconnection_expired_session_clears_editor_preserves_pending(self):
        self.uncertain();original=self.customer_commands[0];self.deny=True;self.network(False);self.network(True)
        expect(self.page.locator('#customer-editor')).to_be_hidden();expect(self.page.locator('#customer-name')).to_have_value('');expect(self.page.locator('#customer-pending')).to_be_visible()
        self.deny=False;self.page.locator('#refresh').click();self.ready();self.page.locator('#customer-resume').click();expect(self.page.locator('#customer-pending')).to_be_hidden()
        expect(self.page.locator('#customer-selection')).to_be_visible();self.assertEqual(self.customer_commands,[original,original])
    def test_reconnection_other_account_cannot_replay(self):
        self.uncertain();self.other=True;self.network(False);self.network(True);expect(self.page.locator('#customer-editor')).to_be_hidden()
        self.page.locator('#customer-resume').click();expect(self.page.locator('#customer-resume')).to_be_enabled();self.assertEqual(len(self.customer_commands),1)
        self.other=False;self.page.locator('#refresh').click();self.ready();self.page.locator('#customer-resume').click();expect(self.page.locator('#customer-pending')).to_be_hidden();self.assertEqual(self.customer_commands[0],self.customer_commands[1])
    def test_reconnection_known_save_get_failure_does_not_resend(self):
        self.prepare();self.new_customer();self.fail_get=True;self.page.locator('#customer-save').click();expect(self.page.locator('#customer-editor')).to_be_hidden()
        expect(self.page.locator('#customer-status')).to_contain_text('Cadastro salvo.');expect(self.page.locator('#customer-pending')).to_be_hidden();expect(self.page.locator('#confirm')).to_be_disabled()
        self.fail_get=False;self.page.locator('#refresh').click();self.ready();self.identify();expect(self.page.locator('#customer-match')).to_be_visible();self.page.locator('#customer-use').click()
        expect(self.page.locator('#confirm')).to_be_enabled();self.assertEqual(len(self.customer_commands),1)
    def test_reconnection_late_get_does_not_restore_private_selection(self):
        self.prepare();self.new_customer();self.hold_path='/api/v1/customers/get';self.page.locator('#customer-save').click();self.held_ready();self.network(False);self.release()
        expect(self.page.locator('#customer-editor')).to_be_hidden();expect(self.page.locator('#customer-selection')).to_be_hidden();expect(self.page.locator('#customer-name')).to_have_value('')
        expect(self.page.locator('#customer-status')).to_contain_text('Cadastro salvo.');self.assertEqual(len(self.customer_commands),1)
    def test_reconnection_lookup_response_after_cpf_change_is_discarded(self):
        self.lookup_saved();self.hold_path='/api/v1/customers/find';self.page.locator('#customer-search').click();self.held_ready()
        self.page.locator('#customer-search-cpf').evaluate("el=>{el.value='11144477735';el.dispatchEvent(new Event('input',{bubbles:true}));}");self.release()
        expect(self.page.locator('#customer-status')).to_contain_text('Esta resposta não foi exibida');expect(self.page.locator('#customer-match')).to_be_hidden();expect(self.page.locator('#confirm')).to_be_disabled()
    def test_reconnection_lookup_session_revoked_before_response_cleans_private_data(self):
        self.lookup_saved();self.hold_path='/api/v1/customers/find';self.page.locator('#customer-search').click();self.held_ready();self.deny=True;self.release()
        expect(self.page.locator('#customer-status')).to_contain_text('Confirme novamente');expect(self.page.locator('#customer-match')).to_be_hidden();expect(self.page.locator('#customer-match-text')).to_be_empty();expect(self.page.locator('#customer-search-cpf')).to_have_value('')
    def test_reconnection_late_postal_response_does_not_overwrite_draft(self):
        self.prepare();self.new_customer();self.page.locator('#customer-editor summary').click();self.page.locator('#customer-city').fill('Cidade manual');self.page.locator('#customer-postalCode').fill('05500000')
        self.hold_path='/api/v1/customers/postal-code';self.page.locator('#customer-cep').click();self.held_ready();self.network(False);self.release()
        expect(self.page.locator('#customer-close')).to_be_enabled();self.network(True);self.ready();expect(self.page.locator('#customer-city')).to_have_value('Cidade manual');self.assertEqual(self.customer_commands,[])
    def test_reconnection_uncertain_late_forbidden_keeps_original(self):
        self.uncertain();original=self.customer_commands[0];self.forbidden=True;self.page.locator('#customer-save').click();expect(self.page.locator('#customer-editor')).to_be_hidden()
        expect(self.page.locator('#customer-pending')).to_be_visible();self.page.locator('#refresh').click();self.ready();self.page.locator('#customer-resume').click()
        expect(self.page.locator('#customer-pending')).to_be_hidden();self.assertEqual(self.customer_commands,[original,original,original])
    def test_reconnection_pagehide_pending_remains_for_same_tab(self):
        self.uncertain();original=self.customer_commands[0];self.page.evaluate("window.dispatchEvent(new Event('pagehide'))")
        expect(self.page.locator('#customer-pending')).to_be_visible();expect(self.page.locator('#customer-fields')).to_be_hidden()
        self.page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");self.ready();self.assertEqual(len(self.customer_commands),1)
        self.finish_customer();self.assertEqual(self.customer_commands,[original,original])
    def test_reconnection_new_sale_cannot_discard_customer_pending(self):
        self.uncertain();expect(self.page.locator('#new-sale')).to_be_disabled();self.page.locator('#new-sale').dispatch_event('click')
        expect(self.page.locator('#customer-pending')).to_be_visible();self.assertEqual(len(self.customer_commands),1)
    def test_reconnection_concurrent_customer_requires_new_lookup(self):
        self.lookup_saved();self.page.locator('#customer-edit').click();self.page.locator('#customer-name').fill('Rascunho de edição')
        result=self.page.evaluate("""async()=>{const s=(await(await fetch('/api/v1/session')).json()).data;
          const c=(await(await fetch('/api/v1/customers/find',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},body:JSON.stringify({cpf:'52998224725'})})).json()).data.customer;
          const keys=['name','cpf','email','phone','postalCode','street','number','complement','district','city','state','contactPreference','marketingConsent'];
          const record=Object.fromEntries(keys.map(k=>[k,k==='cpf'?'':c[k]]));record.name='Nome atualizado remotamente';
          return(await fetch('/api/v1/customers/save',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},body:JSON.stringify({commandId:crypto.randomUUID(),id:c.id,expectedRevision:c.revision,record})})).status;}""")
        self.assertEqual(result,200);self.page.locator('#customer-save').click();expect(self.page.locator('#customer-form-status')).to_contain_text('outro atendimento')
        expect(self.page.locator('#customer-name')).to_have_value('Rascunho de edição');expect(self.page.locator('#customer-name')).to_be_enabled()
        self.page.locator('#customer-close').click();self.page.locator('#customer-search').click();expect(self.page.locator('#customer-match-text')).to_contain_text('Nome atualizado remotamente')
        self.page.locator('#customer-edit').click();self.page.locator('#customer-phone').fill('11888888888');self.finish_customer()
        self.assertEqual(self.customer_commands[-1]['expectedRevision'],2)
    def test_reconnection_expired_stock_check_blocks_new_customer_save(self):
        self.page.clock.install();self.prepare();self.new_customer();self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})")
        self.page.clock.fast_forward(91000);expect(self.page.locator('#customer-save')).to_be_disabled();expect(self.page.locator('#customer-name')).to_have_value('Cliente fictício da livraria')
        self.page.locator('#customer-form').dispatch_event('submit');self.assertEqual(self.customer_commands,[])
    def test_reconnection_mobile_private_selection_cleared_on_disconnect(self):
        self.prepare();self.new_customer();self.finish_customer();self.network(False);expect(self.page.locator('#customer-selection')).to_be_hidden();expect(self.page.locator('#customer-match-text')).to_be_empty();expect(self.page.locator('#customer-search-cpf')).to_have_value('')
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.errors,[])
        target=ROOT/'work/qa-people-reconnection';target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'cliente-protegido.png'),full_page=True)
if __name__=='__main__':
    suite=unittest.TestSuite(CustomersReconnection(n) for n in unittest.defaultTestLoader.getTestCaseNames(CustomersReconnection) if n.startswith('test_reconnection_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
