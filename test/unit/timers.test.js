const test = require('node:test');
const assert = require('node:assert/strict');
const { Timers } = require('../../src/main/timers');

// Fake clock: advance time in 1 s ticks like the real loop does.
function rig(config, { idle = () => 0 } = {}) {
  let t = Date.UTC(2026, 8, 29, 10, 0, 0);
  const timers = new Timers({ now: () => t, config, random: () => 0 });
  const all = [];
  const run = (sec) => {
    for (let i = 0; i < sec; i++) { t += 1000; all.push(...timers.tick(idle(t))); }
    return all;
  };
  const types = () => all.map((e) => e.type);
  const act = (evs) => { all.push(...evs); return evs; };
  return { timers, run, types, act, all, advance: (ms) => { t += ms; } };
}

const pomoOnly = (p) => ({ pomodoro: { focusSec: 10, shortSec: 3, longSec: 5, rounds: 2, autoBreak: true, autoFocus: true, ...p }, move: { enabled: false } });

test('pomodoro: focus -> short -> focus -> long, in order', () => {
  const r = rig(pomoOnly());
  r.act(r.timers.pomoStart());
  r.run(10);
  assert.equal(r.timers.snapshot().pomo.phase, 'short');
  r.run(3);
  assert.equal(r.timers.snapshot().pomo.phase, 'focus');
  r.run(10);
  assert.equal(r.timers.snapshot().pomo.phase, 'long'); // 2 rounds -> long break
  r.run(5);
  assert.equal(r.timers.snapshot().pomo.phase, 'focus');
  assert.deepEqual(r.types().filter((x) => x.startsWith('pomo-')), [
    'pomo-focus-start', 'pomo-focus-end', 'pomo-break-start', 'pomo-break-end', 'pomo-focus-start',
    'pomo-focus-end', 'pomo-break-start', 'pomo-break-end', 'pomo-focus-start',
  ]);
  assert.equal(r.all.find((e) => e.type === 'pomo-break-start' && e.phase === 'long').phase, 'long');
});

test('pomodoro: long break off never gives a long break', () => {
  const r = rig(pomoOnly({ longSec: 0 }));
  r.act(r.timers.pomoStart());
  r.run(60);
  assert.ok(!r.all.some((e) => e.phase === 'long'));
});

test('pomodoro: no auto-start waits for Start', () => {
  const r = rig(pomoOnly({ autoBreak: false, autoFocus: false }));
  r.timers.pomoStart();
  r.run(12);
  let s = r.timers.snapshot().pomo;
  assert.equal(s.phase, 'short');
  assert.equal(s.running, false);
  assert.equal(s.waiting, true);
  assert.equal(s.leftSec, 3);
  r.act(r.timers.pomoStart());
  assert.equal(r.all.at(-1).type, 'pomo-break-start');
  r.run(3);
  s = r.timers.snapshot().pomo;
  assert.equal(s.phase, 'focus');
  assert.equal(s.running, false);
});

test('pomodoro: pause keeps the remaining time exactly', () => {
  const r = rig(pomoOnly({ focusSec: 100 }));
  r.timers.pomoStart();
  r.run(30);
  r.timers.pomoPause();
  r.advance(3_600_000); // an hour paused
  r.run(1);
  assert.equal(r.timers.snapshot().pomo.leftSec, 70);
  r.timers.pomoStart();
  r.run(20);
  assert.equal(r.timers.snapshot().pomo.leftSec, 50);
});

test('pomodoro: skip, reset and +/- adjust for this round only', () => {
  const r = rig(pomoOnly({ focusSec: 100 }));
  r.timers.pomoStart();
  r.timers.pomoAdjust(60);
  assert.equal(r.timers.snapshot().pomo.leftSec, 160);
  r.timers.pomoAdjust(-500);
  assert.equal(r.timers.snapshot().pomo.leftSec, 1); // never below 1 s
  r.timers.pomoSkip();
  assert.equal(r.timers.snapshot().pomo.phase, 'short');
  r.timers.pomoReset();
  assert.equal(r.timers.snapshot().pomo.phase, 'idle');
  r.timers.pomoStart();
  assert.equal(r.timers.snapshot().pomo.leftSec, 100); // saved setting unchanged
});

test('pomodoro: time is right after the PC slept (deadline based)', () => {
  const r = rig(pomoOnly({ focusSec: 600 }));
  r.timers.pomoStart();
  r.advance(200_000);
  r.run(1);
  assert.equal(r.timers.snapshot().pomo.leftSec, 399);
});

const moveOnly = (m) => ({ move: { enabled: true, sitSec: 10, breakSec: 3, snoozeSec: 4, maxSnoozes: 2, mergeSec: 0,
  repeat: { everySec: 2, times: 2 }, ...m } });

test('move: due after sitting, break runs, sitting resets', () => {
  const r = rig(moveOnly());
  r.run(9);
  assert.equal(r.timers.snapshot().move.state, 'sitting');
  r.run(1);
  assert.equal(r.timers.snapshot().move.state, 'due');
  r.act(r.timers.moveBreakStart());
  assert.equal(r.timers.snapshot().move.breakLeftSec, 3);
  r.run(3);
  const s = r.timers.snapshot().move;
  assert.equal(s.state, 'sitting');
  assert.equal(s.sitSec, 0);
  assert.ok(r.types().includes('move-break-end'));
});

