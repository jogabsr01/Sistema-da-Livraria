"""Shared app skin and mobile navigation across all DEV modules; no live services."""
import importlib.util, unittest, tomllib
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('home_qa',Path(__file__).with_name('test-home.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.ROOT,qa.ORIGIN
class AppDesign(qa.Home):
    def relay(self,route):
        path=urlsplit(route.request.url).path
        assets={('/'+p.name):p for p in (ROOT/'dist').iterdir() if p.is_file() and p.suffix in ['.html','.css','.js']}
        if path in assets:
            headers={}
            for rule in tomllib.loads((ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,headers=headers,content_type={'.html':'text/html','.css':'text/css','.js':'application/javascript'}[assets[path].suffix],body=assets[path].read_bytes());return
        super().relay(route)
    def test_design_mobile_every_module_loads_shared_skin_and_fits_navigation(self):
        self.page.set_viewport_size({'width':360,'height':640})
        pages=sorted(p.name for p in ROOT.glob('*-dev.html'))
        self.assertEqual(len(pages),14)
        for filename in pages:
            with self.subTest(page=filename):
                self.page.goto(ORIGIN+'/'+filename)
                expect(self.page.locator('body')).to_have_class(__import__('re').compile('app-shell'))
                self.page.wait_for_function("getComputedStyle(document.body).backgroundColor==='rgb(247, 245, 239)'")
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'),filename)
                if filename not in ['home-dev.html','acesso-dev.html']:
                    expect(self.page.get_by_role('link',name='Início',exact=True).first).to_have_attribute('href','/home-dev.html')
        self.assertEqual(self.errors,[])
    def test_design_lookup_keyboard_and_reduced_motion_keep_functional_actions(self):
        self.page.emulate_media(reduced_motion='reduce');self.home()
        self.page.locator('#new-purchase').focus();self.page.keyboard.press('Enter');expect(self.page.locator('#lookup')).to_be_visible();expect(self.page.locator('#open-camera')).to_be_focused();self.page.keyboard.press('Escape');expect(self.page.locator('#lookup')).not_to_be_visible();expect(self.page.locator('#new-purchase')).to_be_focused()
        self.assertEqual(self.page.locator('#new-purchase').evaluate("el=>getComputedStyle(el).transitionDuration"),'0s')
        self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(AppDesign(name) for name in unittest.defaultTestLoader.getTestCaseNames(AppDesign) if name.startswith('test_design_'))
    r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
