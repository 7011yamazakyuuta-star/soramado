/** Persistent user settings (localStorage). */

export type TimeMode = 'real' | 'manual' | 'demo';
export type QualityMode = 'auto' | 'low' | 'medium' | 'high';
export type AzimuthMode = 'auto' | 'manual';
/** off = pristine sky, manual = slider-driven, live = real weather (Open-Meteo). */
export type CloudsMode = 'off' | 'manual' | 'live';
/** How the current lat/lon was determined. */
export type LocationSource = 'default' | 'tz' | 'geo' | 'manual' | 'city';

export interface Settings {
  /** Settings schema revision (for default migrations). */
  rev: number;
  timeMode: TimeMode;
  /** Manual mode: local time of day in minutes [0, 1440). */
  manualMinutes: number;
  latDeg: number;
  lonDeg: number;
  locationSource: LocationSource;
  /** City preset name (locationSource === 'city'). */
  placeName: string | null;
  /** IANA timezone for the clock display (city presets). */
  displayTz: string | null;
  sunDisc: boolean;
  cloudsMode: CloudsMode;
  cloudCover: number; // 0..1 (manual mode)
  /** Occasional aircraft contrails (clouds enabled only). */
  contrails: boolean;
  /** Boundary-layer haze: subtle horizon irregularity. */
  hazeOn: boolean;
  stars: boolean;
  /** Moon disc + moonlit sky. */
  moon: boolean;
  /** Aurora (auto-gated by geomagnetic latitude; visible at polar presets). */
  aurora: boolean;
  /** Device-tilt parallax (where orientation sensors exist). */
  parallax: boolean;
  /** Slow automatic view wander (full turn ~45 min). */
  viewWalk: boolean;
  /** Ambient soundscape (synthesised; needs a user gesture to start). */
  soundOn: boolean;
  soundVol: number; // 0..1
  /** Wake-up mode: play a dawn ending at wakeTime. */
  wakeEnabled: boolean;
  wakeTime: string; // "HH:MM" local
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
  rev: 3,
  timeMode: 'real',
  manualMinutes: 12 * 60,
  latDeg: DEFAULT_LOCATION.latDeg,
  lonDeg: DEFAULT_LOCATION.lonDeg,
  locationSource: 'default',
  placeName: null,
  displayTz: null,
  sunDisc: false, // requirement: no identifiable light source by default
  cloudsMode: 'off', // pristine sky by default; clouds are one tap away
  cloudCover: 0.35,
  contrails: true,
  hazeOn: true,
  stars: true,
  moon: true,
  aurora: true,
  parallax: true,
  viewWalk: false,
  soundOn: false,
  soundVol: 0.5,
  wakeEnabled: false,
  wakeTime: '06:30',
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
    // rev 2: clouds became opt-in. rev 3: boolean -> CloudsMode.
    const legacy = parsed as Partial<Settings> & { clouds?: boolean };
    if ((parsed.rev ?? 1) < 2) {
      merged.cloudsMode = 'off';
    } else if (!parsed.cloudsMode && typeof legacy.clouds === 'boolean') {
      merged.cloudsMode = legacy.clouds ? 'manual' : 'off';
    }
    merged.rev = DEFAULT_SETTINGS.rev;
    delete (merged as unknown as Record<string, unknown>).usedGeolocation;
    delete (merged as unknown as Record<string, unknown>).clouds;
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
