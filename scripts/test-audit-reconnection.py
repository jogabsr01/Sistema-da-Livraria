"""Audit context and explicit XLSX recovery, with disposable Google state."""
import base64
import importlib.util
import json
from pathlib import Path
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect

spec=importlib.util.spec_from_file_location('audit_qa',Path(__file__).with_name('test-audit.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.ROOT,qa.ORIGIN


class AuditReconnection(qa.Audit):
    def setUp(self):
        super().setUp();self.list_requests=[];self.hold=None;self.held=None;self.changed_account=False;self.deny_session=False;self.downloads=[]
        self.page.on('download',lambda download:self.downloads.append(download))

    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
        if path=='/api/v1/session' and (self.changed_account or self.deny_session):
            if self.deny_session:
                route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'UNAUTHENTICATED'}}));return
            out=self.local(path,headers=headers);body=json.loads(out['body']);body['data']['user']['id']='00000000-0000-4000-8000-000000000001'
            route.fulfill(status=out['status'],headers=out['headers'],body=json.dumps(body));return
        if path=='/api/v1/audit/list':self.list_requests.append(req.url)
        if self.hold and path=='/api/v1/audit/'+self.hold:
            if self.hold=='export':self.export_commands.append(json.loads(req.post_data))
            query=urlsplit(req.url).query
            out=self.local(path+('?' + query if query else ''),body=req.post_data_buffer,headers=headers,method=req.method);self.held=(route,out);return
        super().relay(route)

    def network(self,connected):
        self.page.evaluate('''connected=>{
          Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>connected});
          window.dispatchEvent(new Event(connected?'online':'offline'));
        }''',connected)

    def held_response(self):
        for _ in range(100):
            if self.held:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held)

    def release(self):
        self.hold=None;route,out=self.held
        route.fulfill(status=out['status'],headers=out['headers'],body=base64.b64decode(out['bodyBase64']) if 'bodyBase64' in out else out['body'])

    def ready(self):
        expect(self.page.locator('#audit-connection')).to_have_attribute('data-state','ready')

    def uncertain_export(self):
        self.audit(4);self.lose_export=True;self.page.locator('#export-audit').click()
        expect(self.page.locator('#export-retry')).to_be_visible();expect(self.page.locator('#retry-export')).to_be_enabled()

    def test_reconnection_offline_erases_records_details_and_identifier_fields(self):
        self.audit(4);self.page.locator('.audit-record button').first.click();expect(self.page.locator('#detail')).to_be_visible()
        self.page.locator('#product').evaluate("el=>el.value='c4644e36-57a3-40c1-a223-c8a89132f8cc'")
        self.network(False);expect(self.page.locator('#detail')).to_be_hidden();expect(self.page.locator('#detail-content')).to_be_empty()
        expect(self.page.locator('#records')).to_be_empty();expect(self.page.locator('#product')).to_have_value('')
        expect(self.page.locator('#employee option')).to_have_count(1)
        self.page.locator('#filters').dispatch_event('submit');self.assertEqual(len(self.list_requests),1)
        self.network(True);self.ready();expect(self.page.locator('#records')).to_be_empty();self.assertEqual(len(self.list_requests),1)

    def test_reconnection_late_list_after_network_change_never_publishes(self):
        self.audit(4);self.hold='list';self.page.locator('#refresh').click();self.held_response()
        self.network(False);self.network(True);self.release()
        expect(self.page.locator('#status')).to_contain_text('contexto mudou');expect(self.page.locator('#records')).to_be_empty()
        self.assertEqual(len(self.list_requests),2)

    def test_reconnection_late_export_does_not_download_and_retries_same_command(self):
        self.audit(4);self.hold='export';self.page.locator('#export-audit').click();self.held_response()
        original=self.export_commands[0];self.network(False);self.network(True);self.release()
        expect(self.page.locator('#export-retry')).to_be_visible();expect(self.page.locator('#retry-export')).to_be_enabled()
        self.assertEqual(self.downloads,[]);self.assertEqual(self.local('/test/audit-state')['exports'],1)
        with self.page.expect_download():self.page.locator('#retry-export').click()
        expect(self.page.locator('#export-retry')).to_be_hidden();self.assertEqual(self.export_commands,[original,original])
        self.assertEqual(self.local('/test/audit-state')['exports'],1)

    def test_reconnection_changed_account_after_export_blocks_file(self):
        self.audit(4);self.hold='export';self.page.locator('#export-audit').click();self.held_response()
        self.changed_account=True;self.release();expect(self.page.locator('#status')).to_contain_text('Confirme seu acesso')
        expect(self.page.locator('#records')).to_be_empty();self.assertEqual(self.downloads,[])
        expect(self.page.locator('#export-retry')).to_be_visible();self.changed_account=False
        with self.page.expect_download():self.page.locator('#retry-export').click()
        self.assertEqual(self.export_commands[0],self.export_commands[1]);self.assertEqual(self.local('/test/audit-state')['exports'],1)

    def test_reconnection_session_failure_preserves_reference_without_post(self):
        self.uncertain_export();original=self.export_commands[0];self.deny_session=True;self.page.locator('#retry-export').click()
        expect(self.page.locator('#status')).to_contain_text('Confirme seu acesso');self.assertEqual(len(self.export_commands),1)
        self.deny_session=False
        with self.page.expect_download():self.page.locator('#retry-export').click()
        self.assertEqual(self.export_commands,[original,original])

    def test_reconnection_local_retention_ends_without_export_or_erasing_audit(self):
        self.page.clock.install();self.uncertain_export();self.page.clock.fast_forward(301000)
        expect(self.page.locator('#export-retry')).to_be_hidden();expect(self.page.locator('#records')).to_be_empty()
        expect(self.page.locator('#status')).to_contain_text('cinco minutos');self.assertEqual(len(self.export_commands),1)
        self.assertEqual(self.local('/test/audit-state')['exports'],1);self.assertEqual(self.downloads,[])

    def test_reconnection_explicit_discard_preserves_old_audit_and_new_export_is_deliberate(self):
        self.uncertain_export();original=self.export_commands[0];self.page.locator('#discard-export').click()
        expect(self.page.locator('#export-retry')).to_be_hidden();expect(self.page.locator('#refresh')).to_be_enabled()
        self.page.locator('#refresh').click();expect(self.page.locator('.audit-record')).to_have_count(6)
        with self.page.expect_download():self.page.locator('#export-audit').click()
        self.assertNotEqual(self.export_commands[1]['commandId'],original['commandId'])
        self.assertEqual(self.local('/test/audit-state')['exports'],2)

    def test_reconnection_filter_change_discards_late_query(self):
        self.audit(4);self.hold='list';self.page.locator('#refresh').click();self.held_response()
        self.page.locator('#product').evaluate("el=>el.value='c4644e36-57a3-40c1-a223-c8a89132f8cc'");self.release()
        expect(self.page.locator('#status')).to_contain_text('contexto mudou');expect(self.page.locator('#records')).to_be_empty()

    def test_reconnection_role_removed_during_query_never_publishes_private_records(self):
        self.audit(4);self.hold='list';self.page.locator('#refresh').click();self.held_response()
        self.local('/test/set-role',{'role':'ATENDENTE'});self.release()
        expect(self.page.locator('#access-help')).to_be_visible();expect(self.page.locator('#audit')).to_be_hidden()
        expect(self.page.locator('#records')).to_be_empty();self.assertEqual(self.downloads,[])

    def test_reconnection_mobile_hidden_page_clears_view_and_requires_explicit_query(self):
        self.audit(4);self.page.locator('.audit-record button').first.click()
        self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
        expect(self.page.locator('#detail')).to_be_hidden();expect(self.page.locator('#records')).to_be_empty()
        self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
        self.ready();self.assertEqual(len(self.list_requests),1);self.network(False)
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        target=ROOT/'work/qa-audit-reconnection';target.mkdir(exist_ok=True);self.page.evaluate('window.scrollTo(0,0)')
        self.page.screenshot(path=str(target/'auditoria-sem-conexao.png'),full_page=True);self.assertEqual(self.errors,[])

    def test_reconnection_open_offline_resumes_only_access(self):
        self.activate();self.local('/test/enable-audit',{})
        self.page.add_init_script("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false})")
        self.page.goto(ORIGIN+'/auditoria-dev.html');expect(self.page.locator('#status')).to_contain_text('Sem conexão')
        self.network(True);self.ready();expect(self.page.locator('#audit')).to_be_visible();self.assertEqual(self.list_requests,[])


if __name__=='__main__':
    suite=unittest.TestSuite(AuditReconnection(name) for name in unittest.defaultTestLoader.getTestCaseNames(AuditReconnection) if name.startswith('test_reconnection_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
