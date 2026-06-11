import { SkyRenderer, type RenderParams } from './gl/renderer';
import { loadSkySource } from './atmosphere/lut';
import { rayleighBeta, SUN_TINT, SUN_INTENSITY } from './atmosphere/constants';
import { solarPosition, lstRad, twilightPhase, TWILIGHT_LABEL_JA } from './sun/solar';
import { moonState, moonIrradianceFactor } from './sun/moon';
import { estimateLocationFromTimezone } from './sun/tzlocation';
import { geomagneticLatitudeDeg, auroraZoneFactor } from './sky/cities';
import { SimClock } from './time/clock';
import { loadSettings, saveSettings, type Settings, type TimeMode } from './settings';
import { Panel } from './ui/panel';
import { WakeLockManager } from './wakelock';

const RAD = Math.PI / 180;

// ----------------------------------------------------------- small helpers
/** Unit direction from azimuth (deg, from north, clockwise) and elevation. */
function dirFromAzEl(azDeg: number, elDeg: number): [number, number, number] {
  const az = azDeg * RAD;
  const el = elDeg * RAD;
  // World frame: x = east, y = up, z = north.
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

/**
 * Exposure as a function of solar elevation: emulates the eye's adaptation
 * from daylight to a dark-adapted night (the radiance itself stays physical;
 * only the virtual "film speed" changes).
 *
 * Piecewise-linear in log10(exposure), calibrated against the precomputed
 * multiple-scattering LUT so the zenith lands at a natural display level at
 * every twilight stage (sky radiance drops ~10x per 2 deg of solar descent).
 */
const EXPOSURE_CURVE: ReadonlyArray<readonly [number, number]> = [
  [6, 0.041], // log10(1.1) — daylight base
  [3, 0.2],
  [0, 0.51],
  [-2, 0.9],
  [-4, 1.41],
  [-6, 2.19],
  [-8, 2.82],
  [-10, 3.24],
  [-12, 3.41],
  [-14, 3.49],
  [-18, 3.52], // ~3300x — dark-adapted night
];

function exposureFor(sunElevDeg: number, biasEv: number): number {
  const pts = EXPOSURE_CURVE;
  let lg = pts[pts.length - 1][1];
  if (sunElevDeg >= pts[0][0]) {
    lg = pts[0][1];
  } else {
    for (let i = 0; i < pts.length - 1; i++) {
      const [e0, l0] = pts[i];
      const [e1, l1] = pts[i + 1];
      if (sunElevDeg >= e1) {
        lg = l0 + ((l1 - l0) * (e0 - sunElevDeg)) / (e0 - e1);
        break;
      }
    }
  }
  return Math.pow(10, lg) * Math.pow(2, biasEv);
}

// ------------------------------------------------------- adaptive quality
interface QualityLevel {
  samples: number;
  light: number;
  scale: number;
}

const QUALITY_LEVELS: QualityLevel[] = [
  { samples: 64, light: 10, scale: 1.0 },
  { samples: 48, light: 8, scale: 0.85 },
  { samples: 36, light: 6, scale: 0.72 },
  { samples: 28, light: 5, scale: 0.6 },
  { samples: 20, light: 4, scale: 0.5 },
];

class QualityController {
  private idx = 1;
  private emaMs = 16.7;
  private frames = 0;
  private goodWindows = 0;

  /** Feed one frame time; auto mode walks the level table to hold ~60 fps. */
  update(dtMs: number, mode: Settings['quality']): QualityLevel {
    if (mode === 'low') return QUALITY_LEVELS[3];
    if (mode === 'medium') return QUALITY_LEVELS[1];
    if (mode === 'high') return QUALITY_LEVELS[0];

    if (dtMs > 0 && dtMs < 250) {
      this.emaMs = this.emaMs * 0.92 + dtMs * 0.08;
    }
    if (++this.frames >= 75) {
      this.frames = 0;
      if (this.emaMs > 19 && this.idx < QUALITY_LEVELS.length - 1) {
        this.idx++;
        this.goodWindows = 0;
      } else if (this.emaMs < 13) {
        if (++this.goodWindows >= 3 && this.idx > 0) {
          this.idx--;
          this.goodWindows = 0;
        }
      } else {
        this.goodWindows = 0;
      }
    }
    return QUALITY_LEVELS[this.idx];
  }
}

// ------------------------------------------------------------------- app
export class App {
  private settings: Settings = loadSettings();
  private renderer!: SkyRenderer;
  private panel!: Panel;
  private clock = new SimClock();
  private wakeLock = new WakeLockManager();
  private quality = new QualityController();

  private betaR = rayleighBeta();
  private sunIrradiance: [number, number, number] = [
    SUN_TINT[0] * SUN_INTENSITY,
    SUN_TINT[1] * SUN_INTENSITY,
    SUN_TINT[2] * SUN_INTENSITY,
  ];

  private canvas!: HTMLCanvasElement;
  private cssW = 1;
  private cssH = 1;
  private frame = 0;
  private startMs = performance.now();
  private lastFrameMs = performance.now();
  private fpsEma = 60;
  private lastStatusMs = 0;
  private viewAzDeg: number | null = null; // slewed auto azimuth
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private simDate = new Date();
  private tzZoneLabel: string | null = null;
  // Device-tilt parallax: a real depth cue on handhelds. The baseline drifts
  // slowly toward the current posture, so any holding angle becomes neutral.
  private tiltBase: { b: number; g: number } | null = null;
  private tiltTarget: [number, number] = [0, 0];
  private tiltCur: [number, number] = [0, 0];
  /** Fixed simulation instant from the ?t= URL param (testing/demos). */
  private overrideDate: Date | null = null;

  start(): void {
    this.canvas = document.getElementById('sky') as HTMLCanvasElement;
    try {
      this.renderer = new SkyRenderer(this.canvas);
    } catch (err) {
      console.error(err);
      (document.getElementById('fallback') as HTMLElement).hidden = false;
      return;
    }

    this.panel = new Panel(document.getElementById('ui') as HTMLElement, this.settings, {
      onSettingsChanged: () => {
        saveSettings(this.settings);
        void this.wakeLock.setEnabled(this.settings.wakeLock);
      },
      onTimeModeChanged: (prev: TimeMode) => {
        if (this.settings.timeMode === 'demo' && prev !== 'demo') {
          this.clock.syncDemoTo(this.simDate);
        }
      },
      requestGeolocation: () => this.requestGeolocation(),
      requestParallaxPermission: () => this.requestParallaxPermission(),
      toggleFullscreen: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      },
    });

    const ro = new ResizeObserver(() => {
      this.cssW = this.canvas.clientWidth;
      this.cssH = this.canvas.clientHeight;
    });
    ro.observe(this.canvas);
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;

    void this.wakeLock.setEnabled(this.settings.wakeLock);
    this.resolveLocation();
    this.setupParallax();

    // ?t=2026-06-29T12:00:00Z pins the simulation clock (testing/demos).
    const tParam = new URLSearchParams(location.search).get('t');
    if (tParam) {
      const d = new Date(tParam);
      if (!Number.isNaN(d.getTime())) this.overrideDate = d;
    }

    // Optional precomputed multiple-scattering LUTs (Phase 2 artefacts).
    void loadSkySource().then((src) => {
      if (src.kind === 'lut-multi') this.renderer.setLut(src.lut);
    });

    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------ location
  /**
   * Make the sky match "where you are" without any permission prompt: when
   * no explicit location was ever chosen, estimate one from the device's
   * timezone. The 現在地 button still offers precise GPS on top of this.
   */
  private resolveLocation(): void {
    const est = estimateLocationFromTimezone();
    if (!est) return;
    this.tzZoneLabel = est.zone;
    if (this.settings.locationSource === 'default' || this.settings.locationSource === 'tz') {
      this.settings.latDeg = est.latDeg;
      this.settings.lonDeg = est.lonDeg;
      this.settings.locationSource = 'tz';
      saveSettings(this.settings);
      this.panel.refreshFromSettings();
    }
  }

  // ------------------------------------------------------------ parallax
  private setupParallax(): void {
    if (this.reducedMotion || !('DeviceOrientationEvent' in window)) return;
    window.addEventListener('deviceorientation', (e: DeviceOrientationEvent) => {
      if (!this.settings.parallax || e.beta == null || e.gamma == null) return;
      if (!this.tiltBase) this.tiltBase = { b: e.beta, g: e.gamma };
      const base = this.tiltBase;
      base.b += (e.beta - base.b) * 0.004;
      base.g += (e.gamma - base.g) * 0.004;
      const db = Math.max(-20, Math.min(20, e.beta - base.b));
      const dg = Math.max(-20, Math.min(20, e.gamma - base.g));
      this.tiltTarget = [(dg / 20) * 1.4, (db / 20) * -1.0]; // deg: yaw, pitch
    });
  }

  /** iOS 13+ requires a user-gesture permission for orientation events. */
  private requestParallaxPermission(): void {
    const D = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof D.requestPermission === 'function') {
      void D.requestPermission().catch(() => {
        /* denied — parallax simply stays inactive */
      });
    }
  }

  private locationLabel(): string {
    switch (this.settings.locationSource) {
      case 'geo':
        return '現在地';
      case 'manual':
        return '手動設定';
      case 'city':
        return this.settings.placeName ?? '都市プリセット';
      case 'tz':
        return `推定: ${this.tzZoneLabel ?? 'タイムゾーン'}`;
      default:
        return '既定 (東京)';
    }
  }

  private requestGeolocation(): Promise<string> {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        resolve('この環境では位置情報を利用できません(緯度経度を入力してください)');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.settings.latDeg = Math.round(pos.coords.latitude * 1e4) / 1e4;
          this.settings.lonDeg = Math.round(pos.coords.longitude * 1e4) / 1e4;
          this.settings.locationSource = 'geo';
          this.settings.placeName = null;
          this.settings.displayTz = null; // device timezone is correct here
          saveSettings(this.settings);
          resolve('現在地を設定しました');
        },
        () => {
          resolve('位置情報が許可されませんでした。緯度経度を入力するか、既定値(東京)を使用します。');
        },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 3_600_000 },
      );
    });
  }

  // --------------------------------------------------------- clock display
  private fmtCache: { tz: string | null; time: Intl.DateTimeFormat; date: Intl.DateTimeFormat } | null =
    null;

  /** Clock & date strings, in the viewed city's timezone when one is set. */
  private formatClock(d: Date, tz: string | null): [string, string] {
    try {
      if (!this.fmtCache || this.fmtCache.tz !== tz) {
        this.fmtCache = {
          tz,
          time: new Intl.DateTimeFormat('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: tz ?? undefined,
          }),
          // sv-SE locale renders as YYYY-MM-DD.
          date: new Intl.DateTimeFormat('sv-SE', { timeZone: tz ?? undefined }),
        };
      }
      return [this.fmtCache.time.format(d), this.fmtCache.date.format(d)];
    } catch {
      const pad = (n: number) => String(n).padStart(2, '0');
      return [
        `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      ];
    }
  }

  // ------------------------------------------------------------ main loop
  private loop = (): void => {
    const now = performance.now();
    const dtMs = now - this.lastFrameMs;
    this.lastFrameMs = now;
    if (dtMs > 0 && dtMs < 1000) {
      this.fpsEma = this.fpsEma * 0.95 + (1000 / dtMs) * 0.05;
    }

    const s = this.settings;
    const level = this.quality.update(dtMs, s.quality);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(this.cssW, this.cssH, dpr, level.scale);

    // --- simulation time, sun & moon
    this.simDate = this.overrideDate ?? this.clock.tick(s);
    const sun = solarPosition(this.simDate, s.latDeg, s.lonDeg);
    const sunDir = dirFromAzEl(sun.azimuthDeg, sun.elevationDeg);

    const moon = moonState(this.simDate, s.latDeg, s.lonDeg);
    // Moonlit-sky scattering only matters once the sun is well down, and
    // only when the moon is up; gating also skips the extra ray march.
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    const nightGate = clamp01((-2 - sun.trueElevationDeg) / 6);
    const horizonGate = clamp01((moon.elevationDeg + 4) / 5);
    const mf = s.moon ? moonIrradianceFactor(moon) * nightGate * horizonGate : 0;
    const moonIrr: [number, number, number] = [
      this.sunIrradiance[0] * mf,
      this.sunIrradiance[1] * mf,
      this.sunIrradiance[2] * mf,
    ];

    // Aurora: realistic only inside the auroral oval, and only in dark skies.
    const auroraNight = clamp01((-8 - sun.trueElevationDeg) / 6);
    const auroraStrength = s.aurora
      ? auroraZoneFactor(geomagneticLatitudeDeg(s.latDeg, s.lonDeg)) * auroraNight
      : 0;

    // --- view azimuth: keep the solar aureole out of frame by default
    const tSec = (now - this.startMs) / 1000;
    let yawDeg: number;
    if (s.azimuthMode === 'manual') {
      yawDeg = s.azimuthDeg;
      this.viewAzDeg = null;
    } else {
      const target = (sun.azimuthDeg + 115) % 360;
      if (this.viewAzDeg === null) this.viewAzDeg = target;
      // Slew-rate limit (0.1°/s): imperceptible in real time; in demo mode
      // the sun sweeps past the (almost static) view instead.
      let diff = ((target - this.viewAzDeg + 540) % 360) - 180;
      const maxStep = 0.1 * (dtMs / 1000);
      diff = Math.max(-maxStep, Math.min(maxStep, diff));
      this.viewAzDeg = (this.viewAzDeg + diff + 360) % 360;
      yawDeg = this.viewAzDeg;
    }

    // --- micro drift: extremely slow view wander so the image is never a
    // perfect still (amplitude ≤0.2°, periods ≥ ~50 s: no motion sickness).
    let pitchDeg = s.pitchDeg;
    if (!this.reducedMotion) {
      yawDeg +=
        0.15 * Math.sin((tSec / 53) * 2 * Math.PI) +
        0.07 * Math.sin((tSec / 127) * 2 * Math.PI + 1.3);
      pitchDeg +=
        0.1 * Math.sin((tSec / 71) * 2 * Math.PI + 0.7) +
        0.05 * Math.sin((tSec / 167) * 2 * Math.PI + 2.1);
    }

    // --- device-tilt parallax (smoothed)
    const k = Math.min(1, dtMs / 250);
    this.tiltCur[0] += (this.tiltTarget[0] - this.tiltCur[0]) * k;
    this.tiltCur[1] += (this.tiltTarget[1] - this.tiltCur[1]) * k;
    yawDeg += this.tiltCur[0];
    pitchDeg += this.tiltCur[1];

    // --- camera basis (columns: right, up, forward)
    const fwd = dirFromAzEl(yawDeg, pitchDeg);
    const upW = [0, 1, 0];
    const right = [
      upW[1] * fwd[2] - upW[2] * fwd[1],
      upW[2] * fwd[0] - upW[0] * fwd[2],
      upW[0] * fwd[1] - upW[1] * fwd[0],
    ];
    const rl = Math.hypot(right[0], right[1], right[2]) || 1;
    right[0] /= rl;
    right[1] /= rl;
    right[2] /= rl;
    const camUp = [
      fwd[1] * right[2] - fwd[2] * right[1],
      fwd[2] * right[0] - fwd[0] * right[2],
      fwd[0] * right[1] - fwd[1] * right[0],
    ];
    const camBasis = new Float32Array([
      right[0], right[1], right[2],
      camUp[0], camUp[1], camUp[2],
      fwd[0], fwd[1], fwd[2],
    ]);

    // --- star rotation: horizon frame -> sky-fixed equatorial frame, so the
    // procedural star field rotates with the real sidereal motion.
    const phi = s.latDeg * RAD;
    const lst = lstRad(this.simDate, s.lonDeg);
    const cL = Math.cos(lst);
    const sL = Math.sin(lst);
    const cP = Math.cos(phi);
    const sP = Math.sin(phi);
    // Row-major M = Rz(-LST) * [e1; e2; e3]; uploaded column-major below.
    const starMat = new Float32Array([
      -sL, -cL, 0,
      cL * cP, -sL * cP, sP,
      -cL * sP, sL * sP, cP,
    ]);

    const params: RenderParams = {
      timeSec: tSec,
      frame: this.frame++,
      camBasis,
      tanHalfFov: Math.tan((60 / 2) * RAD),
      sunDir,
      betaR: this.betaR,
      sunIrradiance: this.sunIrradiance,
      exposure: exposureFor(sun.trueElevationDeg, s.exposureBias),
      samples: level.samples,
      lightSamples: level.light,
      sunDisc: s.sunDisc,
      clouds: s.clouds,
      cloudCover: s.cloudCover,
      haze: s.hazeOn,
      stars: s.stars,
      starMat,
      moonDir: moon.dir,
      moonIrr,
      moonDisc: s.moon,
      // Display scale x2.2: the true 0.5-degree disc reads unnaturally tiny
      // on a monitor (the same convention as landscape photography).
      moonAngularRadius: moon.angularRadius * 2.2,
      auroraStrength,
    };
    this.renderer.render(params);

    // --- status & theme (2x per second)
    if (now - this.lastStatusMs > 500) {
      this.lastStatusMs = now;
      // The glass UI adapts to the sky: bright glass + dark ink in daylight.
      document.body.classList.toggle('theme-day', sun.trueElevationDeg > -3);
      const [clockText, dateText] = this.formatClock(this.simDate, s.displayTz);
      this.panel.setStatus({
        clockText,
        dateText,
        sunElevDeg: sun.elevationDeg,
        twilightLabel: TWILIGHT_LABEL_JA[twilightPhase(sun.trueElevationDeg)],
        engineLabel: this.renderer.usingLut ? '多重散乱LUT' : '単一散乱RT',
        locationLabel: this.locationLabel(),
        fps: this.fpsEma,
      });
    }

    requestAnimationFrame(this.loop);
  };
}
