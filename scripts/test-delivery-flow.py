"""Real Chromium, local signed backend/Google double, navigation and primary data."""
import importlib.util,unittest,json
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('profile_qa',Path(__file__).with_name('test-profile.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.qa.ROOT,qa.qa.ORIGIN
class Delivery(qa.Profile):
 def setUp(self):
  super().setUp();self.reads=[]
  self.page.on('request',lambda r:self.reads.append(urlsplit(r.url).path) if '/api/' in r.url else None)
 def relay(self,route):
  path=urlsplit(route.request.url).path
  file=ROOT/'dist'/path.lstrip('/')
  if not path.startswith('/api/') and file.is_file() and file.suffix in ['.html','.css','.js','.png']:
   route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'}[file.suffix],body=file.read_bytes());return
  super().relay(route)
 def menus(self):
  before=self.page.locator('[data-app-header]').bounding_box();self.reads.clear()
  for label in ['Catálogo','Rotina']:
   self.page.locator('header').get_by_text(label,exact=True).click();expect(self.page.locator('header .module-menu[open]')).to_have_count(1);self.assertEqual(self.page.locator('[data-app-header]').bounding_box(),before)
  self.page.locator('.account-menu summary').click();expect(self.page.locator('.account-menu')).to_have_attribute('open','');expect(self.page.locator('header .module-menu[open]')).to_have_count(0);self.assertEqual(self.page.locator('[data-app-header]').bounding_box(),before);self.assertEqual(self.reads,[])
 def test_delivery_primary_data_and_fixed_menu_across_real_navigation(self):
  self.activate();self.local('/test/enable-profile',{});self.local('/test/enable-notifications',{});self.local('/test/enable-email-change',{});self.local('/test/seed-checkout',{})
  self.page.goto(ORIGIN+'/home-dev.html');expect(self.page.locator('#home')).to_be_visible();self.menus();header=self.page.locator('[data-app-header]').bounding_box()
  self.page.locator('.account-menu').get_by_role('link',name='Meu perfil',exact=True).click();expect(self.page.locator('#profile')).to_be_visible();expect(self.page.locator('#email')).to_have_text('owner@example.invalid');expect(self.page.locator('#phone')).to_be_visible();self.assertNotIn('/api/v1/email-change/state',self.reads);self.menus();self.assertEqual(self.page.locator('[data-app-header]').bounding_box(),header)
  self.page.locator('header').get_by_text('Rotina',exact=True).click();self.page.locator('header .module-menu[open]').get_by_role('link',name='Notificações',exact=True).click();expect(self.page.locator('#notifications')).to_be_visible();self.assertIn('/api/v1/notifications/bootstrap',self.reads);self.menus();self.assertEqual(self.page.locator('[data-app-header]').bounding_box(),header)
  self.page.locator('header').get_by_text('Catálogo',exact=True).click();self.page.locator('header .module-menu[open]').get_by_role('link',name='Adicionar novo produto',exact=True).click();expect(self.page.locator('#editor')).to_be_visible();expect(self.page.locator('#title')).to_be_visible();self.page.keyboard.press('Escape');expect(self.page.locator('#editor')).to_be_hidden();self.menus();self.assertEqual(self.page.locator('[data-app-header]').bounding_box(),header);self.assertEqual(self.errors,[])
  target=ROOT/'work/qa-delivery';target.mkdir(exist_ok=True);self.page.screenshot(path=str(target/'catalog-header.png'),full_page=True)
 def test_delivery_mobile_header_is_stable_and_menu_does_not_query(self):
  self.activate();self.local('/test/enable-profile',{});self.page.set_viewport_size({'width':390,'height':844});self.page.goto(ORIGIN+'/meu-perfil-dev.html');expect(self.page.locator('#profile')).to_be_visible();self.menus();self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  self.page.evaluate('scrollTo(0,400)');self.assertEqual(self.page.locator('[data-app-header]').bounding_box()['y'],0);target=ROOT/'work/qa-delivery';target.mkdir(exist_ok=True);self.page.screenshot(path=str(target/'mobile-header.png'))
if __name__=='__main__':
 suite=unittest.TestSuite(Delivery(name) for name in Delivery.__dict__ if name.startswith('test_delivery_'));r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful() else 1)
