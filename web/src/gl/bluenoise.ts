/**
 * Blue-noise dither mask generation (Ulichney's void-and-cluster algorithm).
 *
 * A real blue-noise mask is generated at first launch (no bundled image
 * assets) and cached in localStorage. Blue noise pushes quantisation error
 * into high spatial frequencies where the eye cannot see it — essential for
 * banding-free 8-bit output of the sky's smooth gradients.
 */

const CACHE_KEY = 'soramado:bluenoise:v1';

export const BLUE_NOISE_SIZE = 64;

/** Toroidal Gaussian energy kernel, sigma = 1.9 (Ulichney's choice). */
function buildKernel(size: number): Float32Array {
  const k = new Float32Array(size * size);
  const sigma2 = 1.9 * 1.9;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, size - x);
      const dy = Math.min(y, size - y);
      k[y * size + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma2));
    }
  }
  return k;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class EnergyField {
  energy: Float32Array;
  constructor(
    private size: number,
    private kernel: Float32Array,
  ) {
    this.energy = new Float32Array(size * size);
  }

  splat(px: number, py: number, sign: number): void {
    const s = this.size;
    const k = this.kernel;
    const e = this.energy;
    for (let y = 0; y < s; y++) {
      const ky = ((y - py + s) % s) * s;
      const row = y * s;
      for (let x = 0; x < s; x++) {
        e[row + x] += sign * k[ky + ((x - px + s) % s)];
      }
    }
  }

  /** Index of the max-energy cell among cells where mask[i] === val. */
  extremum(mask: Uint8Array, val: number, findMax: boolean): number {
    let best = -1;
    let bestE = findMax ? -Infinity : Infinity;
    const e = this.energy;
    for (let i = 0; i < e.length; i++) {
      if (mask[i] !== val) continue;
      if (findMax ? e[i] > bestE : e[i] < bestE) {
        bestE = e[i];
        best = i;
      }
    }
    return best;
  }
}

export function generateBlueNoise(size = BLUE_NOISE_SIZE): Uint8Array {
  // Cached?
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const bytes = Uint8Array.from(atob(cached), (c) => c.charCodeAt(0));
      if (bytes.length === size * size) return bytes;
    }
  } catch {
    /* no cache available */
  }

  const n = size * size;
  const kernel = buildKernel(size);
  const rand = mulberry32(0x5eed);

  // --- Phase 0: initial binary pattern, ~10% minority pixels
  const ones = Math.floor(n * 0.1);
  const bp = new Uint8Array(n);
  const field = new EnergyField(size, kernel);
  {
    let placed = 0;
    while (placed < ones) {
      const i = Math.floor(rand() * n);
      if (!bp[i]) {
        bp[i] = 1;
        field.splat(i % size, Math.floor(i / size), +1);
        placed++;
      }
    }
    // Relaxation: move the tightest cluster into the largest void.
    for (let iter = 0; iter < 4 * n; iter++) {
      const cluster = field.extremum(bp, 1, true);
      bp[cluster] = 0;
      field.splat(cluster % size, Math.floor(cluster / size), -1);
      const voidIdx = field.extremum(bp, 0, false);
      bp[voidIdx] = 1;
      field.splat(voidIdx % size, Math.floor(voidIdx / size), +1);
      if (voidIdx === cluster) break; // converged
    }
  }

  const rank = new Int32Array(n).fill(-1);

  // --- Phase 1: rank the initial minority pixels by removing tightest first
  {
    const work = bp.slice();
    const f = new EnergyField(size, kernel);
    for (let i = 0; i < n; i++) {
      if (work[i]) f.splat(i % size, Math.floor(i / size), +1);
    }
    for (let r = ones - 1; r >= 0; r--) {
      const i = f.extremum(work, 1, true);
      work[i] = 0;
      f.splat(i % size, Math.floor(i / size), -1);
      rank[i] = r;
    }
  }

  // --- Phase 2: fill the remaining voids in order
  {
    const work = bp.slice();
    const f = new EnergyField(size, kernel);
    for (let i = 0; i < n; i++) {
      if (work[i]) f.splat(i % size, Math.floor(i / size), +1);
    }
    for (let r = ones; r < n; r++) {
      const i = f.extremum(work, 0, false);
      work[i] = 1;
      f.splat(i % size, Math.floor(i / size), +1);
      rank[i] = r;
    }
  }

  // Normalise ranks to bytes.
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.min(255, Math.round((rank[i] * 255) / (n - 1)));
  }

  try {
    localStorage.setItem(CACHE_KEY, btoa(String.fromCharCode(...out)));
  } catch {
    /* persistence unavailable */
  }
  return out;
}
