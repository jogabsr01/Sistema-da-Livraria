import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const logoPath = new URL('../public/brand/ipb-jardim-bonfiglioli.png', import.meta.url);
const outputPath = new URL('../public/brand/favicon.png', import.meta.url);
const originalHash = '5b1e9aa6d4efbd19a3ae7324146ec835a8e1899eff73d93af99c001f7165a091';

export async function generateFavicon() {
  const logo = await readFile(logoPath);
  if (createHash('sha256').update(logo).digest('hex') !== originalHash) throw new Error('Changed original church identity');
  // The original signature contains the emblem on the left; exclude the
  // decorative underline and preserve its natural proportions.
  const emblem = await sharp(logo).extract({ left: 0, top: 0, width: 95, height: 70 })
    .resize(150, 150, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  const background = Buffer.from('<svg width="192" height="192" xmlns="http://www.w3.org/2000/svg"><circle cx="96" cy="96" r="90" fill="#ffffff" stroke="#8ba0b7" stroke-width="4"/></svg>');
  return sharp(background).composite([{ input: emblem, gravity: 'centre' }]).png().toBuffer();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await writeFile(outputPath, await generateFavicon());