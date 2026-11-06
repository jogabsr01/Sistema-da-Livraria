"""Niche drafts and fixed commands across reconnection; disposable Google state."""
import importlib.util,json,unittest,io
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
from PIL import Image
spec=importlib.util.spec_from_file_location('niches_qa',Path(__file__).with_name('test-niches.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.ROOT,qa.ORIGIN
class NichesReconnection(qa.Niches):
    def setUp(self):
        super().setUp();self.deny=False;self.other=False;self.fail_list=False;self.hold=False;self.held=None;self.forbidden=False
    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
        if path=='/api/v1/session' and (self.deny or self.other):
            if self.deny:route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':{'code':'UNAUTHENTICATED'}}));return
            out=self.local(path,headers=headers);body=json.loads(out['body']);body['data']['user']['id']='00000000-0000-4000-8000-000000000001'
            route.fulfill(status=out['status'],headers=out['headers'],body=json.dumps(body));return
        if path=='/api/v1/niches/list':
            if self.fail_list:route.abort();return
            if self.hold:self.held=(route,self.local(path,headers=headers));return
        if path=='/api/v1/niches/save' and self.forbidden:
            self.niche_commands.append(json.loads(req.post_data));self.forbidden=False
            route.fulfill(status=403,content_type='application/json',body=json.dumps({'error':{'code':'FORBIDDEN'}}));return
        super().relay(route)
    def network(self,on):
        self.page.evaluate("on=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>on});window.dispatchEvent(new Event(on?'online':'offline'));}",on)
    def ready(self):expect(self.page.locator('#niches-connection')).to_have_attribute('data-state','ready')
    def uncertain(self):
        self.management();self.fill_niche();self.lose_niche=True;self.page.locator('#save-niche').click()
        expect(self.page.locator('#form-status')).to_contain_text('tente novamente');expect(self.page.locator('#save-niche')).to_be_enabled()
    def current(self):
        return self.page.evaluate("async()=> (await(await fetch('/api/v1/niches/list')).json()).data.niches")
    def test_reconnection_unsent_draft_masked_offline_restored_same_account(self):
        self.management();self.fill_niche('Rascunho local');self.network(False)
        expect(self.page.locator('#niche-fields')).to_be_hidden();expect(self.page.locator('#save-niche')).to_be_disabled()
        self.page.locator('#niche-form').dispatch_event('submit');self.assertEqual(self.niche_commands,[])
        self.network(True);self.ready();expect(self.page.locator('#niche-name')).to_have_value('Rascunho local');self.save_niche()
        self.assertEqual(len(self.niche_commands),1)
    def test_reconnection_uncertain_save_reuses_original_fields_and_image(self):
        self.management();self.fill_niche();photo=io.BytesIO();Image.new('RGB',(800,400),'#c8ae82').save(photo,format='JPEG')
        self.page.locator('#niche-image').set_input_files({'name':'fundo.jpg','mimeType':'image/jpeg','buffer':photo.getvalue()})
        expect(self.page.locator('#form-status')).to_contain_text('Imagem preparada');self.lose_niche=True;self.page.locator('#save-niche').click()
        expect(self.page.locator('#form-status')).to_contain_text('tente novamente');expect(self.page.locator('#save-niche')).to_be_enabled()
        original=self.niche_commands[0];self.assertIn('image',original)
        self.page.locator('#niche-name').evaluate("el=>el.value='Mudança não enviada'");self.network(False);self.network(True);self.ready()
        self.assertEqual(len(self.niche_commands),1);self.save_niche();self.assertEqual(self.niche_commands,[original,original])
        data=self.current();self.assertEqual(len(data),2);self.assertEqual(next(n for n in data if n['id']==original['id'])['version'],1)
    def test_reconnection_expired_session_clears_editor_keeps_pending(self):
        self.uncertain();original=self.niche_commands[0];self.deny=True;self.network(False);self.network(True)
        expect(self.page.locator('#access-help')).to_be_visible();expect(self.page.locator('#niche-editor')).to_be_hidden()
        expect(self.page.locator('#niche-name')).to_have_value('');expect(self.page.locator('#image-preview')).not_to_have_attribute('src')
        expect(self.page.locator('#pending-niche')).to_be_visible();self.assertEqual(len(self.niche_commands),1)
        self.deny=False;self.page.locator('main [data-niches-refresh]').click();self.ready();self.page.locator('#resume-niche').click()
        expect(self.page.locator('#pending-niche')).to_be_hidden();self.assertEqual(self.niche_commands,[original,original])
    def test_reconnection_other_account_cannot_replay(self):
        self.uncertain();self.other=True;self.network(False);self.network(True)
        expect(self.page.locator('#access-help')).to_be_visible();expect(self.page.locator('#niches')).to_be_empty()
        self.page.locator('#resume-niche').click();expect(self.page.locator('main [data-niches-refresh]')).to_be_enabled()
        self.assertEqual(len(self.niche_commands),1);self.other=False;self.page.locator('main [data-niches-refresh]').click();self.ready()
        self.page.locator('#resume-niche').click();expect(self.page.locator('#pending-niche')).to_be_hidden();self.assertEqual(self.niche_commands[0],self.niche_commands[1])
    def test_reconnection_role_removed_before_save_no_post(self):
        self.management();self.fill_niche();self.local('/test/set-role',{'role':'ATENDENTE'});self.page.locator('#save-niche').click()
        expect(self.page.locator('#access-help')).to_be_visible();expect(self.page.locator('#niche-editor')).to_be_hidden()
        expect(self.page.locator('#niche-name')).to_have_value('');self.assertEqual(self.niche_commands,[])
    def test_reconnection_known_save_not_unknown_when_list_fails(self):
        self.management();self.fill_niche();self.fail_list=True;self.save_niche()
        expect(self.page.locator('#status')).to_contain_text('Nicho salvo.');expect(self.page.locator('#status')).to_contain_text('Não foi possível atualizar')
        expect(self.page.locator('#pending-niche')).to_be_hidden();self.fail_list=False;self.page.locator('main [data-niches-refresh]').click();self.ready()
        self.assertEqual(len(self.niche_commands),1);self.assertEqual(len(self.current()),2)
    def test_reconnection_concurrent_revision_requires_explicit_reload(self):
        self.management();self.fill_niche();self.save_niche();self.page.locator('.niche-card').filter(has_text='Vida cristã').get_by_role('button').click()
        self.page.locator('#niche-description').fill('Rascunho local');self.network(False)
        result=self.page.evaluate("""async()=>{const s=(await(await fetch('/api/v1/session')).json()).data;
          const n=(await(await fetch('/api/v1/niches/list')).json()).data.niches.find(n=>n.name==='Vida cristã');
          const record=Object.fromEntries(['name','description','color','order','active'].map(k=>[k,n[k]]));record.description='Versão remota';
          return(await fetch('/api/v1/niches/save',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},body:JSON.stringify({commandId:crypto.randomUUID(),id:n.id,expectedRevision:n.version,record})})).status;}""")
        self.assertEqual(result,200);self.network(True);self.ready();expect(self.page.locator('#save-niche')).to_be_disabled()
        expect(self.page.locator('#niche-description')).to_have_value('Rascunho local');self.page.locator('#reload-niche').click()
        expect(self.page.locator('#niche-description')).to_have_value('Versão remota');self.page.locator('#niche-order').fill('3');self.save_niche()
        self.assertEqual(next(n for n in self.current() if n['name']=='Vida cristã')['version'],3)
    def test_reconnection_old_response_cannot_enable_save(self):
        self.management();self.fill_niche();self.hold=True;self.page.locator('#niche-editor [data-niches-refresh]').click()
        for _ in range(100):
            if self.held:break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held);self.network(False);self.network(True);self.fail_list=True;self.hold=False
        route,out=self.held;route.fulfill(status=out['status'],headers=out['headers'],body=out['body'])
        expect(self.page.locator('#niches-connection')).to_have_attribute('data-state','stale');expect(self.page.locator('#save-niche')).to_be_disabled();self.assertEqual(self.niche_commands,[])
    def test_reconnection_late_forbidden_preserves_uncertain_command(self):
        self.uncertain();original=self.niche_commands[0];self.forbidden=True;self.page.locator('#save-niche').click()
        expect(self.page.locator('#niche-editor')).to_be_hidden();expect(self.page.locator('#pending-niche')).to_be_visible()
        self.page.locator('main [data-niches-refresh]').click();self.ready();self.page.locator('#resume-niche').click()
        expect(self.page.locator('#pending-niche')).to_be_hidden();self.assertEqual(self.niche_commands,[original,original,original])
        self.assertEqual(next(n for n in self.current() if n['id']==original['id'])['version'],1)
    def test_reconnection_freshness_expiry_keeps_unsent_draft(self):
        self.page.clock.install();self.management();self.fill_niche('Ainda em revisão')
        self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})")
        self.page.clock.fast_forward(91000);expect(self.page.locator('#save-niche')).to_be_disabled()
        expect(self.page.locator('#niche-name')).to_have_value('Ainda em revisão');self.assertEqual(self.niche_commands,[])
    def test_reconnection_late_image_processing_does_not_restore_preview(self):
        self.management();self.fill_niche();self.page.evaluate("()=>{window.decode=createImageBitmap;window.createImageBitmap=(...args)=>new Promise(resolve=>{window.finishImage=()=>resolve(window.decode(...args));});}")
        photo=io.BytesIO();Image.new('RGB',(800,400),'red').save(photo,format='JPEG')
        self.page.locator('#niche-image').set_input_files({'name':'fundo.jpg','mimeType':'image/jpeg','buffer':photo.getvalue()})
        self.network(False);self.page.evaluate('window.finishImage()');expect(self.page.locator('#close-editor')).to_be_enabled()
        expect(self.page.locator('#image-preview')).not_to_have_attribute('src');self.network(True);self.ready();self.save_niche()
        self.assertNotIn('image',self.niche_commands[0])
    def test_reconnection_mobile_masks_draft_and_private_preview(self):
        self.management();self.fill_niche();self.network(False);expect(self.page.locator('#niche-fields')).to_be_hidden()
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.errors,[])
        target=ROOT/'work/qa-niches-reconnection';target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'rascunho-protegido.png'),full_page=True)
    def test_reconnection_boot_offline_recovers_read_only(self):
        self.activate();self.local('/test/enable-niches',{});self.page.add_init_script("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false})")
        self.page.goto(ORIGIN+'/nichos-dev.html');expect(self.page.locator('#niches-connection')).to_have_attribute('data-state','offline')
        self.network(True);self.ready();expect(self.page.locator('#management')).to_be_visible();self.assertEqual(self.niche_commands,[])
if __name__=='__main__':
    suite=unittest.TestSuite(NichesReconnection(n) for n in unittest.defaultTestLoader.getTestCaseNames(NichesReconnection) if n.startswith('test_reconnection_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
