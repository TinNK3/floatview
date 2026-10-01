/* global NativePlayer, WebviewPlayer */
const api = window.floatview;
const $ = (id) => document.getElementById(id);
const body = document.body;

const ui = {
  stage: $('stage'), native: $('native'), linkForm: $('link-form'), linkInput: $('link-input'),
  recent: $('recent'), emptyClose: $('empty-close'), title: $('title'), seek: $('seek'), volume: $('volume'),
  time: $('time'), speed: $('speed'), opacity: $('opacity'), loading: $('loading'), error: $('error'),
  errorText: $('error-text'), toast: $('toast'), settings: $('settings'),
};

const WEB_NO_VIDEO_MS = 12000;
const SAVE_EVERY_MS = 5000;
const STALL_MS = 15000;
const IDLE_HIDE_MS = 2200;
const ASPECTS = { '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, free: 0 };

let app = { settings: {}, history: [], pinned: true, clickThrough: false, opacity: 1 };
let injectScript = '';
let player = null;
let session = null; // { source, startedAt, resumeAt, resumed, lastSave, aspect, titled, wasPlaying }
let pollTimer = null;
let seeking = false;

// ------------------------------------------------------------------ boot

(async function boot() {
  [app, injectScript] = await Promise.all([api.getState(), api.getInjectScript()]);
  applyState(app);
  renderRecent();
  fillSettings();
  ui.linkInput.focus();
  if (app.hotkeyErrors?.length) {
    const n = app.hotkeyErrors.length;
    toast(`${n} keyboard shortcut${n > 1 ? 's are' : ' is'} taken by another app — see Settings → Keys`, 5000);
  }
})();

// ------------------------------------------------------------------ open / close

let openSeq = 0; // only the most recently requested link may take over the player

async function openLink(input, opts = {}) {
  const text = String(input || '').trim();
  if (!text) return;
  const seq = ++openSeq;
  hideError();
  body.classList.remove('show-link');
  ui.loading.hidden = false;
  let source;
  try {
    source = await api.openLink(text, opts);
  } catch (err) {
    if (seq !== openSeq) return;
    ui.loading.hidden = true;
    return showError(cleanError(err), text);
  }
  if (seq !== openSeq) return; // a newer link was pasted while this one resolved
  teardown();
  body.classList.remove('is-empty');
  ui.emptyClose.hidden = false;
  ui.linkInput.value = '';
  setTitle(source.title || source.original);

  const resumeAt = opts.fromHistory && source.lastPosition > 5 ? source.lastPosition : 0;
  session = { source, startedAt: Date.now(), resumeAt, resumed: false, lastSave: 0, aspect: null, titled: !!source.title, wasPlaying: null };
  const hooks = { onError: (msg) => showError(msg, source.original), onTitle, injectScript };
  player = source.kind === 'native'
    ? new NativePlayer(ui.native, source, hooks)
    : new WebviewPlayer(ui.stage, source, hooks);
  player.load();
  player.cmd('rate', 1);
  ui.speed.value = '1';

  const fixed = ASPECTS[app.settings.aspect];
  if (fixed !== undefined) api.window('aspect', fixed);

  clearInterval(pollTimer);
  pollTimer = setInterval(poll, 500);
  refreshRecent();
}

function teardown() {
  clearInterval(pollTimer);
  if (session) savePosition(true);
  player?.destroy();
  player = null;
  session = null;
  api.window('playing', false);
}

function onTitle(title) {
  if (!session || !title) return;
  const clean = title.replace(/\s+-\s+YouTube$/, '').trim();
  if (!clean || /^(youtube|vimeo|twitch)$/i.test(clean) || clean === 'about:blank') return;
  setTitle(clean);
  window.FVQueue?.onTitle(clean);
  if (!session.titled) {
    session.titled = true;
    api.updateHistory(session.source.original, { title: clean });
  }
}

function setTitle(t) { ui.title.textContent = t; ui.title.title = t; }

// ------------------------------------------------------------------ polling

async function poll() {
  if (!player || !session || session.polling) return;
  const sess = session, p = player;
  sess.polling = true;
  const s = await p.status().finally(() => { sess.polling = false; });
  if (session !== sess || player !== p) return; // result belongs to a player that is gone

  if (!s || !s.found) {
    const waited = Date.now() - session.startedAt;
    if (session.wasPlaying) { session.wasPlaying = false; api.window('playing', false); }
    // The page has no <video> but embeds a known player -> open that instead.
    // (Values come from the page, so only accept plain web links.)
    const embed = Array.isArray(s?.embeds) && s.embeds.find((u) => typeof u === 'string' && /^https:\/\//.test(u));
    if (embed && !session.redirecting && session.source.kind === 'web' && waited > 3000) {
      session.redirecting = true;
      toast('Found an embedded player on this page — opening it');
      return openLink(embed);
    }
    if (session.source.kind === 'web' && waited > WEB_NO_VIDEO_MS && ui.error.hidden) {
      showError("Couldn't find a video on this page. Try opening it in your browser, or set up yt-dlp in Settings.", session.source.original);
    }
    return;
  }

  // The page itself reports an error (e.g. YouTube "Video unavailable")
  if (s.error) {
    if (ui.error.hidden && !session.pageErrorShown) {
      session.pageErrorShown = true;
      showError(`YouTube: ${s.error}`, session.source.original);
    }
    return;
  }

  if (s.ready !== false) ui.loading.hidden = true;
  if (s.title) onTitle(s.title);

  // Web pages rarely autoplay; start the video we found once.
  if (!session.autoplayed && s.paused && session.source.kind === 'web' && !s.ended) {
    session.autoplayed = true;
    player.cmd('play');
  }

  // "Playing" but the clock doesn't move -> the stream is stuck. Live streams get longer to buffer.
  if (!s.paused && s.currentTime === session.stallAt) {
    const limit = s.duration === null ? STALL_MS * 2 : STALL_MS;
    if (Date.now() - session.stallSince > limit && ui.error.hidden) {
      session.stallShown = true;
      showError('This video is stuck and not loading. It may play in your browser.', session.source.original);
    }
  } else {
    session.stallAt = s.currentTime;
    session.stallSince = Date.now();
    if (session.stallShown) { session.stallShown = false; hideError(); } // it recovered
  }

  // Resume where you stopped (YouTube gets this through its "start" parameter instead).
  if (!session.resumed && session.resumeAt && s.duration) {
    session.resumed = true;
    if (session.source.provider !== 'youtube') player.cmd('seekTo', session.resumeAt);
  }

  // Shape the window like the video.
  if (app.settings.aspect === 'auto' && s.w > 0 && s.h > 0) {
    const ratio = Math.min(4, Math.max(0.25, Math.round((s.w / s.h) * 1000) / 1000));
    if (ratio !== session.aspect) { session.aspect = ratio; api.window('aspect', ratio); }
  }

  const playing = !s.paused && !s.ended;
  if (playing !== session.wasPlaying) { session.wasPlaying = playing; api.window('playing', playing); }

  body.classList.toggle('paused', !playing);
  body.classList.toggle('muted', s.muted || s.volume === 0);
  body.classList.toggle('live', s.duration === null);
  if (document.activeElement !== ui.volume) setRange(ui.volume, Math.round((s.muted ? 0 : s.volume) * 100));
  if (!seeking && s.duration) setRange(ui.seek, Math.round((s.currentTime / s.duration) * 1000));
  ui.time.textContent = s.duration === null ? '● LIVE' : `${fmt(s.currentTime)} / ${fmt(s.duration || 0)}`;
  if (document.activeElement !== ui.speed && s.rate) {
    const r = String(s.rate);
    if ([...ui.speed.options].some((o) => o.value === r)) ui.speed.value = r;
  }

  session.last = s;
  window.FVQueue?.onStatus(s); // end of video -> next in Up next
  if (Date.now() - session.lastSave > SAVE_EVERY_MS) savePosition();
}

function savePosition(force) {
  const s = session?.last;
  if (!s || !s.duration || s.duration < 60) return;
  session.lastSave = Date.now();
  const nearEnd = s.ended || s.currentTime > s.duration - 10;
  if (!force && s.paused && session.savedAt === s.currentTime) return;
  session.savedAt = s.currentTime;
  api.updateHistory(session.source.original, { lastPosition: nearEnd ? 0 : Math.floor(s.currentTime) });
}

// ------------------------------------------------------------------ state from main

function applyState(s) {
  Object.assign(app, s);
  body.classList.toggle('click-through', !!app.clickThrough);
  $('btn-pin').classList.toggle('on', !!app.pinned);
  $('btn-clickthrough').classList.toggle('on', !!app.clickThrough);
  $('btn-mini').classList.toggle('on', !!app.mini);
  setRange(ui.opacity, Math.round(app.opacity * 100));
}

api.onState((s) => {
  const was = { pinned: app.pinned, clickThrough: app.clickThrough, opacity: app.opacity };
  applyState(s);
  if (was.pinned !== s.pinned) toast(s.pinned ? 'Always on top: ON' : 'Always on top: OFF');
  if (was.clickThrough !== s.clickThrough) toast(s.clickThrough ? 'Click-through ON — clicks pass to the app behind' : 'Click-through OFF');
  else if (was.opacity !== s.opacity) toast(`Opacity ${Math.round(s.opacity * 100)}%`);
});

api.onHandleHot((hot) => body.classList.toggle('handle-hot', hot));

api.onCommand((c) => {
  switch (c) {
    case 'toggle': return player?.cmd('toggle');
    case 'pause': return player?.cmd('pause');
    case 'seek-back': return player?.cmd('seek', -10);
    case 'seek-forward': return player?.cmd('seek', 10);
    case 'focus-link': return showLinkSheet();
    case 'settings': return openSettings();
  }
});

// Hover: the main process reports the cursor (mouse events inside a webview never reach us).
let lastCursor = { x: -1, y: -1 };
let idleTimer = null;
api.onCursor(({ inside, x, y }) => {
  if (!inside) {
    lastCursor = { x: -1, y: -1 };
    if (!sizeMenu.hidden) openSizeMenu(false);
    return setActive(false);
  }
  const moved = x !== lastCursor.x || y !== lastCursor.y;
  lastCursor = { x, y };
  const overBars = y < 40 || y > window.innerHeight - 64;
  if (moved || overBars) {
    setActive(true);
    clearTimeout(idleTimer);
    if (!overBars) idleTimer = setTimeout(() => setActive(false), IDLE_HIDE_MS);
  }
});
function setActive(on) { body.classList.toggle('active', on || body.classList.contains('paused') && !!player && lastCursor.x >= 0); }

// ------------------------------------------------------------------ controls

ui.linkForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = ui.linkInput.value;
  ui.linkInput.value = '';
  window.FVQueue ? window.FVQueue.submit(text) : openLink(text);
});
$('empty-close').addEventListener('click', () => body.classList.remove('show-link'));

