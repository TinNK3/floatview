// Pomodoro + move-reminder state machines. Pure logic: no Electron, no timers of its own.
// The owner calls tick(idleSec) about once a second and acts on the events it returns.
// All times are deadlines (endsAt = now + ms), so a hidden window, a busy CPU or sleep
// never makes the countdown drift.

const DEFAULT_TIPS = [
  'Stand up and look at something 20 m away for 20 seconds.',
  'Roll your shoulders backwards 10 times.',
  'Stretch your neck: ear to shoulder, 15 s each side.',
  'Walk around and grab a glass of water.',
  'Wrist circles: 10 each direction, then shake your hands out.',
  '10 slow calf raises.',
  'Open your chest: hands behind your back, squeeze the shoulder blades.',
  'Reach for the ceiling, then gently touch toward your toes.',
  'Stand on one leg for 20 s, then switch.',
  'Take 5 slow, deep breaths by an open window.',
  'Rotate your upper body slowly left and right, 5 times each.',
  'Squeeze your eyes shut for 3 s, then open wide. Repeat 5 times.',
  'March in place for 30 seconds.',
  'Hands on the desk, lean back and stretch your calves.',
  'Chin tucks: pull your chin straight back 10 times.',
  'Walk to the farthest room and back.',
  'Interlace your fingers and push your palms forward.',
  'Do 10 slow bodyweight squats.',
  'Shake out your arms and legs for 20 seconds.',
  'Refill your water and drink half of it.',
];

const DEFAULT_CONFIG = {
  pomodoro: { focusSec: 1500, shortSec: 300, longSec: 900, rounds: 4, autoBreak: true, autoFocus: false },
  move: {
    enabled: true, sitSec: 3000, breakSec: 180, snoozeSec: 300, maxSnoozes: 2,
    awaySec: null, mergeSec: 300, repeat: { everySec: 30, times: 5 },
    activeHours: null, strict: false, tips: DEFAULT_TIPS,
  },
};

class Timers {
  constructor({ now = Date.now, config = {}, random = Math.random } = {}) {
    this.now = now;
    this.random = random;
    this.setConfig(config);
    this.pomo = { phase: 'idle', running: false, waiting: false, endsAt: 0, leftMs: 0, totalMs: 0, done: 0 };
    this.move = {
      state: 'sitting', sitMs: 0, away: false, deferred: false,
      snoozes: 0, snoozeUntil: 0, breakEndsAt: 0, breakTotalMs: 0,
      lastRing: 0, repeats: 0, tip: null, lockedAt: 0, longestSitMs: 0,
    };
    this.lastTick = this.now();
  }

  setConfig(cfg = {}) {
    this.cfg = {
      pomodoro: { ...DEFAULT_CONFIG.pomodoro, ...(cfg.pomodoro || {}) },
      move: { ...DEFAULT_CONFIG.move, ...(cfg.move || {}), repeat: { ...DEFAULT_CONFIG.move.repeat, ...(cfg.move?.repeat || {}) } },
    };
    if (!Array.isArray(this.cfg.move.tips) || !this.cfg.move.tips.length) this.cfg.move.tips = DEFAULT_TIPS;
  }

  // ------------------------------------------------------------ Pomodoro

  phaseMs(phase) {
    const p = this.cfg.pomodoro;
    return 1000 * ({ focus: p.focusSec, short: p.shortSec, long: p.longSec }[phase] || 0);
  }

  pomoStart() {
    const p = this.pomo, now = this.now();
    if (p.running) return [];
    if (p.phase === 'idle') { p.phase = 'focus'; p.leftMs = this.phaseMs('focus'); p.totalMs = p.leftMs; p.waiting = true; }
    const events = [];
    if (p.waiting) events.push(...this._phaseStartEvents(p.phase));
    p.waiting = false;
    p.running = true;
    p.endsAt = now + p.leftMs;
    return events;
  }

  pomoPause() {
    const p = this.pomo;
    if (!p.running) return [];
    p.leftMs = Math.max(0, p.endsAt - this.now());
    p.running = false;
    return [{ type: 'pomo-paused' }];
  }

