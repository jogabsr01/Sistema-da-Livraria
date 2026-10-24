"""Commercial report UI with real XLSX download and disposable Google bookkeeping."""
import importlib.util,json,unittest,tomllib,base64,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('operations_qa',Path(__file__).with_name('test-operations.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.qa.qa.ROOT,qa.qa.qa.ORIGIN
class Reports(qa.Operations):
    def setUp(self):
        super().setUp();self.lose_report_export=False;self.report_exports=[]
    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        if path in ['/relatorios-dev.html','/relatorios-dev.js','/relatorios-dev.css','/account-menu.js','/account-menu.css']:
            headers={}
            for rule in tomllib.loads((ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],headers=headers,body=(ROOT/'dist'/path[1:]).read_bytes());return
        if path.startswith('/api/v1/reports/'):
            headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};out=self.local(path,body=req.post_data_buffer,headers=headers,method=req.method)
            if path.endswith('/export'):
                self.report_exports.append(json.loads(req.post_data))
                if self.lose_report_export:self.lose_report_export=False;route.abort();return
            route.fulfill(status=out['status'],headers=out['headers'],body=base64.b64decode(out['bodyBase64']) if 'bodyBase64' in out else out['body']);return
        super().relay(route)
    def reports(self):
        self.local('/test/enable-reports',{});self.page.goto(ORIGIN+'/relatorios-dev.html');expect(self.page.locator('#reports')).to_be_visible();expect(self.page.locator('#export-report')).to_be_hidden()
    def query(self):
        self.page.locator('#query-report').click();expect(self.page.locator('#query-report')).to_be_enabled();expect(self.page.locator('#status')).to_have_text('Relatório pronto para conferir.')
    def test_reports_mobile_sales_metrics_details_rankings_and_full_excel(self):
        self.checkout();self.add();self.confirm();self.reports();self.query();expect(self.page.locator('#metrics')).to_contain_text('R$ 32,90');expect(self.page.locator('.report-row')).to_have_count(1);expect(self.page.locator('#top-products')).to_contain_text('Livro de teste do Caixa');self.page.locator('.report-row button').click();expect(self.page.locator('#detail')).to_be_visible();expect(self.page.locator('#detail-content')).to_contain_text('Sem cadastro');expect(self.page.locator('#detail-content')).to_contain_text('R$ 32,90');self.page.locator('#close-detail').click()
        with self.page.expect_download() as out:self.page.locator('#export-report').click()
        z=zipfile.ZipFile(out.value.path());self.assertIsNone(z.testzip());ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};self.assertEqual(len(ET.fromstring(z.read('xl/workbook.xml')).findall('m:sheets/m:sheet',ns)),6);self.assertIn('<v>3290</v>',z.read('xl/worksheets/sheet2.xml').decode());self.assertEqual(self.local('/test/report-state'),{'views':1,'exports':1});self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));folder=ROOT/'work/qa-reports';folder.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(folder/'relatorios-celular.png'),full_page=True);self.assertEqual(self.errors,[])
    def test_reports_reversed_sale_is_visible_and_subtracted_from_net(self):
        self.operations();self.open_receipt();self.reverse();expect(self.page.locator('#receipt-title')).to_have_text('Venda cancelada');self.reports();self.query();expect(self.page.locator('.report-row')).to_contain_text('Estornada');expect(self.page.locator('.metric').first).to_contain_text('R$ 0,00');expect(self.page.locator('.metric').nth(2)).to_contain_text('R$ 32,90');expect(self.page.locator('#criteria')).to_contain_text('1 estornada');self.assertEqual(self.errors,[])
    def test_reports_stock_movement_filters_and_empty_selection(self):
        self.checkout();self.reports();self.page.locator('#kind').select_option('STOCK');self.query();expect(self.page.locator('.report-row')).to_have_count(2);self.page.locator('#advanced summary').first.click();self.page.locator('#stock').select_option('ZERO');expect(self.page.locator('#export-report')).to_be_disabled();self.query();expect(self.page.locator('.report-row')).to_have_count(1);expect(self.page.locator('.report-row')).to_contain_text('Livro sem estoque');self.page.locator('#query').fill('Produto inexistente');self.query();expect(self.page.locator('.report-row')).to_have_count(0);expect(self.page.locator('#rows')).to_contain_text('Nenhum registro');expect(self.page.locator('#export-report')).to_be_disabled();self.page.goto(ORIGIN+'/caixa-dev.html');self.add();self.confirm();self.reports();self.page.locator('#kind').select_option('MOVEMENTS');self.query();expect(self.page.locator('#metrics')).to_contain_text('Movimentações');expect(self.page.locator('.report-row')).to_have_count(1);expect(self.page.locator('.report-row')).to_contain_text('Saída por venda');self.assertEqual(self.errors,[])
    def test_reports_lost_export_ack_reuses_same_command_without_duplicate_audit(self):
        self.checkout();self.add();self.confirm();self.reports();self.query();self.lose_report_export=True;self.page.locator('#export-report').click();expect(self.page.locator('#retry-export')).to_be_enabled();expect(self.page.locator('#pending-export')).to_be_visible();self.assertEqual(self.local('/test/report-state')['exports'],1)
        with self.page.expect_download():self.page.locator('#retry-export').click()
        expect(self.page.locator('#pending-export')).to_be_hidden();self.assertEqual(self.report_exports[0],self.report_exports[1]);self.assertEqual(self.local('/test/report-state')['exports'],1);self.assertEqual(self.page.evaluate('Object.keys(localStorage)'),[]);self.assertEqual(self.errors,[])
    def test_reports_changed_stock_refuses_export_until_new_preview(self):
        self.checkout();self.add();self.confirm();self.reports();self.query();self.local('/test/checkout-price',{});self.page.locator('#export-report').click();expect(self.page.locator('#status')).to_contain_text('dados mudaram');expect(self.page.locator('#export-report')).to_be_hidden();self.query();expect(self.page.locator('#export-report')).to_be_visible();self.assertEqual(self.local('/test/report-state')['exports'],0);self.assertEqual(self.errors,[])
    def test_reports_identified_customer_cpf_city_and_payment_intersect_without_exporting_contacts(self):
        self.checkout();self.local('/test/enable-customers',{});self.page.reload();expect(self.page.locator('#customer-options')).to_be_visible();self.add();self.page.locator('#customer-identified').check();self.page.locator('#customer-search-cpf').fill('529.982.247-25');self.page.locator('#customer-search').click();expect(self.page.locator('#customer-new')).to_be_visible();self.page.locator('#customer-new').click();self.page.locator('#customer-name').fill('Cliente fictício do relatório');self.page.locator('#customer-email').fill('private@example.invalid');self.page.locator('#customer-editor summary').click();self.page.locator('#customer-city').fill('São Paulo');self.page.locator('#customer-state').fill('SP');self.page.locator('#customer-save').click();expect(self.page.locator('#customer-editor')).not_to_be_visible();self.confirm();self.reports();self.page.locator('#advanced summary').first.click();self.page.locator('#cpf').fill('529.982.247-25');self.page.locator('#city').fill('sao paulo');self.page.locator('#paymentMethod').select_option('PIX');self.query();expect(self.page.locator('.report-row')).to_have_count(1);expect(self.page.locator('.report-row')).to_contain_text('Cliente fictício do relatório');
        with self.page.expect_download() as out:self.page.locator('#export-report').click()
        z=zipfile.ZipFile(out.value.path());contents=''.join(z.read(n).decode() for n in z.namelist() if n.endswith('.xml'));self.assertNotIn('52998224725',contents);self.assertNotIn('529.982.247-25',contents);self.assertNotIn('private@example.invalid',contents);self.page.locator('#city').fill('Recife');self.query();expect(self.page.locator('.report-row')).to_have_count(0);self.assertEqual(self.errors,[])
    def test_reports_role_loss_clears_private_results_and_detail(self):
        self.checkout();self.add();self.confirm();self.reports();self.query();self.page.locator('.report-row button').click();expect(self.page.locator('#detail')).to_be_visible();self.local('/test/set-role',{'role':'ATENDENTE'});self.page.evaluate("window.dispatchEvent(new Event('focus'))");expect(self.page.locator('#reports')).to_be_hidden();expect(self.page.locator('#detail')).not_to_be_visible();expect(self.page.locator('#detail-content')).to_be_empty();expect(self.page.locator('.report-row')).to_have_count(0);self.page.reload();expect(self.page.locator('#access-help')).to_be_visible();self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(Reports(name) for name in unittest.defaultTestLoader.getTestCaseNames(Reports) if name.startswith('test_reports_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