$('btn-new').addEventListener('click', showLinkSheet);
$('btn-pin').addEventListener('click', () => api.window('pin'));
$('btn-clickthrough').addEventListener('click', () => api.window('click-through'));
$('btn-mini').addEventListener('click', () => api.window('mini'));
$('btn-settings').addEventListener('click', openSettings);
$('btn-close').addEventListener('click', () => api.window('hide'));
$('lock-handle').addEventListener('click', () => api.window('click-through'));
$('btn-play').addEventListener('click', () => player?.cmd('toggle'));
ui.native.addEventListener('click', () => player?.cmd('toggle'));
$('btn-mute').addEventListener('click', () => player?.cmd('muted', !body.classList.contains('muted')));

ui.seek.addEventListener('input', () => { seeking = true; paintRange(ui.seek); });
ui.seek.addEventListener('change', () => {
  const d = session?.last?.duration;
  if (d) player?.cmd('seekTo', (ui.seek.value / 1000) * d);
  setTimeout(() => { seeking = false; }, 300);
});
ui.volume.addEventListener('input', () => { paintRange(ui.volume); player?.cmd('volume', ui.volume.value / 100); });
ui.speed.addEventListener('change', () => player?.cmd('rate', Number(ui.speed.value)));
ui.opacity.addEventListener('input', () => { paintRange(ui.opacity); api.window('opacity', ui.opacity.value / 100); });