  pomoToggle() { return this.pomo.running ? this.pomoPause() : this.pomoStart(); }

  pomoSkip() {
    const p = this.pomo;
    if (p.phase === 'idle') return [];
    const events = [];
    if (p.phase === 'focus') this._enter(this._nextBreak(p.done + 1), this.cfg.pomodoro.autoBreak, events);
    else {
      events.push({ type: 'pomo-break-end', phase: p.phase, skipped: true });
      this._enter('focus', this.cfg.pomodoro.autoFocus, events);
    }
    return events;
  }

  pomoReset() {
    Object.assign(this.pomo, { phase: 'idle', running: false, waiting: false, endsAt: 0, leftMs: 0, totalMs: 0, done: 0 });
    return [{ type: 'pomo-reset' }];
  }

  // Change only the current phase ("+5 min for this round"). Saved settings stay the same.
  pomoAdjust(sec) {
    const p = this.pomo;
    if (p.phase === 'idle' || !Number.isFinite(sec)) return [];
    const before = p.running ? p.endsAt - this.now() : p.leftMs;
    if (p.running) p.endsAt = Math.max(this.now() + 1000, p.endsAt + sec * 1000);
    else p.leftMs = Math.max(1000, p.leftMs + sec * 1000);
    const after = p.running ? p.endsAt - this.now() : p.leftMs;
    p.totalMs = Math.max(1000, p.totalMs + (after - before)); // stats count the real length
    return [];
  }

  _nextBreak(doneAfter) {
    const { longSec, rounds } = this.cfg.pomodoro;
    return longSec > 0 && rounds > 0 && doneAfter % rounds === 0 ? 'long' : 'short';
  }

  _phaseStartEvents(phase) {
    if (phase === 'focus') return [{ type: 'pomo-focus-start' }];
    // A Pomodoro break is a real break: the sitting clock stops, and a pending move reminder is satisfied.
    const ev = [{ type: 'pomo-break-start', phase }];
    this.move.deferred = false;
    if (['due', 'snoozed'].includes(this.move.state)) {
      this.move.state = 'sitting';
      this.move.snoozes = 0;
      ev.push({ type: 'move-resolved', reason: 'pomodoro-break' });
    }
    return ev;
  }

  _enter(phase, autostart, events) {
    const p = this.pomo;
    if (phase !== 'focus') p.done += 1; // a break follows every focus, finished or skipped
    p.phase = phase;
    p.leftMs = this.phaseMs(phase);
    p.totalMs = p.leftMs;
    p.running = false;
    p.waiting = true;
    if (autostart) {
      events.push(...this._phaseStartEvents(phase));
      p.waiting = false;
      p.running = true;
      p.endsAt = this.now() + p.leftMs;
    }
  }

  _tickPomo(events) {
    const p = this.pomo;
    if (!p.running || this.now() < p.endsAt) return;
    if (p.phase === 'focus') {
      events.push({ type: 'pomo-focus-end', focusSec: Math.round(p.totalMs / 1000) });
      this._enter(this._nextBreak(p.done + 1), this.cfg.pomodoro.autoBreak, events);
    } else {
      events.push({ type: 'pomo-break-end', phase: p.phase });
      this._resetSitting(events, 'pomodoro-break');
      this._enter('focus', this.cfg.pomodoro.autoFocus, events);
    }
  }

  // ------------------------------------------------------------ Move reminder

  get pomoBreakRunning() {
    return this.pomo.running && (this.pomo.phase === 'short' || this.pomo.phase === 'long');
  }

  get awayMs() {
    const m = this.cfg.move;
    return 1000 * (m.awaySec ?? m.breakSec);
  }

  canSnooze() {
    const { maxSnoozes } = this.cfg.move;
    return maxSnoozes < 0 || this.move.snoozes < maxSnoozes;
  }

