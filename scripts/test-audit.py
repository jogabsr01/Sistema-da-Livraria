"""Audit consultation and real XLSX download with emulated Google storage."""
import importlib.util,json,unittest,tomllib,base64,io,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('catalog_qa',Path(__file__).with_name('test-catalog.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.ROOT,qa.ORIGIN
class Audit(qa.Catalog):
    def setUp(self):
        super().setUp();self.lose_export=False;self.export_commands=[]
    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        if path in ['/auditoria-dev.html','/auditoria-dev.js','/auditoria-dev.css','/equipe-dev.css','/account-menu.js','/account-menu.css']:
            headers={}
            for rule in tomllib.loads((ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],headers=headers,body=(ROOT/'dist'/path[1:]).read_bytes());return
        if path.startswith('/api/v1/audit/'):
            query=urlsplit(req.url).query;headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};out=self.local(path+('?' + query if query else ''),body=req.post_data_buffer,headers=headers,method=req.method)
            if req.method=='POST':
                self.export_commands.append(json.loads(req.post_data))
                if self.lose_export:self.lose_export=False;route.abort();return
            route.fulfill(status=out['status'],headers=out['headers'],body=base64.b64decode(out['bodyBase64']) if 'bodyBase64' in out else out['body']);return
        super().relay(route)
    def audit(self,count=30):
        self.activate();self.local('/test/enable-audit',{});self.ids=self.local('/test/audit-seed',{'count':count});self.page.goto(ORIGIN+'/auditoria-dev.html');expect(self.page.locator('#audit')).to_be_visible();expect(self.page.locator('.audit-record')).to_have_count(min(25,count+1))
    def apply(self):
        self.page.locator('#search').click();expect(self.page.locator('#search')).to_be_enabled()
    def test_audit_mobile_filters_private_details_and_real_excel_download(self):
        self.audit();self.page.locator('#operation').select_option('SALE_COMMITTED');expect(self.page.locator('#export-audit')).to_be_disabled();self.apply();expect(self.page.locator('.audit-record')).to_have_count(15);self.page.locator('.audit-record button').first.click();expect(self.page.locator('#detail')).to_be_visible();expect(self.page.locator('#detail-content')).to_contain_text('R$');expect(self.page.locator('#detail-content')).to_contain_text('=1+1 <Livro & ação> 😀');self.assertNotIn('TEST_SECRET_NOT_FOR_DISCLOSURE',self.page.content());self.assertNotIn('private@example.invalid',self.page.content());self.page.locator('#close-detail').click()
        with self.page.expect_download() as download_info:self.page.locator('#export-audit').click()
        download=download_info.value;self.assertTrue(download.suggested_filename.endswith('.xlsx'));z=zipfile.ZipFile(download.path());self.assertIsNone(z.testzip());ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};sheet=ET.fromstring(z.read('xl/worksheets/sheet1.xml'));self.assertEqual(len(sheet.findall('m:sheetData/m:row',ns)),16);self.assertNotIn(b'TEST_SECRET_NOT_FOR_DISCLOSURE',b''.join(z.read(n) for n in z.namelist()));self.assertNotIn('<f>',z.read('xl/worksheets/sheet2.xml').decode());self.assertEqual(self.local('/test/audit-state')['exports'],1);expect(self.page.locator('#status')).to_contain_text('Arquivo Excel preparado');self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));target=ROOT/'work/qa-audit';target.mkdir(parents=True,exist_ok=True);self.page.locator('#refresh').click();expect(self.page.locator('.audit-record')).to_have_count(15);self.page.screenshot(path=str(target/'auditoria-celular.png'),full_page=True);self.assertEqual(self.errors,[])
    def test_audit_lost_export_response_retries_same_command_and_logs_once(self):
        self.audit(4);self.lose_export=True;self.page.locator('#export-audit').click();expect(self.page.locator('#export-retry')).to_be_visible();expect(self.page.locator('#retry-export')).to_be_enabled();expect(self.page.locator('#from')).to_be_disabled();self.assertEqual(self.local('/test/audit-state')['exports'],1)
        with self.page.expect_download():self.page.locator('#retry-export').click()
        expect(self.page.locator('#export-retry')).to_be_hidden();self.assertEqual(self.export_commands[0],self.export_commands[1]);self.assertEqual(self.local('/test/audit-state')['exports'],1);self.assertEqual(self.page.evaluate('Object.keys(localStorage)'),[]);self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[]);self.assertEqual(self.errors,[])
    def test_audit_pagination_detects_new_records_and_requires_explicit_refresh(self):
        self.audit();expect(self.page.locator('#next')).to_be_visible();self.local('/test/audit-seed',{'count':1});self.page.locator('#next').click();expect(self.page.locator('#status')).to_contain_text('histórico mudou');expect(self.page.locator('.audit-record')).to_have_count(0);expect(self.page.locator('#export-audit')).to_be_hidden();self.page.locator('#refresh').click();expect(self.page.locator('.audit-record')).to_have_count(25);self.page.locator('#next').click();expect(self.page.locator('.audit-record')).to_have_count(7);self.page.locator('#previous').click();expect(self.page.locator('.audit-record')).to_have_count(25);self.assertEqual(self.errors,[])
    def test_audit_attendant_cannot_consult_and_privacy_clears_when_role_changes(self):
        self.audit(4);self.page.locator('.audit-record button').first.click();expect(self.page.locator('#detail')).to_be_visible();self.local('/test/set-role',{'role':'ATENDENTE'});self.page.evaluate("window.dispatchEvent(new Event('focus'))");expect(self.page.locator('#audit')).to_be_hidden();expect(self.page.locator('#detail')).not_to_be_visible();expect(self.page.locator('#detail-content')).to_be_empty();expect(self.page.locator('.audit-record')).to_have_count(0);expect(self.page.locator('#access-help')).to_be_visible();self.page.reload();expect(self.page.locator('#audit')).to_be_hidden();expect(self.page.locator('#access-help')).to_be_visible();self.assertEqual(self.errors,[])
    def test_audit_product_sale_result_intersection_and_empty_results(self):
        self.audit();self.page.locator('.extra-filters summary').click();self.page.locator('#product').fill(self.ids['productId']);self.page.locator('#sale').fill(self.ids['saleId']);self.page.locator('#result').select_option('NEGADO');self.apply();expect(self.page.locator('.audit-record')).to_have_count(15);self.page.locator('#product').fill('c4644e36-57a3-40c1-a223-c8a89132f8cc');self.apply();expect(self.page.locator('.audit-record')).to_have_count(0);expect(self.page.locator('#records')).to_contain_text('Nenhum registro');expect(self.page.locator('#export-audit')).to_be_disabled();self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(Audit(name) for name in unittest.defaultTestLoader.getTestCaseNames(Audit) if name.startswith('test_audit_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
