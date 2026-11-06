import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ApiError } from './errors.mjs';
const MAX_INPUT = 65536, MAX_OUTPUT = 49152;
sharp.cache({ memory:8, files:0, items:16 });
sharp.concurrency(1);
const invalid = () => { throw new ApiError(400, 'INVALID_COVER_PHOTO'); };
export async function prepareCoverPhoto(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 87384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) invalid();
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > MAX_INPUT || bytes.toString('base64') !== value) invalid();
  const jpeg = bytes.subarray(0,3).equals(Buffer.from([255,216,255])), png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), webp = bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
  if (!jpeg && !png && !webp) invalid(); // Never hand SVG, PDF, GIF, etc. to a decoder.
  try {
    const image = sharp(bytes, { limitInputPixels:3_000_000, failOn:'error', sequentialRead:true, animated:false });
    const meta = await image.metadata();
    if (!['jpeg','png','webp'].includes(meta.format) || !meta.width || !meta.height || meta.width > 2000 || meta.height > 2000 || (meta.pages || 1) !== 1) invalid();
    // Decode/re-encode on the server; browser claims never preserve EXIF/GPS,
    // active formats or appended source bytes. Never call withMetadata().
    let output;
    for (const quality of [75,60,45]) {
      output = await image.clone().rotate().flatten({ background:'#ffffff' }).resize({ width:900,height:1200,fit:'inside',withoutEnlargement:true }).jpeg({ quality,mozjpeg:false }).timeout({ seconds:2 }).toBuffer();
      if (output.length <= MAX_OUTPUT) break;
    }
    if (output.length > MAX_OUTPUT) output = await image.clone().rotate().flatten({ background:'#ffffff' }).resize({ width:600,height:800,fit:'inside',withoutEnlargement:true }).jpeg({ quality:60 }).timeout({ seconds:2 }).toBuffer();
    if (output.length > MAX_OUTPUT) throw new ApiError(413, 'COVER_PHOTO_TOO_LARGE');
    return { bytes:output.toString('base64'),sha256:createHash('sha256').update(output).digest('hex') };
  } catch (error) { if (error instanceof ApiError) throw error; invalid(); }
}