  inActiveHours(t = this.now()) {
    const ah = this.cfg.move.activeHours;
    if (!ah) return true;
    const d = new Date(t);
    const day = d.getDay(), prev = (day + 6) % 7;
    const dayOk = (x) => !Array.isArray(ah.days) || ah.days.includes(x);
    if (!Array.isArray(ah.ranges) || !ah.ranges.length) return dayOk(day);
    const min = d.getHours() * 60 + d.getMinutes();
    // An overnight range (22:00-02:00) belongs to the day it starts on.
    return ah.ranges.some(([a, b]) => (a <= b
      ? dayOk(day) && min >= a && min < b
      : (dayOk(day) && min >= a) || (dayOk(prev) && min < b)));
  }

  _pickTip() {
    const tips = this.cfg.move.tips;
    let tip = tips[Math.floor(this.random() * tips.length)];
    if (tips.length > 1 && tip === this.move.tip) tip = tips[(tips.indexOf(tip) + 1) % tips.length];
    return tip;
  }

  _resetSitting(events, reason) {
    const m = this.move;
    if (m.sitMs > m.longestSitMs) m.longestSitMs = m.sitMs;
    if (m.sitMs > 0) events.push({ type: 'sit-reset', reason, sitMs: m.sitMs });
    m.sitMs = 0;
    m.deferred = false;
  }

  _goDue(events, again = false) {
    const m = this.move;
    m.state = 'due';
    m.deferred = false;
    m.lastRing = this.now();
    m.repeats = 0;
    if (!again || !m.tip) m.tip = this._pickTip();
    events.push({ type: 'move-due', again, tip: m.tip });
  }

  moveBreakStart() {
    const m = this.move;
    if (!['sitting', 'due', 'snoozed'].includes(m.state)) return [];
    if (!m.tip || m.state === 'sitting') m.tip = this._pickTip();
    m.state = 'break';
    m.breakTotalMs = this.cfg.move.breakSec * 1000;
    m.breakEndsAt = this.now() + m.breakTotalMs;
    return [{ type: 'move-break-start', tip: m.tip }];
  }

  moveSnooze() {
    const m = this.move;
    if (m.state !== 'due' || !this.canSnooze()) return [];
    m.snoozes += 1;
    m.state = 'snoozed';
    m.snoozeUntil = this.now() + this.cfg.move.snoozeSec * 1000;
    return [{ type: 'move-snoozed', snoozes: m.snoozes }];
  }

  moveSkip() {
    const m = this.move;
    if (!['due', 'snoozed', 'break'].includes(m.state)) return [];
    if (m.state === 'break' && this.cfg.move.strict) return [];
    const events = [{ type: 'move-skipped', during: m.state }];
    m.state = 'sitting';
    m.snoozes = 0;
    this._resetSitting(events, 'skipped');
    return events;
  }

  moveAdjust(sec) {
    const m = this.move;
    if (m.state !== 'break' || !Number.isFinite(sec)) return [];
    m.breakEndsAt = Math.max(this.now() + 5000, m.breakEndsAt + sec * 1000);
    m.breakTotalMs = Math.max(m.breakTotalMs, m.breakEndsAt - this.now());
    return [];
  }

  onLock() { if (!this.move.lockedAt) this.move.lockedAt = this.now(); } // lock, then sleep: keep the first

  onUnlock() {
    const m = this.move;
    const events = [];
    if (m.lockedAt && this.now() - m.lockedAt >= this.awayMs) this._cameBack(events, 'locked');
    m.lockedAt = 0;
    return events;
  }

  // Away long enough = the break already happened.
  _cameBack(events, reason) {
    const m = this.move;
    if (['due', 'snoozed'].includes(m.state)) {
      m.state = 'sitting';
      m.snoozes = 0;
      events.push({ type: 'move-resolved', reason });
    }
    if (m.state === 'sitting') this._resetSitting(events, reason);
  }

