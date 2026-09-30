// Tiny JSON store in %APPDATA%\FloatView\floatview.json. Local only.
const fs = require('node:fs');
const path = require('node:path');
const clock = require('./clock-settings');

const DEFAULTS = {
  stats: {},   // { 'YYYY-MM-DD': { focusSessions, focusSec, moveTaken, moveSnoozed, moveSkipped, longestSitSec } }
  windowByMode: {}, // { clock: { x, y, w, h } } — Video / Video+Clock use `window`
  settings: {
    ...clock.DEFAULTS,
    opacity: 1,
    clickThroughOpacity: 0.6,
    defaultCorner: 'bottom-right',
    defaultSize: [480, 270],
    aspect: 'auto', // 'auto' | '16:9' | '9:16' | '4:3' | 'free'
    launchAtLogin: false,
    ytDlpPath: null,
    hotkeys: {
      playPause: 'Ctrl+Alt+Space',
      focusLink: 'Ctrl+Alt+V',
      clickThrough: 'Ctrl+Alt+T',
      opacityUp: 'Ctrl+Alt+Up',
      opacityDown: 'Ctrl+Alt+Down',
      seekBack: 'Ctrl+Alt+Left',
      seekForward: 'Ctrl+Alt+Right',
      toggleHide: 'Ctrl+Alt+H',
      togglePin: 'Ctrl+Alt+P',
      sizeUp: 'Ctrl+Alt+=',
      sizeDown: 'Ctrl+Alt+-',
      cycleView: 'Ctrl+Alt+C',
      pomoToggle: 'Ctrl+Alt+S',
      moveBreakNow: 'Ctrl+Alt+B',
      moveSnooze: 'Ctrl+Alt+N',
    },
  },
  window: null, // { x, y, w, h, displayId, aspect }
  history: [],  // { url, title, provider, lastPosition, openedAt }
};

const HISTORY_LIMIT = 20;

function merge(base, over) {
  if (Array.isArray(base) || base === null || typeof base !== 'object') return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = merge(base[k], over[k]);
  return out;
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'floatview.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.data = merge(DEFAULTS, saved);
    this._timer = null;
  }

  get(key) { return this.data[key]; }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  // Debounced write so window drags/resizes don't hammer the disk.
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this._timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  addHistory(entry) {
    const list = this.data.history.filter((h) => h.url !== entry.url);
    const prev = this.data.history.find((h) => h.url === entry.url);
    list.unshift({ lastPosition: prev?.lastPosition || 0, ...entry, openedAt: new Date().toISOString() });
    this.data.history = list.slice(0, HISTORY_LIMIT);
    this.save();
  }

  updateHistory(url, patch) {
    const item = this.data.history.find((h) => h.url === url);
    if (!item) return;
    Object.assign(item, patch);
    this.save();
  }
}

module.exports = { Store, DEFAULTS, HISTORY_LIMIT, merge };
