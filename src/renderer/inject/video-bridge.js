// Injected into every <webview> page (embed players and full web pages).
// Exposes window.__fv so the host can drive the page's main <video>.
// Set window.__fvVideoOnly = true before injecting to hide everything else.
(() => {
  // Always (re)install: a page must not be able to pre-define its own __fv.

  const STYLE_ID = '__fv-style';
  const CSS = `
    html, body { background: #000 !important; overflow: hidden !important; }
    body * { visibility: hidden !important; }
    [data-fv-ancestor] { transform: none !important; filter: none !important; contain: none !important;
      perspective: none !important; will-change: auto !important; backdrop-filter: none !important; }
    video[data-fv-main] { visibility: visible !important; position: fixed !important; inset: 0 !important;
      width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important;
      margin: 0 !important; object-fit: contain !important; z-index: 2147483647 !important;
      background: #000 !important; transform: none !important; }`;

  function allVideos(root = document, out = []) {
    for (const v of root.querySelectorAll('video')) out.push(v);
    // Players built with web components keep the <video> in an open shadow root.
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) allVideos(el.shadowRoot, out);
    return out;
  }

  let current = null;
  function video() {
    if (current && current.isConnected && current.getBoundingClientRect().width > 0) return current;
    let best = null, bestScore = 0;
    for (const v of allVideos()) {
      const r = v.getBoundingClientRect();
      const area = Math.max(r.width * r.height, (v.videoWidth * v.videoHeight) / 100);
      const score = area * (v.readyState > 0 || v.currentSrc ? 2 : 1) * (v.paused ? 1 : 3);
      if (score > bestScore) { best = v; bestScore = score; }
    }
    if (best !== current) {
      document.querySelectorAll('[data-fv-main]').forEach((e) => e.removeAttribute('data-fv-main'));
      document.querySelectorAll('[data-fv-ancestor]').forEach((e) => e.removeAttribute('data-fv-ancestor'));
      current = best;
    }
    return current;
  }

  function videoOnly() {
    const v = video();
    if (!v) return;
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    }
    if (!v.hasAttribute('data-fv-main')) {
      v.setAttribute('data-fv-main', '');
      for (let p = v.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        p.setAttribute('data-fv-ancestor', '');
      }
    }
  }

  // YouTube's own playlist player (embed/videoseries or watch?v=…&list=…).
  function ytPlaylist() {
    try {
      const p = document.getElementById('movie_player');
      if (!p || typeof p.getPlaylist !== 'function') return null;
      const list = p.getPlaylist() || [];
      return list.length ? { p, index: p.getPlaylistIndex(), count: list.length } : null;
    } catch { return null; } // player not ready yet
  }

  // YouTube shows its own error ("Video unavailable", private, embedding off, bot check)
  // while the <video> just sits there: report it so FloatView can say so / skip it.
  function ytError() {
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) return null;
    const el = document.querySelector('.ytp-error, .ytp-error-content, .player-unavailable');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 5 || r.height < 5 || cs.display === 'none' || cs.visibility === 'hidden') return null;
    return (el.innerText || 'This video is unavailable').trim().split('\n')[0].slice(0, 160);
  }

  function cmd(name, arg) {
    if (name === 'next' || name === 'prev') {
      const yt = ytPlaylist();
      if (!yt) return false;
      if (name === 'next' && yt.index >= yt.count - 1) return 'end'; // last video: FloatView's queue takes over
      if (name === 'prev' && yt.index <= 0) return false;
      name === 'next' ? yt.p.nextVideo() : yt.p.previousVideo();
      return 'yt';
    }
    const v = video();
    if (!v) return false;
    switch (name) {
      case 'play': v.play().catch(() => {}); break;
      case 'pause': v.pause(); break;
      case 'toggle': v.paused ? v.play().catch(() => {}) : v.pause(); break;
      case 'seek': v.currentTime = Math.max(0, Math.min((v.duration || Infinity) - 0.5, v.currentTime + arg)); break;
      case 'seekTo': v.currentTime = Math.max(0, arg); break;
      case 'volume': v.volume = Math.max(0, Math.min(1, arg)); if (arg > 0) v.muted = false; break;
      case 'muted': v.muted = !!arg; break;
      case 'rate': v.playbackRate = arg; break;
    }
    return true;
  }

  // YouTube embeds: FloatView draws the controls, so hide YouTube's own overlay
  // (title bar, big play/prev/next, "More videos", watermark) — two sets of controls overlap.
  function hideYouTubeChrome() {
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname) || document.getElementById('__fv-yt')) return;
    const s = document.createElement('style');
    s.id = '__fv-yt';
    // 2026 player: the whole overlay (title, big buttons, "More videos", bottom bar) lives in #player-controls
    // and #bottom-sheet-wrapper, next to the player. Older player: the .ytp-* chrome inside it.
    s.textContent = '#player-controls, #bottom-sheet-wrapper, #movie_player > .ytp-unmute,'
      + ' .ytp-chrome-top, .ytp-chrome-bottom, .ytp-pause-overlay, .ytp-large-play-button, .ytp-watermark,'
      + ' .ytp-gradient-top, .ytp-gradient-bottom { display: none !important; }';
    (document.head || document.documentElement).appendChild(s);
  }

  function status() {
    hideYouTubeChrome();
    const yterr = ytError();
    if (yterr) return { found: true, error: yterr, title: document.title, paused: true, ended: false, currentTime: 0, duration: 0 };
    if (window.__fvVideoOnly) videoOnly();
    const v = video();
    if (!v) {
      // No <video> here, but maybe the page embeds a known player in an iframe.
      const embeds = [...document.querySelectorAll('iframe[src]')]
        .map((f) => f.src)
        .filter((s) => /youtube(-nocookie)?\.com\/embed|player\.vimeo\.com|player\.twitch\.tv|\.(mp4|m3u8)(\?|$)/.test(s));
      return { found: false, title: document.title, embeds };
    }
    return {
      found: true,
      paused: v.paused,
      ended: v.ended,
      currentTime: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : null, // null = live
      volume: v.volume,
      muted: v.muted,
      rate: v.playbackRate,
      w: v.videoWidth,
      h: v.videoHeight,
      title: document.title,
      yt: (() => { const y = ytPlaylist(); return y ? { index: y.index, count: y.count, title: y.p.getVideoData?.().title || '' } : null; })(),
    };
  }

  Object.defineProperty(window, '__fv', { value: Object.freeze({ cmd, status, videoOnly }), configurable: true, writable: false });
  return true;
})();
