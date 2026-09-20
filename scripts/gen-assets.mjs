// Generates public/og.jpg (1200×630) and public/apple-touch-icon.png (180×180)
// from genuine archive photographs.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dir = 'src/assets/images';
const files = fs.readdirSync(dir);
const jpg = files.filter((f) => /\.jpe?g$/i.test(f));

let wide = files
  .map((f) => {
    const buf = fs.readFileSync(path.join(dir, f));
    return { f, buf };
  })
  .find((x) => x.f && x.f.startsWith('dsc_'));

// pick the widest landscape photo for og
let best = null;
for (const buf of files.map((f) => ({ f, buf: fs.readFileSync(path.join(dir, f)) }))) {
  try {
    const m = await sharp(buf.buf).metadata();
    if (m.width >= 600 && m.height && m.width > m.height) best = buf;
  } catch {}
}
if (!best) best = wide || { buf: fs.readFileSync(path.join(dir, files[0])) };

await sharp(best.buf)
  .resize(1200, 630, { fit: 'cover', position: 'centre' })
  .jpeg({ quality: 82 })
  .toFile('public/og.jpg');

await sharp(best.buf)
  .resize(180, 180, { fit: 'cover', position: 'centre' })
  .png()
  .toFile('public/apple-touch-icon.png');

console.log('og.jpg + apple-touch-icon.png generated from', best.f);