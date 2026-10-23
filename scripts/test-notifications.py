"""Stock alerts/report UI; real sessions/WebAuthn, emulated Google, no messages sent."""
import importlib.util
import json
from pathlib import Path
import tomllib
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect

spec=importlib.util.spec_from_file_location('stock_qa',Path(__file__).with_name('test-stock.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.qa.qa.ROOT,qa.qa.qa.ORIGIN


class Notifications(qa.Stock):
    def setUp(self):
        super().setUp();self.report_requests=[];self.inject_report=False

    def relay(self,route):
        request=route.request;path=urlsplit(request.url).path
        if path in ['/notificacoes-dev.html','/notificacoes-dev.js','/notificacoes-dev.css','/notification-badge.js']:
            headers={}
            for rule in tomllib.loads((ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],headers=headers,body=(ROOT/'dist'/path[1:]).read_bytes());return
        if path.startswith('/api/v1/notifications/'):
            query=urlsplit(request.url).query;headers={k:v for k,v in request.all_headers().items() if k not in ['host','content-length']}
            result=self.local(path+('?' + query if query else ''),body=request.post_data_buffer,headers=headers,method=request.method)
            if path.endswith('/report'):
                self.report_requests.append(json.loads(request.post_data))
                if self.inject_report and result['status']==200:
                    data=json.loads(result['body']);data['data']['groups'][0]['supplier']='+SUM(1,1)';data['data']['groups'][0]['items'][0]['title']='=HYPERLINK("https://example.org","click")';result['body']=json.dumps(data)
            route.fulfill(status=result['status'],headers=result['headers'],body=result['body']);return
        super().relay(route)

    def start(self):
        self.activate();self.local('/test/enable-notifications',{})

    def book(self,title='Livro esgotado',supplier='Fornecedor A',minimum=3):
        self.catalog();self.create(title=title,isbn='',cover='');self.page.locator('#supplier').fill(supplier);self.page.locator('#minimum-stock').fill(str(minimum));self.save()

    def notifications(self):
        self.page.goto(ORIGIN+'/notificacoes-dev.html');expect(self.page.locator('#notifications')).to_be_visible()

    def generate(self):
        self.page.locator('#generate').click();expect(self.page.locator('#report')).to_be_visible()

    def test_notifications_read_and_handling_are_distinct_and_replenishment_resolves(self):
        self.start();self.book();expect(self.page.locator('[data-notification-count]')).to_have_text('(1)')
        self.notifications();expect(self.page.locator('.alert')).to_have_count(1)
        self.page.get_by_role('button',name='Marcar como lida',exact=True).click();expect(self.page.locator('.alert')).to_contain_text('· Lida');expect(self.page.locator('.alert')).to_contain_text('Aberta')
        self.page.get_by_role('button',name='Marcar em atendimento',exact=True).click();expect(self.page.locator('.alert')).to_contain_text('Em atendimento')
        self.page.get_by_role('link',name='Adicionar unidades',exact=True).click();expect(self.page.locator('#stock-editor')).to_be_visible()
        self.page.locator('#stock-quantity').fill('3');self.page.locator('#stock-save').click();expect(self.page.locator('#stock-editor')).not_to_be_visible()
        self.notifications();expect(self.page.locator('.alert')).to_have_count(0)
        self.page.locator('#history').check();expect(self.page.locator('.alert')).to_contain_text('Resolvida');self.assertEqual(self.errors,[])

    def test_notifications_report_groups_suppliers_and_highlights_missing_supplier(self):
        self.start();self.book('Livro A','Fornecedor A',4);self.book('Livro B','Fornecedor B',0);self.book('Sem fornecedor','',2)
        self.notifications();self.generate();expect(self.page.locator('#report-summary')).to_contain_text('3 livro(s)')
        expect(self.page.locator('#supplier-warning')).to_contain_text('1 livro(s) sem fornecedor')
        self.assertEqual(self.page.locator('#report-groups tbody tr').count(),3)
        self.page.locator('#supplier').select_option(json.dumps('Fornecedor A'));self.generate()
        expect(self.page.locator('#report-summary')).to_contain_text('1 livro(s)');expect(self.page.locator('#report-groups')).to_contain_text('Livro A')
        expect(self.page.locator('#report-groups')).not_to_contain_text('Livro B');expect(self.page.locator('#report-groups tbody tr td').nth(1)).to_have_text('Fornecedor A')

    def test_notifications_csv_print_and_manual_copy_do_not_send_messages(self):
        self.start();self.book('Livro para repor','Distribuidora de teste',3);self.notifications();self.generate()
        with self.page.expect_download() as download:self.page.locator('#export').click()
        content=Path(download.value.path()).read_text(encoding='utf-8-sig')
        self.assertIn('"Livro para repor";"Distribuidora de teste"',content);self.assertIn('Quantidade sugerida',content)
        self.page.evaluate('() => { window.print=()=>{window.printed=true}; }');self.page.locator('#print').click();self.page.wait_for_function('() => window.printed===true')
        self.page.locator('#copy').click();expect(self.page.locator('#draft')).to_be_visible();expect(self.page.locator('#draft')).to_have_value(__import__('re').compile('Fornecedor: Distribuidora de teste'))
        expect(self.page.locator('#report-status')).to_contain_text('Nada foi enviado')
        self.assertEqual([r['format'] for r in self.report_requests],['view','csv','print','copy']);self.assertEqual(self.errors,[])

    def test_notifications_spreadsheet_formula_protection_and_plain_text_rendering(self):
        self.start();self.book('<img src=x onerror=window.pwned=true>','Fornecedor seguro',1);self.notifications();self.generate()
        expect(self.page.locator('#report-groups img')).to_have_count(0);self.assertIsNone(self.page.evaluate('window.pwned'))
        # Explicit client-side hostile-response fixture; not a Google record.
        self.inject_report=True
        with self.page.expect_download() as download:self.page.locator('#export').click()
        content=Path(download.value.path()).read_text(encoding='utf-8-sig');self.assertIn("'=HYPERLINK",content);self.assertIn("'+SUM",content)

    def test_notifications_attendant_reads_but_cannot_generate_reports_or_change_global_state(self):
        self.start();self.book();self.local('/test/set-role',{'role':'ATENDENTE'});self.notifications()
        expect(self.page.locator('#report-tools')).to_be_hidden();expect(self.page.get_by_role('button',name='Marcar em atendimento',exact=True)).to_have_count(0)
        self.page.get_by_role('button',name='Marcar como lida',exact=True).click();expect(self.page.locator('.alert')).to_contain_text('· Lida')
        result=self.page.evaluate('''async()=>{const s=await(await fetch('/api/v1/session')).json();const r=await fetch('/api/v1/notifications/report',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.data.csrfToken},body:JSON.stringify({scope:'zero',supplier:null,format:'csv'})});return r.status;}''')
        self.assertEqual(result,403)

    def test_notifications_mobile_layout_filter_and_missing_supplier(self):
        self.start();self.book('Livro sem fornecedor','',1);self.notifications();self.generate()
        self.page.locator('#supplier').select_option(json.dumps(''));self.generate();expect(self.page.locator('#report-groups')).to_contain_text('Fornecedor não informado')
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        self.page.screenshot(path=str(qa.qa.qa.ARTIFACTS/'notificacoes-reposicao-celular.png'),full_page=True);self.assertEqual(self.errors,[])

    def test_notifications_gates_and_production_remain_closed(self):
        self.page.goto(ORIGIN+'/notificacoes-dev.html');expect(self.page.locator('#notifications')).to_be_hidden()
        self.start();self.local('/test/disable-notifications',{});self.page.goto(ORIGIN+'/notificacoes-dev.html');expect(self.page.locator('#status')).to_contain_text('ainda não foram habilitadas')
        expect(self.page.locator('#report-tools')).to_be_hidden()
        self.page.goto('https://merry-chimera-49a1f3.netlify.app/notificacoes-dev.html');expect(self.page.locator('#status')).to_contain_text('exclusivamente no endereço DEV')


if __name__=='__main__':
    suite=unittest.TestSuite(Notifications(name) for name in unittest.defaultTestLoader.getTestCaseNames(Notifications) if name.startswith('test_notifications_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
