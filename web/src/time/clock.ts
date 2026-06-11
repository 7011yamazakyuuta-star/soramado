import type { Settings } from '../settings';

/** Demo mode plays one full day in two minutes. */
export const DEMO_SPEED = 86_400 / 120; // = 720x

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
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        const t = new Date(d.getTime() + settings.manualMinutes * 60_000);
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
