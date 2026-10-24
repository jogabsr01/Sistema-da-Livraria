"""Private customer insights and manual message preparation; all Google is disposable."""
import importlib.util,json,unittest,tomllib,re
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('customers_qa',Path(__file__).with_name('test-customers.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.qa.qa.ROOT,qa.qa.qa.ORIGIN
class Insights(qa.Customers):
    def setUp(self):
        super().setUp();self.lose_message=False;self.message_commands=[]
    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        if path in ['/clientes-compras-dev.html','/clientes-compras-dev.js','/clientes-compras-dev.css','/account-menu.js','/account-menu.css']:
            headers={}
            for rule in tomllib.loads((ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],headers=headers,body=(ROOT/'dist'/path[1:]).read_bytes());return
        if path.startswith('/api/v1/customer-insights/') or path.startswith('/api/v1/operations/'):
            headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};out=self.local(path,body=req.post_data_buffer,headers=headers,method=req.method)
            if path.endswith('/message'):
                self.message_commands.append(json.loads(req.post_data))
                if self.lose_message:self.lose_message=False;route.abort();return
            route.fulfill(status=out['status'],headers=out['headers'],body=out['body']);return
        super().relay(route)
    def setup_profile(self,consent=True,sold=True):
        self.prepare();self.new_customer();self.page.locator('#customer-email').fill('private@example.invalid');self.page.locator('#customer-phone').fill('11999999999')
        if consent:self.page.locator('#customer-contactPreference').select_option('WHATSAPP');self.page.locator('#customer-marketingConsent').check()
        self.finish_customer()
        if sold:self.confirm()
        self.local('/test/enable-insights',{});self.local('/test/seed-insight-candidate',{});self.page.goto(ORIGIN+'/clientes-compras-dev.html');expect(self.page.locator('#workspace')).to_be_visible();self.lookup()
    def lookup(self):
        self.page.locator('#cpf').fill('529.982.247-25');self.page.locator('#consult').click();expect(self.page.locator('#status')).to_have_text('Perfil pronto para conferir.')
    def draft(self):
        self.page.locator('.book-choice').first.check();self.page.locator('#prepare').click();expect(self.page.locator('#draft-panel')).to_be_visible()
    def browser_post(self,path,p):
        return self.page.evaluate("""async ({path,p})=>{const s=await fetch('/api/v1/session').then(r=>r.json());const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.data.csrfToken},body:JSON.stringify(p)});return {status:r.status,body:await r.json()};}""",{'path':path,'p':p})
    def test_insights_mobile_metrics_explanations_history_manual_draft_and_privacy(self):
        self.setup_profile();expect(self.page.locator('#customer-name')).to_have_text('Cliente fictício da livraria');expect(self.page.locator('#metrics')).to_contain_text('R$ 32,90');expect(self.page.locator('#frequency')).to_contain_text('Ainda não há duas');expect(self.page.locator('#recommendations')).to_contain_text('Próxima leitura sugerida');expect(self.page.locator('#price-band')).to_contain_text('margem de 20%');self.page.locator('.history-row summary').click();expect(self.page.locator('.history-row')).to_contain_text('Livro de teste do Caixa');self.draft();expect(self.page.locator('#draft')).to_have_value(re.compile('Próxima leitura sugerida'));self.assertNotIn('529',self.page.locator('#draft').input_value());self.assertNotIn('11999999999',self.page.locator('#profile').inner_text());self.assertNotIn('private@example.invalid',self.page.locator('#profile').inner_text());self.context.grant_permissions(['clipboard-read','clipboard-write'],origin=ORIGIN);self.page.locator('#copy').click();expect(self.page.locator('#status')).to_contain_text('Texto copiado');self.assertIn('Próxima leitura sugerida',self.page.evaluate('navigator.clipboard.readText()'));self.assertEqual(self.local('/test/insight-state'),{'views':1,'messages':1});self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[]);self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));target=ROOT/'work/qa-insights';target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'perfil-compra-celular.png'),full_page=True);self.assertEqual(self.errors,[])
    def test_insights_consent_absent_shows_consultive_suggestions_without_message_action(self):
        self.setup_profile(consent=False);expect(self.page.locator('#recommendations')).to_contain_text('Próxima leitura sugerida');expect(self.page.locator('#prepare')).to_be_hidden();expect(self.page.locator('.book-choice')).to_have_count(0);expect(self.page.locator('#consent-note')).to_contain_text('exige preferência');self.assertEqual(self.local('/test/insight-state')['messages'],0)
    def test_insights_empty_history_has_no_invented_preferences_or_suggestions(self):
        self.setup_profile(sold=False);expect(self.page.locator('#frequency')).to_contain_text('ainda não tem compras confirmadas');expect(self.page.locator('#history')).to_contain_text('Nenhuma compra');expect(self.page.locator('.suggestion')).to_have_count(0);expect(self.page.locator('#prepare')).to_be_hidden()
    def test_insights_lost_ack_reuses_same_preparation_and_single_audit_event(self):
        self.setup_profile();self.page.locator('.book-choice').first.check();self.lose_message=True;self.page.locator('#prepare').click();expect(self.page.locator('#pending-panel')).to_be_visible();expect(self.page.locator('#cpf')).to_be_disabled();expect(self.page.locator('#retry')).to_be_enabled();self.assertEqual(self.local('/test/insight-state')['messages'],1);self.page.locator('#retry').click();expect(self.page.locator('#draft-panel')).to_be_visible();self.assertEqual(self.message_commands[0],self.message_commands[1]);self.assertEqual(self.local('/test/insight-state')['messages'],1)
    def test_insights_revoked_consent_rejects_stale_preparation_then_updates_eligibility(self):
        self.setup_profile();p=self.customer_commands[0].copy();p['record']={**p['record'],'marketingConsent':False};p['expectedRevision']=1;p['commandId']=self.page.evaluate('crypto.randomUUID()');self.assertEqual(self.browser_post('/api/v1/customers/save',p)['status'],200);self.page.locator('.book-choice').first.check();self.page.locator('#prepare').click();expect(self.page.locator('#status')).to_contain_text('dados mudaram');expect(self.page.locator('#draft-panel')).to_be_hidden();expect(self.page.locator('#draft')).to_have_value('');expect(self.page.locator('#profile')).to_be_hidden();self.lookup();expect(self.page.locator('#prepare')).to_be_hidden();self.assertEqual(self.local('/test/insight-state')['messages'],0)
    def test_insights_role_loss_and_clear_remove_customer_history_and_draft(self):
        self.setup_profile();self.draft();self.local('/test/set-role',{'role':'ATENDENTE'});self.page.evaluate("window.dispatchEvent(new Event('focus'))");expect(self.page.locator('#workspace')).to_be_hidden();expect(self.page.locator('#customer-name')).to_be_empty();expect(self.page.locator('.history-row')).to_have_count(0);expect(self.page.locator('#draft')).to_have_value('');expect(self.page.locator('#cpf')).to_have_value('');self.assertEqual(self.errors,[])
    def test_insights_changing_customer_or_clearing_wipes_previous_private_results(self):
        self.setup_profile();self.draft();self.page.locator('#cpf').fill('11144477735');expect(self.page.locator('#profile')).to_be_hidden();expect(self.page.locator('#draft')).to_have_value('');expect(self.page.locator('#customer-name')).to_be_empty();self.page.locator('#consult').click();expect(self.page.locator('#status')).to_contain_text('Cliente não encontrado');expect(self.page.locator('.history-row')).to_have_count(0);self.page.locator('#clear').click();expect(self.page.locator('#cpf')).to_have_value('');self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(Insights(name) for name in unittest.defaultTestLoader.getTestCaseNames(Insights) if name.startswith('test_insights_'))
    r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
