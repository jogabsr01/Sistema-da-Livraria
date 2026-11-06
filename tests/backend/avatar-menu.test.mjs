import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('account avatar keeps native menu click; profile preview opens and closes the lightbox', async () => {
  const source = await readFile(new URL('../../account-menu.js', import.meta.url), 'utf8');
  const listeners = () => ({ events: {}, addEventListener(type, handler) { (this.events[type] ||= []).push(handler); } });
  const element = tag => ({ ...listeners(), tag, className:'', classList:{contains: value => value === 'page-meu-perfil'},
    dataset:{}, children:[], setAttribute() {}, removeAttribute(name) { delete this[name]; },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    querySelector() { return null; }, querySelectorAll() { return []; }, contains() { return false; },
    showModal() { this.open = true; }, close() { this.open = false; }, style:{setProperty(){}} });
  const doc = { ...listeners(), hidden:false, body:element('body'), createElement:element, createTextNode:text=>({text}), querySelector:()=>header };
  const nav=element('nav'), avatar=element('span'), summary=element('summary'), status=element('p'), logout=element('button'), retry=element('button'), account=element('details');
  account.querySelector=()=>summary;
  const header=element('header');
  header.querySelector=selector=>({'nav':nav,'.account-menu':account,'[data-account-avatar]':avatar,'[data-account-status]':status,'[data-account-logout]':logout,'[data-account-logout-retry]':retry}[selector]);
  const window={...listeners()};
  vm.runInNewContext(source,{window,document:doc,location:{origin:'https://dev--merry-chimera-49a1f3.netlify.app'},navigator:{onLine:true},URL,innerHeight:800});
  assert.equal(avatar.events.click, undefined, 'native summary behavior is not intercepted');
  const dialog=doc.body.children[0];
  const preview={id:'avatar-preview',hidden:false,src:'https://example.invalid/photo'};
  doc.events.click.forEach(handler=>handler({target:preview}));
  assert.equal(dialog.open,true);
  assert.equal(dialog.children[1].src,preview.src);
  dialog.children[0].events.click[0]();
  assert.equal(dialog.open,false);
  doc.body.classList.contains=()=>false;
  doc.events.click.forEach(handler=>handler({target:preview}));
  assert.equal(dialog.open,false);
});