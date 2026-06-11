/**
 * Live weather from Open-Meteo (https://open-meteo.com): free, no API key,
 * CORS-enabled, fetched directly from the user's browser. We use the hourly
 * cloud cover split by level (low/mid/high) and visibility, so the window
 * can show *today's actual sky* for the viewed location.
 *
 * The renderer never depends on this: if the fetch fails or the simulated
 * time leaves the forecast window, it falls back to the procedural sky.
 */

export interface WeatherSample {
  /** 0..1 per layer. */
  coverLow: number;
  coverMid: number;
  coverHigh: number;
  /** Metres (Open-Meteo caps at 24140 m). */
  visibility: number;
}

interface WeatherData {
  latDeg: number;
  lonDeg: number;
  fetchedAtMs: number;
  /** Hour timestamps [ms] and parallel arrays. */
  timesMs: number[];
  low: number[];
  mid: number[];
  high: number[];
  vis: number[];
}

const CACHE_KEY = 'soramado:weather:v1';
const TTL_MS = 45 * 60 * 1000;

export class WeatherService {
  private data: WeatherData | null = null;
  private inflight = false;

  constructor() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) this.data = JSON.parse(raw) as WeatherData;
    } catch {
      /* no cache */
    }
  }

  /** Kick a refresh when stale or the location moved; safe to call often. */
  update(latDeg: number, lonDeg: number): void {
    if (this.inflight) return;
    const d = this.data;
    const moved =
      !d || Math.abs(d.latDeg - latDeg) > 0.5 || Math.abs(d.lonDeg - lonDeg) > 0.5;
    const stale = !d || Date.now() - d.fetchedAtMs > TTL_MS;
    if (!moved && !stale) return;
    this.inflight = true;
    void this.fetch(latDeg, lonDeg).finally(() => {
      this.inflight = false;
    });
  }

  private async fetch(latDeg: number, lonDeg: number): Promise<void> {
    try {
      const url =
        'https://api.open-meteo.com/v1/forecast' +
        `?latitude=${latDeg.toFixed(3)}&longitude=${lonDeg.toFixed(3)}` +
        '&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility' +
        '&forecast_days=2&past_days=1&timeformat=unixtime&timezone=UTC';
      const res = await window.fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as {
        hourly?: {
          time?: number[];
          cloud_cover_low?: number[];
          cloud_cover_mid?: number[];
          cloud_cover_high?: number[];
          visibility?: number[];
        };
      };
      const h = j.hourly;
      if (!h?.time?.length) throw new Error('empty hourly data');
      this.data = {
        latDeg,
        lonDeg,
        fetchedAtMs: Date.now(),
        timesMs: h.time.map((t) => t * 1000),
        low: (h.cloud_cover_low ?? []).map((v) => (v ?? 0) / 100),
        mid: (h.cloud_cover_mid ?? []).map((v) => (v ?? 0) / 100),
        high: (h.cloud_cover_high ?? []).map((v) => (v ?? 0) / 100),
        vis: (h.visibility ?? []).map((v) => v ?? 24140),
      };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(this.data));
      } catch {
        /* persistence unavailable */
      }
      console.info('[soramado] live weather updated');
    } catch (err) {
      console.info('[soramado] weather fetch failed (procedural fallback)', err);
    }
  }

  /**
   * Interpolated conditions at a simulated instant, or null when no data
   * covers it (procedural fallback applies). Locations are matched loosely:
   * data for a different place is never used.
   */
  sample(simDate: Date, latDeg: number, lonDeg: number): WeatherSample | null {
    const d = this.data;
    if (!d || Math.abs(d.latDeg - latDeg) > 0.6 || Math.abs(d.lonDeg - lonDeg) > 0.6) {
      return null;
    }
    const t = simDate.getTime();
    const ts = d.timesMs;
    if (t < ts[0] || t > ts[ts.length - 1]) return null;
    let i = 0;
    while (i < ts.length - 2 && ts[i + 1] <= t) i++;
    const f = Math.min(1, Math.max(0, (t - ts[i]) / (ts[i + 1] - ts[i])));
    const lerp = (arr: number[]) =>
      arr.length > i + 1 ? arr[i] + (arr[i + 1] - arr[i]) * f : (arr[i] ?? 0);
    return {
      coverLow: lerp(d.low),
      coverMid: lerp(d.mid),
      coverHigh: lerp(d.high),
      visibility: lerp(d.vis),
    };
  }
}
