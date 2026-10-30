"""Authenticated app Home, mobile layout and local barcode reader; fake Google only."""
import importlib.util, json, unittest, tomllib
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('checkout_qa',Path(__file__).with_name('test-checkout.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
ROOT,ORIGIN=qa.qa.ROOT,qa.qa.ORIGIN
class Home(qa.Checkout):
    def relay(self,route):
        path=urlsplit(route.request.url).path
        if path in ['/home-dev.html','/home-dev.js','/home-dev.css','/account-menu.js','/account-menu.css','/notification-badge.js','/vendor/zxing-0.21.3.min.js']:
            headers={}
            for rule in tomllib.loads((ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,headers=headers,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],body=(ROOT/'dist'/path[1:]).read_bytes());return
        super().relay(route)
    def home(self):
        self.activate();self.local('/test/seed-checkout',{});self.page.goto(ORIGIN+'/home-dev.html');expect(self.page.locator('#home')).to_be_visible()
    def test_home_mobile_main_actions_fit_before_scroll_at_small_viewports(self):
        self.home()
        for width,height in [(320,480),(320,568),(360,640),(390,844),(1280,900)]:
            self.page.set_viewport_size({'width':width,'height':height})
            for selector in ['#new-purchase','#search-product']:
                box=self.page.locator(selector).bounding_box();self.assertGreaterEqual(box['y'],0);self.assertLessEqual(box['y']+box['height'],height);self.assertGreaterEqual(box['height'],48)
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        (ROOT/'work/qa-home').mkdir(exist_ok=True)
        self.page.screenshot(path=str(ROOT/'work/qa-home/home-desktop.png'),full_page=True)
        self.page.set_viewport_size({'width':360,'height':640})
        self.page.screenshot(path=str(ROOT/'work/qa-home/home-mobile.png'),full_page=True)
        self.assertEqual(self.errors,[])
    def test_home_collapsed_notification_counter_does_not_compete_with_entry(self):
        calls=[];self.page.on('request',lambda request:calls.append(urlsplit(request.url).path))
        self.home();self.page.wait_for_timeout(100)
        self.assertNotIn('/api/v1/notifications/summary',calls)

    def test_home_name_search_routes_purchase_and_catalog_without_creating_sale(self):
        self.home();self.page.locator('#new-purchase').click();expect(self.page.locator('#lookup-title')).to_have_text('Nova compra')
        self.page.locator('#search-name').click();expect(self.page.locator('#book-query')).to_be_focused();self.page.locator('#book-query').fill('Livro de teste do Caixa');self.page.get_by_role('button',name='Buscar livro',exact=True).click()
        expect(self.page.locator('#checkout')).to_be_visible();expect(self.page.locator('.book')).to_have_count(1);expect(self.page.locator('#query')).to_have_value('Livro de teste do Caixa');self.assertEqual(self.checkout_requests,0)
        self.page.goto(ORIGIN+'/home-dev.html');expect(self.page.locator('#home')).to_be_visible();self.page.locator('#search-product').click();self.page.locator('#search-name').click();self.page.locator('#book-query').fill('Livro de teste do Caixa');self.page.get_by_role('button',name='Buscar livro',exact=True).click()
        expect(self.page.locator('#catalog')).to_be_visible();expect(self.page.locator('.book')).to_have_count(1);self.assertEqual(self.checkout_requests,0);self.assertEqual(self.errors,[])
    def test_home_new_product_opens_real_editor_after_authorization(self):
        self.home();self.page.get_by_role('link',name='Adicionar novo produto').click();expect(self.page.locator('#editor')).to_be_visible();expect(self.page.locator('#title')).to_have_value('');self.assertEqual(self.errors,[])
    def test_home_camera_denied_keeps_manual_search_and_requests_only_on_click(self):
        self.page.add_init_script("""window.cameraCalls=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{cameraCalls++;throw new DOMException('Denied','NotAllowedError')}});""")
        self.home();self.assertEqual(self.page.evaluate('cameraCalls'),0);self.page.locator('#search-product').click();self.assertEqual(self.page.evaluate('cameraCalls'),0);self.page.locator('#open-camera').click();expect(self.page.locator('#lookup-status')).to_contain_text('Confira a permissão');expect(self.page.locator('#book-query')).to_be_visible();self.assertEqual(self.page.evaluate('cameraCalls'),1);self.page.keyboard.press('Escape');expect(self.page.locator('#lookup')).not_to_be_visible();self.assertEqual(self.errors,[])
    def test_home_late_camera_permission_is_stopped_after_dialog_closes(self):
        self.page.add_init_script("""window.stopped=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>new Promise(resolve=>{window.releaseCamera=()=>resolve({getTracks:()=>[{stop:()=>stopped++}]})})});""")
        self.home();self.page.locator('#new-purchase').click();self.page.locator('#open-camera').click();self.page.keyboard.press('Escape');self.page.evaluate('releaseCamera()');expect(self.page.locator('#lookup')).not_to_be_visible();self.page.wait_for_function('stopped===1');self.assertEqual(self.errors,[])
    def test_home_native_barcode_image_is_decoded_locally_and_searches_catalog(self):
        # A real EAN-13 drawn into a camera stream; the production ZXing decoder runs unchanged.
        self.home();self.page.evaluate("""() => {
          const code='9788543303932',L=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'],G=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'],R=L.map(x=>[...x].map(c=>c==='0'?'1':'0').join('')),parity='LGGLGL';
          let bits='101';for(let i=1;i<=6;i++)bits+=(parity[i-1]==='L'?L:G)[+code[i]];bits+='01010';for(let i=7;i<13;i++)bits+=R[+code[i]];bits+='101';
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,360);ctx.fillStyle='black';[...bits].forEach((bit,i)=>{if(bit==='1')ctx.fillRect(130+i*4,50,4,260)});
          window.fixtureStream=canvas.captureStream(5);window.fixtureTracks=fixtureStream.getTracks();Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>fixtureStream});window.fixturePaint=setInterval(()=>ctx.fillRect(0,0,1,1),100);
        }""")
        self.page.locator('#search-product').click();self.page.locator('#open-camera').click();expect(self.page).to_have_url(ORIGIN+'/catalogo-dev.html?q=9788543303932',timeout=15000);self.assertEqual(self.checkout_requests,0);self.assertEqual(self.errors,[])
    def test_home_no_session_or_wrong_role_keeps_actions_closed(self):
        self.page.goto(ORIGIN+'/home-dev.html');expect(self.page.locator('#sign-in')).to_be_visible();expect(self.page.locator('#home')).to_be_hidden()
        self.page.route(ORIGIN+'/api/v1/session',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps({'data':{'user':{'role':'GUEST'}}})))
        self.page.reload();expect(self.page.locator('#retry')).to_be_visible();expect(self.page.locator('#home')).to_be_hidden();self.assertEqual(self.errors,[])
    def test_home_public_entry_has_no_account_menu_or_notification_requests(self):
        requests=[]
        self.page.on('request',lambda request:requests.append(urlsplit(request.url).path))
        self.page.set_viewport_size({'width':390,'height':844})
        self.page.goto(ORIGIN+'/home-dev.html')
        expect(self.page.locator('#sign-in')).to_be_visible()
        expect(self.page.locator('#status')).to_have_text('Entre na sua conta para abrir a livraria.')
        expect(self.page.locator('#account-navigation')).to_be_hidden()
        expect(self.page.locator('.account-menu')).to_have_count(0)
        self.assertNotIn('/account-menu.js',requests)
        self.assertNotIn('/notification-badge.js',requests)
        self.assertNotIn('/api/v1/notifications/summary',requests)
        for width,height in [(320,568),(390,844),(1440,960)]:
            self.page.set_viewport_size({'width':width,'height':height})
            box=self.page.locator('#sign-in').bounding_box()
            self.assertLessEqual(box['y']+box['height'],height)
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        (ROOT/'work/qa-welcome').mkdir(exist_ok=True)
        self.page.screenshot(path=str(ROOT/'work/qa-welcome/entry-desktop.png'),full_page=True)
        self.page.set_viewport_size({'width':390,'height':844})
        self.page.screenshot(path=str(ROOT/'work/qa-welcome/entry-mobile.png'),full_page=True)
        self.page.locator('#sign-in').focus();self.page.keyboard.press('Enter')
        expect(self.page).to_have_url(ORIGIN+'/acesso-dev.html#entrar')
        self.assertEqual(self.errors,[])
    def test_home_member_navigation_is_hidden_again_after_session_is_lost(self):
        self.home()
        expect(self.page.locator('#welcome')).to_be_hidden()
        expect(self.page.locator('#account-navigation')).to_be_visible()
        expect(self.page.locator('.account-menu')).to_be_visible()
        self.page.route(ORIGIN+'/api/v1/session',lambda route:route.fulfill(status=401,content_type='application/json',body='{}'))
        self.page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
        expect(self.page.locator('#welcome')).to_be_visible()
        expect(self.page.locator('#account-navigation')).to_be_hidden()
        expect(self.page.locator('#home')).to_be_hidden()
        self.assertEqual(self.errors,[])
    def test_home_default_biometric_entry_redirects_and_browser_back_keeps_the_session(self):
        self.activate();self.local('/test/seed-checkout',{});self.logout()
        self.page.goto(ORIGIN+'/acesso-dev.html#entrar')
        expect(self.page.locator('#login-email')).to_have_value('owner@example.invalid')
        native=[];self.page.expose_function("recordNative",lambda count,active:native.append((count,active)))
        self.page.evaluate("""() => {window.beforeNative=[];const fetch=window.fetch.bind(window);window.fetch=(url,options)=>{if(String(url).includes('/api/v1/access/'))beforeNative.push(String(url));return fetch(url,options)};const get=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=options=>{window.requestsBeforeNative=beforeNative.length;window.activeAtNative=navigator.userActivation.isActive;window.recordNative(requestsBeforeNative,activeAtNative);return get(options)}}""")
        self.page.locator('#biometric-login').click()
        expect(self.page).to_have_url(ORIGIN+'/home-dev.html?entrada=confirmada')
        expect(self.page.locator('#home')).to_be_visible()
        self.assertEqual(native[0][0],0)
        self.assertTrue(native[0][1])
        self.page.goto(ORIGIN+'/catalogo-dev.html?novo=1');expect(self.page.locator('#editor')).to_be_visible()
        self.page.go_back();expect(self.page).to_have_url(ORIGIN+'/home-dev.html?entrada=confirmada');expect(self.page.locator('#home')).to_be_visible()
        self.page.goto(ORIGIN+'/acesso-dev.html#entrar');expect(self.page).to_have_url(ORIGIN+'/home-dev.html?entrada=confirmada');expect(self.page.locator('#home')).to_be_visible()
        self.assertEqual(self.errors,[])
    def test_home_top_right_management_menu_and_grouped_navigation_keep_roles(self):
        self.home();self.page.locator('.account-menu summary').click()
        expect(self.page.get_by_role('link',name='Meu perfil',exact=True)).to_be_visible()
        expect(self.page.get_by_role('link',name='Gerenciar equipe',exact=True)).to_be_visible()
        expect(self.page.get_by_role('link',name='Relatórios',exact=True)).to_be_visible()
        expect(self.page.locator('.other-actions').get_by_role('link',name='Gerenciar equipe')).to_have_count(0)
        self.page.get_by_text('Rotina',exact=True).click();expect(self.page.get_by_role('link',name='Histórico e operações')).to_be_visible()
        self.assertGreater(self.page.locator('#new-purchase svg').evaluate('el=>el.getBoundingClientRect().width'),self.page.locator('#new-purchase strong').evaluate('el=>parseFloat(getComputedStyle(el).fontSize)'))
        self.assertEqual(self.errors,[])

    def test_home_attendant_sees_both_main_actions_and_no_admin_links(self):
        self.home();self.page.route(ORIGIN+'/api/v1/session',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps({'data':{'user':{'role':'ATENDENTE'}}})))
        self.page.reload();expect(self.page.locator('#home')).to_be_visible();expect(self.page.locator('#new-purchase')).to_be_visible();expect(self.page.locator('#search-product')).to_be_visible();expect(self.page.get_by_role('link',name='Gerenciar equipe')).not_to_be_visible();self.assertEqual(self.errors,[])
if __name__=='__main__':
    suite=unittest.TestSuite(Home(name) for name in unittest.defaultTestLoader.getTestCaseNames(Home) if name.startswith('test_home_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
