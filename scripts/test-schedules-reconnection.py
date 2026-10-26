"""Schedule reconnection, fixed commands and draft protection; emulated Google."""
import importlib.util
import json
from pathlib import Path
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect

spec=importlib.util.spec_from_file_location('schedules_qa',Path(__file__).with_name('test-schedules.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.ROOT,qa.ORIGIN


class SchedulesReconnection(qa.Schedules):
    def setUp(self):
        super().setUp();self.hold_list=False;self.held=None;self.fail_list=False
        self.deny_session=False;self.changed_account=False;self.reject_change=False;self.lists=0

    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
        if path=='/api/v1/session' and (self.deny_session or self.changed_account):
            if self.deny_session:
                route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'UNAUTHENTICATED'}}));return
            out=self.local(path,headers=headers);body=json.loads(out['body']);body['data']['user']['id']='00000000-0000-4000-8000-000000000001'
            route.fulfill(status=out['status'],headers=out['headers'],body=json.dumps(body));return
        if path=='/api/v1/schedules/list':
            self.lists+=1
            if self.fail_list:route.abort();return
            if self.hold_list:
                out=self.local(path+'?'+urlsplit(req.url).query,headers=headers);self.held=(route,out);return
        if path in ['/api/v1/schedules/save','/api/v1/schedules/cancel'] and self.reject_change:
            self.schedule_commands.append(json.loads(req.post_data));self.reject_change=False
            route.fulfill(status=403,content_type='application/json',body=json.dumps({'error':{'code':'FORBIDDEN'}}));return
        super().relay(route)

    def network(self,connected):
        self.page.evaluate('''connected=>{
          Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>connected});
          window.dispatchEvent(new Event(connected?'online':'offline'));
        }''',connected)

    def ready(self):
        expect(self.page.locator('#schedule-connection')).to_have_attribute('data-state','ready')

    def uncertain(self):
        self.schedules();self.fill_shift();self.lose_schedule='save';self.page.locator('#publish-shift').click()
        expect(self.page.locator('#pending-schedule')).to_be_visible();expect(self.page.locator('#retry-shift')).to_be_enabled()

    def test_reconnection_unsent_draft_is_protected_offline_and_restored_for_same_account(self):
        self.schedules();self.fill_shift('Rascunho preservado');self.network(False)
        expect(self.page.locator('#shift-editor')).to_have_attribute('data-verified','false')
        expect(self.page.locator('#shift-fields')).to_be_hidden();expect(self.page.locator('#publish-shift')).to_be_disabled()
        self.page.locator('#publish-shift').dispatch_event('click');self.assertEqual(self.schedule_commands,[])
        self.network(True);self.ready();expect(self.page.locator('#shift-notes')).to_have_value('Rascunho preservado')
        self.publish();self.assertEqual(len(self.schedule_commands),1)

    def test_reconnection_lost_publication_reuses_original_despite_dom_change(self):
        self.uncertain();original=self.schedule_commands[0]
        self.page.locator('#shift-notes').evaluate("el=>el.value='Não deve substituir o pedido original'")
        self.network(False);self.network(True);self.ready();self.assertEqual(len(self.schedule_commands),1)
        self.page.locator('#retry-shift').click();expect(self.page.locator('#shift-editor')).to_be_hidden()
        self.assertEqual(self.schedule_commands,[original,original]);self.assertEqual(self.local('/test/schedule-state'),{'shifts':1,'events':1})

    def test_reconnection_cancel_response_loss_has_one_effect(self):
        self.schedules();self.fill_shift();self.publish();self.page.locator('.shift').click()
        self.lose_schedule='cancel';self.page.locator('#cancel-shift').click()
        expect(self.page.locator('#pending-schedule')).to_be_visible();expect(self.page.locator('#retry-shift')).to_be_enabled()
        self.assertEqual(len(self.schedule_commands),2)
        self.network(False);self.network(True);self.ready();self.page.locator('#retry-shift').click()
        expect(self.page.locator('#shift-editor')).to_be_hidden();expect(self.page.locator('.shift')).to_contain_text('Cancelada')
        self.assertEqual(self.schedule_commands[1],self.schedule_commands[2]);self.assertEqual(self.local('/test/schedule-state'),{'shifts':1,'events':2})

    def test_reconnection_expired_session_preserves_command_outside_cleared_editor(self):
        self.uncertain();original=self.schedule_commands[0];self.deny_session=True;self.network(False);self.network(True)
        expect(self.page.locator('#access-help')).to_be_visible();expect(self.page.locator('#shift-editor')).to_be_hidden()
        expect(self.page.locator('#shift-notes')).to_have_value('');expect(self.page.locator('#pending-schedule')).to_be_visible()
        self.assertEqual(len(self.schedule_commands),1);self.deny_session=False
        self.page.locator('main [data-schedule-refresh]').click();self.ready();self.page.locator('#resume-pending').click()
        expect(self.page.locator('#pending-schedule')).to_be_hidden();self.assertEqual(self.schedule_commands,[original,original])

    def test_reconnection_other_account_cannot_resume_original_publication(self):
        self.uncertain();original=self.schedule_commands[0];self.changed_account=True;self.network(False);self.network(True)
        expect(self.page.locator('#access-help')).to_be_visible();expect(self.page.locator('#calendar')).to_be_empty()
        self.page.locator('#resume-pending').dispatch_event('click')
        expect(self.page.locator('main [data-schedule-refresh]')).to_be_enabled();self.assertEqual(len(self.schedule_commands),1)
        self.changed_account=False;self.page.locator('main [data-schedule-refresh]').click();self.ready()
        self.page.locator('#resume-pending').click();expect(self.page.locator('#pending-schedule')).to_be_hidden()
        self.assertEqual(self.schedule_commands,[original,original])

    def test_reconnection_known_save_stays_successful_if_calendar_refresh_fails(self):
        self.schedules();self.fill_shift();self.fail_list=True;self.page.locator('#publish-shift').click()
        expect(self.page.locator('#shift-editor')).to_be_hidden();expect(self.page.locator('#status')).to_contain_text('Escala salva.')
        expect(self.page.locator('#status')).to_contain_text('Não foi possível atualizar o calendário')
        expect(self.page.locator('#pending-schedule')).to_be_hidden();self.assertEqual(self.local('/test/schedule-state')['events'],1)
        self.fail_list=False;self.page.locator('main [data-schedule-refresh]').click();self.ready()
        self.assertEqual(len(self.schedule_commands),1)

    def test_reconnection_concurrent_revision_requires_discarding_draft_explicitly(self):
        self.schedules();self.fill_shift();self.publish();self.page.locator('.shift').click()
        self.page.locator('#shift-notes').fill('Meu rascunho ainda não enviado');self.network(False)
        status=self.page.evaluate('''async()=>{
          const s=(await(await fetch('/api/v1/session')).json()).data;
          const d=(await(await fetch('/api/v1/schedules/list?from=2026-11-01&to=2026-11-30')).json()).data;
          const p=d.items[0],record=Object.fromEntries(['employeeId','date','start','end','notes','status'].map(k=>[k,p[k]]));
          record.end='10:00';record.notes='Versão confirmada em outro atendimento';
          return(await fetch('/api/v1/schedules/save',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},
            body:JSON.stringify({commandId:crypto.randomUUID(),id:p.id,expectedRevision:p.version,record})})).status;
        }''')
        self.assertEqual(status,200);self.network(True);self.ready()
        expect(self.page.locator('#publish-shift')).to_be_disabled();expect(self.page.locator('#reload-shift')).to_be_visible()
        expect(self.page.locator('#shift-notes')).to_have_value('Meu rascunho ainda não enviado')
        self.page.locator('#reload-shift').click();expect(self.page.locator('#shift-notes')).to_have_value('Versão confirmada em outro atendimento')
        self.page.locator('#shift-end').fill('11:00');self.publish();self.assertEqual(self.local('/test/schedule-state')['events'],3)

    def test_reconnection_old_calendar_response_cannot_enable_publication(self):
        self.schedules();self.fill_shift();self.hold_list=True
        self.page.locator('#shift-editor [data-schedule-refresh]').click()
        for _ in range(100):
            if self.held:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held);self.network(False);self.network(True);self.fail_list=True;self.hold_list=False
        route,out=self.held;route.fulfill(status=out['status'],headers=out['headers'],body=out['body'])
        expect(self.page.locator('#schedule-connection')).to_have_attribute('data-state','stale')
        expect(self.page.locator('#publish-shift')).to_be_disabled();self.assertEqual(self.schedule_commands,[])

    def test_reconnection_role_removed_before_send_does_not_publish(self):
        self.schedules();self.fill_shift();self.local('/test/set-role',{'role':'ATENDENTE'})
        self.page.locator('#publish-shift').click()
        expect(self.page.locator('#shift-editor')).to_be_hidden();expect(self.page.locator('#new-shift')).to_be_hidden()
        expect(self.page.locator('#shift-notes')).to_have_value('');self.assertEqual(self.schedule_commands,[])

    def test_reconnection_late_forbidden_does_not_discard_uncertain_command(self):
        self.uncertain();original=self.schedule_commands[0];self.reject_change=True;self.page.locator('#retry-shift').click()
        expect(self.page.locator('#shift-editor')).to_be_hidden();expect(self.page.locator('#pending-schedule')).to_be_visible()
        self.page.locator('main [data-schedule-refresh]').click();self.ready();self.page.locator('#resume-pending').click()
        expect(self.page.locator('#pending-schedule')).to_be_hidden();self.assertEqual(self.schedule_commands,[original,original,original])
        self.assertEqual(self.local('/test/schedule-state')['events'],1)

    def test_reconnection_calendar_freshness_expires_without_erasing_draft(self):
        self.page.clock.install();self.schedules();self.fill_shift('Ainda em revisão')
        self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})")
        self.page.clock.fast_forward(91000);expect(self.page.locator('#publish-shift')).to_be_disabled()
        expect(self.page.locator('#shift-notes')).to_have_value('Ainda em revisão');self.assertEqual(self.schedule_commands,[])

    def test_reconnection_mobile_draft_is_masked_during_disconnection(self):
        self.schedules();self.fill_shift('Nota privada preservada nesta aba');self.network(False)
        expect(self.page.locator('#shift-fields')).to_be_hidden();expect(self.page.locator('#publisher')).to_be_hidden()
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        target=ROOT/'work/qa-schedules-reconnection';target.mkdir(exist_ok=True)
        self.page.locator('#shift-editor').evaluate('el=>el.scrollTop=0')
        self.page.screenshot(path=str(target/'rascunho-protegido.png'),full_page=True);self.assertEqual(self.errors,[])

    def test_reconnection_open_offline_resumes_calendar_without_mutation(self):
        self.activate();self.local('/test/enable-schedules',{})
        self.page.add_init_script("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false})")
        self.page.goto(ORIGIN+'/escalas-dev.html');expect(self.page.locator('#schedule-connection')).to_have_attribute('data-state','offline')
        self.network(True);self.ready();expect(self.page.locator('#schedule')).to_be_visible();self.assertEqual(self.schedule_commands,[])


if __name__=='__main__':
    suite=unittest.TestSuite(SchedulesReconnection(name) for name in unittest.defaultTestLoader.getTestCaseNames(SchedulesReconnection) if name.startswith('test_reconnection_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
