"""Visual geometry regression for catalogue covers and missing-image placeholders."""
import os
from pathlib import Path
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

class CatalogCardMedia(unittest.TestCase):
    def test_cover_and_fallback_use_identical_fixed_boxes(self):
        css = (ROOT / 'app-theme.css').read_text() + '\n' + (ROOT / 'catalogo-dev.css').read_text()
        markup = '''<body class="app-shell page-catalogo"><div class="books">
          <article class="book"><span class="book-media"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></span><div><h2>Com capa</h2></div></article>
          <article class="book"><span class="book-media"><span class="fallback">📖</span></span><div><h2>Sem capa</h2></div></article>
        </div></body>'''
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), args=['--no-sandbox'])
            try:
                for width in (320, 1280):
                    page = browser.new_page(viewport={'width':width, 'height':800})
                    page.set_content('<style>' + css + '</style>' + markup)
                    sizes = page.locator('.book-media').evaluate_all('(items) => items.map(item => ({width:item.getBoundingClientRect().width,height:item.getBoundingClientRect().height}))')
                    self.assertEqual(sizes[0], sizes[1])
                    self.assertEqual(sizes[0], {'width':72 if width == 320 else 88, 'height':102 if width == 320 else 124})
                    page.close()
            finally:
                browser.close()

if __name__ == '__main__':
    unittest.main()