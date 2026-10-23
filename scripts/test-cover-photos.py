"""Camera uses Chromium's synthetic media device, gallery uses a generated image.
Actual UI/cookie/Sharp/JPEG proxy; Google and mail are disposable local doubles.
No claim of a real webcam, mobile hardware, Google IAM or editorial API result.
"""
import importlib.util
from pathlib import Path
import io
import unittest
import os
from PIL import Image
from playwright.sync_api import sync_playwright, expect
spec=importlib.util.spec_from_file_location('catalog_qa',Path(__file__).with_name('test-catalog.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
class Photos(qa.Catalog):
    @classmethod
    def setUpClass(cls):
        cls.pw=sync_playwright().start()
        cls.browser=cls.pw.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--use-fake-device-for-media-stream'])
        qa.ARTIFACTS.mkdir(parents=True,exist_ok=True)
    def gallery(self):
        data=io.BytesIO();Image.new('RGB',(420,600),(32,103,71)).save(data,'PNG')
        with self.page.expect_file_chooser() as chooser:self.page.locator('#gallery-open').click()
        chooser.value.set_files({'name':'capa-descartavel.png','mimeType':'image/png','buffer':data.getvalue()})
        expect(self.page.locator('#photo-status')).to_contain_text('Foto pronta')
        expect(self.page.locator('#cover-preview img')).to_be_visible()
        self.assertTrue(self.page.locator('#cover-preview img').evaluate('(img)=>img.complete&&img.naturalWidth>0'))
    def prepare(self):
        self.activate();self.catalog();self.create(cover='')
    def test_photos_gallery_persists_after_reload_and_metadata_edit(self):
        self.prepare();self.gallery();self.page.locator('#cover-preview').scroll_into_view_if_needed();self.page.screenshot(path=str(qa.ARTIFACTS/'foto-formulario.png'),full_page=True)
        self.save();expect(self.page.locator('.book img')).to_be_visible()
        self.assertTrue(self.page.locator('.book img').evaluate('(img)=>img.complete&&img.naturalWidth>0&&img.src.includes("/api/v1/catalog/cover?id=")'))
        self.page.reload();expect(self.page.locator('.book img')).to_be_visible();self.page.screenshot(path=str(qa.ARTIFACTS/'foto-catalogo.png'),full_page=True)
        self.page.get_by_role('button',name='Detalhes e edição').click();expect(self.page.locator('#cover-preview img')).to_be_visible()
        self.page.locator('#title').fill('Livro com foto preservada');self.save()
        self.assertEqual(self.local('/test/state')['files'],1);self.assertEqual(self.errors,[])
    def test_photos_mobile_camera_captures_stops_tracks_and_saves(self):
        self.prepare();self.context.grant_permissions(['camera'],origin=qa.ORIGIN)
        self.page.locator('#camera-open').click();expect(self.page.locator('#photo-status')).to_contain_text('Posicione a capa')
        self.page.evaluate('window.capturedStream=document.querySelector("video").srcObject')
        self.page.locator('#camera-capture').click();expect(self.page.locator('#photo-status')).to_contain_text('Foto pronta')
        self.assertTrue(self.page.evaluate('capturedStream.getTracks().every(track=>track.readyState==="ended")'))
        expect(self.page.locator('#camera-panel')).to_be_hidden();self.save();expect(self.page.locator('.book img')).to_be_visible()
        self.assertTrue(self.page.locator('.book img').evaluate('(img)=>img.complete&&img.naturalWidth>0'))
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'));self.assertEqual(self.errors,[])
        self.page.screenshot(path=str(qa.ARTIFACTS/'foto-camera-celular.png'),full_page=True)
    def test_photos_denied_camera_allows_gallery_and_discard_does_not_upload(self):
        self.prepare();self.page.locator('#camera-open').click();expect(self.page.locator('#photo-status')).to_contain_text('A câmera não está disponível')
        self.gallery();self.page.locator('#close').click();expect(self.page.locator('#editor')).not_to_be_visible();self.assertEqual(self.local('/test/state')['files'],0)
        self.page.locator('#new').click();expect(self.page.locator('#cover-preview img')).to_have_count(0);self.assertEqual(self.errors,[])
    def test_photos_late_camera_permission_after_close_stops_stream(self):
        self.prepare();self.context.grant_permissions(['camera'],origin=qa.ORIGIN)
        # Obtain a genuine synthetic MediaStream, then delay promise delivery to
        # reproduce the user's closing the dialog during the permission prompt.
        self.page.evaluate('''async()=>{window.lateStream=await navigator.mediaDevices.getUserMedia({video:true});navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.deliverCamera=()=>resolve(lateStream));}''')
        self.page.locator('#camera-open').click();expect(self.page.locator('#photo-status')).to_contain_text('Autorize')
        self.page.locator('#close').click();self.page.evaluate('deliverCamera()')
        self.page.wait_for_function('lateStream.getTracks().every(track=>track.readyState==="ended")')
        expect(self.page.locator('#camera-panel')).to_be_hidden();self.assertEqual(self.errors,[])
    def test_photos_lost_ack_retry_and_explicit_remove(self):
        self.prepare();self.gallery();self.fail_next_save_ack=True
        self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_contain_text('Não foi possível confirmar')
        self.save();self.assertEqual(self.local('/test/state')['files'],1);self.assertEqual(self.local('/test/state')['products'],1)
        self.page.get_by_role('button',name='Detalhes e edição').click();self.page.locator('#photo-remove').click();self.save();expect(self.page.locator('.book img')).to_have_count(0)
        self.page.reload();expect(self.page.locator('.book img')).to_have_count(0);self.assertEqual(self.local('/test/state')['files'],1);self.assertEqual(self.errors,[])
    def test_photos_disabled_controls_hidden_preserve_url_entry(self):
        self.activate();self.local('/test/disable-photos',{});self.catalog();self.create()
        expect(self.page.locator('#photo-controls')).to_be_hidden();expect(self.page.locator('#cover-preview img')).to_be_visible();self.save()
        expect(self.page.locator('.book img')).to_be_visible();self.assertEqual(self.local('/test/state')['files'],0);self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(Photos(name) for name in unittest.defaultTestLoader.getTestCaseNames(Photos) if name.startswith('test_photos_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
