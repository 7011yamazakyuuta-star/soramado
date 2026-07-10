/**
 * Full naked-eye star catalogue: Hipparcos-2 stars with real B-V colour
 * indices, decoded from an embedded binary ('SORB' + u32 count + quantised
 * records). The 116 built-in bright stars remain as a decode-failure
 * fallback.
 */

import { HIPPARCOS_B64 } from './hipparcos_b64';

/** Interleaved GPU layout: x, y, z (equatorial), mag, r, g, b — 7 floats. */
export interface StarCatalog {
  data: Float32Array;
  count: number;
}

/**
 * B-V colour index -> approximate linear RGB tint (normalised, max = 1).
 * Ballesteros' formula gives the black-body temperature; a standard
 * black-body fit gives the colour. Slightly desaturated so point sources
 * read naturally (full saturation looks artificial at 2-4 px).
 */
export function bvToRgb(bv: number): [number, number, number] {
  const b = Math.min(2.0, Math.max(-0.4, bv));
  const t = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62)); // Kelvin
  const T = t / 100;
  let r: number, g: number, blu: number;
  if (T <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(T) - 161.1195681661;
    blu = T <= 19 ? 0 : 138.5177312231 * Math.log(T - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(T - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(T - 60, -0.0755148492);
    blu = 255;
  }
  const c = [r, g, blu].map((v) => Math.min(255, Math.max(0, v)) / 255);
  const m = Math.max(c[0], c[1], c[2], 1e-3);
  // Normalise so colour never dims the star, then soften toward white.
  return [
    1 - (1 - c[0] / m) * 0.75,
    1 - (1 - c[1] / m) * 0.75,
    1 - (1 - c[2] / m) * 0.75,
  ] as [number, number, number];
}

/** Equatorial direction matching uStarMat's sky-fixed frame (verified). */
export function eqDir(raRad: number, decRad: number): [number, number, number] {
  const cd = Math.cos(decRad);
  return [cd * Math.cos(raRad), -cd * Math.sin(raRad), Math.sin(decRad)];
}

export function getStarCatalog(): StarCatalog | null {
  try {
    const bin = atob(HIPPARCOS_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dv = new DataView(bytes.buffer);
    if (dv.getUint32(0, false) !== 0x534f5242) return null; // 'SORB'
    const count = dv.getUint32(4, true);
    const data = new Float32Array(count * 7);
    for (let i = 0; i < count; i++) {
      const o = 8 + i * 6;
      const ra = (dv.getUint16(o, true) / 65536) * 2 * Math.PI;
      const dec = (dv.getInt16(o + 2, true) / 32767) * (Math.PI / 2);
      const mag = dv.getUint8(o + 4) / 28 - 1.5;
      const bv = dv.getInt8(o + 5) / 50;
      const [x, y, z] = eqDir(ra, dec);
      const [r, g, b] = bvToRgb(bv);
      data.set([x, y, z, mag, r, g, b], i * 7);
    }
    console.info(`[soramado] star catalogue loaded: ${count} stars`);
    return { data, count };
  } catch {
    return null; // fall back to the built-in bright stars
  }
}
