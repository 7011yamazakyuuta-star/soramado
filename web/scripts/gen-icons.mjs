/**
 * Generates the PWA icons programmatically (no image assets, no deps):
 * a simple sky-gradient with a thin "window" frame motif.
 *
 *   node scripts/gen-icons.mjs
 *
 * Outputs to public/icons/. Committed to the repo so builds need no step.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------ PNG encoder
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------ icon artwork
const lerp = (a, b, t) => a + (b - a) * t;

/** Signed distance to a rounded-rectangle border (for the window frame). */
function roundRectDist(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function drawIcon(size, { frame }) {
  const rgba = Buffer.alloc(size * size * 4);
  // Zenith-to-horizon sky gradient (matches the app's daytime palette).
  const top = [16, 56, 134];
  const mid = [56, 116, 200];
  const bot = [186, 216, 244];
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const c =
      t < 0.62
        ? [0, 1, 2].map((i) => lerp(top[i], mid[i], t / 0.62))
        : [0, 1, 2].map((i) => lerp(mid[i], bot[i], (t - 0.62) / 0.38));
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      rgba[o] = c[0];
      rgba[o + 1] = c[1];
      rgba[o + 2] = c[2];
      rgba[o + 3] = 255;
    }
  }
  if (frame) {
    // Thin rounded window frame, slightly translucent white.
    const inset = size * 0.16;
    const half = size / 2 - inset;
    const thick = size * 0.022;
    const radius = size * 0.1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.abs(roundRectDist(x + 0.5, y + 0.5, size / 2, size / 2, half, half, radius));
        const a = Math.max(0, Math.min(1, thick - d + 0.5));
        if (a > 0) {
          const o = (y * size + x) * 4;
          const fa = a * 0.92;
          rgba[o] = Math.round(lerp(rgba[o], 245, fa));
          rgba[o + 1] = Math.round(lerp(rgba[o + 1], 250, fa));
          rgba[o + 2] = Math.round(lerp(rgba[o + 2], 255, fa));
        }
      }
    }
  }
  return encodePng(size, size, rgba);
}

writeFileSync(join(outDir, 'icon-192.png'), drawIcon(192, { frame: true }));
writeFileSync(join(outDir, 'icon-512.png'), drawIcon(512, { frame: true }));
writeFileSync(join(outDir, 'icon-maskable-512.png'), drawIcon(512, { frame: false }));
writeFileSync(join(outDir, 'apple-touch-icon.png'), drawIcon(180, { frame: true }));
console.log('icons written to', outDir);
