/** Screen Wake Lock manager: keeps the display on while the sky is shown. */
export class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.sync();
    });
  }

  get supported(): boolean {
    return 'wakeLock' in navigator;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.wanted = enabled;
    await this.sync();
  }

  private async sync(): Promise<void> {
    if (!this.supported) return;
    if (this.wanted && document.visibilityState === 'visible') {
      if (this.sentinel && !this.sentinel.released) return;
      try {
        this.sentinel = await navigator.wakeLock.request('screen');
        this.sentinel.addEventListener('release', () => {
          // Re-acquire on next visibility if still wanted.
        });
      } catch {
        // Not allowed (e.g. battery saver) — fail quietly.
        this.sentinel = null;
      }
    } else if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {
        /* already released */
      }
      this.sentinel = null;
    }
  }
}
