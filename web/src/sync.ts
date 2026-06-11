/**
 * Multi-window sky synchronisation (BroadcastChannel).
 *
 * Open the app in several browser windows — one per monitor — and the cloud
 * field, weather clock and demo time stay in lockstep. Give each window its
 * own view direction with ?yaw=<deg> (e.g. 0 / +50 / -50) and the monitors
 * become one continuous window onto the same sky. Settings already sync via
 * localStorage `storage` events; this channel aligns the clocks.
 */

export interface SyncState {
  cloudTimeSec: number;
  /** Demo-mode simulated instant, or null outside demo mode. */
  simMs: number | null;
}

interface Hello {
  kind: 'hello';
  id: string;
  bornMs: number;
}

interface StateMsg extends SyncState {
  kind: 'state';
  id: string;
  bornMs: number;
}

export class WindowSync {
  private ch: BroadcastChannel | null = null;
  private readonly id = Math.random().toString(36).slice(2);
  private readonly bornMs = Date.now() - Math.random(); // tie-break
  private oldestSeen = Infinity;
  onState: ((s: SyncState) => void) | null = null;

  constructor() {
    try {
      this.ch = new BroadcastChannel('soramado-sync');
    } catch {
      return; // no sync support — fully standalone
    }
    this.ch.onmessage = (ev: MessageEvent<Hello | StateMsg>) => {
      const m = ev.data;
      if (!m || typeof m !== 'object') return;
      if (m.bornMs < this.bornMs) this.oldestSeen = Math.min(this.oldestSeen, m.bornMs);
      if (m.kind === 'hello') {
        // Let the newcomer learn about us.
        this.ch?.postMessage({ kind: 'hello', id: this.id, bornMs: this.bornMs } satisfies Hello);
      } else if (m.kind === 'state' && !this.isLeader && this.onState) {
        this.onState({ cloudTimeSec: m.cloudTimeSec, simMs: m.simMs });
      }
    };
    this.ch.postMessage({ kind: 'hello', id: this.id, bornMs: this.bornMs } satisfies Hello);
  }

  /** The longest-lived window drives the shared clocks. */
  get isLeader(): boolean {
    return this.bornMs <= this.oldestSeen;
  }

  broadcast(state: SyncState): void {
    if (!this.ch || !this.isLeader) return;
    this.ch.postMessage({
      kind: 'state',
      id: this.id,
      bornMs: this.bornMs,
      ...state,
    } satisfies StateMsg);
  }
}
