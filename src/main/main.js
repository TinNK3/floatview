const {
  app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen, shell,
  session, powerSaveBlocker, dialog, nativeImage, Notification,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { resolve } = require('./resolver');
const { setupClock } = require('./clock-main');
const queueStore = require('./queue-store');
const youtube = require('./youtube');

// Autoplay with sound without a click inside the page (we are a video player).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Some sites refuse browsers that announce "Electron" in the user agent.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/, '')
  .replace(new RegExp(`\\s?${app.getName()}\\/\\S+`, 'i'), '');

const ROOT = path.join(__dirname, '..', '..');
const ICON = path.join(ROOT, 'assets', 'icon.png');
const MINI_SIZE = { width: 240, height: 135 };
const SNAP_PX = 24;
const HANDLE_PX = 44; // click-through unlock handle (top-right square)

let win = null;
let tray = null;
let store = null;
let state = {
  pinned: true,
  clickThrough: false,
  hidden: false,
  mini: false,
  preMiniBounds: null,
  opacity: 1,
  cursorInside: false,
  handleHot: false,
};
let psbId = null;
let clock = null;
const CLOCK_SIZE = { width: 420, height: 250 };

// Clock mode has no fixed shape; video modes follow the video.
const effAspect = () => (state.mini || viewMode() === 'clock' ? 0 : state.aspect || 0);
const viewMode = () => store.get('settings').viewMode;

// A separate data folder (tests, a second profile) is a separate app instance with its own lock.
if (process.env.FLOATVIEW_DATA_DIR) app.setPath('userData', process.env.FLOATVIEW_DATA_DIR);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(boot);
}

function boot() {
  store = new Store(process.env.FLOATVIEW_DATA_DIR || app.getPath('userData'));
  state.opacity = store.get('settings').opacity;
  hardenSessions();
  createWindow();
  clock = setupClock({
    store, root: ROOT, getWin: () => win, send, showMain: () => { showWindow(); win.focus(); },
    preload: path.join(__dirname, '..', 'preload.js'), icon: ICON, isTest: !!process.env.FLOATVIEW_TEST,
    isMediaPlaying: () => psbId !== null,
    isHidden: () => state.hidden,
    onTick: (snap) => {
      tray?.setToolTip(['FloatView', clock?.trayLabel(snap)].filter(Boolean).join(' · ').slice(0, 127));
      const key = `${snap.pomo.phase}|${snap.pomo.running}|${snap.move.state}|${snap.move.canSnooze}|${snap.move.enabled}`;
      if (key !== state.timerKey) { state.timerKey = key; refreshTray(); }
    },
  });
  createTray();
  registerHotkeys();
  startCursorWatch();
  screen.on('display-removed', ensureOnScreen);
  screen.on('display-metrics-changed', ensureOnScreen);
}

// ---------------------------------------------------------------- window

function initialBounds() {
  const saved = viewMode() === 'clock' ? store.get('windowByMode').clock : store.get('window');
  if (saved && isVisibleOnSomeDisplay(saved)) {
    return { x: saved.x, y: saved.y, width: saved.w, height: saved.h };
  }
  const s = store.get('settings');
  const [width, height] = Array.isArray(s.defaultSize) ? s.defaultSize : [480, 270];
  const wa = screen.getPrimaryDisplay().workArea;
  return cornerBounds(wa, s.defaultCorner, width, height);
}

function cornerBounds(wa, corner, width, height, margin = 16) {
  const right = wa.x + wa.width - width - margin;
  const bottom = wa.y + wa.height - height - margin;
  const left = wa.x + margin;
  const top = wa.y + margin;
  const pos = {
    'bottom-right': [right, bottom], 'bottom-left': [left, bottom],
    'top-right': [right, top], 'top-left': [left, top],
  }[corner] || [right, bottom];
  return { x: pos[0], y: pos[1], width, height };
}

