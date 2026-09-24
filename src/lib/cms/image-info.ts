// Minimal, dependency-free image header reader (JPEG/PNG/WebP/GIF).
//
// The upload endpoint runs inside the Cloudflare Worker (workerd), where the
// native `sharp` binary cannot be loaded; the project's `sharp` build-time
// image pipeline (`imageService: 'compile'`) runs in Node during the Astro
// build, not on the request path. So dimensions + real-format validation are
// derived from the file's binary headers here. This intentionally lives
// outside the runtime Worker module graph that would pull sharp in.

export interface ImageInfo {
  width: number;
  height: number;
  /** 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' */
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

const JPEG_SOF = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];

function parseJpeg(b: Uint8Array): ImageInfo {
  // SOI marker
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG');
  let pos = 2;
  while (pos < b.length) {
    if (b[pos] !== 0xff) {
      // skip fill bytes
      pos++;
      continue;
    }
    let marker = b[pos + 1];
    // standalone fill 0xFF
    if (marker === 0xff) {
      pos++;
      continue;
    }
    pos += 2;
    // standalone markers without length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xd8) continue;
    // SOS -> no more headers worth scanning for SOF (image data follows)
    if (marker === 0xda) break;
    if (pos + 2 > b.length) break;
    const len = (b[pos] << 8) | b[pos + 1];
    if (len < 2 || pos + len > b.length) break;
    if (JPEG_SOF.includes(marker)) {
      // len includes the 2 length bytes: precision, then height, then width
      if (len < 7) throw new Error('bad JPEG SOF');
      const height = (b[pos + 3] << 8) | b[pos + 4];
      const width = (b[pos + 5] << 8) | b[pos + 6];
      if (!width || !height) throw new Error('bad JPEG dims');
      return { width, height, mime: 'image/jpeg' };
    }
    pos += len;
  }
  throw new Error('no JPEG SOF found');
}

function parsePng(b: Uint8Array): ImageInfo {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) throw new Error('not a PNG');
  // IHDR chunk: length(4) + "IHDR"(4) + width(4) + height(4)
  const pos = 8;
  if (b.length < pos + 16) throw new Error('truncated PNG');
  if (b[pos + 4] !== 0x49 || b[pos + 5] !== 0x48 || b[pos + 6] !== 0x44 || b[pos + 7] !== 0x52) throw new Error('PNG without IHDR');
  const width = ((b[pos + 8] << 24) | (b[pos + 9] << 16) | (b[pos + 10] << 8) | b[pos + 11]) >>> 0;
  const height = ((b[pos + 12] << 24) | (b[pos + 13] << 16) | (b[pos + 14] << 8) | b[pos + 15]) >>> 0;
  if (!width || !height) throw new Error('bad PNG dims');
  return { width, height, mime: 'image/png' };
}

function parseWebp(b: Uint8Array): ImageInfo {
  // RIFF....WEBP
  if (b.length < 20 || b[0] !== 0x52 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x46) throw new Error('not a WebP');
  if (b[8] !== 0x57 || b[9] !== 0x45 || b[10] !== 0x42 || b[11] !== 0x50) throw new Error('not a WebP');
  const chunkType = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunkType === 'VP8X') {
    // VP8X: 1byte flags + 3 reserved + 3x24-bit canvas
    if (b.length < 30) throw new Error('truncated WebP VP8X');
    const w = 1 + ((b[24] | (b[25] << 8) | (b[26] << 16)) & 0xffffff);
    const h = 1 + ((b[27] | (b[28] << 8) | (b[29] << 16)) & 0xffffff);
    if (!w || !h) throw new Error('bad WebP dims');
    return { width: w, height: h, mime: 'image/webp' };
  }
  if (chunkType === 'VP8 ') {
    // VP8 lossy: frame tag at 20 + 3-byte start code + 2-byte dimensions
    if (b.length < 30) throw new Error('truncated WebP VP8');
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) throw new Error('bad WebP VP8 start code');
    const width = ((b[26] | (b[27] << 8)) & 0x3fff);
    const height = ((b[28] | (b[29] << 8)) & 0x3fff);
    if (!width || !height) throw new Error('bad WebP dims');
    return { width, height, mime: 'image/webp' };
  }
  if (chunkType === 'VP8L') {
    // VP8L lossless: 1 byte signature 0x2f + 4 bytes of packed 14-bit dims-1
    if (b.length < 25) throw new Error('truncated WebP VP8L');
    if (b[20] !== 0x2f) throw new Error('bad WebP VP8L signature');
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    if (!width || !height) throw new Error('bad WebP dims');
    return { width, height, mime: 'image/webp' };
  }
  throw new Error('unrecognized WebP chunk');
}

function parseGif(b: Uint8Array): ImageInfo {
  // Header "GIF87a" | "GIF89a" then logical screen descriptor (width/height, LE).
  if (b.length < 13) throw new Error('truncated GIF');
  const hdr = String.fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5]);
  if (hdr !== 'GIF87a' && hdr !== 'GIF89a') throw new Error('not a GIF');
  const width = b[6] | (b[7] << 8);
  const height = b[8] | (b[9] << 8);
  if (!width || !height) throw new Error('bad GIF dims');
  return { width, height, mime: 'image/gif' };
}

/** Reads a decodable image's real dimensions + detected MIME, or throws. */
export function readImageInfo(bytes: Uint8Array): ImageInfo {
  if (!bytes || bytes.length < 13) throw new Error('file too small to be an image');
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes);
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return parsePng(bytes);
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return parseWebp(bytes);
  if (bytes.length >= 13 && (String.fromCharCode(bytes[0], bytes[1], bytes[2]) === 'GIF')) return parseGif(bytes);
  throw new Error('unrecognized image format');
}