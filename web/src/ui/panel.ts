import type { Settings, TimeMode, QualityMode, AzimuthMode } from '../settings';

export interface PanelHooks {
  /** Persist settings and apply side effects (wake lock, etc.). */
  onSettingsChanged(): void;
  /** Time mode switched (app re-anchors the demo clock). */
  onTimeModeChanged(prev: TimeMode): void;
  /** Ask for the device location; resolves to a user-facing status string. */
  requestGeolocation(): Promise<string>;
  /** iOS needs a user-gesture permission for tilt parallax. */
  requestParallaxPermission(): void;
  toggleFullscreen(): void;
}

export interface StatusInfo {
  clockText: string;
  dateText: string;
  sunElevDeg: number;
  twilightLabel: string;
  engineLabel: string;
  /** e.g. 推定: Asia/Tokyo, 現在地, 手動 */
  locationLabel: string;
  fps: number;
}

const SHOW_MS = 3000;

const svgExpand =
  '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const svgGear =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.1"/>' +
  '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.06-1.58 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09c.7 0 1.32-.42 1.58-1.06a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.1 4.12l.06.06c.5.5 1.25.63 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.41 1.3 1.03 1.56.62.29 1.37.16 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.5.5-.63 1.25-.34 1.87v.08c.26.62.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09c-.68 0-1.3.41-1.56 1.03Z"/></svg>';

export class Panel {
  private root: HTMLElement;
  private hideTimer: number | undefined;
  private els: Record<string, HTMLElement> = {};

  constructor(
    root: HTMLElement,
    private settings: Settings,
    private hooks: PanelHooks,
  ) {
    this.root = root;
    this.build();
    this.wireAutoHide();
    this.refreshFromSettings();
  }

  // ------------------------------------------------------------- DOM build
  private build(): void {
    this.root.innerHTML = `
      <div class="chip glass" data-el="statusChip">
        <span class="clock" data-el="clock">--:--</span>
        <span class="phase" data-el="phase"></span>
      </div>
      <div class="topbar">
        <button class="iconbtn glass" data-el="fsBtn" title="フルスクリーン / Fullscreen" aria-label="フルスクリーン">${svgExpand}</button>
        <button class="iconbtn glass" data-el="gearBtn" title="設定 / Settings" aria-label="設定" aria-expanded="false">${svgGear}</button>
      </div>
      <div class="panel glass" data-el="panel" role="dialog" aria-label="設定">
        <h1>空窓 <span class="en">SORAMADO</span></h1>

        <div class="row">
          <label class="head">モード</label>
          <span class="seg" data-el="modeSeg">
            <button data-mode="real">実時刻</button>
            <button data-mode="manual">手動</button>
            <button data-mode="demo">デモ</button>
          </span>
        </div>

        <div class="row" data-el="timeRow">
          <label class="head">時刻</label>
          <input type="range" min="0" max="1439" step="1" data-el="timeSlider" />
          <span class="value" data-el="timeValue">12:00</span>
        </div>

        <div class="row">
          <label class="head">場所</label>
          <button class="btn" data-el="geoBtn">現在地を使用</button>
          <input type="number" step="0.0001" min="-90" max="90" data-el="latInput" title="緯度 / Latitude" />
          <input type="number" step="0.0001" min="-180" max="180" data-el="lonInput" title="経度 / Longitude" />
        </div>
        <div class="row hint" data-el="geoStatus"></div>

        <div class="divider"></div>

        <div class="row">
          <label class="head">表示</label>
          <label class="toggle"><input type="checkbox" data-el="sunDisc" />太陽ディスク</label>
          <label class="toggle"><input type="checkbox" data-el="clouds" />雲</label>
          <label class="toggle"><input type="checkbox" data-el="hazeOn" />霞</label>
          <label class="toggle"><input type="checkbox" data-el="stars" />星空</label>
          <label class="toggle" data-el="parallaxRow"><input type="checkbox" data-el="parallax" />視差(傾き)</label>
        </div>

        <div class="row" data-el="cloudRow">
          <label class="head">雲量</label>
          <input type="range" min="0" max="100" step="1" data-el="cloudCover" />
          <span class="value" data-el="cloudValue"></span>
        </div>

        <div class="row">
          <label class="head">仰角</label>
          <input type="range" min="10" max="60" step="1" data-el="pitch" />
          <span class="value" data-el="pitchValue"></span>
        </div>

        <div class="row">
          <label class="head">方位</label>
          <span class="seg" data-el="azSeg">
            <button data-az="auto">自動</button>
            <button data-az="manual">手動</button>
          </span>
          <input type="range" min="0" max="359" step="1" data-el="azimuth" />
          <span class="value" data-el="azValue"></span>
        </div>

        <div class="row">
          <label class="head">明るさ</label>
          <input type="range" min="-2" max="2" step="0.1" data-el="exposure" />
          <span class="value" data-el="exposureValue"></span>
        </div>

        <div class="row">
          <label class="head">画質</label>
          <span class="seg" data-el="qualitySeg">
            <button data-q="auto">自動</button>
            <button data-q="low">低</button>
            <button data-q="medium">中</button>
            <button data-q="high">高</button>
          </span>
        </div>

        <div class="row">
          <label class="toggle"><input type="checkbox" data-el="wakeLock" />スリープ防止 (Wake Lock)</label>
        </div>

        <div class="hint" data-el="iosHint" hidden>
          iPhone / iPad では共有メニューの「ホーム画面に追加」で全画面表示になります。
        </div>
        <div class="divider"></div>
        <div class="meta" data-el="meta">—</div>
      </div>
    `;

    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach((el) => {
      this.els[el.dataset.el!] = el;
    });

    // --- gear opens/closes the panel
    this.els.gearBtn.addEventListener('click', () => {
      const open = this.root.classList.toggle('panel-open');
      this.els.gearBtn.setAttribute('aria-expanded', String(open));
    });

    // --- fullscreen
    const fsBtn = this.els.fsBtn;
    // typeof check: the lib.dom type is non-optional but iPhone Safari
    // really does not implement element fullscreen.
    if (typeof document.documentElement.requestFullscreen === 'function') {
      fsBtn.addEventListener('click', () => this.hooks.toggleFullscreen());
    } else {
      fsBtn.hidden = true; // iPhone Safari has no element fullscreen API
    }
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      this.els.iosHint.hidden = false;
    }