function isVisibleOnSomeDisplay(b) {
  return screen.getAllDisplays().some(({ workArea: w }) => {
    const ix = Math.min(b.x + b.w, w.x + w.width) - Math.max(b.x, w.x);
    const iy = Math.min(b.y + b.h, w.y + w.height) - Math.max(b.y, w.y);
    return ix >= 80 && iy >= 60; // enough of it to grab
  });
}

function createWindow() {
  win = new BrowserWindow({
    ...initialBounds(),
    minWidth: 200,
    minHeight: 112,
    frame: false,
    transparent: false,           // transparent windows can't be edge-resized on Windows
    backgroundColor: '#000000',
    alwaysOnTop: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    show: false,
    title: 'FloatView',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      backgroundThrottling: false, // keep playing when unfocused
      spellcheck: false,
    },
  });

  applyTopmost();
  win.setOpacity(state.opacity);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Never navigate the shell page away from our UI.
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Hiding the window also fires 'blur'. Re-applying topmost then would show it again
  // (on Windows, setAlwaysOnTop/moveTop make a hidden window visible), so skip hidden windows.
  win.on('blur', () => { if (state.pinned && !state.hidden && win.isVisible()) { applyTopmost(); win.moveTop(); } });
  win.on('moved', () => { snapToEdges(); saveBounds(); });
  win.on('resized', saveBounds);
  // Live "W × H" label while the user drags an edge.
  win.on('resize', () => { const [w, h] = win.getSize(); send('size', { w, h }); });
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); hideWindow(); }
  });

  // Guard: some apps knock topmost windows down; re-assert every 2 s.
  setInterval(() => {
    if (win && !win.isDestroyed() && state.pinned && !state.hidden && !win.isAlwaysOnTop()) applyTopmost();
  }, 2000);
}

function applyTopmost() {
  if (!win || state.hidden) return;
  win.setAlwaysOnTop(state.pinned, 'screen-saver');
  if (state.pinned) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function saveBounds() {
  if (!win || state.mini) return;
  const b = win.getBounds();
  const d = screen.getDisplayMatching(b);
  const saved = { x: b.x, y: b.y, w: b.width, h: b.height, displayId: d.id };
  if (viewMode() === 'clock') store.set('windowByMode', { ...store.get('windowByMode'), clock: saved });
  else store.set('window', saved);
}

function snapToEdges() {
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  let { x, y } = b;
  if (Math.abs(b.x - wa.x) < SNAP_PX) x = wa.x;
  if (Math.abs(wa.x + wa.width - (b.x + b.width)) < SNAP_PX) x = wa.x + wa.width - b.width;
  if (Math.abs(b.y - wa.y) < SNAP_PX) y = wa.y;
  if (Math.abs(wa.y + wa.height - (b.y + b.height)) < SNAP_PX) y = wa.y + wa.height - b.height;
  if (x !== b.x || y !== b.y) win.setPosition(x, y);
}

function ensureOnScreen() {
  if (!win) return;
  const b = win.getBounds();
  if (isVisibleOnSomeDisplay({ x: b.x, y: b.y, w: b.width, h: b.height })) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.min(b.width, wa.width), h = Math.min(b.height, wa.height);
  win.setBounds(cornerBounds(wa, store.get('settings').defaultCorner, w, h));
  saveBounds();
}

function showWindow() {
  if (!win) return;
  state.hidden = false;
  win.showInactive();
  applyTopmost();
  sendState();
}

function hideWindow() {
  if (!win) return;
  state.hidden = true;
  win.hide();
  // First time only: say where it went, so ✕ doesn't look like it did nothing / quit.
  if (!store.get('hideTipShown') && !process.env.FLOATVIEW_TEST && Notification.isSupported()) {
    const n = new Notification({ title: 'FloatView is still running', icon: ICON, silent: true,
      body: 'It is hidden in the tray (bottom-right, near the clock). Press Ctrl+Alt+H to show it again, or right-click the tray icon → Quit to close it.' });
    n.on('click', showWindow);
    n.show();
    store.set('hideTipShown', true);
  }
  send('command', 'pause');
  sendState();
}

function toggleMini() {
  if (!win) return;
  if (!state.mini) {
    state.preMiniBounds = win.getBounds();
    const wa = screen.getDisplayMatching(state.preMiniBounds).workArea;
    const b = state.preMiniBounds;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const corner = `${cy > wa.y + wa.height / 2 ? 'bottom' : 'top'}-${cx > wa.x + wa.width / 2 ? 'right' : 'left'}`;
    state.mini = true;
    win.setAspectRatio(0);
    win.setBounds(cornerBounds(wa, corner, MINI_SIZE.width, MINI_SIZE.height));
  } else {
    state.mini = false;
    if (state.preMiniBounds) win.setBounds(state.preMiniBounds);
    ensureOnScreen(); // its monitor may have been unplugged meanwhile
    win.setAspectRatio(effAspect());
  }
  sendState();
}

function setAspect(r) {
  state.aspect = Number.isFinite(r) && r > 0 ? Math.min(4, Math.max(0.25, r)) : 0;
  if (state.mini || viewMode() === 'clock') return; // applied when leaving mini / clock mode
  win.setAspectRatio(state.aspect);
  if (!state.aspect) return;
  // Fit the window to the new ratio, keeping its width, then keep it inside the screen.
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  let width = b.width, height = Math.round(b.width / state.aspect);
  if (height > wa.height * 0.8) { height = Math.round(wa.height * 0.6); width = Math.round(height * state.aspect); }
  width = Math.min(width, wa.width);
  height = Math.max(112, height);
  const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height);
  win.setBounds({ x, y, width, height });
}

