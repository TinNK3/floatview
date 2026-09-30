// Main-process side of the clock feature: runs the timer engine every second, reacts to its
// events (sounds, notifications, break window, pausing the video, stats) and serves the IPC.
const { BrowserWindow, ipcMain, powerMonitor, Notification, screen, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { Timers } = require('./timers');
const clockSettings = require('./clock-settings');

const SOUND_EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.opus'];
const MAX_SOUND_BYTES = 5 * 1024 * 1024;

function setupClock({ store, root, getWin, send, showMain, preload, icon, isTest, onTick, isMediaPlaying, isHidden }) {
  const settings = () => store.get('settings');
  const assetsDir = path.join(root, 'assets');
  const themes = JSON.parse(fs.readFileSync(path.join(assetsDir, 'themes', 'themes.json'), 'utf8')).themes;
  const soundCatalog = JSON.parse(fs.readFileSync(path.join(assetsDir, 'sounds', 'sounds.json'), 'utf8'));
  const fonts = [...new Set(fs.readFileSync(path.join(assetsDir, 'fonts', 'fonts.css'), 'utf8').match(/font-family: '([^']+)'/g).map((m) => m.slice(14, -1)))];
  const ctx = { themeIds: themes.map((t) => t.id), fonts, soundIds: soundCatalog.sounds.map((s) => s.id) };
  const soundsDir = path.join(path.dirname(store.file), 'sounds');

  const timers = new Timers({ config: clockSettings.timerConfig(settings()) });
  let breakWin = null;
  const videoHeldBy = new Set(); // reasons the video is paused by a timer ('pomo', 'move', 'clock')
  let testIdle = null;           // test hook: pretend the user is idle for N seconds

  // ------------------------------------------------------------ helpers

  function allSounds() {
    const s = settings().sounds;
    return [
      ...soundCatalog.sounds.map((x) => ({ id: x.id, name: x.name, gain: x.gain, custom: false,
        url: pathToFileURL(path.join(assetsDir, 'sounds', x.file)).href })),
      ...s.custom.map((x) => ({ id: x.id, name: x.name, gain: 1, custom: true, url: pathToFileURL(x.file).href })),
    ];
  }

  function playSound(event) {
    const s = settings().sounds;
    const id = s.events[event];
    if (!id) return;
    const snd = allSounds().find((x) => x.id === id);
    if (!snd) return;
    send('play-sound', { url: snd.url, volume: Math.min(1, s.master * (s.volumes[event] ?? 1) * snd.gain), duck: s.duck && event !== 'tick' });
  }

  function notify(title, body, onClick) {
    if (isTest || !Notification.isSupported()) return;
    const n = new Notification({ title, body, icon, silent: true });
    if (onClick) n.on('click', onClick);
    n.show();
  }

  function holdVideo(reason, on) {
    const before = videoHeldBy.size;
    if (on) videoHeldBy.add(reason); else videoHeldBy.delete(reason);
    if (!before && videoHeldBy.size) send('timer-video', 'pause');
    if (before && !videoHeldBy.size && !isHidden?.()) send('timer-video', 'resume');
  }

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function stat(patch) {
    const all = { ...store.get('stats') };
    const k = today();
    const day = { focusSessions: 0, focusSec: 0, moveTaken: 0, moveSnoozed: 0, moveSkipped: 0, longestSitSec: 0, ...(all[k] || {}) };
    for (const [key, v] of Object.entries(patch)) day[key] = key === 'longestSitSec' ? Math.max(day[key], v) : day[key] + v;
    all[k] = day;
    // keep 60 days
    const keys = Object.keys(all).sort();
    while (keys.length > 60) delete all[keys.shift()];
    store.set('stats', all);
  }

  // ------------------------------------------------------------ events from the engine

  function handle(events) {
    const s = settings();
    for (const e of events) {
      switch (e.type) {
        case 'pomo-focus-start':
          playSound('focusStart');
          holdVideo('pomo', false);
          break;
        case 'pomo-focus-end':
          playSound('focusEnd');
          stat({ focusSessions: 1, focusSec: e.focusSec });
          notify('Focus done', 'Nice work. Time for a break.', showMain);
          break;
        case 'pomo-break-start':
          playSound('breakStart');
          if (s.pomodoro.pauseVideo) holdVideo('pomo', true);
          break;
        case 'pomo-break-end':
          playSound('breakEnd');
          holdVideo('pomo', false);
          if (!e.skipped) notify('Break over', s.pomodoro.autoFocus ? 'Next focus has started.' : 'Press Start when you are ready.', showMain);
          break;
        case 'pomo-reset':
          holdVideo('pomo', false);
          break;
        case 'move-due':
          playSound('move');
          notify('Time to stand up', e.tip || 'Take a short break and move.', showBreak);
          break;
        case 'move-repeat':
          playSound('move');
          break;
        case 'move-break-start':
          if (s.move.pauseVideo) holdVideo('move', true);
          break;
        case 'move-break-end':
          playSound('breakEnd');
          stat({ moveTaken: 1 });
          holdVideo('move', false);
          break;
        case 'move-snoozed':
          stat({ moveSnoozed: 1 });
          break;
        case 'move-skipped':
          stat({ moveSkipped: 1 });
          holdVideo('move', false);
          break;
        case 'move-resolved':
          holdVideo('move', false);
          break;
        case 'sit-reset':
          stat({ longestSitSec: Math.floor(e.sitMs / 1000) });
          break;
      }
    }
  }

  // ------------------------------------------------------------ break window

  function showBreak() {
    if (breakWin && !breakWin.isDestroyed()) { breakWin.show(); breakWin.focus(); return; }
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const w = 460, h = 330;
    breakWin = new BrowserWindow({
      x: Math.round(d.x + (d.width - w) / 2), y: Math.round(d.y + (d.height - h) / 2), width: w, height: h,
      frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#0b0c0f', title: 'FloatView — Break', icon,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false },
    });
    breakWin.setAlwaysOnTop(true, 'screen-saver');
    breakWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    breakWin.webContents.on('will-navigate', (ev) => ev.preventDefault());
    breakWin.loadFile(path.join(root, 'src', 'renderer', 'break.html'));
    breakWin.once('ready-to-show', () => { breakWin?.show(); breakWin?.focus(); });
    breakWin.on('closed', () => { breakWin = null; });
    // Closing the window (Alt+F4) = snooze if allowed, otherwise it comes back next tick.
    breakWin.on('close', (ev) => {
      const m = timers.snapshot().move;
      if (m.state === 'break' && m.strict) { ev.preventDefault(); return; }
      if (m.state === 'due') handle(timers.moveSnooze());
    });
  }

  function syncBreakWindow(snap) {
    const want = ['due', 'break'].includes(snap.move.state);
    if (want && !breakWin) showBreak();
    if (!want && breakWin && !breakWin.isDestroyed()) { breakWin.destroy(); breakWin = null; }
  }

  // ------------------------------------------------------------ loop

  function broadcast() {
    const snap = timers.snapshot();
    send('timer-state', snap);
    if (breakWin && !breakWin.isDestroyed()) breakWin.webContents.send('timer-state', snap);
    syncBreakWindow(snap);
    onTick?.(snap);
    return snap;
  }

  let lastTickSec = -1;
  function loop() {
    // Watching a FloatView video without touching the mouse is still sitting, not being away.
    const rawIdle = testIdle ?? powerMonitor.getSystemIdleTime();
    const idle = isMediaPlaying?.() ? 0 : rawIdle;
    handle(timers.tick(idle));
    broadcast();
    const s = settings();
    const sec = Math.floor(Date.now() / 1000);
    if (s.sounds.events.tick && s.viewMode !== 'video' && getWin()?.isVisible() && sec !== lastTickSec) playSound('tick');
    lastTickSec = sec;
  }
  const interval = setInterval(loop, 1000);

  powerMonitor.on('lock-screen', () => timers.onLock());
  powerMonitor.on('suspend', () => timers.onLock());
  powerMonitor.on('unlock-screen', () => { handle(timers.onUnlock()); broadcast(); });
  powerMonitor.on('resume', () => { handle(timers.onUnlock()); broadcast(); });

  // ------------------------------------------------------------ IPC

  const ACTIONS = {
    'pomo-start': () => timers.pomoStart(),
    'pomo-pause': () => timers.pomoPause(),
    'pomo-toggle': () => timers.pomoToggle(),
    'pomo-skip': () => timers.pomoSkip(),
    'pomo-reset': () => timers.pomoReset(),
    'pomo-adjust': (sec) => timers.pomoAdjust(Math.max(-3600, Math.min(3600, Number(sec)))),
    'move-break': () => timers.moveBreakStart(),
    'move-snooze': () => timers.moveSnooze(),
    'move-skip': () => timers.moveSkip(),
    'move-adjust': (sec) => timers.moveAdjust(Math.max(-3600, Math.min(3600, Number(sec)))),
  };

  function act(action, arg) {
    if (!Object.hasOwn(ACTIONS, action)) return timers.snapshot();
    const fn = ACTIONS[action];
    handle(fn(arg));
    return broadcast();
  }

  ipcMain.handle('timer', (_e, action, arg) => act(String(action), arg));
  ipcMain.handle('get-timer', () => timers.snapshot());

  ipcMain.handle('get-clock-assets', () => ({
    themes, fonts, sounds: allSounds(), soundEvents: clockSettings.SOUND_EVENTS,
    pomoPresets: clockSettings.POMO_PRESETS, movePresets: clockSettings.MOVE_PRESETS,
    fontsCss: pathToFileURL(path.join(assetsDir, 'fonts', 'fonts.css')).href,
  }));

  ipcMain.handle('set-section', (_e, section, value) => {
    if (!['clock', 'pomodoro', 'move', 'sounds'].includes(section)) return settings();
    const all = { ...settings() };
    all[section] = clockSettings.sanitize(section, value, all[section], ctx);
    store.set('settings', all);
    if (section === 'pomodoro' || section === 'move') timers.setConfig(clockSettings.timerConfig(all));
    send('settings', all);
    if (breakWin && !breakWin.isDestroyed()) breakWin.webContents.send('settings', all);
    broadcast();
    return all;
  });

  ipcMain.handle('add-sound', async (_e, testPath) => {
    let file = null;
    if (isTest && typeof testPath === 'string') file = testPath;
    else {
      const r = await dialog.showOpenDialog(getWin(), { title: 'Add a sound', properties: ['openFile'],
        filters: [{ name: 'Audio', extensions: SOUND_EXTS.map((x) => x.slice(1)) }] });
      if (r.canceled) return { settings: settings(), sounds: allSounds() };
      file = r.filePaths[0];
    }
    const ext = path.extname(file).toLowerCase();
    if (!SOUND_EXTS.includes(ext)) throw new Error('Please choose an .mp3, .wav, .ogg, .m4a or .opus file.');
    const size = fs.statSync(file).size;
    if (size > MAX_SOUND_BYTES) throw new Error('That sound is bigger than 5 MB.');
    fs.mkdirSync(soundsDir, { recursive: true });
    const id = 'custom-' + crypto.randomBytes(4).toString('hex');
    const dest = path.join(soundsDir, id + ext);
    fs.copyFileSync(file, dest); // a copy, so it keeps working if the original moves
    const all = { ...settings() };
    all.sounds = { ...all.sounds, custom: [...all.sounds.custom, { id, name: path.basename(file, ext).slice(0, 60), file: dest }] };
    store.set('settings', all);
    send('settings', all);
    return { settings: all, sounds: allSounds(), added: id };
  });

  ipcMain.handle('remove-sound', (_e, id) => {
    const all = { ...settings() };
    const item = all.sounds.custom.find((c) => c.id === id);
    if (!item) return { settings: all, sounds: allSounds() };
    const rel = path.relative(soundsDir, item.file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(item.file, { force: true });
    const events = { ...all.sounds.events };
    for (const k of Object.keys(events)) if (events[k] === id) events[k] = clockSettings.DEFAULTS.sounds.events[k];
    all.sounds = { ...all.sounds, events, custom: all.sounds.custom.filter((c) => c.id !== id) };
    store.set('settings', all);
    send('settings', all);
    return { settings: all, sounds: allSounds() };
  });

  ipcMain.handle('get-stats', () => {
    const all = store.get('stats');
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ date: k, ...{ focusSessions: 0, focusSec: 0, moveTaken: 0, moveSnoozed: 0, moveSkipped: 0, longestSitSec: 0 }, ...(all[k] || {}) });
    }
    return days;
  });

  ipcMain.handle('reset-stats', () => { store.set('stats', {}); return true; });

  return {
    timers, act, broadcast, showBreak, holdVideo,
    setTestIdle: (sec) => { testIdle = sec; },
    stop: () => clearInterval(interval),
    get breakWin() { return breakWin; },
    trayLabel(snap = timers.snapshot()) {
      const { formatDuration } = require('../shared/duration');
      const p = snap.pomo, m = snap.move;
      const parts = [];
      if (p.phase !== 'idle') parts.push(`${{ focus: 'Focus', short: 'Break', long: 'Long break' }[p.phase]} ${formatDuration(p.leftSec)}${p.running ? '' : ' (paused)'}`);
      if (m.enabled && m.state === 'break') parts.push(`Move break ${formatDuration(m.breakLeftSec)}`);
      else if (m.enabled && m.state === 'due') parts.push('Time to stand up');
      else if (m.enabled) parts.push(`Stand up in ${formatDuration(m.dueInSec)}`);
      return parts.join(' · ');
    },
  };
}

module.exports = { setupClock };
