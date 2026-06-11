import type { Settings } from '../settings';

/** Demo mode plays one full day in two minutes. */
export const DEMO_SPEED = 86_400 / 120; // = 720x

/** Minutes to add to UTC to get civil time in `tz` at `date`. */
function tzOffsetMinutes(tz: string, date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** The instant when "today at `minutes` past midnight" occurs in `tz`. */
function instantAtLocalMinutes(minutes: number, tz: string | null): Date {
  if (!tz) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return new Date(d.getTime() + minutes * 60_000);
  }
  try {
    const now = new Date();
    const off = tzOffsetMinutes(tz, now);
    const civil = new Date(now.getTime() + off * 60_000);
    const utcMidnight =
      Date.UTC(civil.getUTCFullYear(), civil.getUTCMonth(), civil.getUTCDate()) -
      off * 60_000;
    return new Date(utcMidnight + minutes * 60_000);
  } catch {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return new Date(d.getTime() + minutes * 60_000);
  }
}

/**
 * Simulation clock for the three time modes:
 *  - real:   wall clock
 *  - manual: fixed local time of day chosen with the slider
 *  - demo:   accelerated time (24 h in 2 min)
 */
export class SimClock {
  private demoSimMs = Date.now();
  private lastTickMs = performance.now();

  /** Called once per frame; advances demo time. */
  tick(settings: Settings): Date {
    const nowPerf = performance.now();
    const dt = Math.min(nowPerf - this.lastTickMs, 1000);
    this.lastTickMs = nowPerf;

    switch (settings.timeMode) {
      case 'real':
        this.demoSimMs = Date.now();
        return new Date();
      case 'manual': {
        // The slider sets the local time of day at the viewed location.
        const t = instantAtLocalMinutes(settings.manualMinutes, settings.displayTz);
        this.demoSimMs = t.getTime();
        return t;
      }
      case 'demo':
        this.demoSimMs += dt * DEMO_SPEED;
        return new Date(this.demoSimMs);
    }
  }

  /** Re-anchor demo time (e.g. when switching into demo mode). */
  syncDemoTo(date: Date): void {
    this.demoSimMs = date.getTime();
    this.lastTickMs = performance.now();
  }
}
