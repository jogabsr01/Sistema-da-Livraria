import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('DEV interfaces omit environment labels while preserving recovery and pending controls', async () => {
  for (const file of ['acesso','home','caixa','catalogo','equipe','escalas','meu-perfil','nichos','notificacoes','operacoes','relatorios','auditoria']) {
    const html = await readFile(new URL(`../../${file}-dev.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /AMBIENTE DEV|AMBIENTE DE TESTES — DEV|· DEV<|DEV · Testes/);
  }
  const access = await readFile(new URL('../../acesso-dev.html', import.meta.url), 'utf8');
  const profile = await readFile(new URL('../../meu-perfil-dev.html', import.meta.url), 'utf8');
  const checkout = await readFile(new URL('../../caixa-dev.html', import.meta.url), 'utf8');
  assert.match(access, /id="check-step"/);
  assert.match(profile, /id="profile-pending"/);
  assert.match(checkout, /id="connection"/);
  const css = await readFile(new URL('../../app-theme.css', import.meta.url), 'utf8');
  assert.match(css, /data-state="ready"/);
  assert.doesNotMatch(css, /data-state="offline"\]\s*\{\s*display\s*:\s*none/);
});