// ---- view modes: video | video-clock | clock ------------------------------------
// Clock mode keeps its own window size/position; the two video modes share one.
const VIEW_MODES = ['video', 'video-clock', 'clock'];

function setViewMode(mode) {
  if (!win || !VIEW_MODES.includes(mode)) return;
  const prev = viewMode();
  if (prev === mode) return;
  if (state.mini) { state.mini = false; if (state.preMiniBounds) win.setBounds(state.preMiniBounds); }
  saveBounds(); // under the old mode
  store.set('settings', { ...store.get('settings'), viewMode: mode });
  if ((prev === 'clock') !== (mode === 'clock')) {
    const saved = mode === 'clock' ? store.get('windowByMode').clock : store.get('window');
    const cur = win.getBounds();
    const wa = screen.getDisplayMatching(cur).workArea;
    let b;
    if (saved && isVisibleOnSomeDisplay(saved)) b = { x: saved.x, y: saved.y, width: saved.w, height: saved.h };
    else {
      // First time: same corner as the current window.
      const size = mode === 'clock' ? CLOCK_SIZE : { width: 480, height: 270 };
      const right = cur.x + cur.width / 2 > wa.x + wa.width / 2, bottom = cur.y + cur.height / 2 > wa.y + wa.height / 2;
      b = cornerBounds(wa, `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}`, size.width, size.height);
    }
    win.setAspectRatio(0);
    win.setBounds(b);
    win.setAspectRatio(effAspect());
  }
  win.setAspectRatio(effAspect()); // e.g. coming from mini size
  // Clock mode can pause the video (setting); coming back resumes it.
  clock?.holdVideo('clock', mode === 'clock' && store.get('settings').clock.pauseVideoInClock);
  send('settings', store.get('settings'));
  sendState();
}

function cycleViewMode() {
  setViewMode(VIEW_MODES[(VIEW_MODES.indexOf(viewMode()) + 1) % VIEW_MODES.length]);
}

// ---- size presets ------------------------------------------------------------
// Presets are a share of the screen's width, so they feel the same on any monitor.
const SIZE_PRESETS = { small: 0.2, medium: 0.33, large: 0.5, huge: 0.75 };
const MIN_W = 200, MIN_H = 112;

