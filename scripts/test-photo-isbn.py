"""Combined ISBN/photo adversarial checks, disposable Google and API fixtures.
One scenario uploads the verified editorial PNG; synthetic camera is explicit.
No real Google IAM, shared writes or physical camera are exercised.
"""
import importlib.util,unittest,os,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
shared=module('isbn_qa','test-shared-isbn.py');photos=module('photos_qa','test-cover-photos.py')
class PhotoIsbn(shared.SharedIsbn):
    @classmethod
    def setUpClass(cls):
        cls.pw=sync_playwright().start();cls.browser=cls.pw.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--use-fake-device-for-media-stream']);shared.qa.ARTIFACTS.mkdir(parents=True,exist_ok=True)
    gallery=photos.Photos.gallery
    def complete(self):
        self.page.locator('#title').fill('Livro descartável de comparação');self.page.locator('#price').fill('25,00')
    def loaded(self):self.assertTrue(self.page.locator('#cover-preview img').evaluate('(img)=>img.complete&&img.naturalWidth>0'))
    def test_photo_isbn_unsaved_gallery_survives_subsequent_lookup_and_reload(self):
        self.prepare();self.gallery();self.lookup();expect(self.page.locator('#isbn-status')).to_contain_text('A capa existente foi preservada');expect(self.page.locator('#cover')).to_have_value('');self.loaded()
        self.page.locator('#price').fill('25,00');self.save();self.page.reload();expect(self.page.locator('.book img')).to_be_visible();self.assertTrue(self.page.locator('.book img').evaluate('(img)=>img.complete&&img.naturalWidth>0'));self.assertEqual(self.local('/test/state')['files'],1);self.assertEqual(self.errors,[])
    def test_photo_isbn_late_lookup_does_not_replace_gallery_photo(self):
        self.prepare();self.hold_lookup_delivery();self.held_lookup();self.gallery();src=self.page.locator('#cover-preview img').get_attribute('src');self.release_lookup()
        expect(self.page.locator('#cover')).to_have_value('');expect(self.page.locator('#cover-preview img')).to_have_attribute('src',src);expect(self.page.locator('#title')).to_have_value('');self.loaded();self.complete();self.save();self.assertEqual(self.local('/test/state')['files'],1);self.assertEqual(self.errors,[])
    def test_photo_isbn_real_editorial_photo_stays_private_and_preserved_during_lookup(self):
        self.prepare('broken');self.page.locator('#isbn').fill('9788543303932');self.page.locator('#photo-file').set_input_files(str(ROOT/'public/covers/9788543303932-f4aea498fff4b981.png'));expect(self.page.locator('#photo-status')).to_contain_text('Foto pronta');self.loaded();self.page.locator('#title').fill('Examinando as escrituras');self.page.locator('#price').fill('25,00')
        self.page.locator('#cover-preview').scroll_into_view_if_needed();self.page.screenshot(path=str(shared.qa.ARTIFACTS/'foto-editorial-privada-formulario.png'),full_page=True);self.save();self.page.reload();expect(self.page.locator('.book img')).to_be_visible();self.assertTrue(self.page.locator('.book img').evaluate('(img)=>img.complete&&img.naturalWidth>0&&img.src.includes("/api/v1/catalog/cover?id=")'));self.page.screenshot(path=str(shared.qa.ARTIFACTS/'foto-editorial-privada-catalogo.png'),full_page=True)
        self.page.get_by_role('button',name='Detalhes e edição').click();expect(self.page.locator('#editor')).to_be_visible();expect(self.page.locator('#cover-preview img')).to_have_attribute('src',re.compile(r'^/api/v1/catalog/cover\?id='));src=self.page.locator('#cover-preview img').get_attribute('src');self.lookup();expect(self.page.locator('#isbn-status')).to_contain_text('A capa existente foi preservada');expect(self.page.locator('#cover-preview img')).to_have_attribute('src',src);self.loaded();self.save();self.assertEqual(self.local('/test/state')['files'],1);self.assertEqual(self.errors,[])
    def test_photo_isbn_explicit_photo_removal_allows_automatic_replacement(self):
        self.prepare();self.gallery();self.complete();self.save();self.page.get_by_role('button',name='Detalhes e edição').click();self.page.locator('#photo-remove').click();self.lookup();expect(self.page.locator('#isbn-status')).to_contain_text('Capa carregada: Google Books');self.loaded();self.save();self.page.reload();expect(self.page.locator('.book img')).to_have_attribute('src','https://books.google.com/fixture-cover.png');self.assertEqual(self.local('/test/state')['files'],1);self.assertEqual(self.errors,[])
    def test_photo_isbn_camera_intent_cancels_late_lookup_and_pagehide_releases_camera(self):
        self.prepare();self.hold_lookup_delivery();self.held_lookup();self.context.grant_permissions(['camera'],origin=shared.qa.ORIGIN);self.page.locator('#camera-open').click();expect(self.page.locator('#photo-status')).to_contain_text('Posicione');self.page.evaluate('window.photoStream=document.querySelector("video").srcObject');self.release_lookup();expect(self.page.locator('#title')).to_have_value('');self.page.evaluate('window.dispatchEvent(new Event("pagehide"))');self.assertTrue(self.page.evaluate('photoStream.getTracks().every(t=>t.readyState==="ended")'));expect(self.page.locator('#camera-panel')).to_be_hidden();self.assertEqual(self.local('/test/state')['files'],0);self.assertEqual(self.errors,[])
    def test_photo_isbn_corrupt_gallery_preserves_existing_saved_photo(self):
        self.prepare();self.gallery();self.complete();self.save();self.page.get_by_role('button',name='Detalhes e edição').click();expect(self.page.locator('#editor')).to_be_visible();expect(self.page.locator('#cover-preview img')).to_have_attribute('src',re.compile(r'^/api/v1/catalog/cover\?id='));src=self.page.locator('#cover-preview img').get_attribute('src');self.page.locator('#photo-file').set_input_files({'name':'bad.png','mimeType':'image/png','buffer':b'broken fixture'});expect(self.page.locator('#photo-status')).to_contain_text('Não foi possível abrir');expect(self.page.locator('#cover-preview img')).to_have_attribute('src',src);self.loaded();self.save();self.assertEqual(self.local('/test/state')['files'],1);self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(PhotoIsbn(name) for name in unittest.defaultTestLoader.getTestCaseNames(PhotoIsbn) if name.startswith('test_photo_isbn_'));result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
