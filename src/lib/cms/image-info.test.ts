import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readImageInfo } from './image-info.ts';

async function fixture(mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', w = 40, h = 30): Promise<Uint8Array> {
  if (mime === 'image/gif') {
    // minimal GIF89a header + logical screen descriptor (width/height little-endian)
    const b = new Uint8Array(13);
    const text = new TextEncoder();
    b.set(text.encode('GIF89a'), 0);
    b[6] = w & 0xff; b[7] = (w >> 8) & 0xff;
    b[8] = h & 0xff; b[9] = (h >> 8) & 0xff;
    b[10] = 0x00; // global color table flag 0
    b[11] = 0x00; b[12] = 0x00;
    return b;
  }
  const b = sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } });
  const buf = await (mime === 'image/jpeg' ? b.jpeg() : mime === 'image/png' ? b.png() : b.webp()).toBuffer();
  return new Uint8Array(buf);
}

test('image-info: reads dimensions and MIME from real JPEG', async () => {
  assert.deepEqual(readImageInfo(await fixture('image/jpeg')), { width: 40, height: 30, mime: 'image/jpeg' });
});

test('image-info: reads dimensions and MIME from real PNG', async () => {
  assert.deepEqual(readImageInfo(await fixture('image/png')), { width: 40, height: 30, mime: 'image/png' });
});

test('image-info: reads dimensions and MIME from real WebP (lossy VP8)', async () => {
  assert.deepEqual(readImageInfo(await fixture('image/webp')), { width: 40, height: 30, mime: 'image/webp' });
});

test('image-info: reads dimensions and MIME from GIF', async () => {
  assert.deepEqual(readImageInfo(await fixture('image/gif')), { width: 40, height: 30, mime: 'image/gif' });
});

test('image-info: rejects a text file renamed .png', () => {
  assert.throws(() => readImageInfo(new Uint8Array(Buffer.from('this is not an image, just text'))), /unrecognized image format/);
});

test('image-info: rejects malformed binary that claims a PNG signature', () => {
  const junk = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.throws(() => readImageInfo(junk), /PNG/);
});

test('image-info: rejects a truncated header', () => {
  assert.throws(() => readImageInfo(new Uint8Array([0xff, 0xd8])), /too small/);
});