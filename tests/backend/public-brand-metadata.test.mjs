import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { generateFavicon } from '../../scripts/generate-favicon.mjs';
import sharp from 'sharp';

test('public pages advertise the official social preview and favicon', async () => {
  const root = new URL('../../', import.meta.url);
  const pages = (await readdir(root)).filter(name => name.endsWith('.html'));
  for (const page of pages) {
    const html = await readFile(new URL(page, root), 'utf8');
    assert.match(html, /<link rel="icon" type="image\/png" href="\/brand\/favicon\.png\?v=3">/, page);
    assert.match(html, /<meta property="og:title" content="[^"]+">/, page);
    assert.match(html, /<meta property="og:description" content="[^"]+">/, page);
    assert.match(html, /<meta property="og:image" content="https:\/\/livraria\.ipbjb\.com\.br\/brand\/social-preview\.png">/, page);
  }
  for (const [name, width, height] of [['favicon.png',192,192],['social-preview.png',1200,630]]) {
    const image = await readFile(new URL(`../../public/brand/${name}`, import.meta.url));
    assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(image.readUInt32BE(16),width);
    assert.equal(image.readUInt32BE(20),height);
  }
});

test('favicon is reproducible, rounded and has a white emblem on a contrasting blue tile', async () => {
  const icon = await readFile(new URL('../../public/brand/favicon.png', import.meta.url));
  assert.deepEqual(icon, await generateFavicon());
  const { data, info } = await sharp(icon).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
  assert.equal(pixel(0, 0)[3], 0, 'rounded corners must remain transparent');
  assert.deepEqual(pixel(96, 20), [0, 86, 214, 255]);
  let whitePixels = 0;
  for (let y = 30; y < 162; y++) for (let x = 20; x < 172; x++) {
    const [r, g, b, a] = pixel(x, y);
    if (r > 245 && g > 245 && b > 245 && a === 255) whitePixels++;
  }
  assert.ok(whitePixels > 1000, 'visible white emblem');
});