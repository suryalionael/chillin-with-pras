// iPhones save photos as HEIC. Browsers other than Safari can't decode HEIC,
// and the upload endpoint only accepts JPEG/PNG/WebP/GIF (it sniffs the bytes),
// so the image picker converts HEIC to JPEG in the browser before uploading.
// The decoder (heic-to, libheif compiled to WebAssembly, ~3MB) is imported
// lazily, so it's only downloaded when someone actually picks a HEIC photo.

const UPLOAD_LIMIT = 20_000_000; // keep in step with MAX_UPLOAD_BYTES in api/admin/images
// ISO-BMFF brands HEIC/HEIF files declare in their `ftyp` box.
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** True when the first bytes of a file are a HEIC/HEIF `ftyp` header. */
export function isHeifHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ascii = (from: number) => String.fromCharCode(...bytes.subarray(from, from + 4));
  return ascii(4) === 'ftyp' && HEIF_BRANDS.has(ascii(8));
}

/** Name or type says HEIC (Chrome on Windows often reports an empty type). */
export function looksLikeHeic(file: { name: string; type: string }): boolean {
  return /^image\/hei[cf](-sequence)?$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/** Checks the actual bytes, so a renamed HEIC is still caught and a mislabelled JPEG isn't. */
export async function isHeicFile(file: File): Promise<boolean> {
  return isHeifHeader(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
}

/** `IMG_1234.HEIC` → `IMG_1234.jpg` */
export function jpegName(name: string): string {
  return `${name.replace(/\.hei[cf]$/i, '') || 'photo'}.jpg`;
}

/**
 * Converts a HEIC/HEIF photo to a JPEG File. The photo's rotation is applied
 * and its metadata (including GPS location) is dropped. If the JPEG would be
 * over the upload limit, it's re-encoded at a lower quality.
 */
export async function heicToJpeg(file: File): Promise<File> {
  const { heicTo } = await import('heic-to');
  let blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
  for (const quality of [0.8, 0.65]) {
    if (blob.size <= UPLOAD_LIMIT) break;
    blob = await heicTo({ blob: file, type: 'image/jpeg', quality });
  }
  return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
}