    // --- time mode
    this.els.modeSeg.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        const prev = this.settings.timeMode;
        this.settings.timeMode = b.dataset.mode as TimeMode;
        this.hooks.onTimeModeChanged(prev);
        this.changed();
      }),
    );

    // --- manual time
    const timeSlider = this.els.timeSlider as HTMLInputElement;
    timeSlider.addEventListener('input', () => {
      this.settings.manualMinutes = Number(timeSlider.value);
      this.changed();
    });

    // --- location
    this.els.geoBtn.addEventListener('click', async () => {
      this.els.geoStatus.textContent = '位置情報を取得中…';
      this.els.geoStatus.textContent = await this.hooks.requestGeolocation();
      this.refreshFromSettings();
    });
    const latInput = this.els.latInput as HTMLInputElement;
    const lonInput = this.els.lonInput as HTMLInputElement;
    const onLatLon = () => {
      const lat = Number(latInput.value);
      const lon = Number(lonInput.value);
      if (Number.isFinite(lat) && Math.abs(lat) <= 90) this.settings.latDeg = lat;
      if (Number.isFinite(lon) && Math.abs(lon) <= 180) this.settings.lonDeg = lon;
      this.settings.locationSource = 'manual';
      this.changed();
    };
    latInput.addEventListener('change', onLatLon);
    lonInput.addEventListener('change', onLatLon);

    // --- display toggles
    const bindToggle = (
      key: 'sunDisc' | 'clouds' | 'hazeOn' | 'stars' | 'parallax' | 'wakeLock',
    ) => {
      const input = this.els[key] as HTMLInputElement;
      input.addEventListener('change', () => {
        this.settings[key] = input.checked;
        if (key === 'parallax' && input.checked) this.hooks.requestParallaxPermission();
        this.changed();
      });
    };
    bindToggle('sunDisc');
    bindToggle('clouds');
    bindToggle('hazeOn');
    bindToggle('stars');
    bindToggle('parallax');
    bindToggle('wakeLock');
    if (!('DeviceOrientationEvent' in window)) this.els.parallaxRow.hidden = true;

    // --- sliders
    const bindRange = (
      key: 'cloudCover' | 'pitchDeg' | 'azimuthDeg' | 'exposureBias',
      el: string,
      scale = 1,
    ) => {
      const input = this.els[el] as HTMLInputElement;
      input.addEventListener('input', () => {
        this.settings[key] = Number(input.value) * scale;
        this.changed();
      });
    };
    bindRange('cloudCover', 'cloudCover', 0.01);
    bindRange('pitchDeg', 'pitch');
    bindRange('azimuthDeg', 'azimuth');
    bindRange('exposureBias', 'exposure');

    // --- azimuth mode
    this.els.azSeg.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        this.settings.azimuthMode = b.dataset.az as AzimuthMode;
        this.changed();
      }),
    );

    // --- quality
    this.els.qualitySeg.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        this.settings.quality = b.dataset.q as QualityMode;
        this.changed();
      }),
    );
  }

  private changed(): void {
    this.hooks.onSettingsChanged();
    this.refreshFromSettings();
  }

  /** Sync every control with the settings object. */
  refreshFromSettings(): void {
    const s = this.settings;
    const setSeg = (seg: HTMLElement, attr: string, val: string) => {
      seg.querySelectorAll('button').forEach((b) =>
        b.classList.toggle('active', b.dataset[attr] === val),
      );
    };
    setSeg(this.els.modeSeg, 'mode', s.timeMode);
    setSeg(this.els.azSeg, 'az', s.azimuthMode);
    setSeg(this.els.qualitySeg, 'q', s.quality);

    this.els.timeRow.style.display = s.timeMode === 'manual' ? '' : 'none';
    (this.els.timeSlider as HTMLInputElement).value = String(s.manualMinutes);
    const hh = String(Math.floor(s.manualMinutes / 60)).padStart(2, '0');
    const mm = String(s.manualMinutes % 60).padStart(2, '0');
    this.els.timeValue.textContent = `${hh}:${mm}`;

    (this.els.latInput as HTMLInputElement).value = s.latDeg.toFixed(4);
    (this.els.lonInput as HTMLInputElement).value = s.lonDeg.toFixed(4);

    (this.els.sunDisc as HTMLInputElement).checked = s.sunDisc;
    (this.els.clouds as HTMLInputElement).checked = s.clouds;
    (this.els.hazeOn as HTMLInputElement).checked = s.hazeOn;
    (this.els.stars as HTMLInputElement).checked = s.stars;
    (this.els.parallax as HTMLInputElement).checked = s.parallax;
    (this.els.wakeLock as HTMLInputElement).checked = s.wakeLock;

    this.els.cloudRow.style.display = s.clouds ? '' : 'none';
    (this.els.cloudCover as HTMLInputElement).value = String(Math.round(s.cloudCover * 100));
    this.els.cloudValue.textContent = `${Math.round(s.cloudCover * 100)}%`;

    (this.els.pitch as HTMLInputElement).value = String(s.pitchDeg);
    this.els.pitchValue.textContent = `${s.pitchDeg}°`;

    const az = this.els.azimuth as HTMLInputElement;
    az.value = String(Math.round(s.azimuthDeg));
    az.disabled = s.azimuthMode === 'auto';
    this.els.azValue.textContent =
      s.azimuthMode === 'auto' ? '自動' : `${Math.round(s.azimuthDeg)}°`;

    (this.els.exposure as HTMLInputElement).value = String(s.exposureBias);
    this.els.exposureValue.textContent = `${s.exposureBias >= 0 ? '+' : ''}${s.exposureBias.toFixed(1)} EV`;
  }

  /** Update the ambient chip and the in-panel details line. */
  setStatus(info: StatusInfo): void {
    this.els.clock.textContent = info.clockText;
    this.els.phase.textContent = info.twilightLabel;
    this.els.meta.textContent =
      `${info.dateText}  太陽高度 ${info.sunElevDeg >= 0 ? '+' : ''}${info.sunElevDeg.toFixed(1)}°` +
      `  |  ${info.locationLabel}  |  ${info.engineLabel}  ${info.fps | 0} fps`;
  }

  // ------------------------------------------------------ auto-hide logic
  private wireAutoHide(): void {
    const show = () => {
      this.root.classList.add('visible');
      this.root.setAttribute('aria-hidden', 'false');
      document.body.classList.remove('idle-cursor');
      window.clearTimeout(this.hideTimer);
      this.hideTimer = window.setTimeout(() => this.hide(), SHOW_MS);
    };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(ev, show, { passive: true });
    }
    // Slider drags and text edits also count as activity.
    this.root.addEventListener('input', show);
  }

  private hide(): void {
    // Drop focus left behind by a click so the panel can fade; any new
    // keystroke or pointer movement brings it straight back.
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
    this.root.classList.remove('visible');
    this.root.classList.remove('panel-open');
    this.els.gearBtn.setAttribute('aria-expanded', 'false');
    this.root.setAttribute('aria-hidden', 'true');
    document.body.classList.add('idle-cursor');
  }
}
