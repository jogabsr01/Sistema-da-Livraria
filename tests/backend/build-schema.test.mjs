import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../scripts/build-public.mjs';
import { gasSchema } from '../../scripts/generate-gas-schema.mjs';

async function copyBrand(root){await mkdir(join(root,'public/brand'),{recursive:true});await writeFile(join(root,'public/brand/ipb-jardim-bonfiglioli.png'),await readFile(new URL('../../public/brand/ipb-jardim-bonfiglioli.png',import.meta.url)));}

test('public build preserves the demo byte-for-byte and excludes all private source/configuration', async t => {
  const root = await mkdtemp(join(tmpdir(), 'livraria-build-')); t.after(() => rm(root, { recursive: true, force: true }));await copyBrand(root);
  const source = await readFile(new URL('../../index.html', import.meta.url));
  await writeFile(join(root, 'index.html'), source); await writeFile(join(root, '.env'), 'DO_NOT_PUBLISH');
  await mkdir(join(root, 'backend')); await writeFile(join(root, 'backend', 'private.mjs'), 'DO_NOT_PUBLISH');
  await writeFile(join(root, 'backend', 'deployment-metadata.mjs'), 'PRIVATE_BUILD_IDENTITY');
  await build(root);
  assert.deepEqual((await readdir(join(root, 'dist'))).sort(), ['brand','index.html']);
  assert.deepEqual(await readFile(join(root, 'dist', 'index.html')), source);
  assert.ok(source.includes(Buffer.from('1357'))); assert.ok(source.includes(Buffer.from('2468')));
  await build(root); assert.deepEqual(await readFile(join(root, 'dist', 'index.html')), source);
});
test('build refuses symlinked assets and does not follow dist symlinks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'livraria-link-')); t.after(() => rm(root, { recursive: true, force: true }));await copyBrand(root);
  await writeFile(join(root, 'secret'), 'private'); await symlink(join(root, 'secret'), join(root, 'index.html'));
  await assert.rejects(build(root));
  await rm(join(root, 'dist'), { recursive: true, force: true }); await mkdir(join(root, 'outside'));
  await symlink(join(root, 'outside'), join(root, 'dist')); await assert.rejects(build(root));
});
test('generated Apps Script schema exactly matches the reviewed JSON; all requested tables and hash-only sessions exist', async () => {
  const schema = JSON.parse(await readFile(new URL('../../schema/workspace-v1.json', import.meta.url), 'utf8'));
  assert.equal(await readFile(new URL('../../google-apps-script/Schema.gs', import.meta.url), 'utf8'), gasSchema(schema));
  assert.equal(schema.tables.length, 17);
  assert.ok(schema.tables.find(t => t.name === 'Sessoes').columns.includes('Token_Hash'));
  assert.ok(!schema.tables.find(t => t.name === 'Usuarios').columns.some(c => /pin|senha|token/i.test(c)));
});
