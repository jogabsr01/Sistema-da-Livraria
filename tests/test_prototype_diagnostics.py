"""Browser integration: local RPC coexists with injected namespaces.
Injected hooks and errors are explicit fixtures, not the user's actual extension.
"""
from pathlib import Path
import unittest
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
DEV='https://dev--merry-chimera-49a1f3.netlify.app/'
class PrototypeDiagnostics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=(ROOT/'dist/index.html').read_text()
        cls.pw=sync_playwright().start();cls.browser=cls.pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    @classmethod
    def tearDownClass(cls):cls.browser.close();cls.pw.stop()
    def setUp(self):
        self.context=self.browser.new_context();self.page=self.context.new_page();self.errors=[]
        self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        self.page.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html',body=self.source) if route.request.resource_type=='document' else route.fulfill(status=404,body=''))
    def tearDown(self):self.context.close()
    def login(self,pin='1357'):
        self.page.locator('#demoPin').fill(pin);self.page.locator('#pinLoginButton').click();expect(self.page.locator('#pinGate')).to_be_hidden()
    def copy_report(self):
        self.page.evaluate('''()=>{window.copiedDiagnostic='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedDiagnostic=text;}}});}''')
        self.page.get_by_role('button',name='Copiar diagnóstico',exact=True).click()
        return self.page.evaluate('copiedDiagnostic')
    def test_existing_namespace_and_listener_hook_survive_both_logins(self):
        self.context.add_init_script('''window.google={browserHook:{listeners:[]},script:{run:{withSuccessHandler(){throw Error('EXTERNAL_RPC_MUST_NOT_BE_CALLED');}}}};window.originalGoogle=window.google;window.originalScript=window.google.script;setTimeout(()=>google.browserHook.listeners.push("test-listener"),250);''')
        self.page.goto(DEV)
        self.page.wait_for_function('google.browserHook.listeners.length===1')
        self.assertTrue(self.page.evaluate('google===originalGoogle&&google.script===originalScript&&google.browserHook.listeners.length===1'))
        self.login();self.page.get_by_role('button',name='Sair',exact=True).click();self.login('2468')
        self.assertEqual(self.errors,[]);expect(self.page.locator('#demoErrorBanner')).to_be_hidden()
    def test_readonly_namespace_does_not_block_prototype_or_local_save(self):
        self.context.add_init_script('''Object.defineProperty(window,'google',{value:Object.freeze({browserHook:Object.freeze({listeners:[]})}),writable:false,configurable:false});''')
        self.page.goto(DEV);self.login()
        # Actual local book write goes through the isolated dispatch, not an
        # injected google.script.run. No customer or sale data is used.
        self.page.evaluate('UI.registerWithoutBarcode()');form=self.page.locator('#modalRoot form')
        for name,value in [('titulo','Livro de teste de isolamento'),('autor','Autor fictício'),('editora','Editora fictícia'),('fornecedor','Fornecedor fictício'),('preco','24.90')]:form.locator(f'[name="{name}"]').fill(value)
        form.locator('[name="categoria"]').select_option(index=1)
        self.page.locator('#stockNichoToggle').click();self.page.locator('#stockNichoOptions input').first.check()
        form.locator('button[type="submit"]').click()
        expect(self.page.locator('#modalRoot form')).to_have_count(0)
        self.page.wait_for_function('state.data.produtos.some(p=>p.titulo==="Livro de teste de isolamento")')
        self.page.reload();self.login();self.page.wait_for_function('state.data.produtos.some(p=>p.titulo==="Livro de teste de isolamento")')
        self.assertEqual(self.errors,[]);expect(self.page.locator('#demoErrorBanner')).to_be_hidden()
    def test_plain_startup_does_not_create_global_google_and_preserves_existing_storage(self):
        self.context.add_init_script('localStorage.setItem("unrelated-test-record","keep-this-record")')
        self.page.goto(DEV);self.login();self.page.reload();self.login()
        self.assertFalse(self.page.evaluate('Object.hasOwn(window,"google")'))
        self.assertEqual(self.page.evaluate('localStorage.getItem("unrelated-test-record")'),'keep-this-record');self.assertEqual(self.errors,[])
    def test_external_listeners_failure_keeps_banner_and_records_file_line_stack_without_url_secret(self):
        self.page.goto(DEV);self.login()
        self.page.route('https://browser-tools.example.org/**',lambda route:route.fulfill(status=200,content_type='application/javascript',headers={'access-control-allow-origin':'*'},body='window.missingTestHook.listeners.push("x");'))
        self.page.evaluate('''()=>{const script=document.createElement('script');script.crossOrigin='anonymous';script.src='https://browser-tools.example.org/hook.js?credential=URL_SECRET_MUST_NOT_APPEAR#private';document.head.append(script);}''')
        expect(self.page.locator('#demoErrorBanner')).to_be_visible();expect(self.page.locator('[data-error-message]')).to_contain_text("reading 'listeners'")
        report=self.copy_report();self.assertIn('diagnóstico v2',report);self.assertIn('Outro script',report);self.assertIn('Arquivo: https://browser-tools.example.org/hook.js:1:',report);self.assertIn('Pilha: TypeError',report);self.assertNotIn('URL_SECRET_MUST_NOT_APPEAR',report)
        self.assertEqual(len(self.errors),1)
        # A diagnostic must not silently suppress an unknown external error.
        expect(self.page.locator('#demoErrorBanner')).to_be_visible()
    def test_application_error_and_rejected_promise_keep_original_stack(self):
        self.page.goto(DEV);self.login()
        self.page.evaluate('''()=>{window.dispatchEvent(new ErrorEvent('error',{error:new TypeError('APPLICATION_TEST_FAILURE'),filename:location.href,lineno:42,colno:7}));Promise.reject(new Error('ASYNC_TEST_FAILURE'));}''')
        expect(self.page.locator('[data-error-message]')).to_contain_text('ASYNC_TEST_FAILURE')
        report=self.copy_report();self.assertIn('Página do protótipo',report);self.assertIn('APPLICATION_TEST_FAILURE',report);self.assertIn(':42:7',report);self.assertIn('Pilha: Error: ASYNC_TEST_FAILURE',report)
if __name__=='__main__':unittest.main(verbosity=2)
