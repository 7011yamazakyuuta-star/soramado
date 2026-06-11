/**
 * Physical constants of the Earth's atmosphere used by the renderer.
 *
 * The model follows the single-scattering formulation of
 * Bruneton & Neyret 2008 ("Precomputed Atmospheric Scattering") with the
 * commonly used parameter set of Hillaire 2020. All values are SI (metres).
 */

/** Ground (sea level) radius of the Earth [m]. */
export const GROUND_RADIUS = 6_360_000;

/** Top of the simulated atmosphere [m] (100 km shell). */
export const ATMOSPHERE_RADIUS = 6_460_000;

/** Rayleigh density scale height [m]. */
export const RAYLEIGH_SCALE_HEIGHT = 8_500;

/** Mie density scale height [m]. */
export const MIE_SCALE_HEIGHT = 1_200;

/** RGB wavelengths used to evaluate the wavelength-dependent coefficients [m]. */
export const WAVELENGTHS_RGB: [number, number, number] = [680e-9, 550e-9, 440e-9];

/**
 * Rayleigh scattering coefficient at sea level, derived from first principles:
 *
 *   βR(λ) = 8π³ (n² − 1)² / (3 N λ⁴) · (6 + 3p) / (6 − 7p)
 *
 * with n the refractive index of air, N the molecular number density at sea
 * level and p the depolarisation factor. The λ⁻⁴ term is what makes the sky
 * blue and the sunsets red — no colours are hard-coded anywhere.
 */
export function rayleighBeta(
  lambdas: [number, number, number] = WAVELENGTHS_RGB,
): [number, number, number] {
  const n = 1.000293; // refractive index of air (sea level, visible light)
  const N = 2.547e25; // molecules / m^3 at sea level (15 °C, 1013 hPa)
  const p = 0.035; // depolarisation factor
  const king = (6 + 3 * p) / (6 - 7 * p);
  const f = (8 * Math.PI ** 3 * (n * n - 1) ** 2 * king) / (3 * N);
  return lambdas.map((l) => f / l ** 4) as [number, number, number];
}

/** Mie scattering coefficient at sea level [1/m] (weakly wavelength dependent). */
export const MIE_SCATTERING = 3.996e-6;

/** Mie extinction = scattering + absorption [1/m]. */
export const MIE_EXTINCTION = 4.44e-6;

/** Mie phase asymmetry (Henyey–Greenstein g). */
export const MIE_G = 0.8;

/**
 * Ozone absorption coefficient at the centre of the ozone layer [1/m].
 * Ozone barely matters at noon but is responsible for the deep indigo of the
 * twilight zenith (the "blue hour").
 */
export const OZONE_ABSORPTION: [number, number, number] = [0.65e-6, 1.881e-6, 0.085e-6];

/** Ozone layer: tent profile centred at 25 km with 15 km half width. */
export const OZONE_CENTER = 25_000;
export const OZONE_HALF_WIDTH = 15_000;

/**
 * Solar irradiance tint at the top of the atmosphere, normalised to max=1.
 * Approximates a 5778 K black body sampled at WAVELENGTHS_RGB.
 */
export const SUN_TINT: [number, number, number] = [1.0, 0.949, 0.894];

/** Overall solar intensity in renderer radiance units (exposure-calibrated). */
export const SUN_INTENSITY = 20.0;

/** Angular radius of the solar disc [rad] (~0.2665°). */
export const SUN_ANGULAR_RADIUS = 0.004651;
