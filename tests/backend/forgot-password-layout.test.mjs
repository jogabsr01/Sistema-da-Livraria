import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('password recovery control remains isolated between the password row and submit action', async () => {
  const html = await readFile(new URL('../../acesso-dev.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../acesso-dev.css', import.meta.url), 'utf8');
  assert.match(html, /<button id="recovery-open" type="button" class="forgot-password-link"[^>]*>Esqueci minha senha<\/button>/);
  assert.ok(html.indexOf('class="login-password-row"') < html.indexOf('id="recovery-choice"'));
  assert.ok(html.indexOf('id="recovery-choice"') < html.indexOf('Entrar na minha conta'));
  assert.match(html, /id="recovery-choice" class="recovery-choice"><button/);
  for (const rule of ['display:block!important', 'visibility:visible!important', 'opacity:1!important', 'background:transparent!important', 'border:none!important', 'box-shadow:none!important', 'text-underline-offset:4px!important', 'margin:8px auto 16px!important']) assert.ok(css.includes(rule), rule);
  const js = await readFile(new URL('../../acesso-dev.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /\$\('recovery-choice'\)\.hidden\s*=/);
  assert.match(js, /if\(!recoveryEnabled\)/);
});