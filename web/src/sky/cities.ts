/**
 * City presets for "remote skies": pick a place and the app shows that
 * place's sky *right now* — seasons (southern hemisphere included), the
 * midnight sun, polar night, and the auroral zone all follow physically
 * from latitude, longitude and the real clock.
 */

export interface CityPreset {
  /** Display name (Japanese). */
  name: string;
  latDeg: number;
  lonDeg: number;
  /** IANA timezone, used to show that city's local time. */
  tz: string;
}

export const CITY_PRESETS: ReadonlyArray<CityPreset> = [
  { name: '東京', latDeg: 35.6762, lonDeg: 139.6503, tz: 'Asia/Tokyo' },
  { name: 'ソウル', latDeg: 37.5665, lonDeg: 126.978, tz: 'Asia/Seoul' },
  { name: '北京', latDeg: 39.9042, lonDeg: 116.4074, tz: 'Asia/Shanghai' },
  { name: 'シンガポール', latDeg: 1.3521, lonDeg: 103.8198, tz: 'Asia/Singapore' },
  { name: 'バンコク', latDeg: 13.7563, lonDeg: 100.5018, tz: 'Asia/Bangkok' },
  { name: 'ムンバイ', latDeg: 19.076, lonDeg: 72.8777, tz: 'Asia/Kolkata' },
  { name: 'ドバイ', latDeg: 25.2048, lonDeg: 55.2708, tz: 'Asia/Dubai' },
  { name: 'カイロ', latDeg: 30.0444, lonDeg: 31.2357, tz: 'Africa/Cairo' },
  { name: 'ナイロビ', latDeg: -1.2921, lonDeg: 36.8219, tz: 'Africa/Nairobi' },
  { name: 'ケープタウン', latDeg: -33.9249, lonDeg: 18.4241, tz: 'Africa/Johannesburg' },
  { name: 'モスクワ', latDeg: 55.7558, lonDeg: 37.6173, tz: 'Europe/Moscow' },
  { name: 'ローマ', latDeg: 41.9028, lonDeg: 12.4964, tz: 'Europe/Rome' },
  { name: 'パリ', latDeg: 48.8566, lonDeg: 2.3522, tz: 'Europe/Paris' },
  { name: 'ロンドン', latDeg: 51.5072, lonDeg: -0.1276, tz: 'Europe/London' },
  { name: 'ストックホルム', latDeg: 59.3293, lonDeg: 18.0686, tz: 'Europe/Stockholm' },
  { name: 'レイキャビク', latDeg: 64.1466, lonDeg: -21.9426, tz: 'Atlantic/Reykjavik' },
  { name: 'トロムソ(オーロラ帯)', latDeg: 69.6492, lonDeg: 18.9553, tz: 'Europe/Oslo' },
  { name: 'ロングイェールビーン(白夜/極夜)', latDeg: 78.2232, lonDeg: 15.6267, tz: 'Arctic/Longyearbyen' },
  { name: 'ニューヨーク', latDeg: 40.7128, lonDeg: -74.006, tz: 'America/New_York' },
  { name: 'シカゴ', latDeg: 41.8781, lonDeg: -87.6298, tz: 'America/Chicago' },
  { name: 'デンバー', latDeg: 39.7392, lonDeg: -104.9903, tz: 'America/Denver' },
  { name: 'ロサンゼルス', latDeg: 34.0522, lonDeg: -118.2437, tz: 'America/Los_Angeles' },
  { name: 'ホノルル', latDeg: 21.3069, lonDeg: -157.8583, tz: 'Pacific/Honolulu' },
  { name: 'アンカレッジ(オーロラ帯)', latDeg: 61.2181, lonDeg: -149.9003, tz: 'America/Anchorage' },
  { name: 'イエローナイフ(オーロラ帯)', latDeg: 62.454, lonDeg: -114.3718, tz: 'America/Edmonton' },
  { name: 'メキシコシティ', latDeg: 19.4326, lonDeg: -99.1332, tz: 'America/Mexico_City' },
  { name: 'リマ', latDeg: -12.0464, lonDeg: -77.0428, tz: 'America/Lima' },
  { name: 'サンパウロ', latDeg: -23.5505, lonDeg: -46.6333, tz: 'America/Sao_Paulo' },
  { name: 'ブエノスアイレス', latDeg: -34.6037, lonDeg: -58.3816, tz: 'America/Argentina/Buenos_Aires' },
  { name: 'ウシュアイア(世界最南端の街)', latDeg: -54.8019, lonDeg: -68.303, tz: 'America/Argentina/Ushuaia' },
  { name: 'シドニー', latDeg: -33.8688, lonDeg: 151.2093, tz: 'Australia/Sydney' },
  { name: 'オークランド', latDeg: -36.8509, lonDeg: 174.7645, tz: 'Pacific/Auckland' },
  { name: '昭和基地(南極・オーロラ帯)', latDeg: -69.0044, lonDeg: 39.59, tz: 'Antarctica/Syowa' },
];

/**
 * Geomagnetic (dipole) latitude — predicts where aurora is seen.
 * Dipole north pole ~ (80.8N, 72.7W), epoch ~2025.
 */
export function geomagneticLatitudeDeg(latDeg: number, lonDeg: number): number {
  const RAD = Math.PI / 180;
  const pLat = 80.8 * RAD;
  const pLon = -72.7 * RAD;
  const lat = latDeg * RAD;
  const lon = lonDeg * RAD;
  const s =
    Math.sin(lat) * Math.sin(pLat) +
    Math.cos(lat) * Math.cos(pLat) * Math.cos(lon - pLon);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

/**
 * Typical auroral-oval visibility 0..1 for a geomagnetic latitude:
 * peaks around |66-68| deg (Tromso, Yellowknife, Syowa), fades quickly
 * toward mid-latitudes. Tokyo (~27 deg) gets essentially zero.
 */
export function auroraZoneFactor(geomagLatDeg: number): number {
  const a = Math.abs(geomagLatDeg);
  const x = (a - 67) / 6.5;
  return Math.exp(-x * x);
}
