"""Staff privacy, stale revisions and fixed commands; disposable services."""
import importlib.util,json,unittest
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('staff_qa',Path(__file__).with_name('test-staff.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.qa.ROOT,qa.qa.ORIGIN
class StaffReconnection(qa.Staff):
    def setUp(self):
        super().setUp();self.deny=False;self.other=False;self.fail_list=False;self.hold=False;self.held=None;self.forbidden=False
    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path;headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
        if path=='/api/v1/session' and (self.deny or self.other):
            if self.deny:route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'UNAUTHENTICATED'}}));return
            out=self.local(path,headers=headers);body=json.loads(out['body']);body['data']['user']['id']='00000000-0000-4000-8000-000000000001';route.fulfill(status=out['status'],headers=out['headers'],body=json.dumps(body));return
        if path in ['/api/v1/staff/list','/api/v1/staff/bootstrap']:
            if self.fail_list:route.abort();return
            out=self.local(path+'?'+urlsplit(req.url).query,headers=headers)
            if self.hold:self.held=(route,out);return
            route.fulfill(status=out['status'],headers=out['headers'],body=out['body']);return
        if path=='/api/v1/staff/save' and self.forbidden:
            self.commands.append(json.loads(req.post_data));self.forbidden=False;route.fulfill(status=403,content_type='application/json',body=json.dumps({'error':{'code':'FORBIDDEN'}}));return
        super().relay(route)
    def network(self,on):self.page.evaluate("on=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>on});window.dispatchEvent(new Event(on?'online':'offline'));}",on)
    def ready(self):expect(self.page.locator('#staff-connection')).to_have_attribute('data-state','ready')
    def uncertain(self):
        self.team();self.fill();self.lose_staff=True;self.page.locator('#save-user').click();expect(self.page.locator('#retry-save')).to_be_enabled()
    def current(self):return self.page.evaluate("async()=>(await(await fetch('/api/v1/staff/list')).json()).data.users")
    def test_reconnection_unsent_draft_masked_offline_no_post(self):
        self.team();self.fill();self.network(False);expect(self.page.locator('#staff-fields')).to_be_hidden();expect(self.page.locator('#people')).to_be_empty()
        self.page.locator('#staff-form').dispatch_event('submit');self.assertEqual(self.commands,[]);self.network(True);self.ready()
        expect(self.page.locator('#staff-name')).to_have_value('Pessoa de teste');self.save_staff();self.assertEqual(len(self.commands),1)
    def test_reconnection_uncertain_command_keeps_original_contact_and_reason(self):
        self.uncertain();original=self.commands[0];self.page.locator('#staff-name').evaluate("el=>el.value='Nome não enviado'")
        self.network(False);self.network(True);self.ready();self.assertEqual(len(self.commands),1)
        self.page.locator('#retry-save').click();expect(self.page.locator('#editor')).to_be_hidden();self.assertEqual(self.commands,[original,original])
        self.assertEqual(len(self.current()),2);self.assertEqual(next(p for p in self.current() if p['id']==original['id'])['revision'],1)
    def test_reconnection_expired_session_clears_form_keeps_pending(self):
        self.uncertain();original=self.commands[0];self.deny=True;self.network(False);self.network(True)
        expect(self.page.locator('#access-help')).to_be_visible();expect(self.page.locator('#editor')).to_be_hidden();expect(self.page.locator('#staff-email')).to_have_value('')
        expect(self.page.locator('#pending-staff')).to_be_visible();self.deny=False;self.page.locator('main [data-staff-refresh]').click();self.ready()
        self.page.locator('#resume-staff').click();expect(self.page.locator('#pending-staff')).to_be_hidden();self.assertEqual(self.commands,[original,original])
    def test_reconnection_other_account_cannot_replay(self):
        self.uncertain();self.other=True;self.network(False);self.network(True);expect(self.page.locator('#access-help')).to_be_visible()
        self.page.locator('#resume-staff').click();expect(self.page.locator('main [data-staff-refresh]')).to_be_enabled();self.assertEqual(len(self.commands),1)
        self.other=False;self.page.locator('main [data-staff-refresh]').click();self.ready();self.page.locator('#resume-staff').click();expect(self.page.locator('#pending-staff')).to_be_hidden();self.assertEqual(self.commands[0],self.commands[1])
    def test_reconnection_role_removed_before_send_no_post(self):
        self.team();self.fill();self.local('/test/set-role',{'role':'ATENDENTE'});self.page.locator('#save-user').click()
        expect(self.page.locator('#editor')).to_be_hidden();expect(self.page.locator('#staff-name')).to_have_value('');self.assertEqual(self.commands,[])
    def test_reconnection_known_save_stays_saved_if_list_fails(self):
        self.team();self.fill();self.fail_list=True;self.save_staff();expect(self.page.locator('#status')).to_contain_text('Funcionário salvo.')
        expect(self.page.locator('#status')).to_contain_text('Não foi possível atualizar');expect(self.page.locator('#pending-staff')).to_be_hidden()
        self.fail_list=False;self.page.locator('main [data-staff-refresh]').click();self.ready();self.assertEqual(len(self.commands),1);self.assertEqual(len(self.current()),2)
    def test_reconnection_concurrent_revision_requires_explicit_reload(self):
        self.team();self.fill();self.save_staff();self.page.get_by_role('button',name='Editar acesso e dados').click();self.page.locator('#staff-name').fill('Rascunho local');self.network(False)
        result=self.page.evaluate("""async()=>{const s=(await(await fetch('/api/v1/session')).json()).data;
          const p=(await(await fetch('/api/v1/staff/list')).json()).data.users.find(p=>p.role==='ATENDENTE');
          return(await fetch('/api/v1/staff/save',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},body:JSON.stringify({commandId:crypto.randomUUID(),id:p.id,expectedRevision:p.revision,contact:{name:'Versão remota',cpf:'',email:p.email,phone:p.phone},role:p.role,status:p.status,reason:'Atualização em outra aba'})})).status;}""")
        self.assertEqual(result,200);self.network(True);self.ready();expect(self.page.locator('#save-user')).to_be_disabled();expect(self.page.locator('#staff-name')).to_have_value('Rascunho local')
        self.page.locator('#reload-staff').click();expect(self.page.locator('#staff-name')).to_have_value('Versão remota');self.page.locator('#staff-reason').fill('Conferência da versão atual');self.page.locator('#staff-phone').fill('11888888888');self.save_staff()
        self.assertEqual(next(p for p in self.current() if p['role']=='ATENDENTE')['revision'],3)
    def test_reconnection_old_list_cannot_enable_save(self):
        self.team();self.fill();self.hold=True;self.page.locator('#editor [data-staff-refresh]').click()
        for _ in range(100):
            if self.held:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held);self.network(False);self.network(True);self.fail_list=True;self.hold=False
        route,out=self.held;route.fulfill(status=out['status'],headers=out['headers'],body=out['body'])
        expect(self.page.locator('#staff-connection')).to_have_attribute('data-state','stale');expect(self.page.locator('#save-user')).to_be_disabled();self.assertEqual(self.commands,[])
    def test_reconnection_late_forbidden_keeps_uncertain_command(self):
        self.uncertain();original=self.commands[0];self.forbidden=True;self.page.locator('#retry-save').click();expect(self.page.locator('#editor')).to_be_hidden()
        expect(self.page.locator('#pending-staff')).to_be_visible();self.page.locator('main [data-staff-refresh]').click();self.ready();self.page.locator('#resume-staff').click()
        expect(self.page.locator('#pending-staff')).to_be_hidden();self.assertEqual(self.commands,[original,original,original]);self.assertEqual(len(self.current()),2)
    def test_reconnection_pagehide_preserves_pending_for_same_tab_return(self):
        self.uncertain();original=self.commands[0];self.page.evaluate("window.dispatchEvent(new Event('pagehide'))")
        expect(self.page.locator('#staff-fields')).to_be_hidden();expect(self.page.locator('#pending-staff')).to_be_visible()
        self.page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");self.ready();self.assertEqual(len(self.commands),1)
        self.page.locator('#retry-save').click();expect(self.page.locator('#editor')).to_be_hidden();self.assertEqual(self.commands,[original,original])
    def test_reconnection_freshness_expiry_keeps_draft(self):
        self.page.clock.install();self.team();self.fill();self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})");self.page.clock.fast_forward(91000)
        expect(self.page.locator('#save-user')).to_be_disabled();expect(self.page.locator('#staff-email')).to_have_value('pessoa@example.invalid');self.assertEqual(self.commands,[])
    def test_reconnection_mobile_draft_protected_no_overflow(self):
        self.team();self.fill();self.network(False);expect(self.page.locator('#staff-fields')).to_be_hidden();self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.errors,[])
        target=ROOT/'work/qa-people-reconnection';target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'equipe-protegida.png'),full_page=True)
if __name__=='__main__':
    suite=unittest.TestSuite(StaffReconnection(n) for n in unittest.defaultTestLoader.getTestCaseNames(StaffReconnection) if n.startswith('test_reconnection_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
