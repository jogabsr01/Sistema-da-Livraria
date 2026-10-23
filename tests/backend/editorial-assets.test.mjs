import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from '../../scripts/build-public.mjs';
const manifest=JSON.parse(await readFile(new URL('../../data/editorial-covers.json',import.meta.url),'utf8'));
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'editorial-build-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'data'));await mkdir(join(root,'public/covers'),{recursive:true});await writeFile(join(root,'index.html'),'<html>test public output</html>');
 const refs=structuredClone(manifest);await writeFile(join(root,'data/editorial-covers.json'),JSON.stringify(refs));
 for(const ref of refs)await writeFile(join(root,'public',ref.path),await readFile(new URL('../../public'+ref.path,import.meta.url)));
 return {root,refs,save:()=>writeFile(join(root,'data/editorial-covers.json'),JSON.stringify(refs))};
}
test('build publishes the verified raster bytes and minimal reference map without source/config files',async t=>{
 const {root,refs}=await fixture(t);await writeFile(join(root,'public','DO_NOT_PUBLISH.env'),'PRIVATE_TEST_ONLY');await build(root);
 for(const ref of refs){const bytes=await readFile(join(root,'dist',ref.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),ref.sha256);assert.equal(bytes.readUInt32BE(16),660);assert.equal(bytes.readUInt32BE(20),1008);}
 assert.deepEqual((await readdir(join(root,'dist'))).sort(),['cover-references.js','covers','index.html']);const script=await readFile(join(root,'dist/cover-references.js'),'utf8');assert.ok(script.includes(refs[0].referenceUrl));assert.ok(!script.includes('PRIVATE_TEST_ONLY'));
});
test('corrupt, replaced or mismatched raster bytes fail the build instead of publishing an unverified cover',async t=>{
 for(const change of ['bytes','dimensions','hash']){
  const s=await fixture(t);if(change==='bytes')await writeFile(join(s.root,'public',s.refs[0].path),'<html>not a cover</html>');if(change==='dimensions')s.refs[0].width=1;if(change==='hash')s.refs[0].sha256='0'.repeat(64);await s.save();await assert.rejects(build(s.root),/integrity/);
 }
});
test('manifest path traversal, non-image paths and duplicate ISBN references are refused',async t=>{
 for(const change of ['path','duplicate','remote','isbn']){
  const s=await fixture(t);if(change==='path')s.refs[0].path='/covers/../../private.env';if(change==='duplicate')s.refs.push(s.refs[0]);if(change==='isbn')s.refs[0].isbn='9788543303933';if(change==='remote')s.refs[0].path='https://evil.invalid/image.png';await s.save();await assert.rejects(build(s.root),/reference/);
 }
});
test('cover source symlinks and symlinked parent directories are refused',async t=>{
 for(const parent of [false,true]){
  const s=await fixture(t),asset=join(s.root,'public',s.refs[0].path);
  if(parent){await rm(join(s.root,'public/covers'),{recursive:true});await mkdir(join(s.root,'other'));await symlink(join(s.root,'other'),join(s.root,'public/covers'));}
  else{await rm(asset);await writeFile(join(s.root,'private.env'),'PRIVATE_TEST_ONLY');await symlink(join(s.root,'private.env'),asset);}
  await assert.rejects(build(s.root),/Invalid cover/);
 }
});
