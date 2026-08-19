/**
 * gen-icons.mjs — zero-dependency PWA icon generator for One Life.
 *
 * Paints a vertical #0A84FF → #5E5CE6 gradient with a centered white ring
 * (the "life loop" mark) and encodes valid PNGs using only node:zlib — no
 * canvas or image libraries. Run via `npm run icons`.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';

const SIZES = [180, 512];
const TOP = [0x0a, 0x84, 0xff]; // #0A84FF
const BOTTOM = [0x5e, 0x5c, 0xe6]; // #5E5CE6
const RING_INNER = 0.3;
const RING_OUTER = 0.42;

const OUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url));

// Standard CRC32 table (polynomial 0xEDB88320).
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Wrap raw chunk data in a PNG chunk: length, type, data, CRC over type+data. */
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Anti-aliased annulus coverage in [0, 1] with a ~1px soft edge. */
function ringCoverage(dist, inner, outer) {
  const edge = Math.min(dist - inner, outer - dist) + 0.5;
  return Math.min(1, Math.max(0, edge));
}

/** Build the RGBA scanline buffer (filter byte 0 per row) for one icon size. */
function paint(size) {
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  const center = size / 2;
  const inner = RING_INNER * size;
  const outer = RING_OUTER * size;

  for (let y = 0; y < size; y += 1) {
    const t = size > 1 ? y / (size - 1) : 0;
    const rowR = Math.round(TOP[0] + (BOTTOM[0] - TOP[0]) * t);
    const rowG = Math.round(TOP[1] + (BOTTOM[1] - TOP[1]) * t);
    const rowB = Math.round(TOP[2] + (BOTTOM[2] - TOP[2]) * t);
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter type 0 (None)

    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const cov = ringCoverage(Math.sqrt(dx * dx + dy * dy), inner, outer);
      const i = rowStart + 1 + x * 4;
      raw[i] = Math.round(rowR + (255 - rowR) * cov);
      raw[i + 1] = Math.round(rowG + (255 - rowG) * cov);
      raw[i + 2] = Math.round(rowB + (255 - rowB) * cov);
      raw[i + 3] = 255; // fully opaque — apple-touch-icons must not be transparent
    }
  }
  return raw;
}

/** Encode one RGBA scanline buffer as a complete PNG file. */
function encodePng(size, raw) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6 = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  const png = encodePng(size, paint(size));
  writeFileSync(file, png);
  console.log(`gen-icons: wrote icon-${size}.png (${png.length} bytes)`);
}
