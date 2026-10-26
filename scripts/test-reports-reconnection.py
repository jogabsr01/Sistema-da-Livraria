"""Report preview/export context with disposable Google and delayed responses."""
import base64
import importlib.util
import json
from pathlib import Path
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect

spec=importlib.util.spec_from_file_location('reports_qa',Path(__file__).with_name('test-reports.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.ROOT,qa.ORIGIN


class ReportsReconnection(qa.Reports):
    def setUp(self):
        super().setUp();self.queries=[];self.hold=None;self.held=None;self.changed_account=False;self.deny_session=False;self.downloads=[]
        self.page.on('download',lambda download:self.downloads.append(download))

    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
        if path=='/api/v1/session' and (self.changed_account or self.deny_session):
            if self.deny_session:
                route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'UNAUTHENTICATED'}}));return
            out=self.local(path,headers=headers);body=json.loads(out['body']);body['data']['user']['id']='00000000-0000-4000-8000-000000000001'
            route.fulfill(status=out['status'],headers=out['headers'],body=json.dumps(body));return
        if path=='/api/v1/reports/query':self.queries.append(json.loads(req.post_data))
        if self.hold and path=='/api/v1/reports/'+self.hold:
            if self.hold=='export':self.report_exports.append(json.loads(req.post_data))
            out=self.local(path,body=req.post_data_buffer,headers=headers,method=req.method);self.held=(route,out);return
        super().relay(route)

    def prepare(self,query=True):
        self.checkout();self.add();self.confirm();self.reports()
        if query:self.query()

    def held_response(self):
        for _ in range(100):
            if self.held:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held)

    def release(self):
        self.hold=None;route,out=self.held
        route.fulfill(status=out['status'],headers=out['headers'],body=base64.b64decode(out['bodyBase64']) if 'bodyBase64' in out else out['body'])

    def ready(self):
        expect(self.page.locator('#report-connection')).to_have_attribute('data-state','ready')

    def uncertain_export(self):
        self.prepare();self.lose_report_export=True;self.page.locator('#export-report').click()
        expect(self.page.locator('#pending-export')).to_be_visible();expect(self.page.locator('#retry-export')).to_be_enabled()

    def test_reconnection_offline_erases_results_details_and_sensitive_filters(self):
        self.prepare();self.page.locator('.report-row button').click();expect(self.page.locator('#detail')).to_be_visible()
        self.page.locator('#cpf').evaluate("el=>el.value='529.982.247-25'")
        self.network(False);expect(self.page.locator('#detail')).to_be_hidden();expect(self.page.locator('#detail-content')).to_be_empty()
        expect(self.page.locator('#rows')).to_be_empty();expect(self.page.locator('#cpf')).to_have_value('')
        self.page.locator('#filters').dispatch_event('submit');self.assertEqual(len(self.queries),1)
        self.network(True);self.ready();self.assertEqual(len(self.queries),1);expect(self.page.locator('#result')).to_be_hidden()

    def test_reconnection_late_query_after_network_change_never_publishes(self):
        self.prepare(False);self.hold='query';self.page.locator('#query-report').click();self.held_response()
        self.network(False);self.network(True);self.release()
        expect(self.page.locator('#status')).to_contain_text('contexto mudou');expect(self.page.locator('#result')).to_be_hidden()
        expect(self.page.locator('#rows')).to_be_empty();self.assertEqual(len(self.queries),1)

    def test_reconnection_late_export_does_not_download_and_retries_same_authorization(self):
        self.prepare();self.hold='export';self.page.locator('#export-report').click();self.held_response()
        original=self.report_exports[0];self.network(False);self.network(True);self.release()
        expect(self.page.locator('#pending-export')).to_be_visible();expect(self.page.locator('#retry-export')).to_be_enabled()
        self.assertEqual(self.downloads,[]);self.assertEqual(self.local('/test/report-state')['exports'],1)
        with self.page.expect_download():self.page.locator('#retry-export').click()
        expect(self.page.locator('#pending-export')).to_be_hidden();self.assertEqual(self.report_exports,[original,original])
        self.assertEqual(self.local('/test/report-state')['exports'],1)

    def test_reconnection_account_change_during_export_blocks_file_and_preserves_reference(self):
        self.prepare();self.hold='export';self.page.locator('#export-report').click();self.held_response()
        self.changed_account=True;self.release();expect(self.page.locator('#status')).to_contain_text('Confirme seu acesso')
        expect(self.page.locator('#rows')).to_be_empty();expect(self.page.locator('#pending-export')).to_be_visible();self.assertEqual(self.downloads,[])
        self.changed_account=False
        with self.page.expect_download():self.page.locator('#retry-export').click()
        self.assertEqual(self.report_exports[0],self.report_exports[1]);self.assertEqual(self.local('/test/report-state')['exports'],1)

    def test_reconnection_session_failure_never_reposts_until_same_account_is_valid(self):
        self.uncertain_export();original=self.report_exports[0];self.deny_session=True;self.page.locator('#retry-export').click()
        expect(self.page.locator('#status')).to_contain_text('Confirme seu acesso');self.assertEqual(len(self.report_exports),1)
        expect(self.page.locator('#pending-export')).to_be_visible();self.deny_session=False
        with self.page.expect_download():self.page.locator('#retry-export').click()
        self.assertEqual(self.report_exports,[original,original])

    def test_reconnection_expiry_removes_pending_without_sending_or_deleting_audit(self):
        self.page.clock.install();self.uncertain_export();self.page.clock.fast_forward(301000)
        expect(self.page.locator('#pending-export')).to_be_hidden();expect(self.page.locator('#result')).to_be_hidden()
        expect(self.page.locator('#status')).to_contain_text('venceu');self.assertEqual(len(self.report_exports),1)
        self.assertEqual(self.local('/test/report-state')['exports'],1);self.assertEqual(self.downloads,[])

    def test_reconnection_discard_is_explicit_and_new_query_uses_new_authorization(self):
        self.uncertain_export();original=self.report_exports[0];self.page.locator('#discard-export').click()
        expect(self.page.locator('#pending-export')).to_be_hidden();expect(self.page.locator('#query-report')).to_be_enabled()
        self.query()
        with self.page.expect_download():self.page.locator('#export-report').click()
        self.assertNotEqual(self.report_exports[1]['commandId'],original['commandId'])
        self.assertEqual(self.local('/test/report-state')['exports'],2)

    def test_reconnection_programmatic_filter_change_discards_late_preview(self):
        self.prepare(False);self.hold='query';self.page.locator('#query-report').click();self.held_response()
        self.page.locator('#supplier').evaluate("el=>el.value='Outro fornecedor'");self.release()
        expect(self.page.locator('#status')).to_contain_text('contexto mudou');expect(self.page.locator('#result')).to_be_hidden()

    def test_reconnection_role_removed_during_query_erases_private_response(self):
        self.prepare(False);self.hold='query';self.page.locator('#query-report').click();self.held_response()
        self.local('/test/set-role',{'role':'ATENDENTE'});self.release()
        expect(self.page.locator('#access-help')).to_be_visible();expect(self.page.locator('#reports')).to_be_hidden()
        expect(self.page.locator('#rows')).to_be_empty();self.assertEqual(self.downloads,[])

    def test_reconnection_mobile_visibility_loss_clears_view_and_requires_new_query(self):
        self.prepare();self.page.locator('.report-row button').click()
        self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
        expect(self.page.locator('#detail')).to_be_hidden();expect(self.page.locator('#rows')).to_be_empty()
        self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
        self.ready();expect(self.page.locator('#result')).to_be_hidden();self.assertEqual(len(self.queries),1)
        self.network(False);self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        target=ROOT/'work/qa-reports-reconnection';target.mkdir(exist_ok=True);self.page.evaluate('window.scrollTo(0,0)')
        self.page.screenshot(path=str(target/'relatorios-sem-conexao.png'),full_page=True);self.assertEqual(self.errors,[])

    def test_reconnection_open_offline_resumes_access_without_querying_automatically(self):
        self.activate();self.local('/test/enable-reports',{})
        self.page.add_init_script("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false})")
        self.page.goto(ORIGIN+'/relatorios-dev.html');expect(self.page.locator('#status')).to_contain_text('Sem conexão')
        self.network(True);self.ready();expect(self.page.locator('#reports')).to_be_visible();self.assertEqual(self.queries,[])


if __name__=='__main__':
    suite=unittest.TestSuite(ReportsReconnection(name) for name in unittest.defaultTestLoader.getTestCaseNames(ReportsReconnection) if name.startswith('test_reconnection_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
