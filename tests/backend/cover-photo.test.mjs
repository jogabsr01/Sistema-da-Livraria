import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { prepareCoverPhoto } from '../../backend/cover-photo.mjs';
import { catalogFixture, injectCatalogFault, CATALOG_ORIGIN } from '../helpers/catalog-fixture.mjs';
const image = async(color='#23794c') => sharp({create:{width:400,height:600,channels:3,background:color}}).png().toBuffer();
function enabled() { const s=catalogFixture();s.settings.photosEnabled=true;s.gas.props.COVER_PHOTOS_ENABLED='true';return s; }
const files=s=>[...s.gas.resources.values()].filter(r=>r.kind==='image');
const photoCommand=async(s)=>({...s.command(),photo:(await image()).toString('base64')});
const privateId=(s)=>{const t=s.main.getSheetByName('Produtos');return t.rows[1][t.rows[0].indexOf('Capa_Drive_ID')];};

test('server decodes/re-encodes photos, bounds dimensions and strips EXIF/source metadata',async()=>{
  const source=await sharp(await image()).withExif({IFD0:{Artist:'PRIVATE TEST AUTHOR',Copyright:'DISCARD'}}).jpeg().toBuffer();
  const normalized=await prepareCoverPhoto(source.toString('base64')),bytes=Buffer.from(normalized.bytes,'base64'),meta=await sharp(bytes).metadata();
  assert.equal(meta.format,'jpeg');assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);assert.ok(bytes.length<=49152);
  assert.equal(normalized.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(bytes.includes(Buffer.from('PRIVATE TEST AUTHOR')),false);
  assert.equal(await prepareCoverPhoto(null),null);
});
test('corrupt photos, active formats, noncanonical encodings and oversized dimensions/bytes are refused',async()=>{
  for(const source of ['','%%%','/9j/2Q==',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),Buffer.alloc(65537).toString('base64'),(await sharp({create:{width:2001,height:2,channels:3,background:'white'}}).png().toBuffer()).toString('base64')]) await assert.rejects(prepareCoverPhoto(source),{code:'INVALID_COVER_PHOTO'});
});
test('authenticated save stores private bytes, exposes only product proxy URL and survives a second session',async()=>{
  const s=enabled(),a=s.session(),c=await photoCommand(s);
  assert.equal((await s.http(a,'save',c)).status,200);const id=privateId(s);assert.ok(id);assert.equal(files(s).length,1);
  const book=(await s.client.catalog('get',s.session().actor,{id:c.id})).product;
  assert.equal(book.hasPhoto,true);assert.equal(book.photoUrl,'/api/v1/catalog/cover?id='+c.id+'&v=1');assert.equal(book.coverUrl,'');assert.ok(!JSON.stringify(book).includes(id));
  const response=await s.http(a,'cover?id='+c.id+'&v=1');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format,'jpeg');
  assert.equal((await s.handler(new Request(CATALOG_ORIGIN+'/api/v1/catalog/cover?id='+c.id))).status,401);
});
test('photo gates, CSRF, malformed images and forged Drive IDs deny writes before file creation',async()=>{
  const s=enabled(),a=s.session(),c=await photoCommand(s);
  for(const body of [{...c,driveId:'file_external'},{...c,photo:'<svg/>'},{...c,record:{...c.record,coverUrl:'https://covers.example.org/a'}}])assert.equal((await s.http(a,'save',body)).status,400);
  assert.equal((await s.http(a,'save',c,{'x-csrf-token':'wrong'})).status,403);
  s.settings.photosEnabled=false;assert.equal((await s.http(a,'save',c)).status,503);s.settings.photosEnabled=true;s.gas.props.COVER_PHOTOS_ENABLED='false';assert.equal((await s.http(a,'save',c)).status,503);
  assert.equal(files(s).length,0);assert.equal(s.journal.getLastRow(),1);
});
test('preflight invalid niche and duplicate ISBN do not upload orphan photos',async()=>{
  const s=enabled(),a=s.session(),c=await photoCommand(s);
  assert.equal((await s.http(a,'save',{...c,record:{...c.record,nicheIds:[randomUUID()]}})).status,400);assert.equal(files(s).length,0);
  await s.http(a,'save',s.command());assert.equal((await s.http(a,'save',c)).status,409);assert.equal(files(s).length,0);
});
test('photo and metadata retries recover after intent/product/link/audit/receipt failures without duplicate files',async()=>{
  for(const stage of ['intent','product','link','audit','marker'])for(const after of [false,true]){
    const s=enabled(),a=s.session(),c=await photoCommand(s);injectCatalogFault(s,stage,after);
    assert.equal((await s.http(a,'save',c)).status,502,stage);assert.equal((await s.http(a,'save',c)).status,200,stage);
    assert.equal(files(s).length,1);assert.equal(s.main.getSheetByName('Produtos').getLastRow(),2);assert.equal(s.main.getSheetByName('Logs_Auditoria').getLastRow(),2);
    assert.equal((await s.http(a,'cover?id='+c.id)).status,200);
  }
});
test('lost Drive creation/marker acknowledgements reuse a deterministic private file',async()=>{
  for(const mode of ['create','description']){
    const s=enabled(),a=s.session(),c=await photoCommand(s),folder=s.gas.resources.get(s.gas.props.COVERS_FOLDER_ID),create=folder.createFile.bind(folder);let once=true;
    folder.createFile=value=>{const file=create(value);if(mode==='create'&&once){once=false;throw Error('LOST_CREATE_ACK');}if(mode==='description'){const set=file.setDescription.bind(file);file.setDescription=value=>{set(value);if(once){once=false;throw Error('LOST_MARKER_ACK');}return file;};}return file;};
    assert.equal((await s.http(a,'save',c)).status,502);assert.equal(files(s).length,1);assert.equal(s.journal.getLastRow(),1);
    assert.equal((await s.http(a,'save',c)).status,200);assert.equal(files(s).length,1);
  }
});
test('metadata edits preserve photos; explicit replacement/removal retain private originals and other books',async()=>{
  const s=enabled(),a=s.session(),c=await photoCommand(s);await s.http(a,'save',c);const original=privateId(s);
  const edit=s.command({id:c.id,expectedVersion:1,record:{title:'Metadados alterados'}});assert.equal((await s.http(a,'save',edit)).status,200);assert.equal(privateId(s),original);
  const replacement={...s.command({id:c.id,expectedVersion:2}),photo:(await image('#964627')).toString('base64')};assert.equal((await s.http(a,'save',replacement)).status,200);assert.notEqual(privateId(s),original);assert.equal(files(s).length,2);
  const remove={...s.command({id:c.id,expectedVersion:3,record:{coverUrl:'https://covers.example.org/a.jpg'}}),photo:null};assert.equal((await s.http(a,'save',remove)).status,200);assert.equal(privateId(s),'');assert.equal(files(s).length,2);
  const book=(await s.client.catalog('get',a.actor,{id:c.id})).product;assert.equal(book.hasPhoto,false);assert.equal(book.photoUrl,'');assert.equal(book.stock,0);
});
test('public sharing, wrong folder, changed bytes/marker and another product file fail closed on reads',async()=>{
  for(const mode of ['sharing','parent','bytes','marker','product']){
    const s=enabled(),a=s.session(),c=await photoCommand(s);await s.http(a,'save',c);const f=files(s)[0];
    if(mode==='sharing')f.sharing='public';if(mode==='parent')f.parent=s.gas.props.DRIVE_ROOT_ID;if(mode==='bytes')f.bytes=Buffer.from('corrupt');if(mode==='marker')f.description='';if(mode==='product'){const marker=JSON.parse(f.description);marker.productId=randomUUID();f.description=JSON.stringify(marker);}
    const r=await s.http(a,'cover?id='+c.id);assert.notEqual(r.status,200,mode);assert.equal(r.headers.get('cache-control'),'no-store');
  }
});
