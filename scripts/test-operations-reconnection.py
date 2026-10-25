"""Explicit recovery of operations; disposable Google and network fixtures."""
import importlib.util
import json
from pathlib import Path
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('operations_qa',Path(__file__).with_name('test-operations.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ORIGIN=qa.qa.qa.ORIGIN


class OperationsReconnection(qa.Operations):
    def setUp(self):
        super().setUp();self.commands={'adjust':[],'reverse':[]};self.lose={'adjust':False,'reverse':False}
        self.fail_list=False;self.fail_receipt=False;self.hold_list=False;self.held=None
        self.deny_session=False;self.changed_account=False;self.reject=None

    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
        if path=='/api/v1/session' and (self.deny_session or self.changed_account):
            if self.deny_session:
                route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'UNAUTHENTICATED'}}));return
            result=self.local(path,headers=headers);body=json.loads(result['body']);body['data']['user']['id']='00000000-0000-4000-8000-000000000001'
            route.fulfill(status=result['status'],headers=result['headers'],body=json.dumps(body));return
        if path=='/api/v1/operations/list':
            if self.fail_list:route.abort();return
            if self.hold_list:
                result=self.local(path+'?'+urlsplit(req.url).query,headers=headers);self.held=(route,result);return
        if path=='/api/v1/operations/get' and self.fail_receipt:route.abort();return
        if path in ['/api/v1/operations/adjust','/api/v1/operations/reverse']:
            kind=path.rsplit('/',1)[1];self.commands[kind].append(json.loads(req.post_data))
            if self.reject:
                status,code=self.reject;self.reject=None
                route.fulfill(status=status,content_type='application/json',body=json.dumps({'error':{'code':code}}));return
            result=self.local(path,body=req.post_data_buffer,headers=headers,method=req.method)
            if self.lose[kind]:self.lose[kind]=False;route.abort();return
            route.fulfill(status=result['status'],headers=result['headers'],body=result['body']);return
        super().relay(route)

    def ready(self):
        expect(self.page.locator('[data-operations-network]').first).to_have_attribute('data-state','ready')

    def adjustment(self):
        self.operations(False);self.page.locator('#product-query').fill('Livro de teste')
        self.page.get_by_role('button',name='Buscar livro',exact=True).click()
        self.page.get_by_role('button',name='Conferir e ajustar',exact=True).click()
        expect(self.page.locator('#adjust-editor')).to_be_visible()
        self.page.locator('#adjust-stock').fill('0');self.page.locator('#adjust-reason').fill('Conferência física de teste')

    def uncertain_adjustment(self):
        self.adjustment();self.lose['adjust']=True;self.page.locator('#adjust-save').click()
        expect(self.page.locator('#adjust-status')).to_contain_text('Não foi possível confirmar o resultado')

    def test_reconnection_adjustment_offline_keeps_form_without_sending(self):
        self.adjustment();self.network(False);expect(self.page.locator('#adjust-save')).to_be_disabled()
        self.page.locator('#adjust-form').dispatch_event('submit');self.assertEqual(self.commands['adjust'],[])
        self.network(True);self.ready();expect(self.page.locator('#adjust-stock')).to_have_value('0')
        expect(self.page.locator('#adjust-reason')).to_have_value('Conferência física de teste')
        self.page.locator('#adjust-save').click();expect(self.page.locator('#adjust-editor')).to_be_hidden()
        self.assertEqual(self.local('/test/checkout-state')['stock'],0)

    def test_reconnection_reverse_offline_keeps_confirmation_and_requires_action(self):
        self.operations();self.open_receipt();self.page.locator('#reverse-reason').fill('Devolução conferida')
        self.page.locator('#reverse-confirm').check();self.network(False)
        self.page.locator('#reverse-form').dispatch_event('submit');self.assertEqual(self.commands['reverse'],[])
        self.network(True);self.ready();expect(self.page.locator('#reverse-reason')).to_have_value('Devolução conferida')
        expect(self.page.locator('#reverse-confirm')).to_be_checked();self.assertEqual(self.commands['reverse'],[])
        self.page.locator('#reverse-save').click();expect(self.page.locator('#receipt-title')).to_have_text('Venda cancelada')
        self.assertEqual(self.local('/test/checkout-state')['stock'],2)

    def test_reconnection_lost_adjustment_reuses_payload_despite_dom_changes(self):
        self.uncertain_adjustment();original=self.commands['adjust'][0]
        expect(self.page.locator('#adjust-stock')).to_be_disabled();expect(self.page.locator('#adjust-close')).to_be_disabled()
        self.page.locator('#adjust-stock').evaluate("el=>el.value='99'")
        self.network(False);self.network(True);self.ready();self.assertEqual(len(self.commands['adjust']),1)
        self.page.locator('#adjust-save').click();expect(self.page.locator('#adjust-editor')).to_be_hidden()
        self.assertEqual(self.commands['adjust'],[original,original]);self.assertEqual(self.local('/test/checkout-state')['journals'],1)
        self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[])

    def test_reconnection_late_rejection_does_not_discard_uncertain_reverse(self):
        self.operations();self.open_receipt();self.lose['reverse']=True;self.reverse()
        expect(self.page.locator('#receipt-status')).to_contain_text('Não foi possível confirmar o resultado')
        original=self.commands['reverse'][0];self.reject=(403,'FORBIDDEN');self.page.locator('#reverse-save').click()
        expect(self.page.locator('#receipt-status')).to_contain_text('Seu perfil não permite')
        expect(self.page.locator('#reverse-reason')).to_be_disabled();expect(self.page.locator('#receipt-close')).to_be_disabled()
        self.page.locator('#receipt-editor [data-operations-refresh]').click();self.ready()
        self.page.locator('#reverse-save').click();expect(self.page.locator('#receipt-title')).to_have_text('Venda cancelada')
        self.assertEqual(self.commands['reverse'],[original,original,original]);self.assertEqual(self.local('/test/checkout-state')['stock'],2)

    def test_reconnection_known_reverse_success_retries_only_receipt_get(self):
        self.operations();self.open_receipt();self.fail_receipt=True;self.reverse()
        expect(self.page.locator('#receipt-status')).to_contain_text('Estorno confirmado. Não foi possível carregar o comprovante')
        expect(self.page.locator('#reverse-save')).to_have_text('Conferir comprovante')
        expect(self.page.locator('#print')).to_be_disabled();self.assertEqual(len(self.commands['reverse']),1)
        self.page.emulate_media(media='print');expect(self.page.locator('#receipt-editor')).to_be_hidden();self.page.emulate_media(media='screen')
        self.network(False);self.network(True);self.ready();self.assertEqual(len(self.commands['reverse']),1)
        self.fail_receipt=False;self.page.locator('#reverse-save').click()
        expect(self.page.locator('#receipt-title')).to_have_text('Venda cancelada')
        self.assertEqual(len(self.commands['reverse']),1);self.assertEqual(self.local('/test/checkout-state')['stock'],2)

    def test_reconnection_known_adjustment_stays_successful_when_list_read_fails(self):
        self.adjustment();self.fail_list=True;self.page.locator('#adjust-save').click()
        expect(self.page.locator('#adjust-editor')).to_be_hidden()
        expect(self.page.locator('#status')).to_contain_text('Saldo ajustado: 2 → 0')
        expect(self.page.locator('#status')).to_contain_text('Não foi possível atualizar o histórico')
        self.fail_list=False;self.page.locator('main [data-operations-refresh]').click();self.ready()
        self.assertEqual(len(self.commands['adjust']),1)

    def test_reconnection_expired_session_preserves_uncertain_command(self):
        self.uncertain_adjustment();self.network(False);self.deny_session=True;self.network(True)
        expect(self.page.locator('#status')).to_contain_text('Confirme novamente seu acesso')
        self.page.locator('#adjust-form').dispatch_event('submit');self.assertEqual(len(self.commands['adjust']),1)
        expect(self.page.locator('#adjust-close')).to_be_disabled()
        self.deny_session=False;self.page.locator('#adjust-editor [data-operations-refresh]').click();self.ready()
        self.page.locator('#adjust-save').click();expect(self.page.locator('#adjust-editor')).to_be_hidden()
        self.assertEqual(self.commands['adjust'][0],self.commands['adjust'][1])

    def test_reconnection_changed_account_cannot_send_another_accounts_adjustment(self):
        self.uncertain_adjustment();self.changed_account=True;self.network(False);self.network(True)
        expect(self.page.locator('#status')).to_contain_text('Confirme novamente seu acesso')
        self.page.locator('#adjust-form').dispatch_event('submit');self.assertEqual(len(self.commands['adjust']),1)
        self.changed_account=False;self.page.locator('#adjust-editor [data-operations-refresh]').click();self.ready()
        self.page.locator('#adjust-save').click();expect(self.page.locator('#adjust-editor')).to_be_hidden()
        self.assertEqual(self.commands['adjust'][0],self.commands['adjust'][1])

    def test_reconnection_new_stock_version_requires_explicit_review(self):
        self.adjustment();self.network(False)
        result=self.page.evaluate('''async()=>{
          const s=(await(await fetch('/api/v1/session')).json()).data;
          const list=(await(await fetch('/api/v1/catalog/list')).json()).data;
          const p=(await(await fetch('/api/v1/catalog/get?id='+list.products[0].id)).json()).data.product;
          return (await fetch('/api/v1/operations/adjust',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},
            body:JSON.stringify({commandId:crypto.randomUUID(),id:p.id,expectedVersion:p.version,newStock:1,reason:'Outro atendimento de teste'})})).status;
        }''')
        self.assertEqual(result,200);self.network(True);self.ready()
        expect(self.page.locator('#adjust-save')).to_be_disabled();expect(self.page.locator('#reload-product')).to_be_visible()
        expect(self.page.locator('#adjust-stock')).to_have_value('0');self.page.locator('#reload-product').click()
        expect(self.page.locator('#adjust-current')).to_contain_text('1 unidades')
        self.page.locator('#adjust-save').click();expect(self.page.locator('#adjust-editor')).to_be_hidden()
        self.assertEqual(self.local('/test/checkout-state')['journals'],2)

    def test_reconnection_old_history_response_never_unlocks_new_operation(self):
        self.adjustment();self.hold_list=True;self.page.locator('#adjust-editor [data-operations-refresh]').click()
        for _ in range(100):
            if self.held:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held);self.network(False);self.network(True)
        self.fail_list=True;self.hold_list=False;route,result=self.held
        route.fulfill(status=result['status'],headers=result['headers'],body=result['body'])
        expect(self.page.locator('[data-operations-network]').first).to_have_attribute('data-state','stale')
        expect(self.page.locator('#adjust-save')).to_be_disabled();self.assertEqual(self.commands['adjust'],[])

    def test_reconnection_recent_receipt_cannot_print_before_new_read_completes(self):
        self.operations();self.open_receipt();expect(self.page.locator('#print')).to_be_enabled()
        self.hold_list=True;self.network(False);self.network(True)
        for _ in range(100):
            if self.held:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held);expect(self.page.locator('#print')).to_be_disabled()
        self.hold_list=False;route,result=self.held
        route.fulfill(status=result['status'],headers=result['headers'],body=result['body'])
        self.ready();expect(self.page.locator('#print')).to_be_enabled();self.assertEqual(self.commands['reverse'],[])

    def test_reconnection_mobile_expired_receipt_blocks_reversal_and_print(self):
        self.page.clock.install();self.operations();self.open_receipt()
        self.page.locator('#reverse-reason').fill('Texto preservado');self.page.locator('#reverse-confirm').check()
        self.page.clock.fast_forward(91000)
        expect(self.page.locator('#reverse-save')).to_be_disabled();expect(self.page.locator('#print')).to_be_disabled()
        expect(self.page.locator('#reverse-reason')).to_have_value('Texto preservado');self.network(False)
        self.page.locator('#receipt-editor').evaluate('el=>el.scrollTop=0')
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        target=ROOT/'work/qa-operations-reconnection';target.mkdir(exist_ok=True)
        self.page.screenshot(path=str(target/'operacoes-sem-conexao.png'),full_page=True);self.assertEqual(self.errors,[])

    def test_reconnection_open_offline_resumes_without_reload(self):
        self.activate();self.local('/test/enable-operations',{})
        self.page.add_init_script("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false})")
        self.page.goto(ORIGIN+'/operacoes-dev.html');expect(self.page.locator('#status')).to_contain_text('Sem conexão')
        self.network(True);self.ready();expect(self.page.locator('#operations')).to_be_visible()

    def test_reconnection_role_removed_before_send_prevents_adjustment_post(self):
        self.adjustment();self.local('/test/set-role',{'role':'ATENDENTE'})
        self.page.locator('#adjust-save').click();expect(self.page.locator('#adjust-status')).to_contain_text('Seu perfil não permite')
        self.assertEqual(self.commands['adjust'],[]);self.assertEqual(self.local('/test/checkout-state')['stock'],2)
        expect(self.page.locator('#adjust-save')).to_be_disabled()


if __name__=='__main__':
    suite=unittest.TestSuite(OperationsReconnection(name) for name in unittest.defaultTestLoader.getTestCaseNames(OperationsReconnection) if name.startswith('test_reconnection_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
