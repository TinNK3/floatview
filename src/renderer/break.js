/* global FlipClock, Duration */
// Break screen: "Time to stand up" → Start break / Snooze / Skip, then a flip-clock countdown.
const api = window.floatview;
const $ = (id) => document.getElementById(id);
const { formatDuration, describeDuration } = Duration;
const pad = (n) => String(n).padStart(2, '0');

const countdown = new FlipClock($('countdown'), { animate: true });
let settings = null;
let assets = null;

function applyTheme() {
  if (!assets || !settings) return;
  const c = settings.clock;
  const t = JSON.parse(JSON.stringify(assets.themes.find((x) => x.id === c.theme) || assets.themes[0]));
  if (c.font) t.font = { ...t.font, family: c.font, scale: 1, metaFamily: null };
  if (c.colors.digit) t.colors.digit = c.colors.digit;
  if (c.colors.card) { t.colors.cardTop = c.colors.card; t.colors.cardBottom = c.colors.card; }
  if (c.colors.bg) { t.colors.bg = c.colors.bg; t.colors.bg2 = c.colors.bg; }
  if (c.colors.accent) t.colors.accent = c.colors.accent;
  countdown.setTheme(t);
  countdown.opts.animate = c.animate;
  const bg = t.colors.bg?.startsWith('#') ? t.colors.bg : '#0b0c0f';
  const s = document.documentElement.style;
  s.setProperty('--bg', bg);
  s.setProperty('--bg2', t.colors.bg2?.startsWith('#') ? t.colors.bg2 : bg);
  s.setProperty('--accent', t.colors.accent);
  const n = parseInt(bg.slice(1), 16);
  document.body.classList.toggle('light', (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150);
}

function render(snap) {
  const m = snap.move;
  const card = $('card');
  card.dataset.state = m.state === 'break' ? 'break' : 'due';
  $('badge').textContent = m.state === 'break' ? 'Move break' : 'Stand-up reminder';
  $('sitting').textContent = m.state === 'break' ? '' : `Sitting for ${describeDuration(Math.max(60, Math.round(m.sitSec / 60) * 60))}`;
  $('tip-due').textContent = m.tip || 'Take a short break and move.';
  $('tip-break').textContent = m.tip || '';
  $('start').textContent = `Start break (${formatDuration(m.breakTotalSec)})`;
  $('snooze').textContent = `Snooze ${describeDuration(m.snoozeSec)}`;
  $('snooze').hidden = !m.canSnooze;
  $('skip').hidden = m.strict;
  $('end').hidden = m.strict;
  $('note').textContent = !m.canSnooze && m.snoozes > 0 ? 'No more snoozes this time.' : m.strict ? 'Strict mode: the break runs to the end once started.' : '';
  if (m.state === 'break') {
    const s = m.breakEndsAt ? Math.max(0, Math.ceil((m.breakEndsAt - Date.now()) / 1000)) : m.breakLeftSec;
    const hh = Math.floor(s / 3600);
    countdown.show(hh ? { a: String(hh), b: pad(Math.floor((s % 3600) / 60)), c: pad(s % 60) } : { a: pad(Math.floor(s / 60)), b: pad(s % 60), c: null });
  }
}

const act = (a, arg) => api.timer(a, arg).then((s) => { lastSnap = s; render(s); });
$('start').addEventListener('click', () => act('move-break'));
$('snooze').addEventListener('click', () => act('move-snooze'));
$('skip').addEventListener('click', () => act('move-skip'));
$('end').addEventListener('click', () => act('move-skip'));
$('minus').addEventListener('click', () => act('move-adjust', -60));
$('plus').addEventListener('click', () => act('move-adjust', 60));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && $('card').dataset.state === 'due') act('move-break');
  if (e.key === 'Escape' && $('card').dataset.state === 'due' && !$('snooze').hidden) act('move-snooze');
});

let lastSnap = null;
api.onTimerState((s) => { lastSnap = s; render(s); });
// redraw on the second so the countdown never lags
(function loop() {
  if (lastSnap) render(lastSnap);
  const e = lastSnap?.move.breakEndsAt, now = Date.now();
  setTimeout(loop, e && e > now ? ((e - now) % 1000) + 8 : 1000 - (now % 1000) + 8);
})();
api.onSettings((s) => { settings = s; applyTheme(); });

(async () => {
  [assets, settings] = await Promise.all([api.getClockAssets(), api.getState().then((s) => s.settings)]);
  applyTheme();
  lastSnap = await api.getTimer();
  render(lastSnap);
})();
