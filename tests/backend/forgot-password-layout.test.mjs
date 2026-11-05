import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('password recovery control remains isolated between the password row and submit action', async () => {
  const html = await readFile(new URL('../../acesso-dev.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../acesso-dev.css', import.meta.url), 'utf8');
  assert.match(html, /<button id="recovery-open" type="button" class="forgot-password-link"[^>]*>Esqueci minha senha<\/button>/);
  assert.ok(html.indexOf('class="login-password-row"') < html.indexOf('id="recovery-choice"'));
  assert.ok(html.indexOf('id="recovery-choice"') < html.indexOf('Entrar na minha conta'));
  for (const rule of ['background:transparent!important', 'border:none!important', 'box-shadow:none!important', 'text-underline-offset:4px!important', 'margin:12px auto 0']) assert.ok(css.includes(rule), rule);
});