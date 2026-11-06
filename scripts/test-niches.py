"""Niche administration and checkout cards against disposable Google state."""
import importlib.util,json,base64,unittest,tomllib,io
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
from PIL import Image
spec=importlib.util.spec_from_file_location('checkout_qa',Path(__file__).with_name('test-checkout.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.qa.ROOT,qa.qa.ORIGIN
class Niches(qa.Checkout):
    def setUp(self):
        super().setUp();self.lose_niche=False;self.niche_commands=[]
    def relay(self,route):
        req=route.request;path=urlsplit(req.url).path
        if path in ['/nichos-dev.html','/nichos-dev.js','/nichos-dev.css','/equipe-dev.css']:
            headers={}
            for rule in tomllib.loads((ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],headers=headers,body=(ROOT/'dist'/path[1:]).read_bytes());return
        if path.startswith('/api/v1/niches/'):
            headers={k:v for k,v in req.all_headers().items() if k not in ['host','content-length']};query=urlsplit(req.url).query;out=self.local(path+('?' + query if query else ''),body=req.post_data_buffer,headers=headers,method=req.method)
            if path.endswith('/save'):
                self.niche_commands.append(json.loads(req.post_data))
                if self.lose_niche:self.lose_niche=False;route.abort();return
            route.fulfill(status=out['status'],headers=out['headers'],body=base64.b64decode(out['bodyBase64']) if 'bodyBase64'in out else out['body']);return
        super().relay(route)
    def management(self):
        self.activate();self.local('/test/enable-niches',{});self.page.goto(ORIGIN+'/nichos-dev.html');expect(self.page.locator('.niche-card')).to_have_count(1)
    def fill_niche(self,name='Vida cristã'):
        self.page.locator('#new-niche').click();self.page.locator('#niche-name').fill(name);self.page.locator('#niche-description').fill('Leituras para cada dia');self.page.locator('#niche-order').fill('1')
    def save_niche(self):
        self.page.locator('#save-niche').click();expect(self.page.locator('#niche-editor')).not_to_be_visible()
    def test_niches_mobile_background_order_and_checkout_card_filter(self):
        self.management();self.fill_niche();photo=io.BytesIO();Image.new('RGB',(800,400),'#c8ae82').save(photo,format='JPEG');self.page.locator('#niche-image').set_input_files({'name':'fundo.jpg','mimeType':'image/jpeg','buffer':photo.getvalue()});expect(self.page.locator('#form-status')).to_contain_text('Imagem preparada');self.save_niche();expect(self.page.locator('.niche-card img')).to_have_count(1)
        self.local('/test/seed-checkout',{});self.page.goto(ORIGIN+'/caixa-dev.html');expect(self.page.locator('.cash-niche')).to_have_count(3);self.page.get_by_role('button',name='Vida cristã').click();expect(self.page.locator('.book')).to_have_count(0);self.page.get_by_role('button',name='Geral',exact=True).click();expect(self.page.locator('.book')).to_have_count(2);self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.errors,[])
        target=ROOT/'work/qa-niches';target.mkdir(parents=True,exist_ok=True);self.page.screenshot(path=str(target/'nichos-caixa-celular.png'),full_page=True)
    def test_niches_lost_ack_retries_same_command_without_duplicates(self):
        self.management();self.fill_niche();self.lose_niche=True;self.page.locator('#save-niche').click();expect(self.page.locator('#form-status')).to_contain_text('tente novamente');expect(self.page.locator('#niche-name')).to_be_disabled();self.page.locator('#save-niche').click();expect(self.page.locator('#niche-editor')).not_to_be_visible();self.assertEqual(self.niche_commands[0],self.niche_commands[1]);expect(self.page.locator('.niche-card')).to_have_count(2);self.assert_no_secrets_in_browser_storage()
    def test_niches_inactive_linked_book_remains_editable_and_multi_selection_is_preserved(self):
        self.management();self.fill_niche();self.save_niche();self.catalog();self.create(cover='');[box.check() for box in self.page.locator('#niche-choices input').all()];self.save();self.page.goto(ORIGIN+'/nichos-dev.html');card=self.page.locator('.niche-card').filter(has=self.page.get_by_role('heading',name='Vida cristã',exact=True));card.get_by_role('button').click();self.page.locator('#niche-active').uncheck();self.save_niche();expect(self.page.locator('.niche-card')).to_have_count(1)
        self.catalog();self.page.locator('.book').get_by_role('button',name='Detalhes e edição',exact=True).click();expect(self.page.locator('#niche-choices')).to_contain_text('Vida cristã (desativado)');self.assertEqual(self.page.locator('#niche-choices input:checked').count(),2);self.page.locator('#title').fill('Livro com vínculo preservado');self.save();expect(self.page.locator('.book')).to_contain_text('Livro com vínculo preservado');self.assertEqual(self.errors,[])
    def test_niches_focus_refreshes_catalog_choices_after_another_tab_creates_niche(self):
        self.management();self.catalog();expect(self.page.locator('#niche-filter option')).to_have_count(2);other=self.context.new_page();other.goto(ORIGIN+'/nichos-dev.html');expect(other.locator('#new-niche')).to_be_visible();other.locator('#new-niche').click();other.locator('#niche-name').fill('Estudos');other.locator('#save-niche').click();expect(other.locator('#niche-editor')).not_to_be_visible();self.page.evaluate("window.dispatchEvent(new Event('focus'))");expect(self.page.locator('#niche-filter option')).to_have_count(3);other.close();self.assertEqual(self.errors,[])
    def test_niches_attendant_has_no_administrative_actions_and_duplicates_keep_form(self):
        self.management();self.fill_niche('GERAL');self.page.locator('#save-niche').click();expect(self.page.locator('#form-status')).to_contain_text('Já existe');expect(self.page.locator('#niche-name')).to_be_enabled();self.page.locator('#cancel-editor').click();self.local('/test/set-role',{'role':'ATENDENTE'});self.page.reload();expect(self.page.locator('#new-niche')).to_be_hidden();expect(self.page.locator('#status')).to_contain_text('Apenas administradores');self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(Niches(name) for name in unittest.defaultTestLoader.getTestCaseNames(Niches) if name.startswith('test_niches_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
