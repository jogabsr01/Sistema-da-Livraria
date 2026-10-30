import test from 'node:test';
import assert from 'node:assert/strict';
import{readFile}from'node:fs/promises';
import{renderAppHeader}from'../../scripts/app-header.mjs';
const pages=['home','catalogo','caixa','meu-perfil','equipe','notificacoes','operacoes','relatorios','auditoria','nichos','escalas','minhas-chaves','clientes-compras'];
test('all internal pages build the same header above the main content, preserving page headings and bindings',async()=>{
 let expected;
 for(const page of pages){const file=page+'-dev.html',source=await readFile(new URL('../../'+file,import.meta.url),'utf8'),out=renderAppHeader(source,file),header=out.match(/<header class="app-topbar"[\s\S]*?<\/header>/)[0];assert.equal(out.match(/<header\b/g).length,1,file);assert.ok(out.indexOf(header)<out.indexOf('<main'),file);const canonical=header.replace(/id="(?:account-navigation|module-account|app-navigation)"/,'id="navigation"');if(expected)assert.equal(canonical,expected,file);else expected=canonical;const ids=[...source.matchAll(/<h1[^>]*id="([^"]+)"/g)].map(m=>m[1]);for(const id of ids)assert.ok(out.includes('id="'+id+'"'));assert.ok(out.includes('src="/account-menu.js"')||page==='home');}
});
test('access and original prototype do not acquire internal navigation',()=>{for(const page of ['index.html','acesso-dev.html'])assert.equal(renderAppHeader('unchanged',page),'unchanged');});
