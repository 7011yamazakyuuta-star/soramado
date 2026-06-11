/**
 * Solar position from the NOAA Solar Calculator equations
 * (Meeus, "Astronomical Algorithms", as published by NOAA ESRL).
 * Accuracy is better than ±0.01° for years 1900–2100 — far more than enough
 * to drive a sky simulation.
 */

export interface SunPosition {
  /** Elevation above the horizon in degrees (refraction-corrected). */
  elevationDeg: number;
  /** True (geometric) elevation in degrees, no refraction. */
  trueElevationDeg: number;
  /** Azimuth in degrees, clockwise from north. */
  azimuthDeg: number;
  /** Solar declination in degrees. */
  declinationDeg: number;
  /** Equation of time in minutes. */
  equationOfTimeMin: number;
}

const RAD = Math.PI / 180;

/** Julian day from a JS Date (UTC). */
export function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

/** Greenwich mean sidereal time in radians. */
export function gmstRad(date: Date): number {
  const d = julianDay(date) - 2_451_545.0;
  const gmstDeg = 280.46061837 + 360.98564736629 * d;
  return (((gmstDeg % 360) + 360) % 360) * RAD;
}

/** Local sidereal time in radians for a longitude in degrees (east positive). */
export function lstRad(date: Date, lonDeg: number): number {
  const lst = gmstRad(date) + lonDeg * RAD;
  return ((lst % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/** NOAA atmospheric refraction correction, degrees, given true elevation. */
function refractionCorrectionDeg(elevDeg: number): number {
  if (elevDeg > 85) return 0;
  const te = Math.tan(elevDeg * RAD);
  let corr: number;
  if (elevDeg > 5) {
    corr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  } else if (elevDeg > -0.575) {
    corr =
      1735 + elevDeg * (-518.2 + elevDeg * (103.4 + elevDeg * (-12.79 + elevDeg * 0.711)));
  } else {
    corr = -20.774 / te;
  }
  return corr / 3600;
}

/**
 * Compute the solar position for a UTC instant at a geographic location.
 * @param date  instant (the Date's absolute UTC time is used)
 * @param latDeg latitude, degrees north positive
 * @param lonDeg longitude, degrees east positive
 */
export function solarPosition(date: Date, latDeg: number, lonDeg: number): SunPosition {
  const jd = julianDay(date);
  const t = (jd - 2_451_545.0) / 36_525.0; // Julian centuries since J2000

  const meanLong = (280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const m = meanAnom * RAD;
  const eqCenter =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;

  const trueLong = meanLong + eqCenter;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const meanObliq =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);

  const declination =
    Math.asin(Math.sin(obliq * RAD) * Math.sin(apparentLong * RAD)) / RAD;

  // Equation of time (minutes)
  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const l0 = meanLong * RAD;
  const eqTime =
    4 *
    ((y * Math.sin(2 * l0) -
      2 * ecc * Math.sin(m) +
      4 * ecc * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * ecc * ecc * Math.sin(2 * m)) /
      RAD);

  // True solar time (minutes), from UTC time of day and longitude
  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60_000;
  let tst = (utcMinutes + eqTime + 4 * lonDeg) % 1440;
  if (tst < 0) tst += 1440;

  const hourAngleDeg = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const ha = hourAngleDeg * RAD;
  const lat = latDeg * RAD;
  const dec = declination * RAD;

  const cosZenith = Math.min(
    1,
    Math.max(-1, Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha)),
  );
  const zenith = Math.acos(cosZenith);
  const trueElevation = 90 - zenith / RAD;

  // Azimuth, clockwise from north
  let azimuth: number;
  const sinZenith = Math.sin(zenith);
  if (Math.abs(sinZenith) > 1e-9) {
    let azDenom = (Math.sin(lat) * cosZenith - Math.sin(dec)) / (Math.cos(lat) * sinZenith);
    azDenom = Math.min(1, Math.max(-1, azDenom));
    const azRad = Math.acos(azDenom);
    azimuth = hourAngleDeg > 0 ? (azRad / RAD + 180) % 360 : (540 - azRad / RAD) % 360;
  } else {
    azimuth = latDeg > 0 ? 180 : 0;
  }

  return {
    elevationDeg: trueElevation + refractionCorrectionDeg(trueElevation),
    trueElevationDeg: trueElevation,
    azimuthDeg: azimuth,
    declinationDeg: declination,
    equationOfTimeMin: eqTime,
  };
}

/** Twilight phase classification from the sun's true elevation. */
export type TwilightPhase = 'day' | 'civil' | 'nautical' | 'astronomical' | 'night';

export function twilightPhase(elevationDeg: number): TwilightPhase {
  if (elevationDeg >= -0.833) return 'day';
  if (elevationDeg >= -6) return 'civil';
  if (elevationDeg >= -12) return 'nautical';
  if (elevationDeg >= -18) return 'astronomical';
  return 'night';
}

export const TWILIGHT_LABEL_JA: Record<TwilightPhase, string> = {
  day: '昼',
  civil: '市民薄明',
  nautical: '航海薄明',
  astronomical: '天文薄明',
  night: '夜',
};
