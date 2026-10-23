"""Real shared UI/cookies/WebAuthn, disposable local Google contract.
Cover responses are explicit PNG fixtures, not live editorial API results.
"""
import base64
import json
import importlib.util
import os
from pathlib import Path
import subprocess
import unittest
from urllib.parse import urlsplit
import tomllib
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('owner_access_qa',Path(__file__).with_name('test-owner-access.py'))
owner_qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(owner_qa)
OwnerAccess,ROOT,ORIGIN,ARTIFACTS=owner_qa.OwnerAccess,owner_qa.ROOT,owner_qa.ORIGIN,owner_qa.ARTIFACTS

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=')
class Catalog(OwnerAccess):
    def setUp(self):
        self.server=subprocess.Popen([os.environ.get('NODE','node'),'tests/helpers/catalog-harness.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        line=self.server.stdout.readline()
        if not line: raise RuntimeError(self.server.stderr.read())
        self.port=json.loads(line)['port'];self.corrupt_signature=False;self.fail_next_save_ack=False
        self.context=self.browser.new_context(viewport={'width':390,'height':844} if 'mobile' in self.id() else {'width':1280,'height':900},is_mobile='mobile' in self.id(),has_touch='mobile' in self.id())
        self.context.route('**/*',self.relay);self.page=self.context.new_page();self.errors=[];self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        self.cdp=self.context.new_cdp_session(self.page);self.cdp.send('WebAuthn.enable')
        self.authenticator=self.cdp.send('WebAuthn.addVirtualAuthenticator',{'options':{'protocol':'ctap2','transport':'internal','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})['authenticatorId']
    def relay(self,route):
        path=urlsplit(route.request.url).path
        if urlsplit(route.request.url).hostname=='covers.example.org':
            route.fulfill(status=404 if path=='/missing.png' else 200,content_type='image/png',body=b'' if path=='/missing.png' else PNG);return
        if path.startswith('/covers/') and urlsplit(route.request.url).hostname==urlsplit(ORIGIN).hostname:
            asset=(ROOT/'dist'/path.lstrip('/')).resolve()
            if asset.is_relative_to((ROOT/'dist/covers').resolve()) and asset.is_file():route.fulfill(status=200,content_type='image/png',body=asset.read_bytes())
            else:route.fulfill(status=404,body='')
            return
        if path in ['/catalogo-dev.html','/catalogo-dev.js','/catalogo-dev.css']:
            headers={}
            for rule in tomllib.loads((ROOT/'netlify.toml').read_text()).get('headers',[]):
                if rule['for']==path:headers.update(rule['values'])
            route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css'}[Path(path).suffix],headers=headers,body=(ROOT/'dist'/path[1:]).read_bytes());return
        if path.startswith('/api/v1/catalog/'):
            request=route.request;headers={key:value for key,value in request.all_headers().items() if key not in ['host','content-length']}
            query=urlsplit(request.url).query
            result=self.local(path+('?' + query if query else ''),body=request.post_data_buffer,headers=headers,method=request.method)
            if path=='/api/v1/catalog/save' and self.fail_next_save_ack:
                self.fail_next_save_ack=False;route.abort();return
            if result['cookies']:result['headers']['set-cookie']='\n'.join(result['cookies'])
            route.fulfill(status=result['status'],headers=result['headers'],body=result['body']);return
        super().relay(route)
    def catalog(self):
        self.page.goto(ORIGIN+'/catalogo-dev.html');expect(self.page.locator('#catalog')).to_be_visible()
    def create(self,title='Livro de teste compartilhado',isbn='9788543303932',cover='https://covers.example.org/test.png'):
        self.page.locator('#new').click();expect(self.page.locator('#editor')).to_be_visible()
        self.page.locator('#isbn').fill(isbn);self.page.locator('#title').fill(title);self.page.locator('#author').fill('Autor fictício')
        self.page.locator('#price').fill('32,90');self.page.locator('#cover').fill(cover);self.page.locator('#cover').dispatch_event('change')
    def save(self):
        self.page.locator('#save').click();expect(self.page.locator('#editor')).not_to_be_visible()
    def test_catalog_cover_loads_in_form_list_details_and_after_reload(self):
        self.activate();self.catalog();self.create()
        expect(self.page.locator('#cover-preview img')).to_be_visible()
        self.assertTrue(self.page.locator('#cover-preview img').evaluate('(img)=>img.complete && img.naturalWidth>0'))
        self.save();expect(self.page.locator('.book h2')).to_have_text('Livro de teste compartilhado')
        self.assertTrue(self.page.locator('.book img').evaluate('(img)=>img.complete && img.naturalWidth>0'))
        self.page.reload();expect(self.page.locator('.book h2')).to_have_text('Livro de teste compartilhado')
        self.page.get_by_role('button',name='Detalhes e edição').click();expect(self.page.locator('#cover')).to_have_value('https://covers.example.org/test.png')
        self.assertTrue(self.page.locator('#cover-preview img').evaluate('(img)=>img.complete && img.naturalWidth>0'))
        self.page.screenshot(path=str(ARTIFACTS/'catalogo-formulario.png'),full_page=True);self.assertEqual(self.errors,[])
    def test_catalog_two_browser_sessions_share_data_and_reject_stale_edits(self):
        self.activate();self.catalog();self.create();self.save()
        # Independent cookie jar and session, genuine signed login with a copied
        # virtual test credential (simulating a synchronized test passkey).
        other=self.browser.new_context();other.route('**/*',self.relay);page2=other.new_page();cdp=other.new_cdp_session(page2);cdp.send('WebAuthn.enable')
        auth=cdp.send('WebAuthn.addVirtualAuthenticator',{'options':{'protocol':'ctap2','transport':'internal','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})['authenticatorId']
        for key in self.cdp.send('WebAuthn.getCredentials',{'authenticatorId':self.authenticator})['credentials']:cdp.send('WebAuthn.addCredential',{'authenticatorId':auth,'credential':key})
        try:
            page2.goto(ORIGIN+'/acesso-dev.html');expect(page2.locator('#initial')).to_be_visible();page2.locator('#login-email').fill('owner@example.invalid');page2.locator('#login-pin').fill('8274')
            page2.get_by_role('button',name='Continuar com a passkey',exact=True).first.click();expect(page2.locator('#passkey')).to_be_visible();page2.locator('#passkey-button').click();expect(page2.locator('#complete')).to_be_visible()
            page2.goto(ORIGIN+'/catalogo-dev.html');expect(page2.locator('.book h2')).to_have_text('Livro de teste compartilhado')
            self.page.get_by_role('button',name='Detalhes e edição').click();page2.get_by_role('button',name='Detalhes e edição').click()
            self.page.locator('#title').fill('Alteração confirmada no primeiro acesso');self.save()
            page2.locator('#title').fill('Edição antiga do segundo acesso');page2.locator('#save').click();expect(page2.locator('#form-status')).to_contain_text('Outro acesso alterou este livro')
            page2.locator('#reload-book').click();expect(page2.locator('#title')).to_have_value('Alteração confirmada no primeiro acesso')
            self.assertEqual(self.local('/test/state')['products'],1)
        finally:other.close()
    def test_catalog_lost_response_retry_does_not_duplicate_manual_book(self):
        self.activate();self.catalog();self.create(isbn='');self.fail_next_save_ack=True
        self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_contain_text('Não foi possível confirmar o resultado')
        self.assertEqual(self.local('/test/state')['products'],1);self.save();self.assertEqual(self.local('/test/state')['products'],1)
    def test_catalog_google_projection_failure_is_recovered_by_retry(self):
        self.activate();self.catalog();self.create();self.local('/test/fault',{'stage':'product','after':True})
        self.page.locator('#save').click();expect(self.page.locator('#form-status')).to_contain_text('Não foi possível confirmar o resultado');self.save()
        self.assertEqual(self.local('/test/state')['products'],1)
    def test_catalog_mobile_search_and_broken_cover_preserve_book_metadata(self):
        self.activate();self.catalog();self.create(cover='https://covers.example.org/missing.png')
        expect(self.page.locator('#cover-preview')).to_contain_text('A imagem não carregou');self.save()
        expect(self.page.locator('.book h2')).to_have_text('Livro de teste compartilhado');expect(self.page.locator('.book img')).to_have_count(0)
        self.page.locator('#query').fill('Autor fictício');self.page.get_by_role('button',name='Pesquisar',exact=True).click();expect(self.page.locator('#count')).to_contain_text('1 livro(s)')
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
        self.page.screenshot(path=str(ARTIFACTS/'catalogo-celular.png'),full_page=True);self.assertEqual(self.errors,[])
    def test_catalog_disabled_or_unauthenticated_and_prod_have_no_write_form(self):
        self.page.goto(ORIGIN+'/catalogo-dev.html');expect(self.page.locator('#status')).to_contain_text('Entre na conta verificada');expect(self.page.locator('#catalog')).to_be_hidden()
        self.activate();self.local('/test/disable',{});self.page.goto(ORIGIN+'/catalogo-dev.html');expect(self.page.locator('#status')).to_contain_text('ainda não está disponível');expect(self.page.locator('#catalog')).to_be_hidden()
        self.page.goto('https://merry-chimera-49a1f3.netlify.app/catalogo-dev.html');expect(self.page.locator('#status')).to_contain_text('exclusivamente no endereço DEV');expect(self.page.locator('#catalog')).to_be_hidden()

if __name__=='__main__':
    suite=unittest.TestSuite(Catalog(name) for name in unittest.defaultTestLoader.getTestCaseNames(Catalog) if name.startswith('test_catalog_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
