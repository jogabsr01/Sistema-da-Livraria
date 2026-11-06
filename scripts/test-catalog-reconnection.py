"""Catalog reconnection and explicit recovery using disposable Google state.
Network signals, lost responses and delayed reads are deliberate fixtures.
"""
import importlib.util
import io
import json
from pathlib import Path
import unittest
from urllib.parse import urlsplit
from PIL import Image
from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stock_qa', Path(__file__).with_name('test-stock.py'))
qa = importlib.util.module_from_spec(spec); spec.loader.exec_module(qa)
ORIGIN = qa.qa.qa.ORIGIN


class CatalogReconnection(qa.Stock):
    def setUp(self):
        super().setUp()
        self.saves = []; self.removals = []; self.lose_save = False; self.lose_remove = False
        self.fail_list = False; self.hold_list = False; self.held = None
        self.deny_session = False; self.changed_account = False
        self.reject_save = None

    def relay(self, route):
        req = route.request; path = urlsplit(req.url).path
        headers = {k:v for k,v in req.all_headers().items() if k not in ['host','content-length']}
        if path in ['/api/v1/session','/api/v1/catalog/bootstrap'] and (self.deny_session or self.changed_account):
            if self.deny_session:
                route.fulfill(status=401, content_type='application/json', body=json.dumps({'error':{'code':'UNAUTHENTICATED'}})); return
            result = self.local(path+('?' + urlsplit(req.url).query if urlsplit(req.url).query else ''),headers=headers); body = json.loads(result['body'])
            body['data']['user']['id'] = '00000000-0000-4000-8000-000000000001'
            route.fulfill(status=result['status'],headers=result['headers'],body=json.dumps(body)); return
        if path in ['/api/v1/catalog/list','/api/v1/catalog/bootstrap']:
            if self.fail_list: route.abort(); return
            if self.hold_list:
                result = self.local(path+'?'+urlsplit(req.url).query,headers=headers)
                self.held = (route,result); return
        if path in ['/api/v1/catalog/save','/api/v1/catalog/remove']:
            (self.saves if path.endswith('/save') else self.removals).append(json.loads(req.post_data))
            if path.endswith('/save') and self.reject_save:
                code,status=self.reject_save; self.reject_save=None
                route.fulfill(status=status,content_type='application/json',body=json.dumps({'error':{'code':code}})); return
            result = self.local(path,body=req.post_data_buffer,headers=headers,method=req.method)
            if path.endswith('/save') and self.lose_save: self.lose_save=False; route.abort(); return
            if path.endswith('/remove') and self.lose_remove: self.lose_remove=False; route.abort(); return
            route.fulfill(status=result['status'],headers=result['headers'],body=result['body']); return
        super().relay(route)

    def network(self, connected):
        self.page.evaluate('''connected => {
          Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>connected});
          window.dispatchEvent(new Event(connected?'online':'offline'));
        }''',connected)

    def ready(self):
        expect(self.page.locator('[data-catalog-network]').first).to_have_attribute('data-state','ready')

    def new_book(self):
        self.activate(); self.catalog(); self.create(isbn='',cover='')

    def uncertain_book(self):
        self.new_book(); self.lose_save=True; self.page.locator('#save').click()
        expect(self.page.locator('#form-status')).to_contain_text('Não foi possível confirmar o resultado')

    def test_reconnection_preserves_unsent_book_and_never_sends_offline(self):
        self.new_book(); self.page.locator('#supplier').fill('Fornecedor de teste')
        self.network(False); expect(self.page.locator('#save')).to_be_disabled()
        self.page.locator('#title').fill('Rascunho preservado sem rede')
        self.page.locator('#book-form').dispatch_event('submit'); self.assertEqual(self.saves,[])
        self.network(True); self.ready()
        expect(self.page.locator('#title')).to_have_value('Rascunho preservado sem rede')
        expect(self.page.locator('#supplier')).to_have_value('Fornecedor de teste')
        self.save(); self.assertEqual(len(self.saves),1); self.assertEqual(self.local('/test/state')['products'],1)

    def test_reconnection_uncertain_save_is_immutable_and_requires_explicit_retry(self):
        self.uncertain_book(); original=self.saves[0]
        expect(self.page.locator('#title')).to_be_disabled(); expect(self.page.locator('#close')).to_be_disabled()
        self.page.keyboard.press('Escape'); expect(self.page.locator('#editor')).to_be_visible()
        # A DOM mutation cannot replace the in-memory immutable request.
        self.page.locator('#title').evaluate("el=>el.value='Conteúdo que não deve ser enviado'")
        self.network(False); self.network(True); self.ready()
        self.assertEqual(len(self.saves),1); self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[])
        self.save(); self.assertEqual(self.saves,[original,original])
        expect(self.page.locator('.book h2')).to_have_text(original['record']['title'])
        self.assertEqual(self.local('/test/state')['products'],1)

    def test_reconnection_rejection_allows_correction_but_does_not_discard_uncertain_request(self):
        self.new_book(); self.reject_save=('COVER_PHOTO_TOO_LARGE',413); self.page.locator('#save').click()
        expect(self.page.locator('#form-status')).to_contain_text('A foto não pôde ser salva')
        expect(self.page.locator('#title')).to_be_enabled()
        self.lose_save=True; self.page.locator('#title').fill('Livro confirmado sem resposta'); self.page.locator('#save').click()
        expect(self.page.locator('#form-status')).to_contain_text('Não foi possível confirmar o resultado')
        original=self.saves[1]; self.assertNotEqual(original['commandId'],self.saves[0]['commandId'])
        self.reject_save=('INVALID_PRODUCT',400); self.page.locator('#save').click()
        expect(self.page.locator('#form-status')).to_contain_text('Confira ISBN')
        expect(self.page.locator('#title')).to_be_disabled(); expect(self.page.locator('#close')).to_be_disabled()
        self.save(); self.assertEqual(self.saves[1:],[original,original,original])
        self.assertEqual(self.local('/test/state')['products'],1)

    def test_reconnection_uncertain_private_photo_reuses_same_bytes_without_storage(self):
        self.new_book(); image=io.BytesIO(); Image.new('RGB',(420,600),(32,103,71)).save(image,'PNG')
        self.page.locator('#photo-file').set_input_files({'name':'capa-teste.png','mimeType':'image/png','buffer':image.getvalue()})
        expect(self.page.locator('#photo-status')).to_contain_text('Foto pronta')
        self.lose_save=True; self.page.locator('#save').click()
        expect(self.page.locator('#form-status')).to_contain_text('Não foi possível confirmar o resultado')
        self.assertTrue(self.saves[0]['photo']); self.network(False); self.network(True); self.ready()
        self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[])
        self.assert_no_secrets_in_browser_storage()
        self.save(); self.assertEqual(self.saves[0],self.saves[1]); self.assertEqual(self.local('/test/state')['files'],1)

    def test_reconnection_stock_lost_response_keeps_command_and_does_not_repeat_units(self):
        self.prepare(); self.lose_receipt=True
        self.page.get_by_role('button',name='Adicionar unidades',exact=True).click()
        self.page.locator('#stock-quantity').fill('4'); self.page.locator('#stock-save').click()
        expect(self.page.locator('#stock-status')).to_contain_text('Não foi possível confirmar o resultado')
        stored=self.page.evaluate('sessionStorage.getItem(Object.keys(sessionStorage)[0])')
        self.network(False); expect(self.page.locator('#stock-save')).to_be_disabled()
        self.network(True); self.ready(); self.assertEqual(len(self.receipt_requests),1)
        self.assertEqual(self.page.evaluate('sessionStorage.getItem(Object.keys(sessionStorage)[0])'),stored)
        self.page.locator('#stock-save').click(); expect(self.page.locator('#stock-editor')).not_to_be_visible()
        self.assertEqual(self.receipt_requests[0],self.receipt_requests[1]); self.assertEqual(self.local('/test/checkout-state')['stock'],4)

    def test_reconnection_stock_form_does_not_create_pending_command_offline(self):
        self.prepare(); self.page.get_by_role('button',name='Adicionar unidades',exact=True).click()
        self.page.locator('#stock-quantity').fill('7'); self.network(False)
        self.page.locator('#stock-form').dispatch_event('submit')
        self.assertEqual(self.receipt_requests,[]); self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'),[])
        self.network(True); self.ready(); expect(self.page.locator('#stock-quantity')).to_have_value('7')
        self.page.locator('#stock-save').click(); expect(self.page.locator('#stock-editor')).not_to_be_visible()
        self.assertEqual(self.local('/test/checkout-state')['stock'],7)

    def test_reconnection_expired_session_preserves_stock_command_without_sending(self):
        self.prepare(); self.lose_receipt=True
        self.page.get_by_role('button',name='Adicionar unidades',exact=True).click(); self.page.locator('#stock-save').click()
        expect(self.page.locator('#stock-status')).to_contain_text('Não foi possível confirmar o resultado')
        stored=self.page.evaluate('sessionStorage.getItem(Object.keys(sessionStorage)[0])')
        self.network(False); self.deny_session=True; self.network(True)
        expect(self.page.locator('#status')).to_contain_text('Entre na sua conta')
        self.page.locator('#stock-save').click()
        expect(self.page.locator('#stock-status')).to_contain_text('Não foi possível confirmar o resultado')
        self.assertEqual(len(self.receipt_requests),1)
        self.assertEqual(self.page.evaluate('sessionStorage.getItem(Object.keys(sessionStorage)[0])'),stored)

    def test_reconnection_changed_account_cannot_retry_another_accounts_book(self):
        self.uncertain_book(); self.changed_account=True; self.network(False); self.network(True)
        expect(self.page.locator('#status')).to_contain_text('Entre na sua conta')
        self.page.locator('#save').click(); expect(self.page.locator('#form-status')).to_contain_text('Entre na sua conta')
        self.assertEqual(len(self.saves),1); expect(self.page.locator('#title')).to_be_disabled()
        self.changed_account=False; self.page.locator('#editor [data-catalog-refresh]').click(); self.ready(); self.save()
        self.assertEqual(self.saves[0],self.saves[1])

    def test_reconnection_old_list_response_cannot_unlock_after_network_change(self):
        self.prepare(); expect(self.page.locator('#refresh')).to_be_enabled(); self.hold_list=True; self.page.locator('#refresh').click()
        for _ in range(100):
            if self.held: break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held); self.network(False); self.network(True)
        self.fail_list=True; self.hold_list=False; route,result=self.held
        route.fulfill(status=result['status'],headers=result['headers'],body=result['body'])
        expect(self.page.locator('[data-catalog-network]').first).to_have_attribute('data-state','stale')
        expect(self.page.locator('#new')).to_be_disabled()

    def test_reconnection_lost_archive_response_can_be_checked_when_book_disappears(self):
        self.prepare(); baseline=self.local('/test/state')['logs']; self.lose_remove=True
        self.page.once('dialog',lambda dialog:dialog.accept()); self.page.get_by_role('button',name='Excluir livro',exact=True).click()
        expect(self.page.locator('#resume-archive')).to_be_visible(); self.network(False); self.network(True); self.ready()
        expect(self.page.locator('.book')).to_have_count(0); self.assertEqual(len(self.removals),1)
        self.page.locator('#resume-archive').click(); expect(self.page.locator('#resume-archive')).to_be_hidden()
        self.assertEqual(self.removals[0],self.removals[1]); self.assertEqual(self.local('/test/state')['products'],1)
        self.assertEqual(self.local('/test/state')['logs'],baseline+1)

    def test_reconnection_mobile_expiry_blocks_save_without_erasing_form(self):
        self.page.clock.install(); self.new_book(); self.page.locator('#supplier').fill('Fornecedor preservado')
        # Skip polling without a visibility event: expiry itself must lock the
        # page even when no background refresh or invalidation runs.
        self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})")
        self.page.clock.fast_forward(91000); expect(self.page.locator('#save')).to_be_disabled()
        expect(self.page.locator('#supplier')).to_have_value('Fornecedor preservado')
        self.network(False)
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        self.page.locator('#editor').evaluate('el=>el.scrollTop=0')
        self.page.screenshot(path=str(qa.qa.qa.ARTIFACTS/'catalogo-sem-conexao.png'),full_page=True)
        self.assertEqual(self.errors,[])

    def test_reconnection_boot_offline_resumes_without_reloading(self):
        self.activate(); self.page.add_init_script("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false})")
        self.page.goto(ORIGIN+'/catalogo-dev.html'); expect(self.page.locator('#status')).to_contain_text('Sem conexão')
        self.network(True); self.ready(); expect(self.page.locator('#catalog')).to_be_visible(); self.assertEqual(self.saves,[])

    def test_reconnection_other_terminal_edit_requires_explicit_conflict_review(self):
        self.prepare(); self.page.get_by_role('button',name='Detalhes e edição',exact=True).click()
        self.page.locator('#title').fill('Edição local ainda não enviada'); self.network(False)
        result=self.page.evaluate('''async()=>{
          const s=(await(await fetch('/api/v1/session')).json()).data;
          const list=(await(await fetch('/api/v1/catalog/list')).json()).data;
          const p=(await(await fetch('/api/v1/catalog/get?id='+list.products[0].id)).json()).data.product;
          const keys=['isbn','internalCode','title','author','publisher','edition','supplier','priceCents','minimumStock','category','coverUrl','year','pages','synopsis','nicheIds','active'];
          const record=Object.fromEntries(keys.map(k=>[k,p[k]]));record.title='Edição confirmada em outro terminal';
          return (await fetch('/api/v1/catalog/save',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},
            body:JSON.stringify({commandId:crypto.randomUUID(),id:p.id,expectedVersion:p.version,record})})).status;
        }''')
        self.assertEqual(result,200); self.network(True); self.ready()
        expect(self.page.locator('#title')).to_have_value('Edição local ainda não enviada')
        self.page.locator('#save').click(); expect(self.page.locator('#form-status')).to_contain_text('Outro acesso alterou')
        self.page.locator('#reload-book').click(); expect(self.page.locator('#title')).to_have_value('Edição confirmada em outro terminal')


if __name__ == '__main__':
    suite=unittest.TestSuite(CatalogReconnection(name) for name in unittest.defaultTestLoader.getTestCaseNames(CatalogReconnection) if name.startswith('test_reconnection_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
