"""V16 browser regression tests. Network APIs and cameras are simulated unless noted."""
import io
import json
import os
from pathlib import Path
import unittest
from urllib.parse import urlsplit
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
DEV = 'https://dev--merry-chimera-49a1f3.netlify.app/'
PROD = 'https://merry-chimera-49a1f3.netlify.app/'
ISBN = '9780140328721'
SEED = '9786500000009'  # Valid EAN-13 already in the fictitious inventory.

def png(barcode=False):
    image = Image.new('RGB', (600, 260), 'white')
    if barcode:
        left = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
        even = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111']
        right = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100']
        parity = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'][int(SEED[0])]
        bits = '101' + ''.join((left if parity[i] == 'L' else even)[int(n)] for i,n in enumerate(SEED[1:7])) + '01010' + ''.join(right[int(n)] for n in SEED[7:]) + '101'
        draw = ImageDraw.Draw(image)
        for i,bit in enumerate(bits):
            if bit == '1': draw.rectangle((60+i*5,30,64+i*5,225), fill='black')
    else:
        ImageDraw.Draw(image).rectangle((50,50,550,210),fill='#0F3D2E')
    output = io.BytesIO(); image.save(output, format='PNG'); return output.getvalue()

class V16(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT/'index.html').read_text()
        library = Path(os.environ.get('ZXING_JS','/tmp/livraria-zxing-0.21.3.js'))
        if not library.is_file(): raise RuntimeError('Set ZXING_JS to the verified ZXing 0.21.3 UMD file; see tests/README.md')
        cls.library = library.read_bytes()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'), args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop()
    def setUp(self):
        self.context = self.browser.new_context(viewport={'width':1440,'height':1000},permissions=['camera'])
        self.page = self.context.new_page(); self.page.set_default_timeout(6000)
        self.errors = []; self.outgoing = []
        self.page.on('pageerror',lambda e:self.errors.append(str(e)))
        self.page.on('request',lambda r:self.outgoing.append((r.url,r.method)))
        self.page.route('**/*',self.route)
        self.page.goto(DEV,wait_until='load')
        self.login()
    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], 'Uncaught JavaScript errors')
    def route(self, route):
        url = route.request.url
        if route.request.resource_type == 'document': route.fulfill(status=200,content_type='text/html',body=self.source)
        elif (urlsplit(url).path == '/cover-references.js' or urlsplit(url).path.startswith('/covers/')) and urlsplit(url).hostname in [urlsplit(DEV).hostname,urlsplit(PROD).hostname]:
            asset=(ROOT/'dist'/urlsplit(url).path.lstrip('/')).resolve()
            if asset.is_relative_to((ROOT/'dist').resolve()) and asset.is_file():route.fulfill(status=200,content_type='application/javascript' if asset.suffix=='.js' else 'image/png',body=asset.read_bytes())
            else:route.fulfill(status=404,body='')
        elif 'cdn.jsdelivr.net/npm/@zxing/' in url: route.fulfill(status=200,content_type='application/javascript',body=self.library)
        else: route.fulfill(status=404,content_type='application/json',body='{}')
    def login(self,pin='1357'):
        self.page.locator('#demoPin').fill(pin); self.page.locator('#pinLoginButton').click()
        expect(self.page.locator('#pinGate')).to_be_hidden()
    def tab(self,name,mobile=False):
        self.page.locator(f'{".bottom-nav" if mobile else ".nav"} [data-tab="{name}"]').click()
    def camera(self,mode):
        if mode in ['pdv','catalogo','estoque']:
            self.tab(mode);self.page.get_by_role('button',name='📷 Câmera',exact=True).click()
        elif mode=='edicao':
            self.tab('estoque');self.page.get_by_role('button',name='📷 Bipar para editar um livro',exact=True).click()
        else:
            self.page.evaluate('UI.startNewBook()');self.page.get_by_role('button',name='Ler código pela câmera',exact=False).click()
        expect(self.page.locator('#demoBarcodeFile')).to_be_attached()
    def native_detector(self,value=SEED):
        self.page.evaluate('''code=>{window.BarcodeDetector=class {
          static async getSupportedFormats(){return ['ean_13'];}
          async detect(){return [{rawValue:code}];}
        };}''',value)
    def read_gallery(self,barcode=True):
        self.page.locator('#demoBarcodeFile').set_input_files({'name':'codigo.png','mimeType':'image/png','buffer':png(barcode)})
    def mock_books(self,scenario='secondary'):
        def handler(route):
            url=route.request.url
            if 'brasilapi.com.br' in url:
                data={'isbn':ISBN,'title':'Livro fictício de teste','authors':['Autor teste'],'publisher':'Editora teste','provider':'cbl','cover_url':'https://images.example/invalid.png' if scenario in ['invalid','secondary'] else 'https://images.example/primary.png' if scenario=='primary' else ''}
                if 'mercado-editorial' in url: data={'isbn':ISBN,'title':'Título Mercado','provider':'mercado-editorial','cover_url':'https://images.example/primary.png'} if scenario=='mercado' else {}
                if scenario in ['none','cover-only']: route.fulfill(status=404,body='{}');return
            elif 'googleapis.com' in url:
                if scenario=='429':route.fulfill(status=429,body='{}');return
                data={'items':[{'volumeInfo':{'title':'Título secundário','industryIdentifiers':[{'identifier':ISBN if scenario!='wrong-isbn' else '9780306406157'}],'imageLinks':{'thumbnail':'http://books.google.com/valid.png'}}}]} if scenario in ['secondary','wrong-isbn'] else {}
            elif 'api/books' in url and scenario=='open': data={'ISBN:'+ISBN:{'title':'Título Open','cover':{'large':'https://images.example/primary.png'}}}
            else: data={}
            route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
        self.page.route('https://brasilapi.com.br/**',handler)
        self.page.route('https://www.googleapis.com/**',handler)
        self.page.route('https://openlibrary.org/**',handler)
        def image(route):
            url=route.request.url
            valid = ('/primary.png' in url and scenario in ['primary','mercado','open']) or ('books.google.com/valid.png' in url) or ('covers.openlibrary.org' in url and scenario in ['429','cover-only'])
            route.fulfill(status=200 if valid else 404,content_type='image/png',body=png() if valid else b'')
        for pattern in ['https://images.example/**','https://books.google.com/**','https://covers.openlibrary.org/**']:
            self.page.route(pattern,image)
    def lookup(self,isbn=ISBN): return self.page.evaluate('isbn=>Bibliografia.consultar(isbn)',isbn)
    def fill_registration(self):
        form=self.page.locator('#modalRoot form')
        for name,value in [('titulo','Livro fictício integração'),('autor','Autor fictício'),('editora','Editora teste'),('fornecedor','Fornecedor teste'),('preco','39.90')]:
            form.locator(f'[name="{name}"]').fill(value)
        form.locator('[name="categoria"]').select_option(index=1)
        self.page.locator('#stockNichoToggle').click()
        self.page.locator('#stockNichoOptions input').nth(0).check()
        self.page.locator('#stockNichoOptions input').nth(1).check()
    def test_no_external_gallery_buttons(self):
        for tab in ['pdv','catalogo','estoque']:
            self.tab(tab)
            self.assertEqual(self.page.locator('button[onclick*="gallery"]').count(),0)
        self.page.evaluate('UI.startNewBook()')
        self.assertEqual(self.page.locator('[onclick*="UI.gallery"]').count(),0)
    def test_camera_auto_dispatch_all_origins(self):
        self.native_detector()
        for mode in ['pdv','catalogo','estoque','novoLivro','edicao']:
            with self.subTest(mode=mode):
                self.camera(mode)
                if mode=='pdv': self.page.wait_for_function('state.cart.some(p=>p.isbn===\''+SEED+'\')')
                elif mode=='catalogo': expect(self.page.locator('#modalRoot')).to_contain_text('Informações do livro')
                elif mode in ['estoque','novoLivro']: expect(self.page.locator('#modalRoot')).to_contain_text('Livro já cadastrado')
                else: expect(self.page.locator('#modalRoot')).to_contain_text('Dados editoriais')
                self.page.wait_for_function('!demoCam.active && demoCam.stream===null')
                self.page.evaluate('View.closeModal()')
        self.assertEqual(self.page.evaluate('state.cart.find(p=>p.isbn===\''+SEED+'\').quantidade'),1)
    def test_gallery_decodes_real_ean_with_zxing(self):
        self.page.evaluate('window.BarcodeDetector=undefined')
        for mode in ['pdv','catalogo','estoque','novoLivro','edicao']:
            with self.subTest(mode=mode):
                self.camera(mode);self.read_gallery()
                if mode=='pdv': self.page.wait_for_function('state.cart.some(p=>p.isbn===\''+SEED+'\')')
                elif mode=='catalogo': expect(self.page.locator('#modalRoot')).to_contain_text('Informações do livro')
                elif mode in ['estoque','novoLivro']: expect(self.page.locator('#modalRoot')).to_contain_text('Livro já cadastrado')
                else: expect(self.page.locator('#modalRoot')).to_contain_text('Dados editoriais')
                self.page.evaluate('View.closeModal()')
        self.assertEqual(self.page.evaluate('state.cart[0].quantidade'),1)
        self.assertFalse(any(method!='GET' for _,method in self.outgoing),'Image must not be uploaded')
    def test_gallery_unreadable_and_invalid_file(self):
        self.page.evaluate('window.BarcodeDetector=undefined');self.camera('pdv');self.read_gallery(False)
        expect(self.page.locator('#demoCamStatus')).to_contain_text('Nenhum código legível')
        self.assertEqual(self.page.evaluate('state.cart.length'),0)
        self.page.locator('#demoBarcodeFile').set_input_files({'name':'documento.pdf','mimeType':'application/pdf','buffer':b'not an image'})
        expect(self.page.locator('#demoCamStatus')).to_contain_text('Escolha uma imagem')
    def test_duplicate_callbacks_and_invalid_code(self):
        self.page.evaluate('UI.scanner("pdv",false)')
        self.page.evaluate('demoBarcodeFound("!", "pdv")')
        expect(self.page.locator('#demoCamStatus')).to_contain_text('Código não reconhecido')
        self.page.evaluate('code=>Promise.all([demoBarcodeFound(code,"pdv"),demoBarcodeFound(code,"pdv")])',SEED)
        self.assertEqual(self.page.evaluate('state.cart[0].quantidade'),1)
    def test_close_stops_tracks_and_late_results(self):
        self.page.evaluate('''()=>{window.BarcodeDetector=class {
         static async getSupportedFormats(){return ['ean_13'];}
         detect(){return new Promise(r=>window.lateDetect=r);}
        };const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia=async c=>{window.lastStream=await original(c);return window.lastStream;};}''')
        self.camera('pdv');self.page.wait_for_function('!!window.lateDetect')
        self.page.evaluate('View.closeModal()')
        self.page.evaluate('code=>window.lateDetect([{rawValue:code}])',SEED)
        self.assertEqual(self.page.evaluate('window.lastStream.getTracks().map(t=>t.readyState)'),['ended'])
        self.assertEqual(self.page.evaluate('state.cart.length'),0)
    def test_pending_camera_permission_and_modal_replacement(self):
        self.native_detector()
        self.page.evaluate('''()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
         navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.releaseCamera=async()=>{
          window.lastStream=await original({video:true});resolve(window.lastStream);
         });}''')
        self.camera('novoLivro');self.page.wait_for_function('!!window.releaseCamera')
        self.page.get_by_role('button',name='Voltar',exact=True).click()
        self.page.evaluate('window.releaseCamera()')
        self.page.wait_for_function('window.lastStream.getTracks().every(t=>t.readyState==="ended")')
        self.assertEqual(self.page.locator('#demoCamVideo').count(),0)
    def test_permission_denied_and_no_camera(self):
        for name,message in [('NotAllowedError','Permissão da câmera negada'),('NotFoundError','Nenhuma câmera encontrada')]:
            with self.subTest(error=name):
                self.native_detector();self.page.evaluate('name=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException("test",name);};}',name)
                self.camera('pdv');expect(self.page.locator('#demoCamStatus')).to_contain_text(message)
                expect(self.page.locator('.scanner-file-label')).to_have_text('Não tenho o livro — escolher foto da galeria')
                self.page.evaluate('View.closeModal()')
    def test_new_registration_from_camera_and_manual_scanner(self):
        self.mock_books('primary');self.native_detector(ISBN)
        self.camera('novoLivro')
        expect(self.page.locator('#stockTitle')).to_have_value('Livro fictício de teste')
        for name in ['titulo','autor','editora','fornecedor','edicao','preco','quantidade','categoria','anoPublicacao','numeroPaginas','descricao','capaUrl']:
            expect(self.page.locator('#modalRoot [name="'+name+'"]').first).to_be_editable()
        self.page.evaluate('View.closeModal();UI.scanner("catalogo",false)')
        self.page.locator('#modalRoot [name="isbn"]').fill(SEED)
        self.page.get_by_role('button',name='Usar código digitado',exact=True).click()
        expect(self.page.locator('#modalRoot')).to_contain_text('Informações do livro')
    def test_zxing_camera_close_and_gallery_in_mobile(self):
        self.page.set_viewport_size({'width':390,'height':844})
        self.page.evaluate('window.BarcodeDetector=undefined;UI.scanner("pdv")')
        self.page.wait_for_function('demoCam.stream && demoCam.reader')
        self.page.evaluate('window.streamBeforeClose=demoCam.stream;View.closeModal()')
        self.assertEqual(self.page.evaluate('streamBeforeClose.getTracks().map(t=>t.readyState)'),['ended'])
        self.page.evaluate('UI.scanner("pdv")');self.read_gallery()
        self.page.wait_for_function('state.cart.some(p=>p.isbn===\''+SEED+'\')')
        self.assertEqual(self.page.evaluate('state.cart[0].quantidade'),1)
    def test_all_secondary_sources_and_wrong_editions(self):
        for scenario,origin in [('mercado','Mercado Editorial'),('open','Open Library')]:
            with self.subTest(source=scenario):
                self.mock_books(scenario);data=self.lookup()['dados']
                self.assertEqual(data['titulo'],'Livro fictício de teste')
                self.assertIn(origin,data['capaFonte'])
        self.assertIsNone(self.page.evaluate('Bibliografia.normalizarGoogle({items:[{volumeInfo:{title:"Outra edição",industryIdentifiers:[{identifier:"9780306406157"}]}}]},"'+ISBN+'")'))
        self.assertIsNone(self.page.evaluate('Bibliografia.normalizarOpen(null,{title:"Outra edição",isbn_13:["9780306406157"],covers:[123]},"'+ISBN+'")'))
    def test_network_failure_does_not_block_manual_registration(self):
        self.mock_books('no-cover')
        self.page.route('https://www.googleapis.com/**',lambda r:r.abort('failed'))
        result=self.lookup()
        self.assertEqual(result['dados']['titulo'],'Livro fictício de teste')
        self.assertEqual(result['dados']['capaUrl'],'')
        self.assertIn('conexão/CORS',result['mensagem'])
    def test_edit_photo_origin_persists_and_invalid_url_feedback(self):
        self.page.evaluate('isbn=>View.modalEditMetadata(productOf(isbn))',SEED)
        self.page.locator('#modalRoot [name="capaUrl"]').fill('https://images.example/broken.png')
        self.page.get_by_role('button',name='Salvar alterações',exact=True).click()
        self.page.wait_for_function('!state.busy')
        expect(self.page.locator('#modalRoot [name="titulo"]')).to_be_visible()
        expect(self.page.locator('#toastbox')).to_contain_text('A capa não carregou')
        self.page.locator('#modalRoot [data-cover-gallery]').set_input_files({'name':'capa.png','mimeType':'image/png','buffer':png()})
        self.page.wait_for_function('document.querySelector("[name=capaLocal]").value.startsWith("data:image/jpeg")')
        self.page.get_by_role('button',name='Salvar alterações',exact=True).click()
        self.page.wait_for_function('!state.busy && document.querySelector("#modalRoot").innerHTML===""')
        self.assertEqual(self.page.evaluate('isbn=>productOf(isbn).capaFonte',SEED),'Foto manual')
        self.page.reload(wait_until='load');self.login()
        self.assertTrue(self.page.evaluate('isbn=>productOf(isbn).capaUrl.startsWith("data:image/jpeg")',SEED))
    def test_verified_editorial_cover_fallback(self):
        self.mock_books('none')
        url='https://www.mundocristao.com.br/wp-content/uploads/2021/12/Examinando-as-escrituras.png'
        self.page.route(url,lambda r:r.fulfill(status=200,content_type='image/png',body=png()))
        result=self.lookup('9788543303932')
        self.assertIn('/covers/9788543303932-',result['dados']['capaUrl'])
        self.assertIn('Mundo Cristão',result['dados']['capaFonte'])
        self.assertIn('cópia local',result['dados']['capaFonte'])
        self.assertEqual(result['dados']['titulo'],'Examinando as escrituras')
    def test_unavailable_editorial_cover_is_not_reported_as_valid(self):
        self.page.route('**/covers/**',lambda route:route.fulfill(status=404,body=''))
        self.mock_books('none')
        result=self.lookup('9788543303932')
        self.assertEqual(result['dados']['capaUrl'],'')
        self.assertEqual(result['dados']['capaFonte'],'')
        self.assertIn('nenhuma capa',result['mensagem'])
    def test_primary_cover(self):
        self.mock_books('primary');data=self.lookup()['dados']
        self.assertEqual(data['titulo'],'Livro fictício de teste')
        self.assertEqual(data['capaUrl'],'https://images.example/primary.png')
        self.assertIn('BrasilAPI',data['capaFonte'])
    def test_secondary_cover_and_metadata_preserved(self):
        self.mock_books('secondary');data=self.lookup()['dados']
        self.assertEqual(data['titulo'],'Livro fictício de teste')
        self.assertEqual(data['autor'],'Autor teste')
        self.assertEqual(data['capaUrl'],'https://books.google.com/valid.png')
        self.assertEqual(data['capaFonte'],'Google Books')
    def test_metadata_without_cover_and_invalid_images(self):
        for scenario in ['no-cover','invalid','wrong-isbn']:
            with self.subTest(scenario=scenario):
                self.mock_books(scenario);data=self.lookup()['dados']
                self.assertEqual(data['titulo'],'Livro fictício de teste');self.assertEqual(data['capaUrl'],'')
    def test_google_429_uses_covers_api(self):
        self.mock_books('429');res=self.lookup()
        self.assertIn('HTTP 429',res['mensagem']);self.assertIn('/b/isbn/'+ISBN,res['dados']['capaUrl'])
    def test_no_library_results_and_covers_only(self):
        self.mock_books('none');res=self.lookup('9780306406157');self.assertIsNone(res['dados'])
        self.mock_books('cover-only');res=self.lookup();self.assertEqual(res['dados']['titulo'],'')
        self.assertEqual(res['dados']['capaFonte'],'Open Library Covers (ISBN)')
    def test_form_manual_edits_not_overwritten_by_pending_lookup(self):
        self.mock_books('secondary')
        self.page.evaluate('''isbn=>{window.realLookup=Bibliografia.consultar.bind(Bibliografia);Bibliografia.consultar=()=>new Promise(r=>window.finishLookup=r);UI.openAutofillForm(isbn);}''',ISBN)
        self.page.get_by_role('button',name='Continuar preenchendo manualmente',exact=True).click()
        self.page.locator('#stockTitle').fill('Título editado manualmente')
        self.page.evaluate('window.finishLookup({dados:{titulo:"Título tardio",fontes:[]},mensagem:""})')
        expect(self.page.locator('#stockTitle')).to_have_value('Título editado manualmente')
    def test_registration_cover_persistence_and_displays(self):
        self.mock_books('secondary');self.page.evaluate('isbn=>UI.lookupNewBook(isbn)',ISBN)
        expect(self.page.locator('#stockTitle')).to_have_value('Livro fictício de teste')
        self.fill_registration()
        self.page.get_by_role('button',name='Salvar cadastro',exact=True).click()
        self.page.wait_for_function('!state.busy && state.data.produtos.some(p=>p.isbn===\''+ISBN+'\')')
        product=self.page.evaluate('isbn=>productOf(isbn)',ISBN)
        self.assertEqual(product['capaFonte'],'Google Books');self.assertEqual(len(product['nichos']),2)
        self.page.reload(wait_until='load');self.login()
        self.assertEqual(self.page.evaluate('isbn=>productOf(isbn).capaFonte',ISBN),'Google Books')
        for tab in ['pdv','catalogo','estoque']:
            self.tab(tab)
            if tab=='pdv': self.page.locator('#barcode').fill('Livro fictício integração')
            elif tab=='catalogo': self.page.locator('#catalogSearch').fill('Livro fictício integração')
            expect(self.page.locator('#mainArea img[src="https://books.google.com/valid.png"]').first).to_be_visible()
        self.page.evaluate('isbn=>View.modalCatalogBook(productOf(isbn))',ISBN)
        expect(self.page.locator('#modalRoot')).to_contain_text('Origem da capa: Google Books')
        self.page.evaluate('View.closeModal();UI.tab("pdv");Cart.add("'+ISBN+'")')
        expect(self.page.locator('#cartList img')).to_have_attribute('src','https://books.google.com/valid.png')
    def test_manual_cover_photo_and_internal_code(self):
        self.page.evaluate('UI.registerWithoutBarcode()');self.fill_registration()
        self.page.locator('#modalRoot [data-cover-gallery]').set_input_files({'name':'capa.png','mimeType':'image/png','buffer':png()})
        self.page.wait_for_function('document.querySelector("[name=capaLocal]").value.startsWith("data:image/jpeg")')
        self.page.get_by_role('button',name='Salvar cadastro',exact=True).click()
        self.page.wait_for_function('!state.busy && state.data.produtos.some(p=>p.semCodigo)')
        product=self.page.evaluate('state.data.produtos.find(p=>p.semCodigo)')
        self.assertTrue(product['isbn'].startswith('INT'));self.assertEqual(product['codigoBarras'],'')
        self.assertTrue(product['capaUrl'].startswith('data:image/jpeg'));self.assertEqual(product['capaFonte'],'Foto manual')
    def test_cover_camera_and_gallery_in_registration_and_editing(self):
        self.page.set_viewport_size({'width':390,'height':844})
        for editing in [False,True]:
            for source,button_name in [('camera','📷 Tirar foto da capa'),('gallery','🖼️ Escolher da galeria')]:
                with self.subTest(editing=editing,source=source):
                    if editing:
                        self.page.evaluate('isbn=>View.modalEditMetadata(productOf(isbn))',SEED)
                    else:
                        self.page.evaluate('UI.registerWithoutBarcode()');self.fill_registration()
                    camera=self.page.locator('#modalRoot [data-cover-camera]')
                    gallery=self.page.locator('#modalRoot [data-cover-gallery]')
                    expect(camera).to_have_attribute('capture','environment')
                    self.assertIsNone(gallery.get_attribute('capture'))
                    if source=='camera':
                        self.page.get_by_role('button',name=button_name,exact=True).click()
                        self.page.wait_for_function('document.querySelector("[data-cover-camera-panel] video").videoWidth>0 && document.querySelector("[data-cover-camera-panel] video").readyState>=2')
                        self.page.evaluate('window.lastCoverStream=UI.coverCameraStream')
                        self.page.get_by_role('button',name='Usar esta foto',exact=True).click()
                        self.page.wait_for_function('window.lastCoverStream.getTracks().every(t=>t.readyState==="ended")')
                    else:
                        with self.page.expect_file_chooser() as chooser:
                            self.page.get_by_role('button',name=button_name,exact=True).click()
                        self.assertIsNone(chooser.value.element.get_attribute('capture'))
                        chooser.value.set_files({'name':'capa.png','mimeType':'image/png','buffer':png()})
                    self.page.wait_for_function('document.querySelector("[name=capaLocal]").value.startsWith("data:image/jpeg")')
                    self.page.wait_for_function('document.querySelector("#modalRoot .cover-large img")?.complete && document.querySelector("#modalRoot .cover-large img").naturalWidth>0')
                    code=self.page.locator('#modalRoot [name="isbn"]').input_value()
                    self.page.get_by_role('button',name='Salvar alterações' if editing else 'Salvar cadastro',exact=True).click()
                    self.page.wait_for_function('!state.busy && document.querySelector("#modalRoot").innerHTML===""')
                    self.page.reload(wait_until='load');self.login()
                    product=self.page.evaluate('code=>productOf(code)',code)
                    self.assertTrue(product['capaUrl'].startswith('data:image/jpeg'))
                    self.assertEqual(product['capaFonte'],'Foto manual')
    def test_cover_camera_native_fallback_when_preview_is_unavailable(self):
        self.page.evaluate('UI.registerWithoutBarcode();navigator.mediaDevices.getUserMedia=undefined')
        with self.page.expect_file_chooser() as chooser:
            self.page.get_by_role('button',name='📷 Tirar foto da capa',exact=True).click()
        self.assertEqual(chooser.value.element.get_attribute('capture'),'environment')
        chooser.value.set_files({'name':'foto.jpg','mimeType':'image/png','buffer':png()})
        self.page.wait_for_function('document.querySelector("[name=capaLocal]").value.startsWith("data:image/jpeg")')
    def test_cover_camera_errors_preserve_form(self):
        for name,message in [('NotAllowedError','Permissão da câmera negada'),('NotFoundError','Nenhuma câmera encontrada')]:
            self.page.evaluate('UI.registerWithoutBarcode()')
            self.page.locator('#stockTitle').fill('Título digitado preservado')
            self.page.evaluate('name=>navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException("test",name)}',name)
            self.page.get_by_role('button',name='📷 Tirar foto da capa',exact=True).click()
            expect(self.page.locator('#toastbox')).to_contain_text(message)
            expect(self.page.locator('#stockTitle')).to_have_value('Título digitado preservado')
            self.assertIsNone(self.page.evaluate('UI.coverCameraStream'))
    def test_cover_camera_close_replacement_and_logout_stop_tracks(self):
        for action in ['UI.closeCoverCamera()','View.closeModal()','UI.registerWithoutBarcode()',"window.dispatchEvent(new Event('pagehide'))",'LoginUI.logout()']:
            with self.subTest(action=action):
                self.page.evaluate('UI.registerWithoutBarcode()')
                self.page.get_by_role('button',name='📷 Tirar foto da capa',exact=True).click()
                self.page.wait_for_function('UI.coverCameraStream!==null')
                self.page.evaluate('window.lastCoverStream=UI.coverCameraStream')
                self.page.evaluate(action)
                self.assertEqual(self.page.evaluate('lastCoverStream.getTracks().map(t=>t.readyState)'),['ended'])
    def test_cover_camera_permission_after_close_is_released(self):
        self.page.evaluate('''()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
         navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.releaseCoverCamera=async()=>{
          window.lateCoverStream=await original({video:true});resolve(window.lateCoverStream);
         });UI.registerWithoutBarcode();}''')
        self.page.get_by_role('button',name='📷 Tirar foto da capa',exact=True).click()
        self.page.wait_for_function('!!window.releaseCoverCamera')
        self.page.get_by_role('button',name='Fechar câmera',exact=True).click()
        self.page.evaluate('window.releaseCoverCamera()')
        self.page.wait_for_function('window.lateCoverStream.getTracks().every(t=>t.readyState==="ended")')
        self.assertIsNone(self.page.evaluate('UI.coverCameraStream'))
    def test_cover_capture_failure_recovers_with_gallery(self):
        self.page.evaluate('UI.registerWithoutBarcode()')
        self.page.locator('#stockTitle').fill('Título preservado')
        self.page.get_by_role('button',name='📷 Tirar foto da capa',exact=True).click()
        self.page.wait_for_function('document.querySelector("[data-cover-camera-panel] video").readyState>=2')
        self.page.evaluate('()=>{window.lastCoverStream=UI.coverCameraStream;HTMLCanvasElement.prototype.toBlob=()=>{throw Error("camera test failure")};}')
        self.page.get_by_role('button',name='Usar esta foto',exact=True).click()
        expect(self.page.locator('#toastbox')).to_contain_text('Não foi possível preparar a foto')
        expect(self.page.locator('#stockTitle')).to_have_value('Título preservado')
        self.page.locator('#modalRoot [data-cover-gallery]').set_input_files({'name':'capa.png','mimeType':'image/png','buffer':png()})
        self.page.wait_for_function('document.querySelector("[name=capaLocal]").value.startsWith("data:image/jpeg")')
        self.assertEqual(self.page.evaluate('lastCoverStream.getTracks().map(t=>t.readyState)'),['ended'])
    def test_cancel_cover_selection_preserves_existing_photo(self):
        self.page.evaluate('isbn=>View.modalEditMetadata(productOf(isbn))',SEED)
        self.page.locator('#modalRoot [data-cover-gallery]').set_input_files({'name':'capa.png','mimeType':'image/png','buffer':png()})
        self.page.wait_for_function('document.querySelector("[name=capaLocal]").value.startsWith("data:image/jpeg")')
        before=self.page.locator('#modalRoot [name="capaLocal"]').input_value()
        for source in ['camera','gallery']:
            self.page.locator('#modalRoot [data-cover-'+source+']').set_input_files([])
            self.assertEqual(self.page.locator('#modalRoot [name="capaLocal"]').input_value(),before)
    def test_cover_buttons_fit_narrow_mobile_screen(self):
        for width in [320,390]:
            self.page.set_viewport_size({'width':width,'height':844})
            self.page.evaluate('UI.registerWithoutBarcode()')
            for name in ['📷 Tirar foto da capa','🖼️ Escolher da galeria']:
                button=self.page.get_by_role('button',name=name,exact=True)
                button.scroll_into_view_if_needed();expect(button).to_be_visible()
                box=button.bounding_box()
                self.assertGreaterEqual(box['x'],0);self.assertLessEqual(box['x']+box['width'],width)
            self.page.evaluate('View.closeModal()')
    def test_mobile_regression_sale_cpf_filters_reports(self):
        self.page.set_viewport_size({'width':390,'height':844})
        self.tab('catalogo',True);self.page.locator('#catalogSearch').fill('Caminhos')
        expect(self.page.locator('#mainArea')).to_contain_text('Caminhos de Oração')
        self.page.locator('#advanced-btn-catalogo').click()
        self.page.locator('#adv-catalogo-estoque').select_option('disponivel')
        expect(self.page.locator('#advanced-catalogo')).to_be_visible()
        self.tab('estoque',True);self.page.locator('#stockBarcode').fill(SEED)
        self.page.get_by_role('button',name='Verificar',exact=True).click()
        self.page.locator('#modalRoot [name="quantidade"]').fill('2')
        before=self.page.evaluate('isbn=>productOf(isbn).estoque',SEED)
        self.page.get_by_role('button',name='➕ Adicionar estoque',exact=True).click()
        self.page.wait_for_function('!state.busy')
        self.assertEqual(self.page.evaluate('isbn=>productOf(isbn).estoque',SEED),before+2)
        self.tab('pdv',True);self.page.locator('#barcode').fill('Caminhos')
        self.page.get_by_role('button',name='+ Adicionar',exact=True).first.click()
        self.page.get_by_role('button',name='Aumentar quantidade',exact=True).click()
        self.page.get_by_role('button',name='Diminuir quantidade',exact=True).click()
        self.page.get_by_role('button',name='Finalizar venda →',exact=True).click()
        self.page.get_by_role('button',name='Mariana (já cadastrada)',exact=True).click()
        expect(self.page.locator('#checkoutForm [name="nome"]')).to_have_value('Mariana Costa')
        self.page.get_by_role('button',name='Confirmar venda →',exact=True).click()
        expect(self.page.get_by_role('heading',name='Venda confirmada!')).to_be_visible()
        self.page.wait_for_function('!state.busy');self.page.get_by_role('button',name='Nova venda',exact=True).click()
        self.page.evaluate('UI.tab("dashboard")');self.assertNotEqual(self.page.evaluate('state.tab'),'dashboard')
        self.page.get_by_role('button',name='Sair',exact=True).click();self.login('2468')
        self.page.get_by_role('button',name='🔎 Gerar relatório na tela',exact=True).click()
        expect(self.page.get_by_role('button',name='⬇ Exportar Excel (.xlsx)',exact=True)).to_be_enabled()
    def test_scanner_mobile_layout_and_gallery_button(self):
        for width in [320,390]:
            with self.subTest(width=width):
                self.page.set_viewport_size({'width':width,'height':844})
                self.page.evaluate('UI.scanner("pdv",false)')
                button=self.page.get_by_role('button',name='Não tenho o livro — escolher foto da galeria',exact=True)
                expect(button).to_be_visible()
                self.page.locator('#modalRoot .modal').evaluate('(el)=>el.scrollTop=0')
                heading=self.page.get_by_role('heading',name='📷 Ler código de barras',exact=True)
                self.assertTrue(heading.evaluate('(el)=>{const r=el.getBoundingClientRect();return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(".modal");}'))
                box=button.bounding_box()
                self.assertGreaterEqual(box['x'],0);self.assertLessEqual(box['x']+box['width'],width)
                with self.page.expect_file_chooser() as chooser: button.click()
                chooser.value.set_files({'name':'codigo.png','mimeType':'image/png','buffer':png(True)})
                self.page.wait_for_function('demoCam.accepted')
                self.page.evaluate('Cart.clear()')
    def test_badge_exclusive_to_dev(self):
        for url,shown in [(DEV,True),(PROD,False),('https://deploy-preview-2--merry-chimera-49a1f3.netlify.app/',False)]:
            with self.subTest(url=url):
                self.page.goto(url,wait_until='load')
                self.assertEqual(self.page.locator('#devEnvironmentBadge').evaluate('(el)=>!el.hidden'),shown)

if __name__=='__main__': unittest.main(verbosity=2)
