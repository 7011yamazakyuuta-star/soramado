/** Persistent user settings (localStorage). */

export type TimeMode = 'real' | 'manual' | 'demo';
export type QualityMode = 'auto' | 'low' | 'medium' | 'high';
export type AzimuthMode = 'auto' | 'manual';

export interface Settings {
  timeMode: TimeMode;
  /** Manual mode: local time of day in minutes [0, 1440). */
  manualMinutes: number;
  latDeg: number;
  lonDeg: number;
  /** True once the user granted geolocation (informational only). */
  usedGeolocation: boolean;
  sunDisc: boolean;
  clouds: boolean;
  cloudCover: number; // 0..1
  stars: boolean;
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
  usedGeolocation: false,
  sunDisc: false, // requirement: no identifiable light source by default
  clouds: false,
  cloudCover: 0.35,
  stars: true,
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
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
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