// Resize to `width` px, keeping the video's shape. The corner nearest the screen
// edge stays put, so a window in the bottom-right corner grows up and to the left.
function resizeTo(width) {
  if (!win) return;
  if (state.mini) { state.mini = false; win.setAspectRatio(effAspect()); }
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const ratio = effAspect() || b.width / b.height;
  let w = Math.round(Math.min(Math.max(width, MIN_W), wa.width));
  let h = Math.round(w / ratio);
  if (h > wa.height) { h = wa.height; w = Math.round(h * ratio); }
  if (h < MIN_H) { h = MIN_H; w = Math.round(h * ratio); }
  const right = b.x + b.width / 2 > wa.x + wa.width / 2;
  const bottom = b.y + b.height / 2 > wa.y + wa.height / 2;
  let x = right ? b.x + b.width - w : b.x;
  let y = bottom ? b.y + b.height - h : b.y;
  x = Math.min(Math.max(x, wa.x), wa.x + wa.width - w);
  y = Math.min(Math.max(y, wa.y), wa.y + wa.height - h);
  win.setBounds({ x, y, width: w, height: h });
  saveBounds();
  sendState();
}

// Drag-resize from the in-window grip (bottom-right). Top-left corner stays fixed.
let gripStart = null;
function gripResize(phase, dx = 0, dy = 0) {
  if (!win) return;
  if (phase === 'start') {
    if (state.mini) { state.mini = false; win.setAspectRatio(effAspect()); }
    gripStart = win.getBounds();
    return;
  }
  if (phase === 'end') { gripStart = null; saveBounds(); sendState(); return; }
  if (!gripStart) return;
  const s = gripStart;
  const wa = screen.getDisplayMatching(s).workArea;
  const maxW = wa.x + wa.width - s.x, maxH = wa.y + wa.height - s.y;
  let w, h;
  if (effAspect()) {
    const r = effAspect();
    // Follow whichever direction the pointer moved more.
    w = Math.abs(dx) >= Math.abs(dy * r) ? s.width + dx : (s.height + dy) * r;
    w = Math.min(Math.max(w, MIN_W, MIN_H * r), maxW, maxH * r);
    h = w / r;
  } else {
    w = Math.min(Math.max(s.width + dx, MIN_W), maxW);
    h = Math.min(Math.max(s.height + dy, MIN_H), maxH);
  }
  win.setBounds({ x: s.x, y: s.y, width: Math.round(w), height: Math.round(h) });
}

function resizePreset(name) {
  const share = SIZE_PRESETS[name];
  if (!share || !win) return;
  resizeTo(screen.getDisplayMatching(win.getBounds()).workArea.width * share);
}

function resizeBy(factor) {
  if (win) resizeTo(win.getBounds().width * factor);
}

function setPinned(on) {
  state.pinned = on;
  applyTopmost();
  sendState();
}

function setClickThrough(on) {
  state.clickThrough = on;
  state.handleHot = false;
  win.setIgnoreMouseEvents(on, { forward: true });
  win.setOpacity(on ? store.get('settings').clickThroughOpacity : state.opacity);
  if (on) win.blur();
  sendState();
}

function setOpacity(v) {
  state.opacity = Math.round(Math.min(1, Math.max(0.2, v)) * 100) / 100;
  if (!state.clickThrough) win.setOpacity(state.opacity);
  sendState();
}

// Mouse events inside a <webview> never reach our page, so hover is tracked
// from the main process instead. In click-through mode the same watcher turns
// the unlock handle back into a clickable area.
function startCursorWatch() {
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (inside !== state.cursorInside || inside) {
      state.cursorInside = inside;
      send('cursor', { inside, x: p.x - b.x, y: p.y - b.y });
    }
    if (state.clickThrough) {
      const hot = inside && p.x >= b.x + b.width - HANDLE_PX && p.y < b.y + HANDLE_PX;
      if (hot !== state.handleHot) {
        state.handleHot = hot;
        win.setIgnoreMouseEvents(!hot, { forward: true });
        send('handle-hot', hot);
      }
    }
  }, 120);
}

// ---------------------------------------------------------------- security

