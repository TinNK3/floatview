// Defaults + validation for the clock / Pomodoro / move / sound settings.
// Everything the renderer sends goes through sanitize(); bad values fall back to the current value.
const { DEFAULT_TIPS } = require('./timers');

const H8 = 8 * 3600;

const POMO_PRESETS = [
  { id: 'default', name: 'Default', focusSec: 1500, shortSec: 300, longSec: 900, rounds: 4 },
  { id: 'deep', name: 'Deep work', focusSec: 3000, shortSec: 600, longSec: 1800, rounds: 3 },
  { id: 'quick', name: 'Quick', focusSec: 900, shortSec: 180, longSec: 600, rounds: 4 },
  { id: 'ultradian', name: 'Ultradian', focusSec: 5400, shortSec: 1200, longSec: 0, rounds: 4 },
];

const MOVE_PRESETS = [
  { id: 'default', name: 'Default', sitSec: 3000, breakSec: 180 },
  { id: 'eyes', name: 'Eye rest 20-20-20', sitSec: 1200, breakSec: 20 },
  { id: 'pomo', name: 'Pomodoro-style', sitSec: 1500, breakSec: 300 },
  { id: 'hourly', name: 'Hourly stretch', sitSec: 3600, breakSec: 300 },
];

const SOUND_EVENTS = ['focusStart', 'focusEnd', 'breakStart', 'breakEnd', 'move', 'tick'];

const DEFAULTS = {
  viewMode: 'video', // 'video' | 'video-clock' | 'clock'
  clock: {
    theme: 'midnight', hour12: false, seconds: false, date: 'off', animate: true, font: null,
    colors: { digit: null, card: null, bg: null, accent: null },
    overlay: { size: 'M', anchor: 'top-right', opacity: 0.85, hideOnHover: false, show: 'pomodoro', big: 'auto' }, // big: 'auto' | 'time' | 'pomodoro'
    screenShows: 'timer',         // Clock mode: big countdown while a Pomodoro runs ('timer') or always the time ('time')
    pauseVideoInClock: false,
  },
  pomodoro: {
    focusSec: 1500, shortSec: 300, longSec: 900, rounds: 4, autoBreak: true, autoFocus: false, pauseVideo: true,
    preset: 'default', userDefault: null, presets: [],
  },
  move: {
    enabled: true, sitSec: 3000, breakSec: 180, snoozeSec: 300, maxSnoozes: 2, awaySec: null, mergeSec: 300,
    repeat: { everySec: 30, times: 5 }, activeHours: null, strict: false, pauseVideo: true,
    tips: 'builtin', customTips: [], preset: 'default', userDefault: null, presets: [],
  },
  sounds: {
    master: 0.8, duck: true,
    events: { focusStart: 'start-bright', focusEnd: 'chime-steel', breakStart: 'break-pizzicato', breakEnd: 'rise-clear', move: 'bell-clear', tick: null },
    volumes: { focusStart: 1, focusEnd: 1, breakStart: 1, breakEnd: 1, move: 1, tick: 0.5 },
    custom: [], // { id, name, file }  file = absolute path inside userData/sounds
  },
};

