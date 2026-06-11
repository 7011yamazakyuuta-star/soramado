/**
 * Permission-free location estimate from the device's IANA timezone.
 *
 * Knowing the location to within a few hundred kilometres is plenty for sky
 * colour (it shifts twilight times by minutes), so the sky can match "where
 * you are" the moment the app opens, without a geolocation prompt. The
 * 現在地 button still offers precise GPS positioning on top of this.
 */

export interface TzEstimate {
  latDeg: number;
  lonDeg: number;
  /** Human-readable source, e.g. "Asia/Tokyo" or "UTC+9". */
  zone: string;
}

/** IANA timezone -> representative city (lat, lon). */
const TZ_LOCATIONS: Record<string, [number, number]> = {
  // Asia
  'Asia/Tokyo': [35.68, 139.69],
  'Asia/Seoul': [37.57, 126.98],
  'Asia/Pyongyang': [39.03, 125.75],
  'Asia/Shanghai': [31.23, 121.47],
  'Asia/Urumqi': [43.83, 87.62],
  'Asia/Hong_Kong': [22.32, 114.17],
  'Asia/Macau': [22.2, 113.55],
  'Asia/Taipei': [25.03, 121.57],
  'Asia/Manila': [14.6, 120.98],
  'Asia/Singapore': [1.35, 103.82],
  'Asia/Kuala_Lumpur': [3.14, 101.69],
  'Asia/Jakarta': [-6.21, 106.85],
  'Asia/Makassar': [-5.15, 119.43],
  'Asia/Jayapura': [-2.53, 140.72],
  'Asia/Bangkok': [13.76, 100.5],
  'Asia/Ho_Chi_Minh': [10.82, 106.63],
  'Asia/Phnom_Penh': [11.56, 104.92],
  'Asia/Vientiane': [17.97, 102.6],
  'Asia/Yangon': [16.87, 96.2],
  'Asia/Dhaka': [23.81, 90.41],
  'Asia/Kolkata': [22.57, 88.36],
  'Asia/Kathmandu': [27.72, 85.32],
  'Asia/Colombo': [6.93, 79.85],
  'Asia/Karachi': [24.86, 67.0],
  'Asia/Kabul': [34.55, 69.21],
  'Asia/Tashkent': [41.3, 69.24],
  'Asia/Almaty': [43.24, 76.89],
  'Asia/Bishkek': [42.87, 74.59],
  'Asia/Dushanbe': [38.56, 68.77],
  'Asia/Ashgabat': [37.95, 58.38],
  'Asia/Tehran': [35.69, 51.39],
  'Asia/Dubai': [25.2, 55.27],
  'Asia/Muscat': [23.59, 58.41],
  'Asia/Qatar': [25.29, 51.53],
  'Asia/Riyadh': [24.71, 46.68],
  'Asia/Kuwait': [29.38, 47.99],
  'Asia/Baghdad': [33.31, 44.36],
  'Asia/Amman': [31.96, 35.95],
  'Asia/Beirut': [33.89, 35.5],
  'Asia/Damascus': [33.51, 36.29],
  'Asia/Jerusalem': [31.77, 35.21],
  'Asia/Baku': [40.41, 49.87],
  'Asia/Tbilisi': [41.72, 44.79],
  'Asia/Yerevan': [40.18, 44.51],
  'Asia/Ulaanbaatar': [47.89, 106.91],
  'Asia/Novosibirsk': [55.01, 82.94],
  'Asia/Krasnoyarsk': [56.01, 92.87],
  'Asia/Irkutsk': [52.29, 104.3],
  'Asia/Yakutsk': [62.03, 129.73],
  'Asia/Vladivostok': [43.12, 131.89],
  'Asia/Magadan': [59.56, 150.8],
  'Asia/Kamchatka': [53.04, 158.65],
  'Asia/Yekaterinburg': [56.84, 60.65],
  // Europe
  'Europe/London': [51.51, -0.13],
  'Europe/Dublin': [53.35, -6.26],
  'Europe/Lisbon': [38.72, -9.14],
  'Europe/Madrid': [40.42, -3.7],
  'Europe/Paris': [48.86, 2.35],
  'Europe/Brussels': [50.85, 4.35],
  'Europe/Amsterdam': [52.37, 4.9],
  'Europe/Luxembourg': [49.61, 6.13],
  'Europe/Zurich': [47.38, 8.54],
  'Europe/Berlin': [52.52, 13.41],
  'Europe/Copenhagen': [55.68, 12.57],
  'Europe/Oslo': [59.91, 10.75],
  'Europe/Stockholm': [59.33, 18.07],
  'Europe/Helsinki': [60.17, 24.94],
  'Europe/Tallinn': [59.44, 24.75],
  'Europe/Riga': [56.95, 24.11],
  'Europe/Vilnius': [54.69, 25.28],
  'Europe/Warsaw': [52.23, 21.01],
  'Europe/Prague': [50.08, 14.44],
  'Europe/Vienna': [48.21, 16.37],
  'Europe/Budapest': [47.5, 19.04],
  'Europe/Rome': [41.9, 12.5],
  'Europe/Malta': [35.9, 14.51],
  'Europe/Athens': [37.98, 23.73],
  'Europe/Bucharest': [44.43, 26.1],
  'Europe/Sofia': [42.7, 23.32],
  'Europe/Belgrade': [44.79, 20.45],
  'Europe/Zagreb': [45.81, 15.98],
  'Europe/Kyiv': [50.45, 30.52],
  'Europe/Chisinau': [47.01, 28.86],
  'Europe/Minsk': [53.9, 27.57],
  'Europe/Moscow': [55.76, 37.62],
  'Europe/Istanbul': [41.01, 28.98],
  'Atlantic/Reykjavik': [64.15, -21.94],
  'Atlantic/Azores': [37.74, -25.67],
  'Atlantic/Canary': [28.12, -15.43],
  'Atlantic/Madeira': [32.65, -16.91],
  // Africa
  'Africa/Cairo': [30.04, 31.24],
  'Africa/Tripoli': [32.89, 13.19],
  'Africa/Tunis': [36.81, 10.18],
  'Africa/Algiers': [36.75, 3.06],
  'Africa/Casablanca': [33.57, -7.59],
  'Africa/Lagos': [6.52, 3.38],
  'Africa/Accra': [5.6, -0.19],
  'Africa/Abidjan': [5.36, -4.01],
  'Africa/Dakar': [14.72, -17.47],
  'Africa/Kinshasa': [-4.44, 15.27],
  'Africa/Luanda': [-8.84, 13.23],
  'Africa/Khartoum': [15.5, 32.56],
  'Africa/Addis_Ababa': [9.01, 38.76],
  'Africa/Nairobi': [-1.29, 36.82],
  'Africa/Dar_es_Salaam': [-6.79, 39.21],
  'Africa/Kampala': [0.35, 32.58],
  'Africa/Johannesburg': [-26.2, 28.05],
  'Africa/Harare': [-17.83, 31.05],
  'Africa/Lusaka': [-15.39, 28.32],
  'Africa/Maputo': [-25.97, 32.57],
  // North America
  'America/St_Johns': [47.56, -52.71],
  'America/Halifax': [44.65, -63.58],
  'America/New_York': [40.71, -74.01],
  'America/Toronto': [43.65, -79.38],
  'America/Montreal': [45.5, -73.57],
  'America/Detroit': [42.33, -83.05],
  'America/Chicago': [41.88, -87.63],
  'America/Winnipeg': [49.9, -97.14],
  'America/Regina': [50.45, -104.62],
  'America/Denver': [39.74, -104.98],
  'America/Edmonton': [53.55, -113.49],
  'America/Phoenix': [33.45, -112.07],
  'America/Los_Angeles': [34.05, -118.24],
  'America/Vancouver': [49.28, -123.12],
  'America/Anchorage': [61.22, -149.9],
  'Pacific/Honolulu': [21.31, -157.86],
  'America/Mexico_City': [19.43, -99.13],
  'America/Guatemala': [14.63, -90.51],
  'America/Costa_Rica': [9.93, -84.08],
  'America/Panama': [8.98, -79.52],
  'America/Havana': [23.11, -82.37],
  'America/Santo_Domingo': [18.49, -69.93],
  'America/Puerto_Rico': [18.47, -66.11],
  'America/Jamaica': [18.0, -76.8],
  // South America
  'America/Bogota': [4.71, -74.07],
  'America/Caracas': [10.48, -66.9],
  'America/Guayaquil': [-2.19, -79.89],
  'America/Lima': [-12.05, -77.04],
  'America/La_Paz': [-16.49, -68.12],
  'America/Asuncion': [-25.26, -57.58],
  'America/Santiago': [-33.45, -70.67],
  'America/Argentina/Buenos_Aires': [-34.6, -58.38],
  'America/Montevideo': [-34.9, -56.16],
  'America/Sao_Paulo': [-23.55, -46.63],
  'America/Manaus': [-3.12, -60.02],
  'America/Fortaleza': [-3.72, -38.54],
  // Oceania
  'Australia/Sydney': [-33.87, 151.21],
  'Australia/Melbourne': [-37.81, 144.96],
  'Australia/Brisbane': [-27.47, 153.03],
  'Australia/Adelaide': [-34.93, 138.6],
  'Australia/Perth': [-31.95, 115.86],
  'Australia/Darwin': [-12.46, 130.84],
  'Australia/Hobart': [-42.88, 147.33],
  'Pacific/Auckland': [-36.85, 174.76],
  'Pacific/Fiji': [-18.14, 178.44],
  'Pacific/Guam': [13.44, 144.79],
  'Pacific/Port_Moresby': [-9.44, 147.18],
  'Pacific/Noumea': [-22.27, 166.44],
  'Pacific/Tahiti': [-17.55, -149.56],
  'Pacific/Pago_Pago': [-14.28, -170.7],
};

export function estimateLocationFromTimezone(): TzEstimate | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const hit = zone ? TZ_LOCATIONS[zone] : undefined;
    if (zone && hit) return { latDeg: hit[0], lonDeg: hit[1], zone };
  } catch {
    /* Intl unavailable — fall through to the offset estimate */
  }
  // Unknown zone: place the observer on the timezone's central meridian at a
  // mid-northern latitude. Crude, but the sun's daily rhythm stays right.
  const offMin = -new Date().getTimezoneOffset();
  if (Number.isFinite(offMin)) {
    const hours = Math.round(offMin / 60);
    return {
      latDeg: 35,
      lonDeg: Math.max(-180, Math.min(180, offMin / 4)),
      zone: `UTC${hours >= 0 ? '+' : ''}${hours}`,
    };
  }
  return null;
}
