import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHeifHeader, looksLikeHeic, jpegName } from './heic.ts';

const header = (brand: string) => {
  const b = new Uint8Array(12);
  b.set([0, 0, 0, 24]);
  b.set(new TextEncoder().encode('ftyp' + brand), 4);
  return b;
};

test('isHeifHeader: recognises iPhone HEIC and generic HEIF brands', () => {
  for (const brand of ['heic', 'heix', 'mif1', 'msf1', 'hevc']) assert.equal(isHeifHeader(header(brand)), true, brand);
});

test('isHeifHeader: rejects other formats and short input', () => {
  assert.equal(isHeifHeader(header('avif')), false); // AVIF shares the box layout but is not HEIC
  assert.equal(isHeifHeader(header('isom')), false); // MP4
  assert.equal(isHeifHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), false); // JPEG
  assert.equal(isHeifHeader(new Uint8Array(4)), false);
});

test('looksLikeHeic: by MIME type or by extension when the type is empty', () => {
  assert.equal(looksLikeHeic({ name: 'a.jpg', type: 'image/heic' }), true);
  assert.equal(looksLikeHeic({ name: 'a.jpg', type: 'image/heif' }), true);
  assert.equal(looksLikeHeic({ name: 'IMG_0042.HEIC', type: '' }), true);
  assert.equal(looksLikeHeic({ name: 'IMG_0042.jpeg', type: 'image/jpeg' }), false);
});

test('jpegName: swaps the extension, keeps the name', () => {
  assert.equal(jpegName('IMG_1234.HEIC'), 'IMG_1234.jpg');
  assert.equal(jpegName('beach.heif'), 'beach.jpg');
  assert.equal(jpegName('.heic'), 'photo.jpg');
});
