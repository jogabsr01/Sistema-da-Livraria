import test from 'node:test';
import assert from 'node:assert/strict';
import{readFile}from'node:fs/promises';
import{renderAppHeader}from'../../scripts/app-header.mjs';
const pages=['home','catalogo','caixa','meu-perfil','equipe','notificacoes','operacoes','relatorios','auditoria','nichos','escalas','minhas-chaves','clientes-compras'];
test('all internal pages build the same header above the main content, preserving page headings and bindings',async()=>{
 let expected;
 for(const page of pages){const file=page+'-dev.html',source=await readFile(new URL('../../'+file,import.meta.url),'utf8'),out=renderAppHeader(source,file),header=out.match(/<header class="app-topbar"[\s\S]*?<\/header>/)[0];assert.equal(out.match(/<header\b/g).length,1,file);assert.ok(out.indexOf(header)<out.indexOf('<main'),file);const canonical=header.replace(/(?:id|aria-controls)="(?:account-navigation|module-account|app-navigation)"/g,'navigation');if(expected)assert.equal(canonical,expected,file);else expected=canonical;const ids=[...source.matchAll(/<h1[^>]*id="([^"]+)"/g)].map(m=>m[1]);for(const id of ids)assert.ok(out.includes('id="'+id+'"'));assert.ok(out.includes('src="/account-menu.js"')||page==='home');}
});
test('access and original prototype do not acquire internal navigation',()=>{for(const page of ['index.html','acesso-dev.html'])assert.equal(renderAppHeader('unchanged',page),'unchanged');});
test('shared navigation includes decorative SVG icons alongside the main destination labels',async()=>{
 const source=await readFile(new URL('../../home-dev.html',import.meta.url),'utf8'),html=renderAppHeader(source,'home-dev.html');
 for(const label of ['Início','Catálogo','Pesquisar produto','Adicionar novo produto','Rotina','Nova compra','Histórico e operações','Notificações','Minhas escalas','Organizar nichos','Meu perfil','Minha escala','Gerenciar equipe','Relatórios','Relatório de clientes']){
  assert.match(html,new RegExp('<svg class="nav-icon"[^>]*aria-hidden="true"><path[^>]*/></svg>'+label));
 }
});
test('navigation action icons are distinct and home shortcuts retain their contextual shapes',async()=>{
 const source=await readFile(new URL('../../home-dev.html',import.meta.url),'utf8'),html=renderAppHeader(source,'home-dev.html');
 const labels=['Catálogo','Pesquisar produto','Adicionar novo produto','Nova compra','Histórico e operações','Notificações','Minhas escalas','Organizar nichos'];
 const paths=labels.map(label=>{const match=html.match(new RegExp('<svg class="nav-icon"[^>]*><path d="([^"]+)"/></svg>'+label));assert.ok(match,label);return match[1];});
 assert.equal(new Set(paths).size,labels.length);
 assert.match(source,/<button id="new-purchase"[\s\S]*?<circle cx="13" cy="27"/);
 assert.match(source,/<button id="search-product"[\s\S]*?<circle cx="13" cy="13"/);
 assert.match(source,/<a class="action-card" href="\/catalogo-dev.html\?novo=1">[\s\S]*?<circle cx="16" cy="16"/);
});
test('rotation menu contains its destinations and restricts niche administration',async()=>{
 const source=await readFile(new URL('../../home-dev.html',import.meta.url),'utf8'),html=renderAppHeader(source,'home-dev.html');
 const menus=[...html.matchAll(/<details class="module-menu"><summary>(.*?)<\/summary><div class="account-options">([\s\S]*?)<\/div><\/details>/g)];
 const catalog=menus.find(m=>m[1].endsWith('Catálogo'))[2],routine=menus.find(m=>m[1].endsWith('Rotina'))[2];
 assert.doesNotMatch(catalog,/nichos-dev/);
 for(const path of ['caixa-dev.html','operacoes-dev.html','notificacoes-dev.html','escalas-dev.html','nichos-dev.html'])assert.ok(routine.includes('/'+path));
 assert.match(routine,/<a href="\/nichos-dev.html" data-navigation-admin hidden>/);
});
