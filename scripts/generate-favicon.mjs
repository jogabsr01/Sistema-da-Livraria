import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const logoPath = new URL('../public/brand/ipb-jardim-bonfiglioli.png', import.meta.url);
const outputPath = new URL('../public/brand/favicon.png', import.meta.url);

export async function generateFavicon() {
  // Use the original sarça alpha as a solid white silhouette.
  const logo = await readFile(logoPath);
  const alpha = await sharp(logo).extract({ left: 0, top: 0, width: 95, height: 70 })
    .resize(138, 138, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha().extractChannel('alpha').toBuffer();
  const emblem = await sharp({ create: { width: 138, height: 138, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha).png().toBuffer();
  const tile = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" rx="44" fill="#0056d6"/></svg>');
  return sharp(tile).composite([{ input: emblem, gravity: 'centre' }]).png().toBuffer();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await writeFile(outputPath, await generateFavicon());
