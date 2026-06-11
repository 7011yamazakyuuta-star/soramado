/** Persistent user settings (localStorage). */

export type TimeMode = 'real' | 'manual' | 'demo';
export type QualityMode = 'auto' | 'low' | 'medium' | 'high';
export type AzimuthMode = 'auto' | 'manual';
/** How the current lat/lon was determined. */
export type LocationSource = 'default' | 'tz' | 'geo' | 'manual';

export interface Settings {
  timeMode: TimeMode;
  /** Manual mode: local time of day in minutes [0, 1440). */
  manualMinutes: number;
  latDeg: number;
  lonDeg: number;
  locationSource: LocationSource;
  sunDisc: boolean;
  clouds: boolean;
  cloudCover: number; // 0..1
  /** Boundary-layer haze: subtle horizon irregularity. */
  hazeOn: boolean;
  stars: boolean;
  /** Device-tilt parallax (where orientation sensors exist). */
  parallax: boolean;
  pitchDeg: number; // view elevation at screen centre
  azimuthMode: AzimuthMode;
  azimuthDeg: number; // manual view azimuth, degrees from north
  quality: QualityMode;
  wakeLock: boolean;
  /** Exposure bias in EV. */
  exposureBias: number;
}

/** Tokyo Station — the documented fallback location. */
export const DEFAULT_LOCATION = { latDeg: 35.6762, lonDeg: 139.6503 };

export const DEFAULT_SETTINGS: Settings = {
  timeMode: 'real',
  manualMinutes: 12 * 60,
  latDeg: DEFAULT_LOCATION.latDeg,
  lonDeg: DEFAULT_LOCATION.lonDeg,
  locationSource: 'default',
  sunDisc: false, // requirement: no identifiable light source by default
  clouds: true,
  cloudCover: 0.35,
  hazeOn: true,
  stars: true,
  parallax: true,
  pitchDeg: 32,
  azimuthMode: 'auto',
  azimuthDeg: 0,
  quality: 'auto',
  wakeLock: true,
  exposureBias: 0,
};

const STORAGE_KEY = 'soramado:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings> & { usedGeolocation?: boolean };
    const merged: Settings = { ...DEFAULT_SETTINGS, ...parsed };
    // Migrate pre-locationSource saves.
    if (!parsed.locationSource) {
      merged.locationSource = parsed.usedGeolocation ? 'geo' : 'default';
    }
    delete (merged as unknown as Record<string, unknown>).usedGeolocation;
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private browsing etc. — run without persistence.
  }
}
