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
  const dialog=doc.body.children.find(child=>child.tag==='dialog');
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

test('navigation caches verified photo, refreshes on navigation, and falls back to initials', async () => {
  const source = await readFile(new URL('../../account-menu.js', import.meta.url), 'utf8');
  const listeners = () => ({ events:{}, addEventListener(type, handler) { (this.events[type] ||= []).push(handler); } });
  const element = tag => ({ ...listeners(), tag, dataset:{}, children:[], classList:{contains:()=>false,remove(){},toggle(){}},
    setAttribute(){}, removeAttribute(){}, append(...v){this.children.push(...v);}, replaceChildren(...v){this.children=v;},
    querySelector(){return null;}, querySelectorAll(){return [];}, contains(child){return this.children.includes(child);}, style:{setProperty(){}} });
  const store = new Map(), sessionStorage = {setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k)||null,removeItem:k=>store.delete(k)};
  const profile={id:'user-1',name:'Clara Pessoa',role:'ADMIN',photoUrl:'/api/v1/profile/photo?v=1'};
  let requests=0, current=profile;
  async function mount(isProfile=false) {
    const avatar=element('avatar'),summary=element('summary'),account=element('account'),nav=element('nav'),header=element('header');
    account.querySelector=()=>summary;
    header.querySelector=s=>({'nav':nav,'.account-menu':account,'[data-account-avatar]':avatar,'[data-account-status]':element('p'),'[data-account-logout]':element('button'),'[data-account-logout-retry]':element('button')}[s]);
    const body=element('body');body.classList.contains=c=>isProfile&&c==='page-meu-perfil';
    const document={...listeners(),body,hidden:false,querySelector:()=>header,createElement:element,createTextNode:text=>({text})};
    const window={...listeners()};
    const fetch=async url=>{requests++;return {ok:true,status:200,json:async()=>({data:url==='/api/v1/session'?{user:{id:current.id,role:current.role}}:current})};};
    vm.runInNewContext(source,{window,document,sessionStorage,fetch,location:{origin:'https://dev--merry-chimera-49a1f3.netlify.app'},navigator:{onLine:true},URL,innerHeight:800});
    await new Promise(resolve=>setImmediate(resolve));
    return {avatar,window};
  }
  const first=await mount(true);
  first.window.events['livraria:profile-loaded'][0]({detail:{profile}});
  assert.equal(first.avatar.children[0].src,profile.photoUrl);
  assert.equal(JSON.parse(store.get('livraria.navigation.profile.v1')).photoUrl,profile.photoUrl);
  first.window.events['livraria:profile-invalidated'].forEach(handler=>handler({detail:{wipe:false}}));
  current={...profile,photoUrl:'/api/v1/profile/photo?v=2'};
  const next=await mount();
  assert.ok(requests>0, 'cached profile is still refreshed from server');
  assert.equal(next.avatar.children[0].src,current.photoUrl);
  next.avatar.children[0].events.error[0]();
  assert.equal(next.avatar.children[0].text,'CP');
  next.window.events['livraria:profile-loaded'][0]({detail:{profile:{...profile,photoUrl:'https://evil.invalid/photo'}}});
  assert.equal(next.avatar.children[0].text,'CP');
  assert.equal(JSON.parse(store.get('livraria.navigation.profile.v1')).photoUrl,'');
  next.window.events['livraria:profile-invalidated'].forEach(handler=>handler({detail:{wipe:true}}));
  assert.equal(store.size,0);
});