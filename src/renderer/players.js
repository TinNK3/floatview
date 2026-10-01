// Two players behind one interface:
//   load() · cmd(name, arg) · status() -> Promise<status|null> · destroy()
// status = { found, paused, ended, currentTime, duration (null = live), volume, muted, rate, w, h, title }

/* global Hls, dashjs */

class NativePlayer {
  constructor(videoEl, source, { onError }) {
    this.v = videoEl;
    this.source = source;
    this.onError = onError;
    this.hls = null;
    this.dash = null;
    this._onVideoError = () => {
      const code = this.v.error?.code;
      const why = { 2: 'a network error', 3: 'a decoding error', 4: 'an unsupported format or blocked link' }[code] || 'an error';
      this.onError(`The video stopped because of ${why}.`);
    };
  }

  load() {
    const { url, format } = this.source;
    const v = this.v;
    v.hidden = false;
    v.addEventListener('error', this._onVideoError);
    if (format === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl') && window.Hls?.isSupported()) {
      this.hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      this.hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) return this.hls.recoverMediaError();
        this.onError(`The stream could not be loaded (${data.details}).`);
      });
      this.hls.loadSource(url);
      this.hls.attachMedia(v);
    } else if (format === 'dash' && window.dashjs) {
      this.dash = dashjs.MediaPlayer().create();
      this.dash.on('error', (e) => this.onError(`The stream could not be loaded (${e.error?.message || 'DASH error'}).`));
      this.dash.initialize(v, url, true);
    } else {
      v.src = url;
    }
    v.play().catch(() => {});
  }

  async cmd(name, arg) {
    const v = this.v;
    switch (name) {
      case 'play': return v.play().catch(() => {});
      case 'pause': return v.pause();
      case 'toggle': return v.paused ? v.play().catch(() => {}) : v.pause();
      case 'seek': v.currentTime = Math.max(0, Math.min((v.duration || Infinity) - 0.5, v.currentTime + arg)); return;
      case 'seekTo': v.currentTime = Math.max(0, arg); return;
      case 'volume': v.volume = Math.max(0, Math.min(1, arg)); if (arg > 0) v.muted = false; return;
      case 'muted': v.muted = !!arg; return;
      case 'rate': v.playbackRate = arg; return;
    }
  }

  async status() {
    const v = this.v;
    return {
      found: true,
      paused: v.paused,
      ended: v.ended,
      currentTime: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : (v.readyState ? null : 0),
      volume: v.volume,
      muted: v.muted,
      rate: v.playbackRate,
      w: v.videoWidth,
      h: v.videoHeight,
      title: this.source.title,
      ready: v.readyState >= 2,
    };
  }

  destroy() {
    this.v.removeEventListener('error', this._onVideoError);
    this.hls?.destroy();
    this.dash?.reset();
    this.v.pause();
    this.v.removeAttribute('src');
    this.v.load();
    this.v.hidden = true;
  }
}

class WebviewPlayer {
  constructor(stage, source, { onError, onTitle, injectScript, blockAds = true }) {
    this.stage = stage;
    this.source = source;
    this.onError = onError;
    this.onTitle = onTitle;
    this.injectScript = injectScript;
    this.blockAds = blockAds;
    this.wv = null;
    this.ready = false;
  }

  load() {
    const wv = document.createElement('webview');
    wv.setAttribute('partition', this.source.kind === 'embed' ? 'persist:embed' : 'persist:fallback');
    wv.setAttribute('webpreferences', 'backgroundThrottling=no');
    wv.setAttribute('src', this.source.url);
    const inject = () => {
      const code = `window.__fvVideoOnly = ${this.source.kind === 'web'};\nwindow.__fvBlockAds = ${!!this.blockAds};\n${this.injectScript}`;
      wv.executeJavaScript(code).then(() => { this.ready = true; }).catch(() => {});
    };
    wv.addEventListener('dom-ready', inject);
    wv.addEventListener('did-navigate-in-page', inject);
    wv.addEventListener('did-fail-load', (e) => {
      if (!e.isMainFrame || e.errorCode === -3) return; // -3 = aborted by a redirect, harmless
      this.onError(`The page could not be loaded (${e.errorDescription || e.errorCode}).`);
    });
    wv.addEventListener('page-title-updated', (e) => this.onTitle?.(e.title));
    wv.addEventListener('render-process-gone', () => this.onError('The page crashed.'));
    this.stage.appendChild(wv);
    this.wv = wv;
  }

  _exec(code) {
    if (!this.wv || !this.ready) return Promise.resolve(null);
    // userGesture=true lets play() start even when the page wants a real click.
    return this.wv.executeJavaScript(code, true).catch(() => null);
  }

  cmd(name, arg) {
    return this._exec(`window.__fv && window.__fv.cmd(${JSON.stringify(name)}, ${JSON.stringify(arg ?? null)})`);
  }

  status() {
    return this._exec('window.__fv ? window.__fv.status() : null');
  }

  destroy() {
    this.wv?.remove();
    this.wv = null;
  }
}

window.NativePlayer = NativePlayer;
window.WebviewPlayer = WebviewPlayer;
