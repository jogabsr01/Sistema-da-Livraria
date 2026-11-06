"""Private profile and message-preparation context with disposable services."""
import importlib.util
import json
from pathlib import Path
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect

spec=importlib.util.spec_from_file_location('insights_qa',Path(__file__).with_name('test-customer-insights.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.ROOT,qa.ORIGIN


class InsightsReconnection(qa.Insights):
    def setUp(self):
        super().setUp();self.hold=None;self.held=None;self.queries=[];self.changed_account=False;self.deny_session=False

    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
        if path=='/api/v1/session' and (self.changed_account or self.deny_session):
            if self.deny_session:
                route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'UNAUTHENTICATED'}}));return
            out=self.local(path,headers=headers);body=json.loads(out['body']);body['data']['user']['id']='00000000-0000-4000-8000-000000000001'
            route.fulfill(status=out['status'],headers=out['headers'],body=json.dumps(body));return
        if path=='/api/v1/customer-insights/query':self.queries.append(json.loads(req.post_data))
        if self.hold and path=='/api/v1/customer-insights/'+self.hold:
            if self.hold=='message':self.message_commands.append(json.loads(req.post_data))
            out=self.local(path,body=req.post_data_buffer,headers=headers,method=req.method);self.held=(route,out);return
        super().relay(route)

    def held_response(self):
        for _ in range(100):
            if self.held:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held)

    def release(self):
        self.hold=None;route,out=self.held;route.fulfill(status=out['status'],headers=out['headers'],body=out['body'])

    def ready(self):
        expect(self.page.locator('#insight-connection')).to_have_attribute('data-state','ready')

    def uncertain(self):
        self.setup_profile();self.page.locator('.book-choice').first.check();self.lose_message=True;self.page.locator('#prepare').click()
        expect(self.page.locator('#pending-panel')).to_be_visible();expect(self.page.locator('#retry')).to_be_enabled()

    def test_reconnection_offline_erases_private_profile_cpf_and_text(self):
        self.setup_profile();self.draft();before=len(self.queries);self.network(False)
        expect(self.page.locator('#profile')).to_be_hidden();expect(self.page.locator('#customer-name')).to_be_empty()
        expect(self.page.locator('#history')).to_be_empty();expect(self.page.locator('#draft')).to_have_value('');expect(self.page.locator('#cpf')).to_have_value('')
        self.page.locator('#search').dispatch_event('submit');self.assertEqual(len(self.queries),before)
        self.network(True);self.ready();self.assertEqual(len(self.queries),before);expect(self.page.locator('#profile')).to_be_hidden()

    def test_reconnection_late_profile_query_cannot_restore_private_data(self):
        self.setup_profile();self.hold='query';self.page.locator('#consult').click();self.held_response()
        self.network(False);self.network(True);self.release()
        expect(self.page.locator('#status')).to_contain_text('contexto mudou');expect(self.page.locator('#customer-name')).to_be_empty()
        expect(self.page.locator('#history')).to_be_empty();expect(self.page.locator('#profile')).to_be_hidden()

    def test_reconnection_late_preparation_recovers_original_without_restoring_history(self):
        self.setup_profile();self.page.locator('.book-choice').first.check();self.hold='message';self.page.locator('#prepare').click();self.held_response()
        original=self.message_commands[0];self.network(False);self.network(True);self.release()
        expect(self.page.locator('#pending-panel')).to_be_visible();expect(self.page.locator('#retry')).to_be_enabled()
        expect(self.page.locator('#draft')).to_have_value('');expect(self.page.locator('#customer-name')).to_be_empty()
        self.page.locator('#retry').click();expect(self.page.locator('#draft-panel')).to_be_visible()
        expect(self.page.locator('#profile')).to_be_hidden();self.assertEqual(self.message_commands,[original,original])
        self.assertEqual(self.local('/test/insight-state')['messages'],1)

    def test_reconnection_copy_response_after_context_change_never_requests_clipboard(self):
        self.setup_profile();self.draft()
        self.page.evaluate("window.clipboardWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.clipboardWrites.push(text)}}})")
        self.hold='message';self.page.locator('#copy').click();self.held_response();self.network(False);self.network(True);self.release()
        expect(self.page.locator('#pending-panel')).to_be_visible();expect(self.page.locator('#retry')).to_be_enabled()
        self.assertEqual(self.page.evaluate('window.clipboardWrites'),[]);expect(self.page.locator('#draft')).to_have_value('')
        self.assertEqual(self.local('/test/insight-state')['messages'],1)

    def test_reconnection_changed_account_blocks_prepared_text_and_preserves_reference(self):
        self.setup_profile();self.page.locator('.book-choice').first.check();self.hold='message';self.page.locator('#prepare').click();self.held_response()
        self.changed_account=True;self.release();expect(self.page.locator('#status')).to_contain_text('Confirme seu acesso')
        expect(self.page.locator('#draft')).to_have_value('');expect(self.page.locator('#customer-name')).to_be_empty()
        expect(self.page.locator('#pending-panel')).to_be_visible();self.changed_account=False
        self.page.locator('#retry').click();expect(self.page.locator('#draft-panel')).to_be_visible()
        self.assertEqual(self.message_commands[0],self.message_commands[1]);self.assertEqual(self.local('/test/insight-state')['messages'],1)

    def test_reconnection_session_failure_before_retry_never_reposts(self):
        self.uncertain();original=self.message_commands[0];self.deny_session=True;self.page.locator('#retry').click()
        expect(self.page.locator('#status')).to_contain_text('Confirme seu acesso');self.assertEqual(len(self.message_commands),1)
        self.deny_session=False;self.page.locator('#retry').click();expect(self.page.locator('#draft-panel')).to_be_visible()
        self.assertEqual(self.message_commands,[original,original])

    def test_reconnection_revoked_consent_after_uncertain_preparation_never_reveals_text(self):
        self.uncertain();p=self.customer_commands[0].copy();p['record']={**p['record'],'marketingConsent':False};p['expectedRevision']=1;p['commandId']=self.page.evaluate('crypto.randomUUID()')
        self.assertEqual(self.browser_post('/api/v1/customers/save',p)['status'],200)
        self.page.locator('#retry').click();expect(self.page.locator('#status')).to_contain_text('dados mudaram')
        expect(self.page.locator('#draft')).to_have_value('');expect(self.page.locator('#pending-panel')).to_be_hidden()
        self.assertEqual(self.local('/test/insight-state')['messages'],1)

    def test_reconnection_selection_change_discards_old_response_and_preserves_original_command(self):
        self.setup_profile();self.page.locator('.book-choice').first.check();self.hold='message';self.page.locator('#prepare').click();self.held_response()
        original=self.message_commands[0]
        self.page.locator('.book-choice').first.evaluate("el=>{el.checked=false;el.dispatchEvent(new Event('change'))}")
        self.release();expect(self.page.locator('#pending-panel')).to_be_visible();expect(self.page.locator('#retry')).to_be_enabled()
        expect(self.page.locator('#draft')).to_have_value('');self.page.locator('#retry').click()
        expect(self.page.locator('#draft-panel')).to_be_visible();self.assertEqual(self.message_commands,[original,original])

    def test_reconnection_expiry_clears_reference_profile_and_text_without_new_message(self):
        self.page.clock.install();self.uncertain();self.page.clock.fast_forward(301000)
        expect(self.page.locator('#pending-panel')).to_be_hidden();expect(self.page.locator('#draft')).to_have_value('')
        expect(self.page.locator('#cpf')).to_have_value('');expect(self.page.locator('#status')).to_contain_text('venceu')
        self.assertEqual(len(self.message_commands),1);self.assertEqual(self.local('/test/insight-state')['messages'],1)

    def test_reconnection_explicit_discard_allows_new_customer_query_without_erasing_audit(self):
        self.uncertain();original=self.message_commands[0];self.page.locator('#discard-preparation').click()
        expect(self.page.locator('#pending-panel')).to_be_hidden();expect(self.page.locator('#cpf')).to_be_enabled()
        self.lookup();self.draft();self.assertNotEqual(self.message_commands[1]['commandId'],original['commandId'])
        self.assertEqual(self.local('/test/insight-state')['messages'],2)

    def test_reconnection_mobile_role_removed_during_query_never_restores_private_profile(self):
        self.setup_profile();self.hold='query';self.page.locator('#consult').click();self.held_response()
        self.local('/test/set-role',{'role':'ATENDENTE'});self.release()
        expect(self.page.locator('#access-help')).to_be_visible();expect(self.page.locator('#customer-name')).to_be_empty()
        expect(self.page.locator('#history')).to_be_empty();expect(self.page.locator('#cpf')).to_have_value('')
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));target=ROOT/'work/qa-insights-reconnection';target.mkdir(exist_ok=True)
        self.page.evaluate('window.scrollTo(0,0)');self.page.screenshot(path=str(target/'perfil-protegido.png'),full_page=True);self.assertEqual(self.errors,[])

    def test_reconnection_open_offline_resumes_only_access(self):
        self.activate();self.local('/test/enable-insights',{})
        self.page.add_init_script("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false})")
        self.page.goto(ORIGIN+'/clientes-compras-dev.html');expect(self.page.locator('#insight-connection')).to_have_attribute('data-state','offline')
        self.network(True);self.ready();expect(self.page.locator('#workspace')).to_be_visible();self.assertEqual(self.queries,[])


if __name__=='__main__':
    suite=unittest.TestSuite(InsightsReconnection(name) for name in unittest.defaultTestLoader.getTestCaseNames(InsightsReconnection) if name.startswith('test_reconnection_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
