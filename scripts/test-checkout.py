"""Browser checkout, real session/WebAuthn code, disposable Google contract.
No remote Google, physical devices or payment provider are exercised.
"""
import importlib.util
import json
from pathlib import Path
import tomllib
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location('catalog_qa', Path(__file__).with_name('test-catalog.py'))
qa = importlib.util.module_from_spec(spec); spec.loader.exec_module(qa)


class Checkout(qa.Catalog):
    def setUp(self):
        super().setUp(); self.lose_checkout_response = False; self.offline_checkout = False; self.last_command = None
        self.checkout_requests = 0; self.fail_stock = False; self.hold_stock = False; self.held_stock = None; self.deny_session = False; self.fail_detail = False

    def relay(self, route):
        request = route.request; path = urlsplit(request.url).path
        if path == '/api/v1/catalog/get' and self.fail_detail: route.abort(); return
        if path in ['/api/v1/session','/api/v1/catalog/bootstrap'] and self.deny_session:
            route.fulfill(status=401, content_type='application/json', body=json.dumps({'error':{'code':'UNAUTHENTICATED'}})); return
        if path in ['/api/v1/catalog/list','/api/v1/catalog/bootstrap']:
            if self.fail_stock: route.abort(); return
            if self.hold_stock:
                headers = {k:v for k,v in request.all_headers().items() if k not in ['host','content-length']}
                result = self.local(path+'?'+urlsplit(request.url).query, headers=headers, method=request.method)
                self.held_stock = (route, result); return
        if path in ['/caixa-dev.html', '/caixa-dev.js', '/caixa-dev.css']:
            headers = {}
            for rule in tomllib.loads((qa.ROOT / 'netlify.toml').read_text()).get('headers', []):
                if rule['for'] == path: headers.update(rule['values'])
            route.fulfill(status=200, content_type={'.html':'text/html', '.js':'application/javascript', '.css':'text/css'}[Path(path).suffix], headers=headers, body=(qa.ROOT / 'dist' / path[1:]).read_bytes()); return
        if path == '/api/v1/checkout':
            self.checkout_requests += 1
            self.last_command = json.loads(request.post_data)
            if self.offline_checkout: route.abort(); return
            headers = {k:v for k,v in request.all_headers().items() if k not in ['host','content-length']}
            result = self.local(path, body=request.post_data_buffer, headers=headers, method=request.method)
            if self.lose_checkout_response: self.lose_checkout_response = False; route.abort(); return
            route.fulfill(status=result['status'], headers=result['headers'], body=result['body']); return
        super().relay(route)

    def checkout(self):
        self.activate(); self.local('/test/seed-checkout', {})
        self.page.goto(qa.ORIGIN + '/caixa-dev.html'); expect(self.page.locator('.book')).to_have_count(2)

    def add(self):
        self.page.locator('.book').filter(has=self.page.get_by_role('heading', name='Livro de teste do Caixa', exact=True)).get_by_role('button', name='Adicionar').click()

    def confirm(self):
        self.page.locator('#confirm').click(); expect(self.page.locator('#receipt')).to_be_visible()

    def network(self, connected):
        # Explicit browser signal fixture; route aborts separately exercise real
        # fetch failures even when navigator.onLine remains true.
        self.page.evaluate('''connected => {
          Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>connected});
          window.dispatchEvent(new Event(connected?'online':'offline'));
        }''', connected)

    def test_checkout_offline_signal_blocks_send_and_reconnect_requires_complete_read(self):
        self.checkout(); self.add(); self.network(False)
        expect(self.page.locator('#connection-title')).to_have_text('Sem conexão')
        expect(self.page.locator('#confirm')).to_be_disabled()
        self.page.locator('#payment-form').dispatch_event('submit')
        self.assertEqual(self.checkout_requests, 0); self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'), [])
        self.fail_stock=True; self.network(True)
        expect(self.page.locator('#connection')).to_have_attribute('data-state','stale')
        expect(self.page.locator('#confirm')).to_be_disabled()
        expect(self.page.locator('.cart-line')).to_have_count(1)
        self.fail_stock=False; self.page.locator('#refresh').click()
        expect(self.page.locator('#connection')).to_have_attribute('data-state','ready'); self.confirm()
        self.assertEqual(self.checkout_requests, 1)

    def test_checkout_reconnection_never_replays_uncertain_sale_automatically(self):
        self.checkout(); self.add(); self.lose_checkout_response=True; self.page.locator('#confirm').click()
        expect(self.page.locator('#sale-status')).to_contain_text('Não foi possível confirmar o resultado')
        original=self.last_command.copy(); stored=self.page.evaluate('sessionStorage.getItem(Object.keys(sessionStorage)[0])')
        self.network(False); expect(self.page.locator('#confirm')).to_be_disabled()
        self.network(True); expect(self.page.locator('#connection')).to_have_attribute('data-state','ready')
        self.assertEqual(self.checkout_requests,1); self.assertEqual(self.page.evaluate('sessionStorage.getItem(Object.keys(sessionStorage)[0])'),stored)
        expect(self.page.locator('#connection-detail')).to_contain_text('não reenvia')
        self.confirm(); self.assertEqual(self.last_command,original)
        self.assertEqual(self.local('/test/checkout-state'),{'sales':1,'stock':1,'journals':1})

    def test_checkout_pending_can_be_checked_even_if_stock_query_fails(self):
        self.checkout(); self.add(); self.lose_checkout_response=True; self.page.locator('#confirm').click()
        expect(self.page.locator('#sale-status')).to_contain_text('Não foi possível confirmar o resultado')
        self.fail_stock=True; self.page.locator('#refresh').click()
        expect(self.page.locator('#connection')).to_have_attribute('data-state','stale')
        expect(self.page.locator('#confirm')).to_be_enabled(); self.confirm()
        self.assertEqual(self.local('/test/checkout-state')['sales'],1)

    def test_checkout_late_response_cannot_unlock_after_disconnect(self):
        self.checkout(); self.add(); self.hold_stock=True; self.page.locator('#refresh').click()
        expect(self.page.locator('#connection')).to_have_attribute('data-state','checking')
        self.page.wait_for_function("document.querySelector('#status').textContent.length>0")
        # Pump the browser until the intentionally held route is reached.
        for _ in range(100):
            if self.held_stock: break
            self.page.wait_for_timeout(10)
        self.assertIsNotNone(self.held_stock)
        self.network(False); self.network(True)
        self.fail_stock=True; self.hold_stock=False
        route,result=self.held_stock; route.fulfill(status=result['status'],headers=result['headers'],body=result['body'])
        expect(self.page.locator('#connection')).to_have_attribute('data-state','stale')
        expect(self.page.locator('#confirm')).to_be_disabled(); self.assertEqual(self.checkout_requests,0)

    def test_checkout_return_from_offline_respects_price_changed_elsewhere(self):
        self.checkout(); self.add(); self.network(False)
        # Explicit fixture changes the shared price while this page is offline.
        self.local('/test/checkout-price',{})
        self.network(True); expect(self.page.locator('#connection')).to_have_attribute('data-state','ready')
        expect(self.page.locator('#total')).to_contain_text('45,00'); self.confirm()
        self.assertEqual(self.last_command['expectedTotalCents'],4500)

    def test_checkout_reconnect_denied_session_preserves_pending_without_send(self):
        self.checkout(); self.add(); self.offline_checkout=True; self.page.locator('#confirm').click()
        expect(self.page.locator('#sale-status')).to_contain_text('Não foi possível confirmar o resultado')
        stored=self.page.evaluate('sessionStorage.getItem(Object.keys(sessionStorage)[0])')
        self.network(False); self.deny_session=True; self.offline_checkout=False; self.network(True)
        expect(self.page.locator('#status')).to_contain_text('Entre na conta verificada')
        self.page.locator('#confirm').click()
        expect(self.page.locator('#sale-status')).to_contain_text('Entre na conta verificada')
        self.assertEqual(self.checkout_requests,1); self.assertEqual(self.page.evaluate('sessionStorage.getItem(Object.keys(sessionStorage)[0])'),stored)

    def test_checkout_mobile_stale_stock_expires_and_banner_fits(self):
        # Install before navigation so every application timer uses this clock.
        self.page.clock.install(); self.checkout(); self.add(); self.fail_stock=True
        self.page.clock.fast_forward(91000)
        expect(self.page.locator('#confirm')).to_be_disabled()
        expect(self.page.locator('#connection')).not_to_have_attribute('data-state','ready')
        self.network(False)
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
        self.page.screenshot(path=str(qa.ARTIFACTS/'caixa-sem-conexao.png'),full_page=True)
        self.assertEqual(self.errors,[])

    def test_checkout_partial_refresh_of_cart_outside_page_stays_blocked(self):
        self.checkout(); self.add(); self.fail_detail=True
        self.page.locator('#query').fill('Livro sem estoque'); self.page.locator('#search-form').dispatch_event('submit')
        expect(self.page.locator('#connection')).to_have_attribute('data-state','stale')
        expect(self.page.locator('#confirm')).to_be_disabled()
        self.fail_detail=False; self.page.locator('#refresh').click()
        expect(self.page.locator('#connection')).to_have_attribute('data-state','ready')
        expect(self.page.locator('.book')).to_have_count(1); self.confirm()

    def test_checkout_reconnect_reads_zero_stock_from_another_authorized_operation(self):
        self.checkout(); self.add(); self.local('/test/enable-operations',{}); self.network(False)
        # Real authorized admin operation in the disposable installation,
        # representing another terminal (not an unchecked stock fixture).
        result=self.page.evaluate('''async () => {
          const session=(await (await fetch('/api/v1/session')).json()).data;
          const id=document.querySelector('[data-add]').dataset.add;
          const p=(await (await fetch('/api/v1/catalog/get?id='+id)).json()).data.product;
          const r=await fetch('/api/v1/operations/adjust',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},
            body:JSON.stringify({commandId:crypto.randomUUID(),id,expectedVersion:p.version,newStock:0,reason:'Conferência em outro terminal de teste'})});
          return r.status;
        }''')
        self.assertEqual(result,200); self.network(True)
        expect(self.page.locator('#connection')).to_have_attribute('data-state','ready')
        expect(self.page.locator('.cart-line')).to_contain_text('Sem estoque')
        expect(self.page.locator('#confirm')).to_be_disabled(); self.assertEqual(self.checkout_requests,0)

    def test_checkout_open_offline_recovers_access_on_reconnection(self):
        self.activate(); self.local('/test/seed-checkout',{})
        self.page.add_init_script("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false})")
        self.page.goto(qa.ORIGIN+'/caixa-dev.html')
        expect(self.page.locator('#status')).to_contain_text('Sem conexão')
        expect(self.page.locator('#checkout')).to_be_hidden(); self.network(True)
        expect(self.page.locator('#connection')).to_have_attribute('data-state','ready')
        expect(self.page.locator('.book')).to_have_count(2); self.assertEqual(self.checkout_requests,0)

    def test_checkout_restored_page_rechecks_before_accepting_new_sale(self):
        self.checkout(); self.add(); self.fail_stock=True
        self.page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
        expect(self.page.locator('#connection')).to_have_attribute('data-state','stale')
        expect(self.page.locator('#confirm')).to_be_disabled(); self.assertEqual(self.checkout_requests,0)

    def test_checkout_anonymous_payment_methods_reset_customer_and_cart(self):
        for method in ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO']:
            with self.subTest(method=method):
                # Each method gets an independent storage installation.
                if method != 'PIX': self.tearDown(); self.setUp()
                self.checkout(); self.add(); self.page.locator('#payment').select_option(method); self.confirm()
                self.assertEqual(self.last_command['customerId'], None); self.assertEqual(self.last_command['paymentMethod'], method)
                self.assertEqual(self.local('/test/checkout-state')['sales'], 1)
                self.page.locator('#new-sale').click(); expect(self.page.locator('.cart-line')).to_have_count(0)
                expect(self.page.locator('#payment')).to_have_value('PIX'); expect(self.page.locator('#confirm')).to_be_disabled()
                self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'), [])
                self.assertEqual(self.errors, [])

    def test_checkout_lost_ack_survives_reload_and_retries_same_command(self):
        self.checkout(); self.add(); self.lose_checkout_response = True; self.page.locator('#confirm').click()
        expect(self.page.locator('#sale-status')).to_contain_text('Não foi possível confirmar o resultado')
        original = self.last_command.copy(); self.assertEqual(self.local('/test/checkout-state')['sales'], 1)
        self.page.reload(); expect(self.page.locator('#sale-status')).to_contain_text('Há uma compra aguardando confirmação')
        expect(self.page.locator('.cart-line input')).to_be_disabled(); expect(self.page.locator('#payment')).to_be_disabled()
        self.confirm(); self.assertEqual(self.last_command, original)
        self.assertEqual(self.local('/test/checkout-state'), {'sales':1, 'stock':1, 'journals':1})
        self.assertEqual(self.page.evaluate('Object.keys(sessionStorage)'), [])

    def test_checkout_projection_failure_retries_without_double_stock_decrement(self):
        self.checkout(); self.add(); self.local('/test/checkout-fault', {}); self.page.locator('#confirm').click()
        expect(self.page.locator('#sale-status')).to_contain_text('Não foi possível confirmar o resultado')
        self.confirm(); self.assertEqual(self.local('/test/checkout-state'), {'sales':1, 'stock':1, 'journals':1})

    def test_checkout_price_change_requires_review_and_new_confirmation(self):
        self.checkout(); self.add(); self.local('/test/checkout-price', {}); self.page.locator('#confirm').click()
        expect(self.page.locator('#sale-status')).to_contain_text('O preço mudou')
        expect(self.page.locator('#total')).to_contain_text('45,00'); self.assertEqual(self.local('/test/checkout-state')['sales'], 0)
        self.confirm(); expect(self.page.locator('#receipt-text')).to_contain_text('45,00')

    def test_checkout_offline_keeps_anonymous_command_and_blocks_cart_changes(self):
        self.checkout(); self.add(); self.offline_checkout = True; self.page.locator('#confirm').click()
        expect(self.page.locator('#sale-status')).to_contain_text('Não foi possível confirmar o resultado')
        stored = self.page.evaluate('JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage)[0]))')
        self.assertEqual(set(stored), {'idempotencyKey','items','paymentMethod','customerId','expectedTotalCents'})
        expect(self.page.get_by_role('button', name='Remover', exact=True)).to_be_disabled()
        self.assertEqual(self.local('/test/checkout-state')['sales'], 0)
        self.offline_checkout = False; self.confirm(); self.assertEqual(self.last_command, stored)

    def test_checkout_full_storage_prevents_sending_sale(self):
        self.checkout(); self.add()
        self.page.evaluate("() => { Storage.prototype.setItem = function(){throw new DOMException('test quota','QuotaExceededError')}; }")
        self.page.locator('#confirm').click(); expect(self.page.locator('#sale-status')).to_contain_text('Nenhuma venda foi enviada')
        self.assertIsNone(self.last_command); self.assertEqual(self.local('/test/checkout-state')['sales'], 0)

    def test_checkout_mobile_layout_keyboard_quantities_and_zero_stock(self):
        self.checkout()
        expect(self.page.locator('.book').filter(has=self.page.get_by_role('heading',name='Livro sem estoque',exact=True)).get_by_role('button')).to_be_disabled()
        self.add(); quantity=self.page.locator('.cart-line input'); quantity.fill('2'); quantity.press('Tab')
        expect(self.page.locator('#total')).to_contain_text('65,80'); self.confirm()
        self.assertEqual(self.local('/test/checkout-state')['stock'],0)
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
        self.page.screenshot(path=str(qa.ARTIFACTS/'caixa-celular.png'),full_page=True);self.assertEqual(self.errors,[])

    def test_checkout_recovery_is_bound_to_current_account_and_gates_are_closed(self):
        self.page.goto(qa.ORIGIN+'/caixa-dev.html');expect(self.page.locator('#status')).to_contain_text('Entre na conta verificada')
        self.checkout(); self.add(); self.offline_checkout=True; self.page.locator('#confirm').click()
        expect(self.page.locator('#sale-status')).to_contain_text('Não foi possível confirmar o resultado')
        self.page.evaluate("const key=Object.keys(sessionStorage)[0];sessionStorage.setItem('checkout.pending.other-account',sessionStorage.getItem(key));sessionStorage.removeItem(key)")
        self.page.reload();expect(self.page.locator('#checkout')).to_be_visible();expect(self.page.locator('.cart-line')).to_have_count(0)
        self.local('/test/disable-checkout',{});self.page.reload();expect(self.page.locator('#checkout')).to_be_hidden();expect(self.page.locator('#status')).to_contain_text('ainda não está disponível')
        self.page.goto('https://merry-chimera-49a1f3.netlify.app/caixa-dev.html');expect(self.page.locator('#status')).to_contain_text('exclusivamente no endereço DEV')

    def test_checkout_two_independent_sessions_refresh_stock_on_focus(self):
        self.checkout(); other=self.browser.new_context();other.route('**/*',self.relay)
        page=other.new_page();cdp=other.new_cdp_session(page);cdp.send('WebAuthn.enable')
        auth=cdp.send('WebAuthn.addVirtualAuthenticator',{'options':{'protocol':'ctap2','transport':'internal','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})['authenticatorId']
        for key in self.cdp.send('WebAuthn.getCredentials',{'authenticatorId':self.authenticator})['credentials']:cdp.send('WebAuthn.addCredential',{'authenticatorId':auth,'credential':key})
        try:
            page.goto(qa.ORIGIN+'/acesso-dev.html?verificar=1');expect(page.locator('#initial')).to_be_visible()
            page.locator('#login-email').fill('owner@example.invalid');page.locator('#login-pin').fill('8274')
            page.get_by_role('button',name='Entrar na minha conta',exact=True).first.click();expect(page.locator('#passkey')).to_be_visible()
            page.locator('#passkey-button').click();expect(page.locator('#complete')).to_be_visible()
            page.goto(qa.ORIGIN+'/caixa-dev.html');expect(page.locator('.book')).to_have_count(2)
            expect(page.locator('.book').first).to_contain_text('Estoque: 2')
            self.add();self.confirm();page.evaluate("window.dispatchEvent(new Event('focus'))")
            expect(page.locator('.book').first).to_contain_text('Estoque: 1')
            page.get_by_role('button',name='Adicionar',exact=True).first.click();page.locator('#confirm').click();expect(page.locator('#receipt')).to_be_visible()
            self.assertEqual(self.local('/test/checkout-state'),{'sales':2,'stock':0,'journals':2})
        finally:other.close()

    def test_checkout_mobile_android_quantity_and_navigation(self):
        self.page.set_viewport_size({'width':412,'height':915});self.checkout();self.add()
        self.page.get_by_role('button',name='Remover',exact=True).click();expect(self.page.locator('.cart-line')).to_have_count(0)
        self.page.locator('#query').fill('Livro sem estoque');self.page.get_by_role('button',name='Pesquisar',exact=True).click()
        expect(self.page.locator('.book')).to_have_count(1);expect(self.page.locator('.book h2')).to_have_text('Livro sem estoque')
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'));self.assertEqual(self.errors,[])


if __name__ == '__main__':
    suite=unittest.TestSuite(Checkout(name) for name in unittest.defaultTestLoader.getTestCaseNames(Checkout) if name.startswith('test_checkout_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
