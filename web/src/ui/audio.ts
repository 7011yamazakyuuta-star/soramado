/**
 * Ambient soundscape, fully synthesised with Web Audio (no audio assets):
 *  - wind: filtered noise whose level follows cloudiness and time of day
 *  - birds: sparse FM chirps, densest around the dawn chorus
 *  - crickets: pulsed high tones on warm-season nights
 * Starts only from a user gesture (the toggle), defaults off, stays quiet.
 */

export class AmbientAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private timer: number | undefined;
  private vol = 0.5;
  private env = { sunElevDeg: 20, cloudiness: 0.2, month: 6 };

  setVolume(v: number): void {
    this.vol = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(0.16 * v, this.ctx.currentTime, 0.2);
    }
  }

  updateEnvironment(sunElevDeg: number, cloudiness: number, date: Date): void {
    this.env = { sunElevDeg, cloudiness, month: date.getMonth() + 1 };
  }

  async setEnabled(on: boolean): Promise<void> {
    if (!on) {
      window.clearInterval(this.timer);
      this.timer = undefined;
      if (this.ctx) await this.ctx.suspend().catch(() => undefined);
      return;
    }
    if (!this.ctx) this.build();
    if (this.ctx) {
      await this.ctx.resume().catch(() => undefined);
      if (this.timer === undefined) {
        this.timer = window.setInterval(() => this.tick(), 700);
      }
    }
  }

  private build(): void {
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0.16 * this.vol;
      master.connect(ctx.destination);
      this.master = master;

      // --- wind: looped noise -> wandering lowpass -> slow gain LFO
      const len = 2 * ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        // pre-soften the white noise a touch
        lp = lp * 0.86 + (Math.random() * 2 - 1) * 0.14;
        ch[i] = lp * 2.4;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 480;
      filter.Q.value = 0.4;
      const wind = ctx.createGain();
      wind.gain.value = 0.16;
      src.connect(filter).connect(wind).connect(master);
      src.start();
      this.windFilter = filter;
      this.windGain = wind;
    } catch {
      this.ctx = null;
    }
  }

  /** Scheduler: adjusts the wind and stochastically spawns critters. */
  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const { sunElevDeg, cloudiness, month } = this.env;
    const t = ctx.currentTime;

    // Wind bed: a little stronger when cloudy, gentle gusts.
    const gust = 0.6 + 0.4 * Math.sin(t * 0.13) * Math.sin(t * 0.071 + 2.1);
    const level = (0.10 + 0.14 * cloudiness) * (0.7 + 0.45 * gust);
    this.windGain?.gain.setTargetAtTime(level, t, 1.2);
    this.windFilter?.frequency.setTargetAtTime(420 + 260 * gust, t, 1.5);

    // Dawn chorus peaks just after sunrise; daytime birds are sparse.
    const dawn = Math.exp(-(((sunElevDeg - 6) / 9) ** 2));
    const day = sunElevDeg > 2 ? 0.12 : 0;
    if (Math.random() < dawn * 0.65 + day) this.chirp();

    // Crickets: warm-season dark hours.
    const warm = month >= 6 && month <= 9 ? 1 : month === 5 || month === 10 ? 0.4 : 0;
    if (sunElevDeg < -5 && warm > 0 && Math.random() < 0.5 * warm) this.cricket();
  }

  private chirp(): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + Math.random() * 0.4;
    const base = 2300 + Math.random() * 1900;
    const syll = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < syll; i++) {
      const ts = t0 + i * (0.12 + Math.random() * 0.08);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(base * (1 + Math.random() * 0.15), ts);
      osc.frequency.exponentialRampToValueAtTime(base * 0.72, ts + 0.09);
      g.gain.setValueAtTime(0, ts);
      g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.04, ts + 0.012);
      g.gain.exponentialRampToValueAtTime(1e-4, ts + 0.1);
      osc.connect(g).connect(this.master!);
      osc.start(ts);
      osc.stop(ts + 0.12);
    }
  }

  private cricket(): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + Math.random() * 0.3;
    const osc = ctx.createOscillator();
    osc.frequency.value = 4100 + Math.random() * 500;
    const am = ctx.createGain();
    const g = ctx.createGain();
    g.gain.value = 0.018;
    // pulse train: ~22 Hz amplitude modulation bursts
    const pulses = 6 + Math.floor(Math.random() * 8);
    for (let i = 0; i < pulses; i++) {
      const tp = t0 + i * 0.045;
      am.gain.setValueAtTime(0, tp);
      am.gain.linearRampToValueAtTime(1, tp + 0.008);
      am.gain.setTargetAtTime(0, tp + 0.02, 0.008);
    }
    osc.connect(am).connect(g).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + pulses * 0.045 + 0.1);
  }
}
