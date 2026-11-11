"""Exercise staff editing against mocked HTTP without touching production."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1] / 'dist'
origin = 'https://dev--merry-chimera-49a1f3.netlify.app'
person = {'id': '11111111-1111-4111-8111-111111111111', 'name': 'Pessoa Teste',
          'email': 'pessoa@example.invalid', 'phone': '11999999999', 'cpfMasked': '***.982.247-**',
          'role': 'ATENDENTE', 'status': 'ATIVO', 'revision': 1, 'activated': True}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)
    page = browser.new_page()
    writes = []
    def route(req):
        path = req.request.url.removeprefix(origin).split('?')[0]
        if path == '/api/v1/staff/bootstrap':
            req.fulfill(json={'data': {'users': [person], 'total': 1, 'nextOffset': None,
                                      'user': {'id': 'admin', 'role': 'SUPER_ADMIN'}, 'csrfToken': 'token'}})
        elif path == '/api/v1/staff/save':
            writes.append(req.request.post_data_json)
            req.fulfill(status=401, json={'error': {'code': 'REAUTHENTICATION_REQUIRED'}})
        elif path.startswith('/api/'):
            req.fulfill(status=404, json={'error': {'code': 'NOT_FOUND'}})
        else:
            file = root / path.lstrip('/')
            req.fulfill(path=str(file)) if file.is_file() else req.fulfill(status=404)
    page.route(origin + '/**', route)
    page.goto(origin + '/equipe-dev.html', wait_until='domcontentloaded')
    page.get_by_role('button', name='Editar acesso e dados').click()
    expect(page.locator('#staff-name')).to_have_value(person['name'])
    expect(page.locator('#staff-phone')).to_have_value(person['phone'])
    expect(page.locator('#staff-cpf')).to_have_attribute('placeholder', person['cpfMasked'])
    page.locator('#staff-name').fill('Rascunho preservado')
    page.locator('#staff-reason').fill('Correção de cadastro')
    page.locator('#save-user').click()
    expect(page.locator('#editor')).to_be_visible()
    expect(page.locator('#staff-name')).to_have_value('Rascunho preservado')
    assert writes[0]['contact']['cpf'] == '' and writes[0]['contact']['phone'] == person['phone']
    browser.close()
print('STAFF_DRAFT_SMOKE_OK')