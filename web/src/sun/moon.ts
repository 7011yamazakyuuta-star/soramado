/**
 * Low-precision lunar ephemeris (truncated Meeus, "Astronomical Algorithms").
 * Position accuracy ~0.3 deg — far better than needed to render the moon and
 * its sky illumination at the right place, phase and brightness.
 */

import { julianDay, lstRad } from './solar';

const RAD = Math.PI / 180;

export interface MoonState {
  /** Unit direction in world coords (x=E, y=up, z=N). */
  dir: [number, number, number];
  elevationDeg: number;
  /** Geocentric distance [km]. */
  distanceKm: number;
  /** Angular radius [rad]. */
  angularRadius: number;
  /** Phase angle [deg]: 0 = full, 180 = new. */
  phaseAngleDeg: number;
  /** Illuminated fraction 0..1. */
  illuminatedFraction: number;
  /** Irradiance relative to a full moon (Allen's phase law). */
  phaseBrightness: number;
}

/** Equatorial (RA/Dec, radians) -> world direction for observer (lat, LST). */
export function worldFromEquatorial(
  raRad: number,
  decRad: number,
  latRad: number,
  lst: number,
): [number, number, number] {
  const H = lst - raRad; // hour angle
  const cd = Math.cos(decRad);
  const sd = Math.sin(decRad);
  const cH = Math.cos(H);
  const sH = Math.sin(H);
  const cp = Math.cos(latRad);
  const sp = Math.sin(latRad);
  // Basis: e1 = equator@meridian, e2 = west, e3 = celestial pole.
  return [
    -cd * sH, // east
    cp * cd * cH + sp * sd, // up
    -sp * cd * cH + cp * sd, // north
  ];
}

export function moonState(date: Date, latDeg: number, lonDeg: number): MoonState {
  const d = julianDay(date) - 2_451_545.0;

  // Fundamental arguments (deg)
  const Lp = 218.316 + 13.176396 * d; // mean longitude
  const M = 134.963 + 13.064993 * d; // mean anomaly (moon)
  const Ms = 357.529 + 0.98560028 * d; // mean anomaly (sun)
  const F = 93.272 + 13.22935 * d; // argument of latitude
  const D = 297.85 + 12.190749 * d; // mean elongation

  const m = M * RAD;
  const ms = Ms * RAD;
  const f = F * RAD;
  const dd = D * RAD;

  // Ecliptic longitude/latitude (deg), main periodic terms
  const lambda =
    Lp +
    6.289 * Math.sin(m) -
    1.274 * Math.sin(m - 2 * dd) +
    0.658 * Math.sin(2 * dd) -
    0.186 * Math.sin(ms) -
    0.059 * Math.sin(2 * m - 2 * dd) -
    0.057 * Math.sin(m - 2 * dd + ms) +
    0.053 * Math.sin(m + 2 * dd);
  const beta =
    5.128 * Math.sin(f) +
    0.281 * Math.sin(m + f) -
    0.28 * Math.sin(f - m) -
    0.173 * Math.sin(f - 2 * dd);
  const dist =
    385_001 -
    20_905 * Math.cos(m) -
    3_699 * Math.cos(2 * dd - m) -
    2_956 * Math.cos(2 * dd);

  // Ecliptic -> equatorial (J2000-ish obliquity is fine at this precision)
  const eps = 23.4393 * RAD;
  const lam = lambda * RAD;
  const bet = beta * RAD;
  const x = Math.cos(bet) * Math.cos(lam);
  const y = Math.cos(eps) * Math.cos(bet) * Math.sin(lam) - Math.sin(eps) * Math.sin(bet);
  const z = Math.sin(eps) * Math.cos(bet) * Math.sin(lam) + Math.cos(eps) * Math.sin(bet);
  const ra = Math.atan2(y, x);
  const dec = Math.asin(Math.max(-1, Math.min(1, z)));

  const lst = lstRad(date, lonDeg);
  let dir = worldFromEquatorial(ra, dec, latDeg * RAD, lst);
  // Topocentric correction: the observer stands one Earth radius above the
  // geocentre, which lowers the apparent moon by up to ~1 deg.
  {
    const k = 6371 / dist;
    const len = Math.hypot(dir[0], dir[1] - k, dir[2]);
    dir = [dir[0] / len, (dir[1] - k) / len, dir[2] / len];
  }

  // Phase: elongation between sun and moon ecliptic longitudes.
  const lambdaSun =
    280.466 + 0.98564736 * d + 1.915 * Math.sin(ms) + 0.02 * Math.sin(2 * ms);
  const cosPsi =
    Math.cos(bet) * Math.cos((lambda - lambdaSun) * RAD);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  const phaseAngleDeg = 180 - psi / RAD; // sun is effectively at infinity
  const illuminatedFraction = (1 + Math.cos(phaseAngleDeg * RAD)) / 2;

  // Allen's lunar phase law: m = -12.73 + 0.026|i| + 4e-9 i^4
  const i = Math.abs(phaseAngleDeg);
  const dm = 0.026 * i + 4e-9 * i ** 4;
  const phaseBrightness = Math.pow(10, -0.4 * dm);

  return {
    dir,
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, dir[1]))) / RAD,
    distanceKm: dist,
    angularRadius: Math.atan2(1737.4, dist),
    phaseAngleDeg,
    illuminatedFraction,
    phaseBrightness,
  };
}

/**
 * Moonlight irradiance relative to the sun's, for sky scattering.
 * A full moon is ~2.5e-6 of the sun (mv -12.73 vs -26.74); we add a
 * documented x8 "scotopic" display boost so a moonlit sky reads on a
 * monitor the way it does to the dark-adapted eye.
 */
export function moonIrradianceFactor(state: MoonState): number {
  const SCOTOPIC_BOOST = 8;
  return 2.5e-6 * state.phaseBrightness * SCOTOPIC_BOOST;
}