$('error-browser').addEventListener('click', () => {
  const url = ui.error.dataset.url;
  if (url) api.openExternal(url);
});
$('error-new').addEventListener('click', () => { hideError(); showLinkSheet(); });

// Keyboard (only while FloatView has focus; global hotkeys live in the main process).
document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input[type=text], input[type=number], select');
  if (e.key === 'Escape') {
    if (!sizeMenu.hidden) return openSizeMenu(false);
    if (!ui.settings.hidden) return closeSettings();
    if (body.classList.contains('show-link')) return body.classList.remove('show-link');
    return hideError();
  }
  if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
  const actions = {
    ' ': () => player?.cmd('toggle'), k: () => player?.cmd('toggle'),
    ArrowLeft: () => player?.cmd('seek', -5), ArrowRight: () => player?.cmd('seek', 5),
    ArrowUp: () => player?.cmd('volume', Math.min(1, (session?.last?.volume ?? 1) + 0.1)),
    ArrowDown: () => player?.cmd('volume', Math.max(0, (session?.last?.volume ?? 1) - 0.1)),
    m: () => player?.cmd('muted', !body.classList.contains('muted')),
    n: () => showLinkSheet(),
    '+': () => api.window('size-by', 1.15), '=': () => api.window('size-by', 1.15),
    '-': () => api.window('size-by', 1 / 1.15),
  };
  const fn = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (fn && !e.target.matches('input[type=range]')) { e.preventDefault(); fn(); }
});

