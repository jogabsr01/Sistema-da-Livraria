"""Smoke test the built shared navigation with mobile touch and keyboard."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1] / 'dist'
origin = 'https://dev--merry-chimera-49a1f3.netlify.app'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    page = context.new_page()
    def respond(route):
        path = route.request.url.split('?', 1)[0].removeprefix(origin)
        file = root / path.lstrip('/')
        if path == '/api/v1/session':
            route.fulfill(json={'data': {'user': {'role': 'ATENDENTE'}}})
        elif path == '/api/v1/profile/get':
            route.fulfill(status=503, json={'error': {'code': 'UNAVAILABLE'}})
        elif file.is_file():
            route.fulfill(path=str(file))
        else:
            route.fulfill(status=404)
    page.route(origin + '/**', respond)
    page.goto(origin + '/catalogo-dev.html', wait_until='domcontentloaded')
    page.wait_for_selector('.app-navigation:not([hidden])')
    page.locator('.account-menu summary').tap()
    backdrop = page.locator('[data-menu-backdrop]')
    assert backdrop.is_visible()
    assert backdrop.evaluate('(el) => getComputedStyle(el).backdropFilter') == 'blur(8px)'
    backdrop.tap(position={'x': 5, 'y': 150})
    assert not page.locator('.account-menu').evaluate('(el) => el.open')
    assert not backdrop.is_visible()
    page.locator('.account-menu summary').tap()
    assert backdrop.is_visible()
    link = page.locator('.account-menu a[href="/meu-perfil-dev.html"]')
    link.wait_for(state='visible')
    assert link.evaluate('(el) => document.elementFromPoint(el.getBoundingClientRect().x+10, el.getBoundingClientRect().y+10).closest("a") === el')
    link.tap()
    page.wait_for_url('**/meu-perfil-dev.html')
    page.goto(origin + '/catalogo-dev.html', wait_until='domcontentloaded')
    page.wait_for_selector('.app-navigation:not([hidden])')
    page.locator('.account-menu summary').focus()
    page.keyboard.press('Enter')
    assert page.locator('.account-menu').evaluate('(el) => el.open')
    page.keyboard.press('Escape')
    assert not page.locator('.account-menu').evaluate('(el) => el.open')
    assert not backdrop.is_visible()
    browser.close()
print('MENU_MOBILE_OK')