test('move: sound repeats N times, then stops', () => {
  const r = rig(moveOnly());
  r.run(20);
  assert.equal(r.types().filter((x) => x === 'move-repeat').length, 2);
});

test('move: snooze limit, then no more snoozing', () => {
  const r = rig(moveOnly());
  r.run(10);
  assert.equal(r.timers.moveSnooze().length, 1);
  r.run(4);
  assert.equal(r.timers.snapshot().move.state, 'due');
  assert.equal(r.timers.moveSnooze().length, 1);
  r.run(4);
  assert.equal(r.timers.snapshot().move.canSnooze, false);
  assert.equal(r.timers.moveSnooze().length, 0); // 3rd snooze refused
  assert.equal(r.timers.snapshot().move.state, 'due');
});

test('move: unlimited snoozes with -1, none with 0', () => {
  const r = rig(moveOnly({ maxSnoozes: -1 }));
  r.run(10);
  for (let i = 0; i < 5; i++) { assert.equal(r.timers.moveSnooze().length, 1); r.run(4); }
  const r0 = rig(moveOnly({ maxSnoozes: 0 }));
  r0.run(10);
  assert.equal(r0.timers.moveSnooze().length, 0);
});

test('move: strict mode refuses to skip a running break', () => {
  const r = rig(moveOnly({ strict: true }));
  r.run(10);
  r.timers.moveBreakStart();
  assert.equal(r.timers.moveSkip().length, 0);
  assert.equal(r.timers.snapshot().move.state, 'break');
  const r2 = rig(moveOnly());
  r2.run(10);
  r2.timers.moveBreakStart();
  assert.equal(r2.timers.moveSkip()[0].type, 'move-skipped');
  assert.equal(r2.timers.snapshot().move.state, 'sitting');
});

test('move: being idle long enough counts as a break', () => {
  let idleFrom = null;
  const r = rig(moveOnly({ sitSec: 60, breakSec: 5 }), { idle: (t) => (idleFrom && t >= idleFrom ? (t - idleFrom) / 1000 : 0) });
  r.run(40);
  assert.equal(r.timers.snapshot().move.sitSec, 40);
  idleFrom = r.timers.now();
  r.run(6);
  assert.equal(r.timers.snapshot().move.sitSec, 0);
  assert.ok(r.all.some((e) => e.type === 'sit-reset' && e.reason === 'idle'));
  idleFrom = null;
  r.run(10);
  assert.equal(r.timers.snapshot().move.sitSec, 10); // counting again once back
});

test('move: idle also clears a pending reminder; custom away time', () => {
  let idle = 0;
  const r = rig(moveOnly({ awaySec: 20 }), { idle: () => idle });
  r.run(10);
  assert.equal(r.timers.snapshot().move.state, 'due');
  idle = 10;
  r.run(1);
  assert.equal(r.timers.snapshot().move.state, 'due'); // 10 s < 20 s away time
  idle = 21;
  r.run(1);
  assert.equal(r.timers.snapshot().move.state, 'sitting');
  assert.ok(r.types().includes('move-resolved'));
});

test('move: lock for long enough resets; sleep gap resets', () => {
  const r = rig(moveOnly({ sitSec: 100 }));
  r.run(50);
  r.timers.onLock();
  r.advance(4000);
  r.timers.onUnlock();
  assert.equal(r.timers.snapshot().move.sitSec, 0);
  r.run(30);
  r.advance(10_000); // PC slept 10 s (> 3 s break length)
  r.run(1);
  assert.equal(r.timers.snapshot().move.sitSec, 0);
});

test('move: waits for a Pomodoro break that is about to start (merge)', () => {
  const r = rig({ pomodoro: { focusSec: 20, shortSec: 5, longSec: 0, autoBreak: true, autoFocus: true },
    move: { enabled: true, sitSec: 15, breakSec: 3, mergeSec: 10, maxSnoozes: 2 } });
  r.timers.pomoStart();
  r.run(15);
  assert.equal(r.timers.snapshot().move.state, 'sitting'); // deferred: focus ends in 5 s
  assert.equal(r.timers.snapshot().move.deferred, true);
  r.run(5);
  assert.equal(r.timers.snapshot().pomo.phase, 'short');
  r.run(5);
  assert.ok(r.all.some((e) => e.type === 'sit-reset' && e.reason === 'pomodoro-break')); // pomodoro break reset sitting
  assert.ok(r.timers.snapshot().move.sitSec <= 1);
  assert.ok(!r.types().includes('move-due'));
});

