/* global api, ui, toast */
// Settings → Keys: every global shortcut with a plain-English name and key caps,
// "Change" to record a new one, clear, reset, and a warning when another app has taken it.
// Plus a read-only list of the keys that work inside the window.

(function keysUI() {
  const panel = document.querySelector('.tab-panel[data-panel="keys"]');
  const tab = document.querySelector('.settings-tabs [data-tab="keys"]');

  const GROUPS = [
    ['Video', [
      ['playPause', 'Play / pause'],
      ['seekBack', 'Back 10 seconds'],
      ['seekForward', 'Forward 10 seconds'],
      ['nextVideo', 'Next video'],
      ['prevVideo', 'Previous video'],
      ['focusLink', 'Open a new link'],
    ]],
    ['Window', [
      ['toggleHide', 'Show / hide FloatView'],
      ['togglePin', 'Always on top on / off'],
      ['clickThrough', 'Click-through on / off'],
      ['opacityUp', 'Less see-through'],
      ['opacityDown', 'More see-through'],
      ['sizeUp', 'Bigger window'],
      ['sizeDown', 'Smaller window'],
    ]],
    ['Clock & timers', [
      ['cycleView', 'Switch view (Video → Video + Clock → Clock)'],
      ['pomoToggle', 'Start / pause Pomodoro'],
      ['moveBreakNow', 'Take a move break now'],
      ['moveSnooze', 'Snooze the stand-up reminder'],
    ]],
  ];

  const LOCAL_KEYS = [
    [['Space'], 'Play / pause (Clock view: Pomodoro)'],
    [['K'], 'Play / pause'],
    [['←', '→'], 'Back / forward 5 seconds'],
    [['↑', '↓'], 'Volume up / down'],
    [['M'], 'Mute'],
    [['Shift', 'N'], 'Next video'],
    [['Shift', 'P'], 'Previous video'],
    [['N'], 'Open a new link'],
    [['Ctrl', 'V'], 'Play a copied link'],
    [['+', '−'], 'Bigger / smaller window'],
    [['Esc'], 'Close a panel'],
  ];

  // Accelerator part -> what's printed on the key cap
  const CAP = { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win', Up: '↑', Down: '↓', Left: '←', Right: '→',
    PageUp: 'PgUp', PageDown: 'PgDn', Space: 'Space', Delete: 'Del', Insert: 'Ins', Backspace: '⌫', Enter: 'Enter', '-': '−' };
  const caps = (accel) => (accel ? accel.split(/\+(?=.)/).map((p) => CAP[p] || p) : []);

  // KeyboardEvent.code -> accelerator key (layout-independent, so it matches what Windows sends)
  function keyFromCode(code) {
    let m;
    if ((m = code.match(/^Key([A-Z])$/))) return m[1];
    if ((m = code.match(/^Digit([0-9])$/))) return m[1];
    if ((m = code.match(/^Numpad([0-9])$/))) return 'num' + m[1];
    if ((m = code.match(/^F([0-9]{1,2})$/))) return 'F' + m[1];
    return {
      ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', PageUp: 'PageUp', PageDown: 'PageDown',
      Home: 'Home', End: 'End', Insert: 'Insert', Delete: 'Delete', Space: 'Space', Tab: 'Tab', Enter: 'Enter',
      Backspace: 'Backspace', Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
      Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', NumpadAdd: 'numadd', NumpadSubtract: 'numsub',
      NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
    }[code] || null;
  }

  let state = { hotkeys: {}, failed: [] };
  let recording = null; // action being recorded
  let message = null;   // { action, text, kind }

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    n.append(...kids.flat().filter((k) => k != null && k !== false));
    return n;
  };
  const keycaps = (list) => el('span', { class: 'caps' }, list.map((c) => el('kbd', {}, c)));

  function row(action, label) {
    const accel = state.hotkeys[action] || '';
    const taken = state.failed.includes(action);
    const isRec = recording === action;
    const msg = message && message.action === action ? message : null;
    return el('div', { class: 'key-row' + (isRec ? ' recording' : '') + (taken ? ' taken' : ''), 'data-action': action },
      el('span', { class: 'key-label' }, label,
        taken && el('span', { class: 'key-warn', title: 'Another app already uses this shortcut, so it does nothing in FloatView. Pick another one.' }, ' ⚠ taken by another app'),
        msg && el('span', { class: 'key-msg ' + msg.kind }, msg.text)),
      isRec ? el('span', { class: 'caps rec' }, 'Press the new keys… (Esc cancels)')
        : accel ? keycaps(caps(accel)) : el('span', { class: 'caps none' }, 'none'),
      el('span', { class: 'key-actions' },
        isRec ? el('button', { type: 'button', onclick: stopRecording }, 'Cancel')
          : el('button', { type: 'button', onclick: () => startRecording(action) }, 'Change'),
        !isRec && accel && el('button', { type: 'button', class: 'quiet', title: 'Remove this shortcut', onclick: () => apply(action, '') }, '×')));
  }

  function render() {
    if (!panel) return;
    // replaceChildren doesn't unpack nested arrays (they'd become "[object …]" text), so flatten.
    panel.replaceChildren(...[
      el('p', { class: 'hint' }, 'These work from any app, even when FloatView is in the background. Click ', el('b', {}, 'Change'), ' and press the new keys.'),
      GROUPS.map(([title, items]) => [el('h3', {}, title), el('div', { class: 'key-list' }, items.map(([a, l]) => row(a, l)))]),
      el('div', { class: 'btn-row' }, el('button', { type: 'button', onclick: async () => {
        state = await api.resetHotkeys(); message = null; render(); toast('Shortcuts reset to the defaults');
      } }, 'Reset all to defaults')),
      el('h3', {}, 'Inside the FloatView window'),
      el('div', { class: 'key-list local' }, LOCAL_KEYS.map(([k, l]) => el('div', { class: 'key-row' }, el('span', { class: 'key-label' }, l), keycaps(k), el('span')))),
    ].flat(3));
  }

  async function load() { state = await api.getHotkeys(); render(); }

  async function apply(action, accel) {
    const r = await api.setHotkey(action, accel);
    state = { hotkeys: r.hotkeys, failed: r.failed };
    message = r.error ? { action, text: r.error, kind: 'bad' } : { action, text: accel ? 'Saved' : 'Removed', kind: 'good' };
    render();
    if (!r.error) setTimeout(() => { if (message?.action === action && message.kind === 'good') { message = null; render(); } }, 1800);
  }

  function startRecording(action) {
    recording = action;
    message = null;
    api.pauseHotkeys(true); // so pressing an existing shortcut doesn't trigger it
    render();
  }

  function stopRecording() {
    recording = null;
    api.pauseHotkeys(false);
    render();
  }

  document.addEventListener('keydown', (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') return stopRecording();
    if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(e.key)) return; // wait for the real key
    const key = keyFromCode(e.code);
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
    if (!key) { message = { action: recording, text: 'That key can’t be used. Try a letter, number or F-key.', kind: 'bad' }; render(); return; }
    if (!mods.some((m) => m !== 'Shift')) {
      message = { action: recording, text: 'Add Ctrl, Alt or Win (for example Ctrl+Alt+' + key + ').', kind: 'bad' };
      render();
      return;
    }
    const action = recording;
    recording = null;
    api.pauseHotkeys(false).then(() => apply(action, [...mods, key].join('+')));
  }, true);

  // Leaving the tab / closing Settings while recording: stop.
  const settings = document.getElementById('settings');
  new MutationObserver(() => {
    const visible = !settings.hidden && !panel.hidden;
    if (!visible && recording) stopRecording();
    if (visible && !panel.childElementCount) load();
  }).observe(settings, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  tab?.addEventListener('click', load);

  window.floatviewKeys = { load, get state() { return state; }, get recording() { return recording; } };
})();
