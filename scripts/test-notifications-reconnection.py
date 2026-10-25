"""Notification command recovery and report scope, disposable Google/network."""
import importlib.util
import json
from pathlib import Path
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect

spec=importlib.util.spec_from_file_location('notifications_qa',Path(__file__).with_name('test-notifications.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.ROOT,qa.ORIGIN


class NotificationsReconnection(qa.Notifications):
    def setUp(self):
        super().setUp();self.changes=[];self.lose_change=False;self.hold_report=False;self.held=None
        self.deny_session=False;self.changed_account=False;self.fail_list=False;self.reject_change=False;self.downloads=[]
        self.page.on('download',lambda download:self.downloads.append(download))

    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
        if path=='/api/v1/session' and (self.deny_session or self.changed_account):
            if self.deny_session:
                route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'UNAUTHENTICATED'}}));return
            out=self.local(path,headers=headers);body=json.loads(out['body']);body['data']['user']['id']='00000000-0000-4000-8000-000000000001'
            route.fulfill(status=out['status'],headers=out['headers'],body=json.dumps(body));return
        if path=='/api/v1/notifications/list' and self.fail_list:route.abort();return
        if path=='/api/v1/notifications/report' and self.hold_report:
            self.report_requests.append(json.loads(req.post_data))
            out=self.local(path,body=req.post_data_buffer,headers=headers,method=req.method);self.held=(route,out);return
        if path in ['/api/v1/notifications/read','/api/v1/notifications/state']:
            self.changes.append((path,json.loads(req.post_data)))
            if self.reject_change:
                self.reject_change=False;route.fulfill(status=403,content_type='application/json',body=json.dumps({'error':{'code':'FORBIDDEN'}}));return
            out=self.local(path,body=req.post_data_buffer,headers=headers,method=req.method)
            if self.lose_change:self.lose_change=False;route.abort();return
            route.fulfill(status=out['status'],headers=out['headers'],body=out['body']);return
        super().relay(route)

    def prepare(self):
        self.start();self.book();self.notifications();self.ready()

    def ready(self):
        expect(self.page.locator('#notification-connection')).to_have_attribute('data-state','ready')

    def uncertain(self,personal=False):
        self.prepare();self.lose_change=True
        self.page.get_by_role('button',name='Marcar como lida' if personal else 'Marcar em atendimento',exact=True).click()
        expect(self.page.locator('#pending-update')).to_be_visible()
        expect(self.page.locator('#status')).to_contain_text('Não foi possível confirmar')

    def wait_held(self):
        for _ in range(100):
            if self.held:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held)

    def release_report(self):
        self.hold_report=False;route,out=self.held;route.fulfill(status=out['status'],headers=out['headers'],body=out['body'])

    def test_reconnection_state_response_loss_keeps_same_command_without_auto_post(self):
        self.uncertain();original=self.changes[0];after=self.local('/test/state')['logs']
        self.network(False);expect(self.page.locator('#retry-update')).to_be_disabled()
        self.network(True);self.ready();self.assertEqual(len(self.changes),1)
        expect(self.page.get_by_role('button',name='Voltar para aberta',exact=True)).to_be_disabled()
        self.page.locator('#retry-update').click();expect(self.page.locator('#pending-update')).to_be_hidden()
        self.assertEqual(self.changes,[original,original]);self.assertEqual(self.local('/test/state')['logs'],after)

    def test_reconnection_personal_read_reuses_notification_identity(self):
        self.uncertain(True);original=self.changes[0];self.network(False);self.network(True);self.ready()
        self.assertEqual(len(self.changes),1);self.page.locator('#retry-update').click()
        expect(self.page.locator('#pending-update')).to_be_hidden();expect(self.page.locator('.alert')).to_contain_text('· Lida')
        self.assertEqual(self.changes,[original,original]);self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[])

    def test_reconnection_offline_blocks_new_changes_and_report_requests(self):
        self.prepare();self.network(False)
        self.page.get_by_role('button',name='Marcar em atendimento',exact=True).dispatch_event('click')
        self.page.locator('#report-form').dispatch_event('submit')
        self.assertEqual(self.changes,[]);self.assertEqual(self.report_requests,[])
        expect(self.page.locator('#pending-update')).to_be_hidden()
        self.network(True);self.ready();self.generate();self.assertEqual(len(self.report_requests),1)

    def test_reconnection_offline_clears_report_draft_and_print_output(self):
        self.prepare();self.generate();self.page.locator('#copy').click();expect(self.page.locator('#draft')).to_be_visible()
        self.network(False);expect(self.page.locator('#draft')).to_have_value('');expect(self.page.locator('#report')).to_be_hidden()
        expect(self.page.locator('#report-groups')).to_be_empty();expect(self.page.locator('#export')).to_be_disabled()
        self.page.emulate_media(media='print');expect(self.page.locator('#report')).to_be_hidden();self.page.emulate_media(media='screen')
        self.network(True);self.ready();self.assertEqual(len(self.report_requests),2);expect(self.page.locator('#report')).to_be_hidden()

    def test_reconnection_delayed_csv_after_network_change_never_downloads(self):
        self.prepare();self.generate();self.hold_report=True;self.page.locator('#export').click();self.wait_held()
        self.network(False);self.network(True);self.release_report();self.ready()
        expect(self.page.locator('#report')).to_be_hidden();self.assertEqual(self.downloads,[])
        expect(self.page.locator('#report-status')).to_contain_text('mudou')

    def test_reconnection_delayed_report_cannot_replace_changed_filter(self):
        self.prepare();self.hold_report=True;self.page.locator('#generate').click();self.wait_held()
        self.page.locator('#scope').evaluate("el=>{el.value='low';el.dispatchEvent(new Event('change'))}")
        self.release_report();expect(self.page.locator('#report-status')).to_contain_text('mudou')
        expect(self.page.locator('#report')).to_be_hidden();self.generate()
        self.assertEqual(self.report_requests[-1]['scope'],'low')

    def test_reconnection_account_change_erases_previous_view_and_supplier_options(self):
        self.prepare();self.generate();self.page.locator('#copy').click();expect(self.page.locator('#draft')).to_be_visible()
        self.changed_account=True;self.page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(self.page.locator('#status')).to_contain_text('Entre novamente')
        expect(self.page.locator('#notifications')).to_be_hidden();expect(self.page.locator('#alerts')).to_be_empty()
        expect(self.page.locator('#report')).to_be_hidden();expect(self.page.locator('#draft')).to_have_value('')
        expect(self.page.locator('#supplier option')).to_have_count(1)

    def test_reconnection_expired_session_preserves_original_update(self):
        self.uncertain();original=self.changes[0];self.deny_session=True;self.network(False);self.network(True)
        expect(self.page.locator('#status')).to_contain_text('Entre novamente')
        self.page.locator('#retry-update').dispatch_event('click');self.assertEqual(len(self.changes),1)
        self.deny_session=False;self.page.locator('#reconnect').click();self.ready()
        self.page.locator('#retry-update').click();expect(self.page.locator('#pending-update')).to_be_hidden()
        self.assertEqual(self.changes,[original,original])

    def test_reconnection_rejection_after_uncertainty_does_not_create_new_key(self):
        self.uncertain();original=self.changes[0];self.reject_change=True;self.page.locator('#retry-update').click()
        expect(self.page.locator('#status')).to_contain_text('Entre novamente');expect(self.page.locator('#pending-update')).to_be_visible()
        self.page.locator('#reconnect').click();self.ready();self.page.locator('#retry-update').click()
        expect(self.page.locator('#pending-update')).to_be_hidden();self.assertEqual(self.changes,[original,original,original])

    def test_reconnection_known_update_survives_followup_list_failure(self):
        self.prepare();self.fail_list=True;self.page.get_by_role('button',name='Marcar em atendimento',exact=True).click()
        expect(self.page.locator('#status')).to_contain_text('Atualização confirmada. Não foi possível atualizar a lista')
        expect(self.page.locator('#pending-update')).to_be_hidden();self.fail_list=False;self.page.locator('#reconnect').click();self.ready()
        expect(self.page.locator('.alert')).to_contain_text('Em atendimento');self.assertEqual(len(self.changes),1)

    def test_reconnection_role_removed_before_update_prevents_post_and_hides_actions(self):
        self.prepare();self.local('/test/set-role',{'role':'ATENDENTE'})
        self.page.get_by_role('button',name='Marcar em atendimento',exact=True).click()
        expect(self.page.locator('#status')).to_contain_text('Entre novamente')
        self.assertEqual(self.changes,[]);expect(self.page.locator('#pending-update')).to_be_hidden()
        expect(self.page.locator('[data-administrative]')).to_be_hidden();expect(self.page.locator('#report-tools')).to_be_hidden()

    def test_reconnection_mobile_report_expires_without_poll_interrupting_review(self):
        self.page.clock.install();self.prepare();self.generate();self.page.locator('#copy').click();expect(self.page.locator('#draft')).to_be_visible()
        self.page.clock.fast_forward(61000);expect(self.page.locator('#report')).to_be_visible();expect(self.page.locator('#draft')).not_to_have_value('')
        self.page.clock.fast_forward(30000);expect(self.page.locator('#report')).to_be_hidden();expect(self.page.locator('#draft')).to_have_value('')
        self.network(False);self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        self.page.evaluate('window.scrollTo(0,0)');target=ROOT/'work/qa-notifications-reconnection';target.mkdir(exist_ok=True)
        self.page.screenshot(path=str(target/'notificacoes-sem-conexao.png'),full_page=True);self.assertEqual(self.errors,[])

    def test_reconnection_open_offline_resumes_without_reload(self):
        self.start();self.page.add_init_script("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false})")
        self.page.goto(ORIGIN+'/notificacoes-dev.html');expect(self.page.locator('#status')).to_contain_text('Sem conexão')
        self.network(True);self.ready();expect(self.page.locator('#notifications')).to_be_visible()

    def test_reconnection_original_command_stays_safe_after_alert_resolved_by_stock(self):
        self.uncertain();original=self.changes[0]
        status=self.page.evaluate('''async()=>{
          const s=(await(await fetch('/api/v1/session')).json()).data;
          const list=(await(await fetch('/api/v1/catalog/list')).json()).data;
          const p=(await(await fetch('/api/v1/catalog/get?id='+list.products[0].id)).json()).data.product;
          return (await fetch('/api/v1/catalog/receive',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},
            body:JSON.stringify({commandId:crypto.randomUUID(),id:p.id,expectedVersion:p.version,quantity:3,reason:'REPOSICAO'})})).status;
        }''')
        self.assertEqual(status,200);self.network(False);self.network(True);self.ready();expect(self.page.locator('.alert')).to_have_count(0)
        self.page.locator('#retry-update').click();expect(self.page.locator('#pending-update')).to_be_hidden()
        self.page.locator('#history').check();expect(self.page.locator('.alert')).to_contain_text('Resolvida')
        self.assertEqual(self.changes,[original,original])


if __name__=='__main__':
    suite=unittest.TestSuite(NotificationsReconnection(name) for name in unittest.defaultTestLoader.getTestCaseNames(NotificationsReconnection) if name.startswith('test_reconnection_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