test('move: a Pomodoro break satisfies a reminder that is already showing', () => {
  const r = rig({ pomodoro: { focusSec: 100, shortSec: 5, autoBreak: false }, move: { enabled: true, sitSec: 5, breakSec: 3, mergeSec: 0 } });
  r.timers.pomoStart();
  r.run(5);
  assert.equal(r.timers.snapshot().move.state, 'due');
  r.timers.pomoSkip(); // focus -> short break (waiting, autoBreak off)
  r.act(r.timers.pomoStart());
  assert.equal(r.timers.snapshot().move.state, 'sitting');
  assert.ok(r.types().includes('move-resolved'));
});

test('move: active hours stop counting outside the range', () => {
  // test clock starts 10:00 UTC; use the local hour so the test works in any time zone
  const r = rig(moveOnly({ sitSec: 5 }));
  const h = new Date(r.timers.now()).getHours();
  r.timers.setConfig(moveOnly({ sitSec: 5, activeHours: { days: [], ranges: [[((h + 2) % 24) * 60, ((h + 3) % 24) * 60]] } }));
  r.run(30);
  assert.equal(r.timers.snapshot().move.state, 'sitting');
  assert.equal(r.timers.snapshot().move.sitSec, 0);
  assert.equal(r.timers.snapshot().move.active, false);
});

test('move: break length can be changed for this break only', () => {
  const r = rig(moveOnly({ breakSec: 60 }));
  r.timers.moveBreakStart();
  r.timers.moveAdjust(60);
  assert.equal(r.timers.snapshot().move.breakLeftSec, 120);
  r.timers.moveAdjust(-1000);
  assert.equal(r.timers.snapshot().move.breakLeftSec, 5);
});

test('move: disabled means no reminders at all', () => {
  const r = rig(moveOnly({ enabled: false }));
  r.run(100);
  assert.ok(!r.types().includes('move-due'));
});

// ---- regressions from the code review (2026-09-29)

test('review H1: turning reminders off ends even a strict break', () => {
  const cfg = moveOnly({ strict: true });
  const r = rig(cfg);
  r.run(10);
  r.timers.moveBreakStart();
  r.timers.setConfig({ move: { ...cfg.move, enabled: false } });
  r.run(1);
  assert.equal(r.timers.snapshot().move.state, 'sitting');
  assert.ok(r.types().includes('move-resolved'));
});

test('review M1: a PAUSED Pomodoro break does not switch reminders off', () => {
  const r = rig({ pomodoro: { focusSec: 10, shortSec: 600, autoBreak: true }, move: { enabled: true, sitSec: 60, breakSec: 30, mergeSec: 0 } });
  r.timers.pomoStart();
  r.run(10);                     // focus ends -> break running
  r.timers.pomoPause();          // ...and then paused
  r.run(70);
  assert.ok(r.types().includes('move-due'));
});

test('review M4: lock then sleep still counts as time away', () => {
  const r = rig(moveOnly({ sitSec: 1000, breakSec: 180 }));
  r.run(600);
  r.timers.onLock();             // lock-screen
  r.advance(10_000);
  r.timers.onLock();             // then suspend: must not overwrite the first lock time
  r.advance(220_000);
  r.timers.onUnlock();           // resume
  r.run(1);
  assert.ok(r.timers.snapshot().move.sitSec <= 1);
});

test('review M4: no sitting time while the PC is locked', () => {
  const r = rig(moveOnly({ sitSec: 1000, breakSec: 600 }));
  r.run(100);
  r.timers.onLock();
  r.run(120);                    // locked 2 min (less than the away time)
  r.timers.onUnlock();
  assert.equal(r.timers.snapshot().move.sitSec, 100);
});

test('review L1: no days ticked = no reminders; overnight range belongs to its start day', () => {
  const t = new Timers({ config: { move: { activeHours: { days: [], ranges: [] } } } });
  assert.equal(t.inActiveHours(), false);
  // Friday 22:00-02:00 -> active on Saturday 01:00, not on Sunday 01:00
  const fri = 5;
  t.setConfig({ move: { activeHours: { days: [fri], ranges: [[22 * 60, 2 * 60]] } } });
  const sat1am = new Date(2026, 9, 3, 1, 0).getTime();   // Sat 3 Oct 2026
  const sun1am = new Date(2026, 9, 4, 1, 0).getTime();
  assert.equal(new Date(sat1am).getDay(), 6);
  assert.equal(t.inActiveHours(sat1am), true);
  assert.equal(t.inActiveHours(sun1am), false);
});

test('review L2: a snooze ending outside active hours stays quiet', () => {
  const r = rig(moveOnly());
  r.run(10);
  r.timers.moveSnooze();
  const h = new Date(r.timers.now()).getHours();
  r.timers.setConfig(moveOnly({ activeHours: { days: [0, 1, 2, 3, 4, 5, 6], ranges: [[((h + 2) % 24) * 60, ((h + 3) % 24) * 60]] } }));
  r.run(10);
  assert.equal(r.timers.snapshot().move.state, 'snoozed');
});

test('review L6/L8: due clears "deferred"; stats get the adjusted focus length', () => {
  const r = rig(pomoOnly({ focusSec: 60 }));
  r.timers.pomoStart();
  r.timers.pomoAdjust(120);
  r.run(180);
  assert.equal(r.all.find((e) => e.type === 'pomo-focus-end').focusSec, 180);
});
