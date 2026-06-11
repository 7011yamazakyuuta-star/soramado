/**
 * Pluggable sky-radiance source abstraction.
 *
 * Phase 1 ships the realtime single-scattering path. If precomputed
 * multiple-scattering LUTs (built with /colab/multi_scattering_lut.ipynb)
 * are deployed under /lut/, they are loaded here and the renderer switches
 * to the LUT shader variant. The same interface is the intended seam for a
 * future neural sky model (trained in Colab, exported as textures/ONNX).
 */

export interface LutManifest {
  version: number;
  /** Multiplier applied to stored radiance (usually 1). */
  radianceScale?: number;
  transmittance: { file: string; width: number; height: number };
  scattering: { file: string; muSize: number; muSSize: number; nuSize: number };
}

export interface SkyLut {
  manifest: LutManifest;
  /** RGBA float16 data, width*height*4. */
  transmittance: Uint16Array;
  /** RGBA float16 data, mu*muS*nu*4 (x fastest). */
  scattering: Uint16Array;
}

export type SkySource =
  | { kind: 'realtime-single' }
  | { kind: 'lut-multi'; lut: SkyLut };

/** float32 -> float16 bit conversion (round-to-nearest-even-ish). */
export function toHalf(f: number): number {
  floatView[0] = f;
  const x = intView[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 1 : 0); // Inf/NaN
  exp = exp - 127 + 15;
  if (exp >= 0x1f) return sign | 0x7c00; // overflow -> Inf
  if (exp <= 0) {
    if (exp < -10) return sign; // underflow -> 0
    mant = (mant | 0x800000) >> (1 - exp);
    return sign + ((mant + 0x1000) >> 13);
  }
  // Plain additions so a mantissa rounding carry propagates into the
  // exponent (e.g. 0.0312475 must round to 0x2800, not collapse to 0x2400).
  return (sign + (exp << 10)) + ((mant + 0x1000) >> 13);
}

const floatView = new Float32Array(1);
const intView = new Uint32Array(floatView.buffer);

/** RGB float32 buffer -> RGBA float16 (A = 1.0). */
function rgbFloatToRgbaHalf(rgb: Float32Array, scale: number): Uint16Array {
  const texels = rgb.length / 3;
  const out = new Uint16Array(texels * 4);
  const one = toHalf(1);
  for (let i = 0; i < texels; i++) {
    out[i * 4 + 0] = toHalf(rgb[i * 3 + 0] * scale);
    out[i * 4 + 1] = toHalf(rgb[i * 3 + 1] * scale);
    out[i * 4 + 2] = toHalf(rgb[i * 3 + 2] * scale);
    out[i * 4 + 3] = one;
  }
  return out;
}

/**
 * Try to load LUTs from /lut/. Resolves to the realtime source when the
 * manifest is missing or malformed (the documented fallback behaviour).
 */
export async function loadSkySource(baseUrl = ''): Promise<SkySource> {
  try {
    const res = await fetch(`${baseUrl}/lut/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return { kind: 'realtime-single' };
    const manifest = (await res.json()) as LutManifest;
    if (!manifest?.transmittance?.file || !manifest?.scattering?.file) {
      return { kind: 'realtime-single' };
    }

    const [transBuf, scatBuf] = await Promise.all([
      fetch(`${baseUrl}/lut/${manifest.transmittance.file}`).then((r) => {
        if (!r.ok) throw new Error(`transmittance: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch(`${baseUrl}/lut/${manifest.scattering.file}`).then((r) => {
        if (!r.ok) throw new Error(`scattering: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);

    const t = manifest.transmittance;
    const s = manifest.scattering;
    const transF32 = new Float32Array(transBuf);
    const scatF32 = new Float32Array(scatBuf);
    if (transF32.length !== t.width * t.height * 3) {
      throw new Error('transmittance LUT size mismatch');
    }
    if (scatF32.length !== s.muSize * s.muSSize * s.nuSize * 3) {
      throw new Error('scattering LUT size mismatch');
    }

    const scale = manifest.radianceScale ?? 1;
    const lut: SkyLut = {
      manifest,
      transmittance: rgbFloatToRgbaHalf(transF32, 1),
      scattering: rgbFloatToRgbaHalf(scatF32, scale),
    };
    console.info('[soramado] multiple-scattering LUT loaded');
    return { kind: 'lut-multi', lut };
  } catch (err) {
    console.info('[soramado] no LUT available, using realtime single scattering', err);
    return { kind: 'realtime-single' };
  }
}
