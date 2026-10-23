"""Actual shared form + authenticated handler + provider normalization.
Bibliographic APIs, remote images and Google/MailApp are explicit local doubles.
"""
import importlib.util
from pathlib import Path
import unittest
import io
from urllib.parse import urlsplit
from PIL import Image
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('catalog_qa',Path(__file__).with_name('test-catalog.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ISBN='9786589806691'
class SharedIsbn(qa.Catalog):
    def setUp(self):self.cover_mode='normal';super().setUp()
    def relay(self,route):
        url=urlsplit(route.request.url)
        if url.hostname in ['covers.example.org','books.google.com','covers.openlibrary.org','www.mundocristao.com.br']:
            valid=self.cover_mode=='normal' and url.hostname=='books.google.com' or self.cover_mode=='open' and url.hostname=='covers.openlibrary.org' or self.cover_mode=='editorial' and url.hostname=='www.mundocristao.com.br'
            if valid or self.cover_mode=='placeholder':
                output=io.BytesIO();Image.new('RGB',(1,1) if self.cover_mode=='placeholder' else (420,600),(25,102,72)).save(output,'PNG');route.fulfill(status=200,content_type='image/png',body=output.getvalue())
            else:route.fulfill(status=404,content_type='image/png',body=b'')
            return
        super().relay(route)
    def prepare(self,mode='normal'):
        self.activate();self.local('/test/lookup-mode',{'mode':mode});self.catalog();self.page.locator('#new').click();self.page.locator('#isbn').fill(ISBN)
    def lookup(self):self.page.locator('#isbn-lookup').click()
    def hold_lookup_delivery(self):
        # Delay only delivery of the actual authenticated fixture response,
        # so operators can edit/cancel without a synchronous Python relay race.
        self.page.evaluate("""()=>{const original=window.fetch;window.heldIsbn=[];window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/catalog/isbn'))return new Promise(resolve=>heldIsbn.push(()=>resolve(response)));return response;};window.releaseIsbn=()=>heldIsbn.splice(0).forEach(deliver=>deliver());}""")
    def held_lookup(self):
        self.lookup();self.page.wait_for_function('()=>heldIsbn.length===1')
    def release_lookup(self):
        self.page.evaluate('releaseIsbn()');self.page.wait_for_timeout(100)

    def test_isbn_falls_back_to_loaded_image_and_persists_metadata_and_cover(self):
        self.prepare();self.lookup();expect(self.page.locator('#isbn-status')).to_contain_text('Capa carregada: Google Books')
        expect(self.page.locator('#title')).to_have_value('Livro cristão fictício para QA');expect(self.page.locator('#edition')).to_have_value('2ª edição');expect(self.page.locator('#price')).to_have_value('')
        self.assertTrue(self.page.locator('#cover-preview img').evaluate('(img)=>img.complete&&img.naturalWidth>0'))
        self.page.locator('#cover-preview').scroll_into_view_if_needed();self.page.screenshot(path=str(qa.ARTIFACTS/'isbn-compartilhado-formulario.png'),full_page=True)
        self.page.locator('#price').fill('32,90');self.save();self.page.reload();expect(self.page.locator('.book h2')).to_have_text('Livro cristão fictício para QA')
        self.assertTrue(self.page.locator('.book img').evaluate('(img)=>img.complete&&img.naturalWidth>0'))
        self.page.get_by_role('button',name='Detalhes e edição').click();expect(self.page.locator('#cover')).to_have_value('https://books.google.com/fixture-cover.png');self.assertEqual(self.errors,[])
    def test_isbn_verified_editorial_candidate_loads_and_keeps_its_source_label(self):
        self.cover_mode='editorial';self.prepare('broken');self.page.locator('#isbn').fill('9788543303932');self.lookup();expect(self.page.locator('#isbn-status')).to_contain_text('Capa carregada: Referência editorial (Mundo Cristão)')
        self.assertTrue(self.page.locator('#cover-preview img').evaluate('(img)=>img.complete&&img.naturalWidth>0'));self.assertEqual(self.errors,[])
    def test_isbn_existing_book_title_and_cover_are_preserved(self):
        self.prepare();self.page.locator('#title').fill('Título conferido pelo operador');self.page.locator('#author').fill('Autor conferido');self.page.locator('#price').fill('39,90');self.page.locator('#cover').fill('https://books.google.com/fixture-cover.png');self.page.locator('#cover').dispatch_event('change');self.save()
        self.page.get_by_role('button',name='Detalhes e edição').click();self.lookup();expect(self.page.locator('#isbn-status')).to_contain_text('A capa existente foi preservada')
        expect(self.page.locator('#title')).to_have_value('Título conferido pelo operador');expect(self.page.locator('#author')).to_have_value('Autor conferido');expect(self.page.locator('#price')).to_have_value('39,90');expect(self.page.locator('#cover')).to_have_value('https://books.google.com/fixture-cover.png');self.save()
        self.assertEqual(self.local('/test/state')['products'],1);self.assertEqual(self.errors,[])
    def test_isbn_google_429_uses_open_covers_with_real_loaded_pixels_in_mobile(self):
        self.cover_mode='open';self.prepare('rate-limited');self.page.locator('#isbn').press('Enter')
        expect(self.page.locator('#isbn-status')).to_contain_text('Capa carregada: Open Library Covers (ISBN)');expect(self.page.locator('#isbn-status')).to_contain_text('Google Books: HTTP 429')
        self.assertTrue(self.page.locator('#cover-preview img').evaluate('(img)=>img.complete&&img.naturalWidth>0'))
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.errors,[])
    def test_isbn_no_cover_or_one_pixel_placeholder_keeps_metadata_and_allows_manual_save(self):
        self.cover_mode='placeholder';self.prepare('broken');self.lookup()
        expect(self.page.locator('#isbn-status')).to_contain_text('Nenhuma capa disponível carregou');expect(self.page.locator('#title')).to_have_value('Livro cristão fictício para QA');expect(self.page.locator('#cover')).to_have_value('');expect(self.page.locator('#cover-preview img')).to_have_count(0)
        self.page.locator('#price').fill('21,50');self.save();expect(self.page.locator('.book h2')).to_have_text('Livro cristão fictício para QA');self.assertEqual(self.errors,[])
    def test_isbn_manual_edits_during_query_and_existing_cover_are_preserved(self):
        self.prepare();self.hold_lookup_delivery();self.held_lookup();expect(self.page.locator('#isbn-status')).to_contain_text('Consultando')
        self.page.locator('#title').fill('Título escolhido pelo operador');self.page.locator('#price').fill('45,00');self.page.locator('#cover').fill('https://covers.example.org/manual.png');self.release_lookup()
        expect(self.page.locator('#isbn-status')).to_contain_text('Sugestões recebidas');expect(self.page.locator('#title')).to_have_value('Título escolhido pelo operador');expect(self.page.locator('#price')).to_have_value('45,00');expect(self.page.locator('#cover')).to_have_value('https://covers.example.org/manual.png')
        self.assertEqual(self.errors,[])
    def test_isbn_close_cancel_and_changed_code_discard_late_results(self):
        self.prepare();self.hold_lookup_delivery();self.held_lookup();self.page.locator('#close').click();self.page.locator('#new').click();self.release_lookup()
        expect(self.page.locator('#title')).to_have_value('')
        self.page.locator('#isbn').fill(ISBN);self.held_lookup();self.page.locator('#isbn-cancel').click();expect(self.page.locator('#isbn-status')).to_contain_text('Consulta cancelada');self.release_lookup()
        expect(self.page.locator('#title')).to_have_value('')
        self.held_lookup();self.page.locator('#isbn').fill('9788543303932');self.release_lookup()
        expect(self.page.locator('#title')).to_have_value('');expect(self.page.locator('#cover')).to_have_value('');self.assertEqual(self.local('/test/state')['products'],0);self.assertEqual(self.errors,[])
    def test_isbn_wrong_edition_invalid_code_and_disabled_lookup_preserve_manual_registration(self):
        self.cover_mode='broken';self.prepare('wrong');self.lookup();expect(self.page.locator('#isbn-status')).to_contain_text('Nenhuma ficha exata');expect(self.page.locator('#title')).to_have_value('')
        self.page.locator('#isbn').fill('9786589806692');self.lookup();expect(self.page.locator('#isbn-status')).to_contain_text('ISBN inválido')
        self.page.locator('#close').click();self.local('/test/disable-lookup',{});self.page.reload();expect(self.page.locator('#catalog')).to_be_visible();self.page.locator('#new').click();expect(self.page.locator('#isbn-tools')).to_be_hidden();expect(self.page.locator('#title')).to_be_editable();self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(SharedIsbn(name) for name in unittest.defaultTestLoader.getTestCaseNames(SharedIsbn) if name.startswith('test_isbn_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
