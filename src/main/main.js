const {
  app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen, shell,
  session, powerSaveBlocker, dialog, nativeImage,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { resolve } = require('./resolver');

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
  createTray();
  registerHotkeys();
  startCursorWatch();
  screen.on('display-removed', ensureOnScreen);
  screen.on('display-metrics-changed', ensureOnScreen);
}

// ---------------------------------------------------------------- window

function initialBounds() {
  const saved = store.get('window');
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

  win.on('blur', () => { if (state.pinned) { applyTopmost(); win.moveTop(); } });
  win.on('moved', () => { snapToEdges(); saveBounds(); });
  win.on('resized', saveBounds);
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); hideWindow(); }
  });

  // Guard: some apps knock topmost windows down; re-assert every 2 s.
  setInterval(() => {
    if (win && !win.isDestroyed() && state.pinned && !state.hidden && !win.isAlwaysOnTop()) applyTopmost();
  }, 2000);
}

function applyTopmost() {
  if (!win) return;
  win.setAlwaysOnTop(state.pinned, 'screen-saver');
  if (state.pinned) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function saveBounds() {
  if (!win || state.mini) return;
  const b = win.getBounds();
  const d = screen.getDisplayMatching(b);
  store.set('window', { x: b.x, y: b.y, w: b.width, h: b.height, displayId: d.id });
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
    win.setAspectRatio(state.aspect || 0);
  }
  sendState();
}

function setAspect(r) {
  state.aspect = Number.isFinite(r) && r > 0 ? Math.min(4, Math.max(0.25, r)) : 0;
  if (state.mini) return; // applied when leaving mini
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

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: state.hidden ? 'Show' : 'Hide', click: () => (state.hidden ? showWindow() : hideWindow()) },
    { label: 'Open new link…', click: () => { showWindow(); win.focus(); send('command', 'focus-link'); } },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: state.pinned, click: (i) => setPinned(i.checked) },
    { label: 'Click-through', type: 'checkbox', checked: state.clickThrough, click: (i) => setClickThrough(i.checked) },
    { label: 'Mini size', type: 'checkbox', checked: state.mini, click: toggleMini },
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
};

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [action, accel] of Object.entries(store.get('settings').hotkeys)) {
    const fn = HOTKEY_ACTIONS[action];
    if (!fn || !accel) continue;
    try { if (!globalShortcut.register(accel, fn)) failed.push(accel); } catch { failed.push(accel); }
  }
  state.hotkeyErrors = failed; // taken by another app, or invalid
}

// ---------------------------------------------------------------- IPC

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function publicState() {
  return {
    pinned: state.pinned, clickThrough: state.clickThrough, hidden: state.hidden,
    mini: state.mini, opacity: state.opacity, hotkeyErrors: state.hotkeyErrors || [],
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
    case 'pin': setPinned(!state.pinned); break;
    case 'click-through': setClickThrough(!state.clickThrough); break;
    case 'opacity': setOpacity(Number(arg)); break;
    case 'aspect': setAspect(Number(arg)); break;
    case 'playing':
      if (arg && psbId === null) psbId = powerSaveBlocker.start('prevent-display-sleep');
      if (!arg && psbId !== null) { powerSaveBlocker.stop(psbId); psbId = null; }
      break;
  }
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
  global.__floatview = { get win() { return win; }, get state() { return state; }, get store() { return store; } };
}