// Ctrl+V anywhere (outside the text box) opens the pasted link right away.
document.addEventListener('paste', (e) => {
  if (e.target.matches('input[type=text], input[type=number]')) return;
  const text = e.clipboardData?.getData('text/plain');
  if (text) { e.preventDefault(); window.FVQueue ? window.FVQueue.submit(text) : openLink(text); }
});

// Drag & drop a link or a local file.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (window.FVQueue) return window.FVQueue.dropped(e); // several files / a folder -> Up next
  const file = e.dataTransfer.files?.[0];
  if (file) return openLink(api.pathForFile(file));
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (text) openLink(text.split(/\r?\n/).find((l) => l && !l.startsWith('#')));
});

// ------------------------------------------------------------------ window size

const sizeMenu = $('size-menu');
const sizeBadge = $('size-badge');

function openSizeMenu(open = sizeMenu.hidden) {
  sizeMenu.hidden = !open;
  $('btn-size').setAttribute('aria-expanded', String(open));
  $('btn-size').classList.toggle('on', open);
  if (open) api.getState().then((s) => s.size && showSize(s.size[0], s.size[1], false));
}

function showSize(w, h, badge = true) {
  $('size-now').textContent = `${w} × ${h}`;
  if (document.activeElement !== $('size-width')) $('size-width').value = w;
  if (!badge) return;
  sizeBadge.textContent = `${w} × ${h}`;
  sizeBadge.hidden = false;
  clearTimeout(showSize.t);
  showSize.t = setTimeout(() => { sizeBadge.hidden = true; }, 900);
}

api.onSize(({ w, h }) => showSize(w, h));

// Resize grip: screen coordinates, so moving the window under the pointer doesn't matter.
const grip = $('grip');
let gripFrom = null;
grip.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  gripFrom = { x: e.screenX, y: e.screenY };
  body.classList.add('gripping');
  api.window('grip-start');
});
grip.addEventListener('pointermove', (e) => {
  if (!gripFrom) return;
  api.window('grip-move', { dx: e.screenX - gripFrom.x, dy: e.screenY - gripFrom.y });
});
const gripEnd = () => {
  if (!gripFrom) return;
  gripFrom = null;
  body.classList.remove('gripping');
  api.window('grip-end');
};
grip.addEventListener('pointerup', gripEnd);
grip.addEventListener('pointercancel', gripEnd);
grip.addEventListener('lostpointercapture', gripEnd);

$('btn-size').addEventListener('click', () => openSizeMenu());
sizeMenu.querySelectorAll('[data-preset]').forEach((b) =>
  b.addEventListener('click', () => api.window('size-preset', b.dataset.preset)));
$('size-up').addEventListener('click', () => api.window('size-by', 1.15));
$('size-down').addEventListener('click', () => api.window('size-by', 1 / 1.15));
$('size-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const w = Number($('size-width').value);
  if (w >= 200) api.window('size-width', w);
});

// ------------------------------------------------------------------ link sheet & recent

function showLinkSheet() {
  closeSettings();
  if (player) body.classList.add('show-link');
  refreshRecent();
  requestAnimationFrame(() => { ui.linkInput.focus(); ui.linkInput.select(); });
}

