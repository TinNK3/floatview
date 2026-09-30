/* global api, $, body, player, session, toast, openSettings, showLinkSheet, FlipClock, Duration */
// Clock views (Video + Clock overlay, Clock-only screen), Pomodoro panel, timer sounds,
// and the Clock / Pomodoro / Move / Sounds / Stats settings tabs.
// Loaded after renderer.js and shares its globals (api, $, body, player, session, toast…).

(async function clockUI() {
  const { parseDuration, formatDuration, describeDuration } = Duration;
  const pad = (n) => String(n).padStart(2, '0');

  const assets = await api.getClockAssets();
  let settings = (await api.getState()).settings;
  let snap = await api.getTimer();
  const themesById = Object.fromEntries(assets.themes.map((t) => [t.id, t]));

  const overlayEl = $('clock-overlay');
  const pill = overlayEl.querySelector('.clock-pill');
  const screenEl = $('clock-screen');
  const overlayClock = new FlipClock($('overlay-clock'));
  const screenClock = new FlipClock($('screen-clock'));

  // ------------------------------------------------------------------ theme + view

  function effectiveTheme() {
    const c = settings.clock;
    const t = JSON.parse(JSON.stringify(themesById[c.theme] || themesById.midnight));
    if (c.font) t.font = { ...t.font, family: c.font, scale: 1, tracking: '0', metaFamily: null };
    if (c.colors.digit) t.colors.digit = c.colors.digit;
    if (c.colors.card) { t.colors.cardTop = c.colors.card; t.colors.cardBottom = c.colors.card; }
    if (c.colors.bg) { t.colors.bg = c.colors.bg; t.colors.bg2 = c.colors.bg; }
    if (c.colors.accent) t.colors.accent = c.colors.accent;
    return t;
  }

  const isLight = (hex) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    const n = parseInt(m[1], 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150;
  };

  function applyView() {
    const mode = settings.viewMode;
    body.classList.toggle('mode-video', mode === 'video');
    body.classList.toggle('mode-video-clock', mode === 'video-clock');
    body.classList.toggle('mode-clock', mode === 'clock');
    $('btn-view').classList.toggle('on', mode !== 'video');
    $('btn-view').title = `View: ${{ video: 'Video', 'video-clock': 'Video + Clock', clock: 'Clock only' }[mode]} (Ctrl+Alt+C to switch)`;

    const t = effectiveTheme();
    const c = settings.clock;
    for (const clk of [overlayClock, screenClock]) {
      clk.setTheme(t);
      Object.assign(clk.opts, { hour12: c.hour12, seconds: c.seconds, animate: c.animate });
    }
    // Overlay
    overlayEl.dataset.anchor = c.overlay.anchor;
    overlayEl.style.setProperty('--overlay-opacity', c.overlay.opacity);
    overlayEl.classList.toggle('hide-on-hover', c.overlay.hideOnHover);
    const glass = t.kind !== 'flip' && t.colors.bg && t.colors.bg !== 'transparent';
    pill.classList.toggle('glass', !!glass);
    pill.style.setProperty('--pill-bg', glass ? t.colors.bg : 'transparent');
    pill.style.setProperty('--pill-blur', `${t.card?.blur || 0}px`);
    // Clock screen
    const bg = t.colors.bg && !t.colors.bg.startsWith('rgba') && t.colors.bg !== 'transparent' ? t.colors.bg : '#0b0c0f';
    const bg2 = t.colors.bg2 && t.colors.bg2.startsWith('#') ? t.colors.bg2 : bg;
    screenEl.style.setProperty('--screen-bg', `radial-gradient(120% 120% at 50% 0%, ${bg2}, ${bg})`);
    screenEl.style.setProperty('--screen-accent', t.colors.accent);
    screenEl.style.setProperty('--screen-muted', t.colors.muted?.startsWith('#') ? t.colors.muted : '#9097a6');
    screenEl.style.setProperty('--screen-text', isLight(bg) ? '#1c1c1e' : '#eceef3');
    screenEl.classList.toggle('light', isLight(bg));
    screenEl.classList.toggle('scanlines', !!t.card?.scanlines);
    sizeClocks();
    render(true);
  }

  function sizeClocks() {
    const W = window.innerWidth, H = window.innerHeight;
    const wide = settings.clock.seconds ? 3.25 : 2.7; // card widths in units of card height
    const o = { S: 0.13, M: 0.19, L: 0.27, XL: 0.36 }[settings.clock.overlay.size] || 0.19;
    const oh = Math.max(22, Math.min(H * o, (W - 40) / wide));
    $('overlay-clock').style.setProperty('--fc-h', `${Math.round(oh)}px`);
    const panel = H > 200 ? 78 : H > 140 ? 30 : 0;
    const sh = Math.max(28, Math.min((H - panel - 24) * 0.72, (W - 40) / wide));
    $('screen-clock').style.setProperty('--fc-h', `${Math.round(sh)}px`);
  }
  window.addEventListener('resize', sizeClocks);

  // ------------------------------------------------------------------ rendering

  function timeValues(now = new Date()) {
    let h = now.getHours(), ampm = '';
    if (settings.clock.hour12) { ampm = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; }
    return { a: pad(h), b: pad(now.getMinutes()), c: settings.clock.seconds ? pad(now.getSeconds()) : null, ampm };
  }

  function countdownValues(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? { a: String(h), b: pad(m), c: pad(s) } : { a: pad(m), b: pad(s), c: null };
  }

  function dateLine(now = new Date()) {
    const d = settings.clock.date;
    if (d === 'off') return '';
    return now.toLocaleDateString('en-US', d === 'full'
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // Remaining seconds computed now from the deadline, so the display never lags the engine.
  const liveLeft = (endsAt, fallback) => (endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : fallback);

  const PHASE = { idle: 'Ready', focus: 'Focus', short: 'Short break', long: 'Long break' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function moveLine() {
    const m = snap.move;
    if (!m.enabled) return '';
    if (m.state === 'break') return `Move break · ${formatDuration(liveLeft(m.breakEndsAt, m.breakLeftSec))} left`;
    if (m.state === 'due') return 'Time to stand up';
    if (m.state === 'snoozed') return `Snoozed · ${formatDuration(liveLeft(m.snoozeUntil, m.snoozeLeftSec))}`;
    if (!m.active) return 'Reminders paused (outside active hours)';
    if (m.away) return 'Away · sitting timer reset';
    return `Stand up in ${formatDuration(m.dueInSec)}`;
  }

  function render(force) {
    const now = new Date();
    const p = { ...snap.pomo, leftSec: liveLeft(snap.pomo.endsAt, snap.pomo.leftSec) };
    const tv = timeValues(now);

    // Overlay: the time, plus a small line (Pomodoro / sitting / date)
    if (settings.viewMode === 'video-clock' || force) {
      const show = settings.clock.overlay.show;
      let meta = esc(dateLine(now));
      if (show === 'pomodoro' && p.phase !== 'idle') meta = `<span class="fc-accent">${PHASE[p.phase]}</span><span>${formatDuration(p.leftSec)}${p.running ? '' : ' ❚❚'}</span>`;
      if (show === 'sitting' && snap.move.enabled) meta = `<span>${esc(moveLine())}</span>`;
      overlayClock.show({ ...tv, meta });
    }

    // Clock screen: big countdown while a Pomodoro is on (setting), else the time
    if (settings.viewMode === 'clock' || force) {
      const timer = settings.clock.screenShows === 'timer' && p.phase !== 'idle';
      if (timer) {
        const clockText = `${tv.a}:${tv.b}${tv.ampm ? ' ' + tv.ampm : ''}`;
        screenClock.show({ ...countdownValues(p.leftSec), ampm: '', meta: `<span class="fc-accent">${PHASE[p.phase]}${p.running ? '' : ' · paused'}</span><span>${clockText}</span>` });
      } else {
        screenClock.show({ ...tv, meta: esc(dateLine(now)) });
      }
      renderPanel();
    }
  }

  function renderPanel() {
    const p = snap.pomo, m = snap.move;
    $('pomo-phase').textContent = p.phase === 'idle' ? 'Pomodoro' : PHASE[p.phase] + (p.running ? '' : ' · paused');
    const dots = $('pomo-dots');
    const want = p.rounds || 0;
    if (dots.children.length !== want) dots.replaceChildren(...Array.from({ length: want }, () => document.createElement('i')));
    const filled = p.phase === 'focus' || p.phase === 'idle' ? (p.round - 1) : p.round;
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i < filled));
    $('pomo-toggle').textContent = p.running ? 'Pause' : p.phase === 'idle' ? 'Start focus'
      : p.waiting ? (p.phase === 'focus' ? 'Start focus' : 'Start break') : 'Resume';
    for (const id of ['pomo-skip', 'pomo-reset', 'pomo-minus', 'pomo-plus1', 'pomo-plus5']) $(id).disabled = p.phase === 'idle';
    $('move-status').textContent = moveLine();
    $('move-now').hidden = !m.enabled || m.state === 'break';
  }

  // Redraw at the next wall-clock second AND at the next countdown second (they are not aligned:
  // a countdown ticks from the moment Start was pressed), so neither display ever lags.
  function nextDelay() {
    const now = Date.now();
    let d = 1000 - (now % 1000) + 8;
    for (const e of [snap.pomo.endsAt, snap.move.breakEndsAt, snap.move.snoozeUntil]) {
      if (e && e > now) d = Math.min(d, ((e - now) % 1000) + 8);
    }
    return d;
  }
  (function loop() { render(); setTimeout(loop, nextDelay()); })();

  api.onTimerState((s) => { snap = s; if (settings.viewMode === 'clock') renderPanel(); });
  api.onSettings((s) => {
    settings = s;
    applyView();
    if (!ui.settings.hidden && !ui.settings.contains(document.activeElement)) renderTab(currentTab);
  });
  api.onState((s) => { if (s.viewMode && s.viewMode !== settings.viewMode) { settings.viewMode = s.viewMode; applyView(); } });

  // ------------------------------------------------------------------ controls

  const timer = (action, arg) => api.timer(action, arg).then((s) => { snap = s; render(); });
  $('pomo-toggle').addEventListener('click', () => timer('pomo-toggle'));
  $('pomo-skip').addEventListener('click', () => timer('pomo-skip'));
  $('pomo-reset').addEventListener('click', () => timer('pomo-reset'));
  $('pomo-minus').addEventListener('click', () => timer('pomo-adjust', -60));
  $('pomo-plus1').addEventListener('click', () => timer('pomo-adjust', 60));
  $('pomo-plus5').addEventListener('click', () => timer('pomo-adjust', 300));
  $('move-now').addEventListener('click', () => timer('move-break'));
  $('btn-view').addEventListener('click', () => api.window('view-cycle'));
  $('empty-clock').addEventListener('click', () => api.window('view-mode', 'clock'));
  $('empty-settings').addEventListener('click', () => openSettings());
  // "New link" from Clock mode goes back to video first.
  $('btn-new').addEventListener('click', () => { if (settings.viewMode === 'clock') api.window('view-mode', 'video'); }, true);

  // Space in Clock mode starts/pauses the Pomodoro instead of the (hidden) video.
  document.addEventListener('keydown', (e) => {
    if (settings.viewMode !== 'clock' || e.target.matches('input, select, textarea') || !ui.settings.hidden) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); e.stopImmediatePropagation(); timer('pomo-toggle'); }
  }, true);

  // ------------------------------------------------------------------ video pause/resume from timers

  let pausedByTimer = false;
  const userTookOver = () => { pausedByTimer = false; };
  $('btn-play').addEventListener('click', userTookOver);
  document.getElementById('native').addEventListener('click', userTookOver);
  document.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'k') && !e.target.matches('input, select, textarea')) userTookOver(); }, true);
  api.onCommand((c) => { if (c === 'toggle' || c === 'pause') userTookOver(); });
  api.onTimerVideo((cmd) => {
    if (cmd === 'pause' && player && session?.wasPlaying) { player.cmd('pause'); pausedByTimer = true; }
    if (cmd === 'resume' && pausedByTimer) { pausedByTimer = false; player?.cmd('play'); }
  });

  // ------------------------------------------------------------------ sounds (+ ducking the video)

  let duck = { count: 0, base: null, lastBase: null, restoredAt: 0 };
  function playSound({ url, volume, duck: shouldDuck }) {
    const a = new Audio(url);
    a.volume = Math.max(0, Math.min(1, volume));
    const canDuck = shouldDuck && player && session?.last && !session.last.muted && session.wasPlaying;
    if (canDuck) {
      if (duck.count === 0) {
        // right after a restore the polled volume may still be the lowered one
        duck.base = Date.now() - duck.restoredAt < 1500 && duck.lastBase !== null ? duck.lastBase : session.last.volume;
        player.cmd('volume', duck.base * 0.3);
      }
      duck.count += 1;
      let done = false;
      const release = () => {
        if (done) return;
        done = true;
        duck.count -= 1;
        if (duck.count === 0 && duck.base !== null) {
          player?.cmd('volume', duck.base);
          duck.lastBase = duck.base; duck.restoredAt = Date.now(); duck.base = null;
        }
      };
      a.addEventListener('ended', release);
      a.addEventListener('error', release);
      setTimeout(release, 4000);
    }
    a.play().catch(() => {});
    return a;
  }
  api.onPlaySound(playSound);

  // ------------------------------------------------------------------ settings tabs

  let currentTab = 'general';
  const tabs = [...document.querySelectorAll('.settings-tabs [role=tab]')];
  tabs.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  function showTab(name) {
    currentTab = name;
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    renderTab(name);
  }

  const panel = (name) => document.querySelector(`.tab-panel[data-panel="${name}"]`);

  function h(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    n.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
    return n;
  }

  // Like replaceChildren, but flattens arrays and skips false/null (for optional sections).
  const fill = (root, ...kids) => root.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

  async function save(section, patch) {
    const next = section === 'viewMode' ? patch : { ...settings[section], ...patch };
    settings = await api.setSection(section, next);
    applyView();
    return settings;
  }

  function toggle(label, checked, onChange, hint) {
    return h('label', { class: 'toggle', title: hint },
      h('span', {}, label),
      h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }));
  }

  function select(label, value, options, onChange) {
    return h('label', { class: 'field' }, label,
      h('select', { onchange: (e) => onChange(e.target.value) },
        options.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text))));
  }

  // Duration input: type anything (25, 90s, 1:30, 1h20m), ▲▼ / wheel to step, reset link.
  function duration(label, sec, { min = 10, max = 8 * 3600, def, onChange, off } = {}) {
    const input = h('input', { type: 'text', value: sec === null || sec === 0 && off ? '' : describeDuration(sec), spellcheck: 'false',
      placeholder: off ? off.placeholder : '', 'aria-label': label });
    const err = h('div', { class: 'err' });
    let last = sec;
    const commit = (v) => {
      input.classList.remove('bad');
      err.textContent = '';
      if (v === last) { input.value = v === null || (v === 0 && off) ? '' : describeDuration(v); return; }
      last = v;
      input.value = v === null || (v === 0 && off) ? '' : describeDuration(v);
      onChange(v);
    };
    const tryText = () => {
      const t = input.value.trim();
      if (!t && off) return commit(off.value);
      const v = parseDuration(t, { min, max });
      if (v === null) {
        input.classList.add('bad');
        err.textContent = `Try "25", "90s", "1:30" or "1h20m" (${describeDuration(min)} – ${describeDuration(max)}).`;
        return;
      }
      commit(v);
    };
    const step = (dir, e) => {
      const base = last === null || (last === 0 && off) ? (def ?? min) : last;
      const inc = e?.shiftKey ? 300 : e?.altKey ? 10 : 60;
      commit(Math.max(min, Math.min(max, base + dir * inc)));
    };
    input.addEventListener('change', tryText);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryText();
      if (e.key === 'ArrowUp') { e.preventDefault(); step(1, e); }
      if (e.key === 'ArrowDown') { e.preventDefault(); step(-1, e); }
    });
    input.addEventListener('wheel', (e) => { if (document.activeElement === input) { e.preventDefault(); step(e.deltaY < 0 ? 1 : -1, e); } }, { passive: false });
    return h('div', { class: 'field' }, label,
      h('div', { class: 'dur' }, input,
        h('button', { type: 'button', title: 'More (Shift = 5 min, Alt = 10 s)', onclick: (e) => step(1, e) }, '▲'),
        h('button', { type: 'button', title: 'Less (Shift = 5 min, Alt = 10 s)', onclick: (e) => step(-1, e) }, '▼')),
      err,
      def !== undefined && h('button', { type: 'button', class: 'reset', onclick: () => commit(def) }, `Reset to default (${def === null || (def === 0 && off) ? off?.label || 'off' : describeDuration(def)})`));
  }

  function number(label, value, { min, max, onChange }) {
    return h('label', { class: 'field' }, label, h('input', { type: 'number', min, max, value, onchange: (e) => {
      const v = Math.round(Number(e.target.value));
      if (Number.isFinite(v) && v >= min && v <= max) onChange(v); else { e.target.value = value; toast(`Use a number from ${min} to ${max}`); }
    } }));
  }

  const newId = () => 'my-' + Math.random().toString(36).slice(2, 8);

  // ---- Clock tab
  function themeColor(k) {
    const t = themesById[settings.clock.theme] || themesById.midnight;
    const v = { digit: t.colors.digit, card: t.colors.cardTop, bg: t.colors.bg, accent: t.colors.accent }[k];
    return /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000';
  }

  function renderClock(root) {
    const c = settings.clock;
    fill(root, 
      h('h3', {}, 'View'),
      select('Mode', settings.viewMode, [['video', 'Video only'], ['video-clock', 'Video + Clock'], ['clock', 'Clock only']],
        (v) => api.window('view-mode', v)),
      h('h3', {}, 'Theme'),
      h('div', { class: 'theme-grid' }, assets.themes.map((t) => h('button', {
        type: 'button', class: c.theme === t.id ? 'on' : '', title: t.name,
        style: `background: linear-gradient(160deg, ${t.colors.bg2?.startsWith('#') ? t.colors.bg2 : '#222'}, ${t.colors.bg?.startsWith('#') ? t.colors.bg : '#111'}); color: ${t.colors.digit}; font-family: '${t.font.family}'`,
        onclick: () => save('clock', { theme: t.id }).then(() => renderTab('clock')),
      }, h('span', { class: 'tnum', style: `color:${t.colors.digit}; font-weight:${t.font.weight}` }, '12:34'), h('span', { style: 'font-family: inherit; opacity:.8; font-size: 10px' }, t.name)))),
      h('div', { class: 'row2' },
        select('Font', c.font || '', [['', 'Theme font'], ...assets.fonts.map((f) => [f, f])], (v) => save('clock', { font: v || null })),
        select('Date', c.date, [['off', 'Off'], ['short', 'Tue, Sep 29'], ['full', 'Full date']], (v) => save('clock', { date: v }))),
      h('div', { class: 'colors' }, ['digit', 'card', 'bg', 'accent'].map((k) => h('label', {}, { digit: 'Digits', card: 'Cards', bg: 'Background', accent: 'Accent' }[k],
        h('input', { type: 'color', value: c.colors[k] || themeColor(k), title: c.colors[k] ? c.colors[k] : 'From theme',
          onchange: (e) => save('clock', { colors: { ...c.colors, [k]: e.target.value } }) })))),
      h('button', { type: 'button', class: 'reset', onclick: () => save('clock', { colors: { digit: null, card: null, bg: null, accent: null } }).then(() => renderTab('clock')) }, 'Use theme colors'),
      toggle('24-hour time', !c.hour12, (v) => save('clock', { hour12: !v })),
      toggle('Show seconds', c.seconds, (v) => save('clock', { seconds: v })),
      toggle('Flip animation', c.animate, (v) => save('clock', { animate: v })),
      h('h3', {}, 'On top of the video'),
      h('div', { class: 'row2' },
        select('Size', c.overlay.size, [['S', 'Small'], ['M', 'Medium'], ['L', 'Large'], ['XL', 'Extra large']], (v) => save('clock', { overlay: { ...c.overlay, size: v } })),
        select('Position', c.overlay.anchor, [['top-left', 'Top left'], ['top', 'Top'], ['top-right', 'Top right'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['bottom-left', 'Bottom left'], ['bottom', 'Bottom'], ['bottom-right', 'Bottom right']],
          (v) => save('clock', { overlay: { ...c.overlay, anchor: v } }))),
      h('label', { class: 'field' }, `Opacity ${Math.round(c.overlay.opacity * 100)}%`,
        h('input', { type: 'range', min: 20, max: 100, value: Math.round(c.overlay.opacity * 100),
          onchange: (e) => save('clock', { overlay: { ...c.overlay, opacity: e.target.value / 100 } }).then(() => renderTab('clock')) })),
      select('Line under the clock', c.overlay.show, [['pomodoro', 'Pomodoro countdown (when running)'], ['sitting', 'Sitting time'], ['none', 'Date / nothing']],
        (v) => save('clock', { overlay: { ...c.overlay, show: v } })),
      toggle('Hide clock while the mouse is over the window', c.overlay.hideOnHover, (v) => save('clock', { overlay: { ...c.overlay, hideOnHover: v } })),
      h('h3', {}, 'Clock only mode'),
      select('Big display', c.screenShows, [['timer', 'Pomodoro countdown when running, else the time'], ['time', 'Always the time']], (v) => save('clock', { screenShows: v })),
      toggle('Pause the video in Clock only mode', c.pauseVideoInClock, (v) => save('clock', { pauseVideoInClock: v })),
    );
  }

  // ---- Pomodoro tab
  function renderPomodoro(root) {
    const p = settings.pomodoro;
    const def = p.userDefault || assets.pomoPresets[0];
    const all = [...assets.pomoPresets.map((x) => ({ ...x, builtin: true })), ...p.presets];
    const matches = (x) => x.focusSec === p.focusSec && x.shortSec === p.shortSec && x.longSec === p.longSec && x.rounds === p.rounds;
    const apply = (x) => save('pomodoro', { focusSec: x.focusSec, shortSec: x.shortSec, longSec: x.longSec, rounds: x.rounds, preset: x.id }).then(() => renderTab('pomodoro'));
    const nameInput = h('input', { type: 'text', placeholder: 'Preset name, e.g. Coding 40/8', maxlength: 40 });
    fill(root, 
      h('h3', {}, 'Presets'),
      h('div', { class: 'chips' }, all.map((x) => h('button', { type: 'button', class: matches(x) ? 'on' : '', onclick: () => apply(x),
        title: `${describeDuration(x.focusSec)} focus · ${describeDuration(x.shortSec)} break · ${x.longSec ? describeDuration(x.longSec) + ' long break every ' + x.rounds : 'no long break'}` },
        x.name + (p.userDefault && p.userDefault.id === x.id ? ' ★' : ''),
        !x.builtin && h('span', { class: 'x', title: 'Delete preset', onclick: (e) => { e.stopPropagation(); save('pomodoro', { presets: p.presets.filter((y) => y.id !== x.id), userDefault: p.userDefault?.id === x.id ? null : p.userDefault }).then(() => renderTab('pomodoro')); } }, '×')))),
      h('div', { class: 'row2' },
        duration('Focus', p.focusSec, { def: def.focusSec, onChange: (v) => save('pomodoro', { focusSec: v }) }),
        duration('Short break', p.shortSec, { def: def.shortSec, onChange: (v) => save('pomodoro', { shortSec: v }) })),
      h('div', { class: 'row2' },
        duration('Long break', p.longSec, { def: def.longSec, off: { value: 0, label: 'off', placeholder: 'Off — no long break' }, onChange: (v) => save('pomodoro', { longSec: v }) }),
        number('Rounds before long break', p.rounds, { min: 1, max: 99, onChange: (v) => save('pomodoro', { rounds: v }) })),
      toggle('Start breaks automatically', p.autoBreak, (v) => save('pomodoro', { autoBreak: v })),
      toggle('Start the next focus automatically', p.autoFocus, (v) => save('pomodoro', { autoFocus: v })),
      toggle('Pause the video during breaks', p.pauseVideo, (v) => save('pomodoro', { pauseVideo: v })),
      h('h3', {}, 'Save'),
      h('div', { class: 'dur' }, nameInput, h('button', { type: 'button', style: 'width:auto;padding:0 10px', onclick: () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return toast('Give the preset a name'); }
        const x = { id: newId(), name, focusSec: p.focusSec, shortSec: p.shortSec, longSec: p.longSec, rounds: p.rounds };
        save('pomodoro', { presets: [...p.presets, x], preset: x.id }).then(() => { toast(`Saved "${name}"`); renderTab('pomodoro'); });
      } }, 'Save as preset')),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', onclick: () => {
          const x = { id: all.find(matches)?.id || newId(), name: all.find(matches)?.name || `My ${Math.round(p.focusSec / 60)}/${Math.round(p.shortSec / 60)}`, focusSec: p.focusSec, shortSec: p.shortSec, longSec: p.longSec, rounds: p.rounds };
          save('pomodoro', { userDefault: x }).then(() => { toast('These times are now your default'); renderTab('pomodoro'); });
        } }, 'Set current as my default'),
        h('button', { type: 'button', onclick: () => apply(def) }, 'Reset to default'),
        p.userDefault && h('button', { type: 'button', onclick: () => save('pomodoro', { userDefault: null }).then(() => renderTab('pomodoro')) }, 'Forget my default')),
    );
  }

  // ---- Move tab
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmtRange = ([a, b]) => `${pad(Math.floor(a / 60))}:${pad(a % 60)}-${pad(Math.floor(b / 60))}:${pad(b % 60)}`;
  function parseRanges(text) {
    const out = [];
    for (const part of text.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
      const m = part.match(/^(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?$/);
      if (!m) return null;
      const a = Number(m[1]) * 60 + Number(m[2] || 0), b = Number(m[3]) * 60 + Number(m[4] || 0);
      if (a > 1440 || b > 1440 || a === b) return null;
      out.push([a, b]);
    }
    return out;
  }

  function renderMove(root) {
    const m = settings.move;
    const def = m.userDefault || assets.movePresets[0];
    const all = [...assets.movePresets.map((x) => ({ ...x, builtin: true })), ...m.presets];
    const matches = (x) => x.sitSec === m.sitSec && x.breakSec === m.breakSec;
    const apply = (x) => save('move', { sitSec: x.sitSec, breakSec: x.breakSec, preset: x.id }).then(() => renderTab('move'));
    const ah = m.activeHours;
    const rangesInput = h('input', { type: 'text', value: ah?.ranges?.map(fmtRange).join(', ') || '', placeholder: 'e.g. 09:00-12:00, 13:00-18:00 (empty = all day)' });
    rangesInput.addEventListener('change', () => {
      const r = parseRanges(rangesInput.value);
      if (r === null) { rangesInput.classList.add('bad'); return toast('Use times like 09:00-12:00, 13:00-18:00'); }
      rangesInput.classList.remove('bad');
      save('move', { activeHours: { days: ah?.days || [], ranges: r } });
    });
    const nameInput = h('input', { type: 'text', placeholder: 'Preset name', maxlength: 40 });
    const snoozeUnlimited = m.maxSnoozes === -1;
    fill(root, 
      toggle('Remind me to stand up and move', m.enabled, (v) => save('move', { enabled: v }).then(() => renderTab('move'))),
      h('h3', {}, 'Presets'),
      h('div', { class: 'chips' }, all.map((x) => h('button', { type: 'button', class: matches(x) ? 'on' : '', onclick: () => apply(x),
        title: `after ${describeDuration(x.sitSec)} sitting → ${describeDuration(x.breakSec)} break` },
        x.name + (m.userDefault && m.userDefault.id === x.id ? ' ★' : ''),
        !x.builtin && h('span', { class: 'x', onclick: (e) => { e.stopPropagation(); save('move', { presets: m.presets.filter((y) => y.id !== x.id) }).then(() => renderTab('move')); } }, '×')))),
      h('div', { class: 'row2' },
        duration('Remind me after sitting', m.sitSec, { min: 60, def: def.sitSec, onChange: (v) => save('move', { sitSec: v }) }),
        duration('Move break length', m.breakSec, { def: def.breakSec, onChange: (v) => save('move', { breakSec: v }) })),
      h('div', { class: 'row2' },
        duration('Snooze length', m.snoozeSec, { max: 7200, def: 300, onChange: (v) => save('move', { snoozeSec: v }) }),
        h('div', { class: 'field' }, 'Snoozes allowed in a row',
          h('div', { class: 'dur' },
            h('input', { type: 'number', min: 0, max: 99, value: snoozeUnlimited ? '' : m.maxSnoozes, disabled: snoozeUnlimited,
              onchange: (e) => { const v = Math.round(Number(e.target.value)); if (v >= 0 && v <= 99) save('move', { maxSnoozes: v }); } }),
            h('label', { class: 'days' }, h('input', { type: 'checkbox', checked: snoozeUnlimited,
              onchange: (e) => save('move', { maxSnoozes: e.target.checked ? -1 : 2 }).then(() => renderTab('move')) }), 'no limit')))),
      h('div', { class: 'row2' },
        duration('Away this long counts as a break', m.awaySec, { max: 7200, def: null, off: { value: null, label: 'same as break length', placeholder: 'Same as break length' }, onChange: (v) => save('move', { awaySec: v }) }),
        duration('Wait for a Pomodoro break due within', m.mergeSec, { min: 10, max: 3600, def: 300, off: { value: 0, label: 'off', placeholder: 'Off' }, onChange: (v) => save('move', { mergeSec: v }) })),
      h('div', { class: 'row2' },
        duration('Repeat the sound every', m.repeat.everySec, { min: 5, max: 600, def: 30, off: { value: 0, label: 'off', placeholder: 'Off — play once' }, onChange: (v) => save('move', { repeat: { ...m.repeat, everySec: v } }) }),
        number('…up to this many times', m.repeat.times, { min: 0, max: 99, onChange: (v) => save('move', { repeat: { ...m.repeat, times: v } }) })),
      h('h3', {}, 'When'),
      toggle('Only remind me during active hours', !!ah, (v) => save('move', { activeHours: v ? { days: [1, 2, 3, 4, 5], ranges: [[540, 1080]] } : null }).then(() => renderTab('move'))),
      ah && h('div', { class: 'days' }, DAYS.map((d, i) => h('label', {}, h('input', { type: 'checkbox', checked: ah.days.includes(i),
        onchange: (e) => save('move', { activeHours: { ...ah, days: e.target.checked ? [...ah.days, i] : ah.days.filter((x) => x !== i) } }) }), d))),
      ah && h('label', { class: 'field' }, 'Hours (several ranges allowed)', rangesInput),
      h('h3', {}, 'Break screen'),
      toggle('Strict mode (the break can\'t be skipped once started)', m.strict, (v) => save('move', { strict: v })),
      toggle('Pause the video during a move break', m.pauseVideo, (v) => save('move', { pauseVideo: v })),
      select('What to show', m.tips, [['builtin', 'A random stretch idea'], ['custom', 'My own list'], ['plain', 'Just "Stand up"']], (v) => save('move', { tips: v }).then(() => renderTab('move'))),
      m.tips === 'custom' && h('label', { class: 'field' }, 'My ideas (one per line)',
        h('textarea', { onchange: (e) => save('move', { customTips: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }) }, m.customTips.join('\n'))),
      h('h3', {}, 'Save'),
      h('div', { class: 'dur' }, nameInput, h('button', { type: 'button', style: 'width:auto;padding:0 10px', onclick: () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return toast('Give the preset a name'); }
        const x = { id: newId(), name, sitSec: m.sitSec, breakSec: m.breakSec };
        save('move', { presets: [...m.presets, x], preset: x.id }).then(() => { toast(`Saved "${name}"`); renderTab('move'); });
      } }, 'Save as preset')),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', onclick: () => save('move', { userDefault: { id: all.find(matches)?.id || newId(), name: all.find(matches)?.name || 'My default', sitSec: m.sitSec, breakSec: m.breakSec } }).then(() => { toast('These times are now your default'); renderTab('move'); }) }, 'Set current as my default'),
        h('button', { type: 'button', onclick: () => apply(def) }, 'Reset to default'),
        h('button', { type: 'button', onclick: () => timer('move-break') }, 'Take a break now')),
    );
  }

  // ---- Sounds tab
  function renderSounds(root) {
    const s = settings.sounds;
    const LABEL = { focusStart: 'Focus start', focusEnd: 'Focus end', breakStart: 'Break start', breakEnd: 'Break end', move: 'Move reminder', tick: 'Tick (each second)' };
    const preview = (id, vol) => {
      const snd = assets.sounds.find((x) => x.id === id);
      if (snd) playSound({ url: snd.url, volume: s.master * vol * snd.gain, duck: false });
    };
    fill(root, 
      h('label', { class: 'field' }, `Master volume ${Math.round(s.master * 100)}%`,
        h('input', { type: 'range', min: 0, max: 100, value: Math.round(s.master * 100), onchange: (e) => save('sounds', { master: e.target.value / 100 }).then(() => renderTab('sounds')) })),
      toggle('Lower the video while a timer sound plays', s.duck, (v) => save('sounds', { duck: v })),
      h('h3', {}, 'Sound for each event'),
      assets.soundEvents.map((ev) => h('div', { class: 'snd-row' }, LABEL[ev],
        h('select', { onchange: (e) => save('sounds', { events: { ...s.events, [ev]: e.target.value || null } }) },
          h('option', { value: '', selected: !s.events[ev] }, 'None'),
          assets.sounds.map((x) => h('option', { value: x.id, selected: s.events[ev] === x.id }, (x.custom ? '★ ' : '') + x.name))),
        h('input', { type: 'range', min: 0, max: 100, value: Math.round((s.volumes[ev] ?? 1) * 100), title: 'Volume',
          onchange: (e) => save('sounds', { volumes: { ...s.volumes, [ev]: e.target.value / 100 } }) }),
        h('button', { type: 'button', class: 'mini-btn', title: 'Preview', onclick: () => preview(settings.sounds.events[ev], settings.sounds.volumes[ev] ?? 1) }, '▶'))),
      h('h3', {}, 'My sounds'),
      s.custom.length ? h('div', { class: 'chips' }, s.custom.map((x) => h('button', { type: 'button', title: 'Preview',
        onclick: () => preview(x.id, 1) }, '▶ ' + x.name,
        h('span', { class: 'x', title: 'Remove', onclick: async (e) => { e.stopPropagation(); const r = await api.removeSound(x.id); settings = r.settings; assets.sounds = r.sounds; renderTab('sounds'); } }, '×'))))
        : h('p', { class: 'hint' }, 'Add your own .mp3, .wav or .ogg (up to 5 MB). FloatView keeps a copy, so moving the original is fine.'),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', onclick: async () => {
        try {
          const r = await api.addSound();
          settings = r.settings; assets.sounds = r.sounds;
          if (r.added) toast('Sound added — pick it for an event above');
          renderTab('sounds');
        } catch (err) { toast(String(err.message || err).replace(/^.*Error: /, ''), 3500); }
      } }, 'Add a sound…')),
      h('p', { class: 'hint' }, 'Built-in sounds by Kenney.nl (CC0).'),
    );
  }

  // ---- Stats tab
  async function renderStats(root) {
    const days = await api.getStats();
    const t = days.at(-1);
    const maxFocus = Math.max(1, ...days.map((d) => d.focusSec));
    fill(root, 
      h('h3', {}, 'Today'),
      h('div', { class: 'stat-grid' },
        h('div', {}, h('b', {}, String(t.focusSessions)), h('span', {}, 'focus sessions')),
        h('div', {}, h('b', {}, describeDuration(Math.round(t.focusSec / 60) * 60)), h('span', {}, 'focus time')),
        h('div', {}, h('b', {}, String(t.moveTaken)), h('span', {}, 'move breaks')),
        h('div', {}, h('b', {}, String(t.moveSnoozed)), h('span', {}, 'snoozed')),
        h('div', {}, h('b', {}, String(t.moveSkipped)), h('span', {}, 'skipped')),
        h('div', {}, h('b', {}, formatDuration(Math.max(t.longestSitSec, snap.move.longestSitSec || 0))), h('span', {}, 'longest sitting'))),
      h('h3', {}, 'Focus, last 7 days'),
      h('div', { class: 'bars' }, days.map((d) => h('div', { title: `${d.date}: ${describeDuration(Math.round(d.focusSec / 60) * 60)} focus, ${d.moveTaken} move breaks` },
        h('i', { style: `height:${Math.round((d.focusSec / maxFocus) * 70)}px` }),
        new Date(d.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' })))),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', onclick: async () => { await api.resetStats(); renderTab('stats'); toast('Stats reset'); } }, 'Reset stats')),
    );
  }

  function renderTab(name) {
    const root = panel(name);
    if (!root || name === 'general') return;
    ({ clock: renderClock, pomodoro: renderPomodoro, move: renderMove, sounds: renderSounds, stats: renderStats })[name]?.(root);
  }

  // Esc in the settings panel closes it (renderer.js); remember the tab.
  applyView();
  window.floatviewClock = { showTab, get settings() { return settings; }, get snap() { return snap; } }; // used by tests
})();
