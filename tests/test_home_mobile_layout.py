"""Checks dashboard geometry in a real browser without network or credentials."""
import os
from pathlib import Path
import re
import subprocess
import unittest

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class HomeMobileLayout(unittest.TestCase):
    def test_navigation_icons_on_desktop_and_mobile(self):
        source = subprocess.check_output([
            'node', '--input-type=module', '-e',
            "import {readFileSync} from 'node:fs'; import {renderAppHeader} from './scripts/app-header.mjs'; "
            "console.log(renderAppHeader(readFileSync('home-dev.html','utf8'),'home-dev.html'));"
        ], cwd=ROOT, text=True)
        source = re.sub(r'<script\b[^>]*>[\s\S]*?</script>', '', source)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), headless=True)
            try:
                page = browser.new_page()
                page.set_content(source)
                for css in ('home-dev.css', 'account-menu.css', 'app-theme.css'):
                    page.add_style_tag(content=(ROOT / css).read_text())
                page.locator('.app-navigation').evaluate('el => el.hidden = false')
                page.locator('[data-navigation-admin]').evaluate_all('els => els.forEach(el => el.hidden = false)')
                for width in (390, 1024):
                    with self.subTest(width=width):
                        page.set_viewport_size({'width': width, 'height': 900})
                        page.locator('[data-app-header]').evaluate("el => el.classList.toggle('mobile-menu-open', innerWidth <= 768)")
                        for selector in ('.app-home-link', '.module-menu summary'):
                            for element in page.locator(selector).all():
                                icon = element.locator('svg.nav-icon')
                                self.assertTrue(icon.is_visible())
                                self.assertGreater(icon.bounding_box()['width'], 0)
                        for menu in page.locator('.module-menu').all():
                            menu.evaluate('el => el.open = true')
                            for link in menu.locator('.account-options a').all():
                                icon = link.locator('svg.nav-icon')
                                self.assertEqual(icon.count(), 1)
                                self.assertTrue(icon.is_visible(), link.inner_text())
                                self.assertGreater(icon.bounding_box()['width'], 0)
                            menu.evaluate('el => el.open = false')
            finally:
                browser.close()

    def test_actions_stack_and_remain_reachable(self):
        source = subprocess.check_output([
            'node', '--input-type=module', '-e',
            "import {readFileSync} from 'node:fs'; import {renderAppHeader} from './scripts/app-header.mjs'; "
            "console.log(renderAppHeader(readFileSync('home-dev.html','utf8'),'home-dev.html'));"
        ], cwd=ROOT, text=True)
        source = re.sub(r'<script\b[^>]*>[\s\S]*?</script>', '', source)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), headless=True)
            try:
                page = browser.new_page()
                page.set_content(source)
                for css in ('home-dev.css', 'account-menu.css', 'app-theme.css'):
                    page.add_style_tag(content=(ROOT / css).read_text())
                page.locator('#home').evaluate("el => el.hidden = false")
                for width in (320, 390, 768):
                    with self.subTest(width=width):
                        page.set_viewport_size({'width': width, 'height': 480})
                        page.evaluate('window.scrollTo(0, 0)')
                        primary = page.locator('#new-purchase').bounding_box()
                        search = page.locator('#search-product').bounding_box()
                        container = page.locator('.main-actions').bounding_box()
                        self.assertAlmostEqual(primary['width'], container['width'], delta=1)
                        self.assertAlmostEqual(search['width'], container['width'], delta=1)
                        self.assertGreaterEqual(search['y'], primary['y'] + primary['height'])
                        self.assertEqual(page.evaluate('document.documentElement.scrollWidth <= innerWidth'), True)
                        target = page.locator('.other-actions .action-card')
                        target.scroll_into_view_if_needed()
                        self.assertTrue(target.evaluate("el => {const r=el.getBoundingClientRect(); const x=r.left+r.width/2, y=r.top+r.height/2; return el.contains(document.elementFromPoint(x,y));}"))
                page.set_viewport_size({'width': 1024, 'height': 768})
                self.assertEqual(page.locator('.main-actions').evaluate('el => getComputedStyle(el).gridTemplateColumns.split(" ").length'), 2)
            finally:
                browser.close()


if __name__ == '__main__':
    unittest.main()