// ---- small validators ------------------------------------------------------------
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const int = (v, min, max, d) => (Number.isInteger(v) && v >= min && v <= max ? v : d);
const num = (v, min, max, d) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : d);
const color = (v, d) => (v === null ? null : typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const text = (v, max, d) => (typeof v === 'string' ? v.trim().slice(0, max) : d);
const idStr = (v) => typeof v === 'string' && /^[a-z0-9-]{1,40}$/i.test(v);

function sanitizeClock(v, cur, ctx) {
  if (!isObj(v)) return cur;
  const o = isObj(v.overlay) ? v.overlay : {};
  const c = isObj(v.colors) ? v.colors : {};
  return {
    theme: oneOf(v.theme, ctx.themeIds, cur.theme),
    hour12: bool(v.hour12, cur.hour12),
    seconds: bool(v.seconds, cur.seconds),
    date: oneOf(v.date, ['off', 'short', 'full'], cur.date),
    animate: bool(v.animate, cur.animate),
    font: v.font === null ? null : oneOf(v.font, ctx.fonts, cur.font),
    colors: {
      digit: color(c.digit, cur.colors.digit), card: color(c.card, cur.colors.card),
      bg: color(c.bg, cur.colors.bg), accent: color(c.accent, cur.colors.accent),
    },
    overlay: {
      size: oneOf(o.size, ['S', 'M', 'L', 'XL'], cur.overlay.size),
      anchor: oneOf(o.anchor, ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'], cur.overlay.anchor),
      opacity: num(o.opacity, 0.2, 1, cur.overlay.opacity),
      hideOnHover: bool(o.hideOnHover, cur.overlay.hideOnHover),
      show: oneOf(o.show, ['none', 'pomodoro', 'sitting'], cur.overlay.show),
      big: oneOf(o.big, ['auto', 'time', 'pomodoro'], cur.overlay.big || 'auto'),
    },
    screenShows: oneOf(v.screenShows, ['timer', 'time'], cur.screenShows),
    pauseVideoInClock: bool(v.pauseVideoInClock, cur.pauseVideoInClock),
  };
}

function sanitizePomoPreset(p) {
  if (!isObj(p) || !idStr(p.id)) return null;
  const name = text(p.name, 40, '');
  const focusSec = int(p.focusSec, 10, H8, null), shortSec = int(p.shortSec, 10, H8, null);
  const longSec = p.longSec === 0 ? 0 : int(p.longSec, 10, H8, null);
  const rounds = int(p.rounds, 1, 99, null);
  if (!name || focusSec === null || shortSec === null || longSec === null || rounds === null) return null;
  return { id: p.id, name, focusSec, shortSec, longSec, rounds };
}

function sanitizePomodoro(v, cur) {
  if (!isObj(v)) return cur;
  const presets = Array.isArray(v.presets) ? v.presets.map(sanitizePomoPreset).filter(Boolean).slice(0, 30) : cur.presets;
  return {
    focusSec: int(v.focusSec, 10, H8, cur.focusSec),
    shortSec: int(v.shortSec, 10, H8, cur.shortSec),
    longSec: v.longSec === 0 ? 0 : int(v.longSec, 10, H8, cur.longSec),
    rounds: int(v.rounds, 1, 99, cur.rounds),
    autoBreak: bool(v.autoBreak, cur.autoBreak),
    autoFocus: bool(v.autoFocus, cur.autoFocus),
    pauseVideo: bool(v.pauseVideo, cur.pauseVideo),
    preset: typeof v.preset === 'string' && v.preset.length <= 40 ? v.preset : cur.preset,
    userDefault: v.userDefault === null ? null : sanitizePomoPreset(v.userDefault) ?? cur.userDefault,
    presets,
  };
}

function sanitizeMovePreset(p) {
  if (!isObj(p) || !idStr(p.id)) return null;
  const name = text(p.name, 40, '');
  const sitSec = int(p.sitSec, 60, H8, null), breakSec = int(p.breakSec, 10, H8, null);
  if (!name || sitSec === null || breakSec === null) return null;
  return { id: p.id, name, sitSec, breakSec };
}

function sanitizeActiveHours(v, cur) {
  if (v === null) return null;
  if (!isObj(v)) return cur;
  const days = Array.isArray(v.days) ? [...new Set(v.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  const ranges = Array.isArray(v.ranges)
    ? v.ranges.filter((r) => Array.isArray(r) && r.length === 2 && r.every((m) => Number.isInteger(m) && m >= 0 && m <= 1440) && r[0] !== r[1]).slice(0, 8)
    : [];
  return { days, ranges };
}

function sanitizeMove(v, cur) {
  if (!isObj(v)) return cur;
  const r = isObj(v.repeat) ? v.repeat : {};
  return {
    enabled: bool(v.enabled, cur.enabled),
    sitSec: int(v.sitSec, 60, H8, cur.sitSec),
    breakSec: int(v.breakSec, 10, H8, cur.breakSec),
    snoozeSec: int(v.snoozeSec, 10, 2 * 3600, cur.snoozeSec),
    maxSnoozes: v.maxSnoozes === -1 ? -1 : int(v.maxSnoozes, 0, 99, cur.maxSnoozes),
    awaySec: v.awaySec === null ? null : int(v.awaySec, 10, 2 * 3600, cur.awaySec),
    mergeSec: int(v.mergeSec, 0, 3600, cur.mergeSec),
    repeat: { everySec: r.everySec === 0 ? 0 : int(r.everySec, 5, 600, cur.repeat.everySec), times: int(r.times, 0, 99, cur.repeat.times) },
    activeHours: 'activeHours' in v ? sanitizeActiveHours(v.activeHours, cur.activeHours) : cur.activeHours,
    strict: bool(v.strict, cur.strict),
    pauseVideo: bool(v.pauseVideo, cur.pauseVideo),
    tips: oneOf(v.tips, ['builtin', 'custom', 'plain'], cur.tips),
    customTips: Array.isArray(v.customTips) ? v.customTips.map((t) => text(t, 200, '')).filter(Boolean).slice(0, 100) : cur.customTips,
    preset: typeof v.preset === 'string' && v.preset.length <= 40 ? v.preset : cur.preset,
    userDefault: v.userDefault === null ? null : sanitizeMovePreset(v.userDefault) ?? cur.userDefault,
    presets: Array.isArray(v.presets) ? v.presets.map(sanitizeMovePreset).filter(Boolean).slice(0, 30) : cur.presets,
  };
}

function sanitizeSounds(v, cur, ctx) {
  if (!isObj(v)) return cur;
  const ids = [...ctx.soundIds, ...cur.custom.map((c) => c.id)];
  const ev = isObj(v.events) ? v.events : {};
  const vol = isObj(v.volumes) ? v.volumes : {};
  const events = {}, volumes = {};
  for (const e of SOUND_EVENTS) {
    events[e] = ev[e] === null ? null : oneOf(ev[e], ids, cur.events[e]);
    volumes[e] = num(vol[e], 0, 1, cur.volumes[e]);
  }
  return { master: num(v.master, 0, 1, cur.master), duck: bool(v.duck, cur.duck), events, volumes, custom: cur.custom };
  // custom sounds are only added/removed through their own IPC calls (they copy files)
}

function sanitize(section, value, current, ctx) {
  switch (section) {
    case 'viewMode': return oneOf(value, ['video', 'video-clock', 'clock'], current);
    case 'clock': return sanitizeClock(value, current, ctx);
    case 'pomodoro': return sanitizePomodoro(value, current);
    case 'move': return sanitizeMove(value, current);
    case 'sounds': return sanitizeSounds(value, current, ctx);
    default: return current;
  }
}

// What the timer engine needs, from saved settings.
function timerConfig(settings) {
  const p = settings.pomodoro, m = settings.move;
  const tips = m.tips === 'custom' && m.customTips.length ? m.customTips : m.tips === 'plain' ? ['Time to stand up and move.'] : DEFAULT_TIPS;
  return {
    pomodoro: { focusSec: p.focusSec, shortSec: p.shortSec, longSec: p.longSec, rounds: p.rounds, autoBreak: p.autoBreak, autoFocus: p.autoFocus },
    move: {
      enabled: m.enabled, sitSec: m.sitSec, breakSec: m.breakSec, snoozeSec: m.snoozeSec, maxSnoozes: m.maxSnoozes,
      awaySec: m.awaySec, mergeSec: m.mergeSec, repeat: m.repeat, activeHours: m.activeHours, strict: m.strict, tips,
    },
  };
}

module.exports = { DEFAULTS, POMO_PRESETS, MOVE_PRESETS, SOUND_EVENTS, sanitize, timerConfig };