async function refreshRecent() {
  app.history = (await api.getState()).history;
  renderRecent();
}

function renderRecent() {
  ui.recent.replaceChildren(...app.history.slice(0, 20).map((h) => {
    const li = document.createElement('li');
    li.title = h.url;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = h.title || h.url;
    const p = document.createElement('span');
    p.className = 'p';
    p.textContent = [h.provider, h.lastPosition > 5 ? `▶ ${fmt(h.lastPosition)}` : ''].filter(Boolean).join(' · ');
    li.append(t, p);
    li.addEventListener('click', () => {
      const opts = { fromHistory: true, startAt: h.lastPosition > 5 ? h.lastPosition : 0 };
      window.FVQueue ? window.FVQueue.playNow(h.url, opts) : openLink(h.url, opts);
    });
    return li;
  }));
}

// ------------------------------------------------------------------ settings

function fillSettings() {
  const s = app.settings;
  setRange($('s-opacity'), Math.round(s.opacity * 100));
  setRange($('s-ct'), Math.round(s.clickThroughOpacity * 100));
  $('o-opacity').textContent = `${Math.round(s.opacity * 100)}%`;
  $('o-ct').textContent = `${Math.round(s.clickThroughOpacity * 100)}%`;
  $('s-aspect').value = s.aspect || 'auto';
  $('s-corner').value = s.defaultCorner;
  $('s-login').checked = !!s.launchAtLogin;
  $('s-ytdlp').value = s.ytDlpPath || '';
}

async function setSetting(key, value) { app.settings = await api.setSetting(key, value); fillSettings(); }

$('s-opacity').addEventListener('input', (e) => { paintRange(e.target); $('o-opacity').textContent = `${e.target.value}%`; });
$('s-opacity').addEventListener('change', (e) => setSetting('opacity', e.target.value / 100));
$('s-ct').addEventListener('input', (e) => { paintRange(e.target); $('o-ct').textContent = `${e.target.value}%`; });
$('s-ct').addEventListener('change', (e) => setSetting('clickThroughOpacity', e.target.value / 100));
$('s-aspect').addEventListener('change', async (e) => {
  await setSetting('aspect', e.target.value);
  const fixed = ASPECTS[e.target.value];
  if (fixed !== undefined) api.window('aspect', fixed);
  else if (session) session.aspect = null; // 'auto' -> re-measure on next poll
});
$('s-corner').addEventListener('change', (e) => setSetting('defaultCorner', e.target.value));
$('s-login').addEventListener('change', (e) => setSetting('launchAtLogin', e.target.checked));
$('s-ytdlp').addEventListener('change', (e) => setSetting('ytDlpPath', e.target.value.trim() || null));
$('s-ytdlp-browse').addEventListener('click', async () => {
  const p = await api.pickYtDlp();
  if (p) setSetting('ytDlpPath', p);
});
$('s-clear-history').addEventListener('click', async () => { app.history = await api.clearHistory(); renderRecent(); toast('History cleared'); });
$('s-clear-site').addEventListener('click', async () => { await api.clearSiteData(); toast('Site cookies cleared'); });
$('s-keys').addEventListener('click', () => window.floatviewClock?.showTab('keys'));
$('s-quit').addEventListener('click', () => api.window('quit'));
$('settings-close').addEventListener('click', closeSettings);

function openSettings() { fillSettings(); ui.settings.hidden = false; }
function closeSettings() { ui.settings.hidden = true; }

// ------------------------------------------------------------------ helpers

function showError(msg, url) {
  ui.loading.hidden = true;
  if (session?.wasPlaying) { session.wasPlaying = false; api.window('playing', false); } // let the screen sleep again
  ui.errorText.textContent = msg;
  window.FVQueue?.onError(); // in a playlist: skip to the next video
  ui.error.dataset.url = /^https?:/.test(url || '') ? url : '';
  $('error-browser').hidden = !ui.error.dataset.url;
  ui.error.hidden = false;
}
function hideError() { ui.error.hidden = true; }

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

let toastTimer = null;
function toast(text, ms = 1600) {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms);
}

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
}

function setRange(el, value) { el.value = value; paintRange(el); }
function paintRange(el) {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--pct', `${pct}%`);
}

window.addEventListener('beforeunload', () => savePosition(true));