function hardenSessions() {
  // Embedded players must never open new windows or reach Node.
  app.on('web-contents-created', (_e, contents) => {
    // Pop-ups are always denied. Never forward them to the real browser either:
    // ad scripts open windows without any click.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (_ev, prefs, params) => {
      delete prefs.preload;
      prefs.nodeIntegration = false;
      prefs.contextIsolation = true;
      prefs.sandbox = true;
      prefs.backgroundThrottling = false;
      if (!/^https?:\/\//.test(params.src || '') && params.src !== 'about:blank') _ev.preventDefault();
      if (!['persist:embed', 'persist:fallback'].includes(params.partition)) _ev.preventDefault();
    });
  });

  for (const name of ['persist:embed', 'persist:fallback']) {
    const s = session.fromPartition(name);
    s.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
    s.setUserAgent(app.userAgentFallback);
    // Block ads (Settings → General, on by default): ad servers and YouTube's ad / ad-tracking calls.
    // Web pages: leave Google's IMA player SDK alone (some players hang without it).
    const patterns = name === 'persist:fallback' ? youtube.AD_PATTERNS.filter((p) => !p.includes('imasdk')) : youtube.AD_PATTERNS;
    s.webRequest.onBeforeRequest({ urls: patterns }, (_details, cb) => {
      const block = store.get('settings').blockAds !== false;
      if (block) state.adsBlocked = (state.adsBlocked || 0) + 1;
      cb({ cancel: block });
    });
  }

  // YouTube's embed player refuses to start without a Referer (error 153).
  session.fromPartition('persist:embed').webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube-nocookie.com/embed/*', 'https://www.youtube.com/embed/*'] },
    (details, cb) => {
      if (!details.requestHeaders.Referer) details.requestHeaders.Referer = 'https://floatview.local/';
      cb({ requestHeaders: details.requestHeaders });
    },
  );
}

// ---------------------------------------------------------------- tray & hotkeys

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('FloatView');
  tray.on('click', () => (state.hidden ? showWindow() : hideWindow()));
  refreshTray();
}

function timerMenu() {
  if (!clock) return [{ label: 'Loading…', enabled: false }];
  const snap = clock.timers.snapshot();
  const p = snap.pomo, m = snap.move;
  return [
    { label: p.running ? 'Pause Pomodoro' : p.phase === 'idle' ? 'Start Pomodoro' : 'Resume Pomodoro', click: () => { clock.act('pomo-toggle'); refreshTray(); } },
    { label: 'Skip phase', enabled: p.phase !== 'idle', click: () => { clock.act('pomo-skip'); refreshTray(); } },
    { label: 'Reset Pomodoro', enabled: p.phase !== 'idle', click: () => { clock.act('pomo-reset'); refreshTray(); } },
    { type: 'separator' },
    { label: 'Take a move break now', enabled: m.enabled && m.state !== 'break', click: () => { clock.act('move-break'); refreshTray(); } },
    { label: 'Snooze reminder', enabled: m.state === 'due' && m.canSnooze, click: () => { clock.act('move-snooze'); refreshTray(); } },
  ];
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: state.hidden ? 'Show' : 'Hide', click: () => (state.hidden ? showWindow() : hideWindow()) },
    { label: 'Open new link…', click: () => { showWindow(); win.focus(); send('command', 'focus-link'); } },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: state.pinned, click: (i) => setPinned(i.checked) },
    { label: 'Click-through', type: 'checkbox', checked: state.clickThrough, click: (i) => setClickThrough(i.checked) },
    { label: 'Next video', click: () => send('command', 'next') },
    { label: 'Previous video', click: () => send('command', 'prev') },
    { label: 'Mini size', type: 'checkbox', checked: state.mini, click: toggleMini },
    { label: 'Size', submenu: [
      { label: 'Small', click: () => resizePreset('small') },
      { label: 'Medium', click: () => resizePreset('medium') },
      { label: 'Large', click: () => resizePreset('large') },
      { label: 'Huge', click: () => resizePreset('huge') },
      { type: 'separator' },
      { label: 'Bigger\tCtrl+Alt+=', click: () => resizeBy(1.15) },
      { label: 'Smaller\tCtrl+Alt+-', click: () => resizeBy(1 / 1.15) },
    ] },
    { type: 'separator' },
    { label: 'View', submenu: [
      { label: 'Video', type: 'radio', checked: viewMode() === 'video', click: () => setViewMode('video') },
      { label: 'Video + Clock', type: 'radio', checked: viewMode() === 'video-clock', click: () => setViewMode('video-clock') },
      { label: 'Clock only', type: 'radio', checked: viewMode() === 'clock', click: () => setViewMode('clock') },
    ] },
    { label: 'Timer', submenu: timerMenu() },
    { type: 'separator' },
    { label: 'Settings…', click: () => { showWindow(); win.focus(); send('command', 'settings'); } },
    { label: 'Quit FloatView', click: quit },
  ]));
}

const HOTKEY_ACTIONS = {
  playPause: () => send('command', 'toggle'),
  focusLink: () => { showWindow(); if (state.clickThrough) setClickThrough(false); win.focus(); send('command', 'focus-link'); },
  clickThrough: () => setClickThrough(!state.clickThrough),
  opacityUp: () => setOpacity(state.opacity + 0.1),
  opacityDown: () => setOpacity(state.opacity - 0.1),
  seekBack: () => send('command', 'seek-back'),
  seekForward: () => send('command', 'seek-forward'),
  toggleHide: () => (state.hidden ? showWindow() : hideWindow()),
  togglePin: () => setPinned(!state.pinned),
  sizeUp: () => resizeBy(1.15),
  sizeDown: () => resizeBy(1 / 1.15),
  cycleView: () => { showWindow(); cycleViewMode(); },
  pomoToggle: () => { clock?.act('pomo-toggle'); refreshTray(); },
  moveBreakNow: () => { clock?.act('move-break'); refreshTray(); },
  moveSnooze: () => { clock?.act('move-snooze'); refreshTray(); },
  nextVideo: () => send('command', 'next'),
  prevVideo: () => send('command', 'prev'),
};

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  const failedActions = [];
  for (const [action, accel] of Object.entries(store.get('settings').hotkeys)) {
    const fn = HOTKEY_ACTIONS[action];
    if (!fn || !accel) continue;
    let ok = false;
    try { ok = globalShortcut.register(accel, fn); } catch { ok = false; }
    if (!ok) { failed.push(accel); failedActions.push(action); }
  }
  state.hotkeyErrors = failed;              // taken by another app, or invalid
  state.hotkeyFailedActions = failedActions;
}

// ---- editing hotkeys from Settings → Keys
// An accelerator FloatView accepts: at least one of Ctrl/Alt/Super (so plain typing keys are never
// stolen system-wide), then one key.
const HOTKEY_KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Up|Down|Left|Right|PageUp|PageDown|Home|End|Insert|Delete|Space|Tab|Backspace|Enter|=|-|\[|\]|\\|;|'|,|\.|\/|`|num[0-9]|numadd|numsub|nummult|numdiv|numdec)$/;
function validAccelerator(accel) {
  if (typeof accel !== 'string' || accel.length > 40) return false;
  const parts = accel.split('+');
  // "Ctrl+Alt+=" splits fine; "Ctrl+Alt+Plus" style isn't produced by the recorder
  const key = parts.pop();
  const mods = new Set(parts);
  if (mods.size !== parts.length || ![...mods].every((m) => ['Ctrl', 'Alt', 'Shift', 'Super'].includes(m))) return false;
  if (!mods.has('Ctrl') && !mods.has('Alt') && !mods.has('Super')) return false;
  return HOTKEY_KEY.test(key);
}

function hotkeyReport() {
  return { hotkeys: store.get('settings').hotkeys, failed: state.hotkeyFailedActions || [] };
}

ipcMain.handle('get-hotkeys', () => hotkeyReport());

// accel '' = no shortcut for this action
ipcMain.handle('set-hotkey', (_e, action, accel) => {
  if (!Object.hasOwn(HOTKEY_ACTIONS, action)) return { ...hotkeyReport(), error: 'Unknown action' };
  if (accel !== '' && !validAccelerator(accel)) {
    return { ...hotkeyReport(), error: 'Use Ctrl, Alt or Win together with another key (for example Ctrl+Alt+K).' };
  }
  const hotkeys = { ...store.get('settings').hotkeys };
  const clash = accel && Object.entries(hotkeys).find(([a, k]) => a !== action && k && k.toLowerCase() === accel.toLowerCase());
  if (clash) return { ...hotkeyReport(), error: `${accel} is already used here`, clash: clash[0] };
  hotkeys[action] = accel;
  store.set('settings', { ...store.get('settings'), hotkeys });
  registerHotkeys();
  const r = hotkeyReport();
  return r.failed.includes(action) ? { ...r, error: `${accel} is taken by another app. Try a different one.` } : r;
});

ipcMain.handle('reset-hotkeys', () => {
  const { DEFAULTS } = require('./store');
  store.set('settings', { ...store.get('settings'), hotkeys: { ...DEFAULTS.settings.hotkeys } });
  registerHotkeys();
  return hotkeyReport();
});

// While the user records a new shortcut, the old global ones must not fire.
ipcMain.handle('pause-hotkeys', (_e, on) => {
  if (on) globalShortcut.unregisterAll(); else registerHotkeys();
  return true;
});

// ---------------------------------------------------------------- IPC

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function publicState() {
  return {
    pinned: state.pinned, clickThrough: state.clickThrough, hidden: state.hidden,
    mini: state.mini, opacity: state.opacity, hotkeyErrors: state.hotkeyErrors || [], viewMode: viewMode(),
    adsBlocked: state.adsBlocked || 0,
    size: win && !win.isDestroyed() ? win.getSize() : null,
  };
}

function sendState() {
  send('state', publicState());
  refreshTray();
}

ipcMain.handle('get-state', () => ({
  ...publicState(),
  settings: store.get('settings'),
  history: store.get('history'),
  dataFile: store.file,
}));

ipcMain.handle('open-link', async (_e, input, opts = {}) => {
  const settings = store.get('settings');
  const src = await resolve(input, { ytDlpPath: settings.ytDlpPath, startAt: opts.startAt || 0 });
  const prev = store.get('history').find((h) => h.url === src.original);
  store.addHistory({ url: src.original, title: src.title || prev?.title || src.original, provider: src.provider || src.kind });
  return { ...src, lastPosition: prev?.lastPosition || 0 };
});

ipcMain.handle('update-history', (_e, url, patch) => {
  const allowed = {};
  if (typeof patch?.title === 'string') allowed.title = patch.title.slice(0, 200);
  if (Number.isFinite(patch?.lastPosition)) allowed.lastPosition = Math.max(0, patch.lastPosition);
  store.updateHistory(url, allowed);
  if (app.isQuitting) store.flush(); // the debounced save would never run
});

ipcMain.handle('clear-history', () => { store.set('history', []); return []; });

ipcMain.handle('clear-site-data', async () => {
  await Promise.all(['persist:embed', 'persist:fallback'].map((p) => session.fromPartition(p).clearStorageData()));
});

// What the UI may change, and what a valid value looks like.
const SETTING_RULES = {
  opacity: (v) => typeof v === 'number' && v >= 0.2 && v <= 1,
  clickThroughOpacity: (v) => typeof v === 'number' && v >= 0.1 && v <= 1,
  aspect: (v) => ['auto', '16:9', '9:16', '4:3', 'free'].includes(v),
  defaultCorner: (v) => ['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(v),
  launchAtLogin: (v) => typeof v === 'boolean',
  ytDlpPath: (v) => v === null || (typeof v === 'string' && /\.exe$/i.test(v) && path.isAbsolute(v)),
  blockAds: (v) => typeof v === 'boolean',
};

ipcMain.handle('set-setting', (_e, key, value) => {
  const settings = { ...store.get('settings') };
  if (!SETTING_RULES[key]?.(value)) return settings;
  settings[key] = value;
  store.set('settings', settings);
  if (key === 'launchAtLogin') app.setLoginItemSettings({ openAtLogin: !!value });
  if (key === 'opacity') setOpacity(Number(value));
  if (key === 'clickThroughOpacity' && state.clickThrough) win.setOpacity(Number(value));
  return settings;
});

ipcMain.handle('pick-ytdlp', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Find yt-dlp.exe', properties: ['openFile'],
    filters: [{ name: 'yt-dlp', extensions: ['exe'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('get-inject-script', () =>
  fs.readFileSync(path.join(__dirname, '..', 'renderer', 'inject', 'video-bridge.js'), 'utf8'));

ipcMain.on('window', (_e, action, arg) => {
  if (!win) return;
  switch (action) {
    case 'hide': hideWindow(); break;
    case 'quit': quit(); break;
    case 'mini': toggleMini(); break;
    case 'size-preset': resizePreset(String(arg)); break;
    case 'grip-start': gripResize('start'); break;
    case 'grip-end': gripResize('end'); break;
    case 'grip-move': {
      const dx = Number(arg?.dx), dy = Number(arg?.dy);
      if (Number.isFinite(dx) && Number.isFinite(dy)) gripResize('move', dx, dy);
      break;
    }
    case 'size-by': { const f = Number(arg); if (f >= 0.5 && f <= 2) resizeBy(f); break; }
    case 'size-width': { const w = Number(arg); if (Number.isFinite(w)) resizeTo(w); break; }
    case 'pin': setPinned(!state.pinned); break;
    case 'click-through': setClickThrough(!state.clickThrough); break;
    case 'opacity': setOpacity(Number(arg)); break;
    case 'aspect': setAspect(Number(arg)); break;
    case 'view-mode': setViewMode(String(arg)); break;
    case 'view-cycle': cycleViewMode(); break;
    case 'playing':
      if (arg && psbId === null) psbId = powerSaveBlocker.start('prevent-display-sleep');
      if (!arg && psbId !== null) { powerSaveBlocker.stop(psbId); psbId = null; }
      break;
  }
});

// ---- "Up next" queue
ipcMain.handle('get-queue', () => queueStore.sanitizeQueue(store.get('queue'), queueStore.DEFAULT_QUEUE));
ipcMain.handle('set-queue', (_e, q) => {
  const next = queueStore.sanitizeQueue(q, store.get('queue'));
  store.set('queue', next);
  return next;
});
// Dropped files/folders -> playable files (folders in name order).
ipcMain.handle('expand-paths', (_e, paths) => queueStore.expandPaths(paths));
// A site's playlist/album via yt-dlp (only when the user set it up).
// YouTube's suggested videos for the video that is playing ("More from YouTube").
ipcMain.handle('youtube-suggestions', async (_e, input) => {
  const id = youtube.videoIdFrom(input);
  if (!id) return [];
  try {
    const res = await session.fromPartition('persist:embed').fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: { 'Accept-Language': 'en,vi;q=0.8', Cookie: 'SOCS=CAI' }, signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    return youtube.suggestions(youtube.initialData(html), { exclude: id, limit: 30 });
  } catch { return []; }
});

ipcMain.handle('expand-playlist', async (_e, url) => {
  const exe = store.get('settings').ytDlpPath;
  if (!exe || typeof url !== 'string' || !/^https?:\/\//.test(url) || !queueStore.looksLikePlaylist(url)) return [];
  return queueStore.ytDlpPlaylist(exe, url);
});

ipcMain.handle('open-external', (_e, url) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url);
});

ipcMain.handle('open-data-file', () => { store.flush(); return shell.openPath(store.file); });

// ---------------------------------------------------------------- lifecycle

function quit() {
  app.isQuitting = true;
  store.flush();
  app.quit();
}

app.on('before-quit', () => { app.isQuitting = true; store?.flush(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

// Test hook: lets the smoke test read main-process state.
if (process.env.FLOATVIEW_TEST) {
  global.__floatview = {
    get win() { return win; }, get state() { return state; }, get store() { return store; }, get clock() { return clock; },
    setViewMode, showWindow, hideWindow,
  };
}