  _tickMove(events, idleSec, dt) {
    const m = this.move, cfg = this.cfg.move, now = this.now();
    if (!cfg.enabled) {
      if (m.state !== 'sitting') {
        m.state = 'sitting';
        m.snoozes = 0;
        events.push({ type: 'move-resolved', reason: 'disabled' });
      }
      return;
    }

    // Sleep / hibernate / a long freeze counts as time away from the desk (and that gap is not sitting).
    if (dt >= this.awayMs) { this._cameBack(events, 'sleep'); dt = 0; }

    if (idleSec * 1000 >= this.awayMs) {
      if (!m.away) { m.away = true; this._cameBack(events, 'idle'); }
    } else if (idleSec < 5) m.away = false;

    if (m.state === 'break') {
      if (now >= m.breakEndsAt) {
        events.push({ type: 'move-break-end', breakSec: Math.round(m.breakTotalMs / 1000) });
        m.state = 'sitting';
        m.snoozes = 0;
        this._resetSitting(events, 'move-break');
      }
      return;
    }

    const active = this.inActiveHours(now);
    const resting = m.away || m.lockedAt || this.pomoBreakRunning;
    // Still sitting while a reminder waits for an answer (so "longest sitting" is honest).
    if (!resting && active) m.sitMs += Math.min(dt, 60000);

    if (m.state === 'sitting' && active && !resting && m.sitMs >= cfg.sitSec * 1000) {
      // A Pomodoro break is about to start anyway: wait for it instead of nagging twice.
      const p = this.pomo;
      const soon = cfg.mergeSec > 0 && p.phase === 'focus' && p.running && p.endsAt - now <= cfg.mergeSec * 1000;
      if (soon) m.deferred = true;
      else this._goDue(events);
    } else if (m.state === 'snoozed' && active && now >= m.snoozeUntil) {
      this._goDue(events, true);
    } else if (m.state === 'due' && active && cfg.repeat.everySec > 0 && m.repeats < cfg.repeat.times
               && now - m.lastRing >= cfg.repeat.everySec * 1000) {
      m.repeats += 1;
      m.lastRing = now;
      events.push({ type: 'move-repeat', n: m.repeats });
    }
  }

  // ------------------------------------------------------------ main loop

  tick(idleSec = 0) {
    const now = this.now();
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    const events = [];
    this._tickPomo(events);
    this._tickMove(events, idleSec, dt);
    return events;
  }

  snapshot() {
    const p = this.pomo, m = this.move, now = this.now(), pc = this.cfg.pomodoro, mc = this.cfg.move;
    const leftMs = p.running ? Math.max(0, p.endsAt - now) : p.leftMs;
    const rounds = pc.longSec > 0 ? pc.rounds : 0;
    return {
      pomo: {
        phase: p.phase, running: p.running, waiting: p.waiting, endsAt: p.running ? p.endsAt : null,
        leftSec: Math.ceil(leftMs / 1000), totalSec: Math.round((p.totalMs || this.phaseMs(p.phase)) / 1000),
        done: p.done, rounds,
        round: rounds ? (p.phase === 'focus' || p.phase === 'idle' ? (p.done % rounds) + 1 : (p.done % rounds) || rounds) : p.done + (p.phase === 'focus' ? 1 : 0),
      },
      move: {
        enabled: mc.enabled, state: m.state, away: m.away, deferred: m.deferred,
        sitSec: Math.floor(m.sitMs / 1000), sitTargetSec: mc.sitSec,
        dueInSec: Math.max(0, Math.ceil(mc.sitSec - m.sitMs / 1000)),
        breakLeftSec: m.state === 'break' ? Math.ceil(Math.max(0, m.breakEndsAt - now) / 1000) : 0,
        breakEndsAt: m.state === 'break' ? m.breakEndsAt : null,
        snoozeUntil: m.state === 'snoozed' ? m.snoozeUntil : null,
        breakTotalSec: m.state === 'break' ? Math.round(m.breakTotalMs / 1000) : mc.breakSec,
        snoozeLeftSec: m.state === 'snoozed' ? Math.ceil(Math.max(0, m.snoozeUntil - now) / 1000) : 0,
        snoozes: m.snoozes, canSnooze: this.canSnooze(), snoozeSec: mc.snoozeSec,
        strict: !!mc.strict, tip: m.tip, active: this.inActiveHours(now),
        longestSitSec: Math.floor(Math.max(m.longestSitMs, m.sitMs) / 1000),
      },
    };
  }
}

module.exports = { Timers, DEFAULT_TIPS, DEFAULT_CONFIG };
