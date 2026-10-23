"""Hard cover checks: actual verified editorial PNG from dist, disposable data.
API replay/failures and manual photographs are explicit test fixtures.
"""
from pathlib import Path
import sys,json,unittest,time
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from test_v16 import V16,png,DEV
from playwright.sync_api import expect
REF=json.loads((ROOT/'data/editorial-covers.json').read_text())[0]
ARTIFACTS=Path('/workspace/qa-capas-hard');ARTIFACTS.mkdir(exist_ok=True)
class HardCovers(V16):
    @classmethod
    def setUpClass(cls):super().setUpClass();cls.source=(ROOT/'dist/index.html').read_text()
    def picture(self,locator):
        expect(locator).to_be_visible();self.assertTrue(locator.evaluate('(img)=>img.complete&&img.naturalWidth>0'))
    def cache_book(self,mobile=False):
        if mobile:self.page.set_viewport_size({'width':390,'height':844})
        self.mock_books('none');start=time.perf_counter();self.page.evaluate('UI.lookupNewBook("9788543303932")')
        expect(self.page.locator('#stockTitle')).to_have_value('Examinando as escrituras')
        image=self.page.locator('#stockCoverPreview img');self.picture(image)
        self.assertTrue(image.evaluate('(img)=>img.naturalWidth===660&&img.naturalHeight===1008'))
        self.assertEqual(image.get_attribute('src'),DEV.rstrip('/')+REF['path'])
        form=self.page.locator('#modalRoot form');form.locator('[name=fornecedor]').fill('Fornecedor fictício QA');form.locator('[name=preco]').fill('39.90');form.locator('[name=categoria]').select_option(index=1)
        self.page.locator('#stockNichoToggle').click();self.page.locator('#stockNichoOptions input').first.check()
        self.page.locator('#stockCoverPreview').scroll_into_view_if_needed();self.page.screenshot(path=str(ARTIFACTS/('formulario-mobile.png' if mobile else 'formulario.png')),full_page=True)
        self.page.get_by_role('button',name='Salvar cadastro',exact=True).click();self.page.wait_for_function('!state.busy && document.querySelector("#modalRoot").innerHTML===""')
        self.page.reload();self.login();self.tab('catalogo',mobile);self.page.locator('#catalogSearch').fill('Examinando')
        self.picture(self.page.locator('#mainArea img[src$="'+REF['path']+'"]').first)
        self.page.screenshot(path=str(ARTIFACTS/('catalogo-mobile.png' if mobile else 'catalogo.png')),full_page=True)
        self.page.evaluate('View.modalCatalogBook(productOf("9788543303932"))');self.picture(self.page.locator('#modalRoot img[src$="'+REF['path']+'"]').first)
        self.page.evaluate('View.closeModal();UI.tab("pdv");state.search="Examinando";View.resultsOnly();Cart.add("9788543303932")')
        self.picture(self.page.locator('#cartList img'));self.page.reload();self.login();self.picture(self.page.locator('#cartList img'))
        record=self.page.evaluate('productOf("9788543303932")');self.assertIn('cópia local',record['capaFonte'])
        self.assertFalse(any(url==REF['sourceUrl'] for url,_ in self.outgoing),'cached cover must not depend on publisher image requests')
        print(json.dumps({'case':'editorial-local-mobile' if mobile else 'editorial-local-desktop','workflowMs':round((time.perf_counter()-start)*1000),'imageWidth':660,'imageHeight':1008}),flush=True)
    def test_hard_real_editorial_image_form_catalog_details_checkout_and_reload(self):self.cache_book()
    def test_hard_real_editorial_mobile_image_and_cart_persistence(self):self.cache_book(True)
    def test_hard_existing_book_without_cover_can_find_and_save_verified_cover(self):
        self.page.evaluate('UI.useManualBook("9788543303932")');self.fill_registration();self.page.locator('#stockTitle').fill('Livro já cadastrado sem capa');self.page.get_by_role('button',name='Salvar cadastro',exact=True).click();self.page.wait_for_function('!state.busy&&document.querySelector("#modalRoot").innerHTML===""')
        self.assertEqual(self.page.evaluate('productOf("9788543303932").capaUrl'),'')
        before=self.page.evaluate('productOf("9788543303932").estoque');self.page.evaluate('View.modalEditMetadata(productOf("9788543303932"))')
        self.page.get_by_role('button',name='🔎 Buscar capa pelo ISBN',exact=True).click();self.picture(self.page.locator('#editCoverPreview img'))
        self.assertIn('/covers/9788543303932-',self.page.locator('[name=capaUrl]').input_value());expect(self.page.locator('[name=titulo]')).to_have_value('Livro já cadastrado sem capa')
        self.page.get_by_role('button',name='Salvar alterações',exact=True).click();self.page.wait_for_function('!state.busy&&document.querySelector("#modalRoot").innerHTML===""');self.page.reload();self.login()
        self.assertEqual(self.page.evaluate('productOf("9788543303932").estoque'),before);self.assertEqual(self.page.evaluate('state.data.produtos.filter(p=>p.isbn==="9788543303932").length'),1)
        self.page.evaluate('Cart.add("9788543303932")');self.picture(self.page.locator('#cartList img'))
    def test_hard_full_storage_keeps_previous_data_and_never_confirms_unsaved_photo(self):
        self.page.evaluate('UI.registerWithoutBarcode()');self.fill_registration();self.page.locator('#stockTitle').fill('Livro anterior preservado');self.page.get_by_role('button',name='Salvar cadastro',exact=True).click();self.page.wait_for_function('!state.busy&&document.querySelector("#modalRoot").innerHTML===""')
        original=self.page.evaluate('localStorage.getItem("livraria_igreja_dados_demo_v7")')
        self.page.evaluate('UI.registerWithoutBarcode()');self.fill_registration();self.page.locator('#stockTitle').fill('Nova foto com armazenamento cheio')
        self.page.locator('[data-cover-gallery]').set_input_files({'name':'manual-qa.png','mimeType':'image/png','buffer':png()});self.page.wait_for_function('document.querySelector("[name=capaLocal]").value.startsWith("data:image/jpeg")')
        self.page.evaluate('''()=>{const save=Storage.prototype.setItem;window.restoreStorage=()=>{Storage.prototype.setItem=save;};Storage.prototype.setItem=function(key,value){if(key==='livraria_igreja_dados_demo_v7')throw new DOMException('fixture quota','QuotaExceededError');return save.call(this,key,value);};}''')
        self.page.get_by_role('button',name='Salvar cadastro',exact=True).click();expect(self.page.locator('#toastbox')).to_contain_text('Não foi possível salvar');self.page.wait_for_function('!state.busy')
        self.assertEqual(self.page.evaluate('localStorage.getItem("livraria_igreja_dados_demo_v7")'),original);expect(self.page.locator('#stockTitle')).to_have_value('Nova foto com armazenamento cheio')
        self.assertFalse(self.page.evaluate('state.data.produtos.some(p=>p.titulo==="Nova foto com armazenamento cheio")'))
        self.page.evaluate('restoreStorage()');self.page.get_by_role('button',name='Salvar cadastro',exact=True).click();self.page.wait_for_function('!state.busy&&document.querySelector("#modalRoot").innerHTML===""')
        self.page.reload();self.login();self.assertEqual(self.page.evaluate('state.data.produtos.filter(p=>p.titulo==="Nova foto com armazenamento cheio").length'),1)
    def test_hard_corrupt_local_cover_is_rejected_without_fabricated_success(self):
        self.page.route('**/covers/**',lambda r:r.fulfill(status=200,content_type='image/png',body=b'<html>not an image</html>'));self.mock_books('none')
        result=self.lookup('9788543303932');self.assertEqual(result['dados']['capaUrl'],'');self.assertIn('nenhuma capa',result['mensagem'])
        self.page.evaluate('UI.registerWithoutBarcode()');expect(self.page.get_by_role('button',name='📷 Tirar foto da capa',exact=True)).to_be_visible();expect(self.page.get_by_role('button',name='🖼️ Escolher da galeria',exact=True)).to_be_visible()
    def test_hard_known_missing_cover_can_be_completed_by_camera_and_persisted(self):
        self.mock_books('none');record=json.loads((ROOT/'docs/evidencias-camera/fontes-9786589806691.json').read_text())[0]['data']
        self.page.route('https://brasilapi.com.br/api/isbn/v1/9786589806691?providers=cbl',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps(record)))
        self.page.evaluate('UI.lookupNewBook("9786589806691")');expect(self.page.locator('#stockTitle')).to_have_value('Mulher real');expect(self.page.locator('#stockCoverPreview img')).to_have_count(0)
        form=self.page.locator('#modalRoot form');form.locator('[name=fornecedor]').fill('Fornecedor fictício');form.locator('[name=preco]').fill('29.90');form.locator('[name=categoria]').select_option(index=1);self.page.locator('#stockNichoToggle').click();self.page.locator('#stockNichoOptions input').first.check()
        self.page.get_by_role('button',name='📷 Tirar foto da capa',exact=True).click();self.page.wait_for_function('document.querySelector("[data-cover-camera-panel] video").readyState>=2')
        self.page.get_by_role('button',name='Usar esta foto',exact=True).click();self.page.wait_for_function('document.querySelector("[name=capaLocal]").value.startsWith("data:image/jpeg")');self.picture(self.page.locator('#stockCoverPreview img'))
        self.page.get_by_role('button',name='Salvar cadastro',exact=True).click();self.page.wait_for_function('!state.busy&&document.querySelector("#modalRoot").innerHTML===""');self.page.reload();self.login()
        book=self.page.evaluate('productOf("9786589806691")');self.assertEqual(book['capaFonte'],'Foto manual');self.assertTrue(book['capaUrl'].startswith('data:image/jpeg'));self.page.evaluate('Cart.add("9786589806691")');self.picture(self.page.locator('#cartList img'))
    def test_hard_corrupt_gallery_upload_preserves_previous_photo(self):
        self.page.evaluate('UI.registerWithoutBarcode()');self.fill_registration();self.page.locator('[data-cover-gallery]').set_input_files({'name':'qa.png','mimeType':'image/png','buffer':png()});self.page.wait_for_function('document.querySelector("[name=capaLocal]").value.startsWith("data:image/jpeg")')
        previous=self.page.locator('[name=capaLocal]').input_value();self.page.locator('[data-cover-gallery]').set_input_files({'name':'bad.png','mimeType':'image/png','buffer':b'not an image'});expect(self.page.locator('#toastbox')).to_contain_text('Não foi possível usar esta foto');self.assertEqual(self.page.locator('[name=capaLocal]').input_value(),previous);self.picture(self.page.locator('#stockCoverPreview img'))
    def test_hard_camera_twenty_open_close_cycles_release_all_tracks(self):
        self.page.evaluate('UI.registerWithoutBarcode()');start=time.perf_counter()
        for _ in range(20):
            self.page.get_by_role('button',name='📷 Tirar foto da capa',exact=True).click();self.page.wait_for_function('UI.coverCameraStream!==null');self.page.evaluate('window.testCoverStream=UI.coverCameraStream;UI.closeCoverCamera()');self.assertTrue(self.page.evaluate('testCoverStream.getTracks().every(t=>t.readyState==="ended")'))
        print(json.dumps({'case':'20-camera-cycles','elapsedMs':round((time.perf_counter()-start)*1000)}),flush=True)
if __name__=='__main__':
    suite=unittest.TestSuite(HardCovers(name) for name in unittest.defaultTestLoader.getTestCaseNames(HardCovers) if name.startswith('test_hard_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
