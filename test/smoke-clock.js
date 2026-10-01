// End-to-end test for the clock / Pomodoro / move-reminder features (SPEC-clock.md §10).
// Usage: npm run smoke:clock   (screenshots -> $SMOKE_OUT or ./smoke-out)
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = process.env.SMOKE_OUT || path.join(__dirname, '..', 'smoke-out');
const HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };

async function launch(dataDir) {
  const app = await electron.launch({
    ...(process.env.SMOKE_EXE ? { executablePath: process.env.SMOKE_EXE, args: [] } : { args: [path.join(__dirname, '..')] }),
    env: { ...process.env, FLOATVIEW_TEST: '1', FLOATVIEW_DATA_DIR: dataDir },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('#link-input');
  await page.waitForFunction(() => window.floatviewClock);
  // Record every sound the main process asks the UI to play. Pretend someone is at the keyboard.
  await app.evaluate(() => {
    global.__floatview.clock.setTestIdle(0);
    const wc = global.__floatview.win.webContents;
    global.__sounds = [];
    const orig = wc.send.bind(wc);
    wc.send = (ch, ...a) => { if (ch === 'play-sound') global.__sounds.push(a[0].url.split('/').pop()); return orig(ch, ...a); };
  });
  return { app, page };
}

const quit = (app) => app.evaluate(({ app: a }) => { a.isQuitting = true; a.quit(); });
const snap = (page) => page.evaluate(() => window.floatview.getTimer());
const setSection = (page, s, v) => page.evaluate(([s, v]) => window.floatview.setSection(s, v), [s, v]);
const videoTime = (page) => page.evaluate(() => document.getElementById('native').currentTime);
const videoPaused = (page) => page.evaluate(() => document.getElementById('native').paused);
const sounds = (app) => app.evaluate(() => global.__sounds.splice(0));
async function waitFor(fn, ms = 20000, step = 250) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-clock-'));
  let { app, page } = await launch(dataDir);
  const errors = [];
  const watch = (p, tag) => { p.on('pageerror', (e) => errors.push(`${tag}: ${e}`)); p.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); }); };
  watch(page, 'main');
  app.on('window', (w) => watch(w, 'break'));

  // Play a long stream so we can check pause/resume.
  await page.fill('#link-input', HLS);
  await page.press('#link-input', 'Enter');
  await waitFor(async () => (await videoTime(page)) > 1.5, 30000);

  // ---- C1: cycle view modes; video keeps playing
  const modes = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.floatview.window('view-cycle'));
    await sleep(700);
    modes.push(await page.evaluate(() => ['video', 'video-clock', 'clock'].find((m) => document.body.classList.contains('mode-' + m))));
  }
  const t0 = await videoTime(page);
  await sleep(1500);
  ok('C1 view cycles Video+Clock -> Clock -> Video', modes.join(',') === 'video-clock,clock,video', modes.join(','));
  ok('C1 video keeps playing while switching', (await videoTime(page)) > t0 + 1);

  // Clock mode keeps its own window size
  await page.evaluate(() => window.floatview.window('view-mode', 'clock'));
  await sleep(600);
  const clockB = await app.evaluate(() => global.__floatview.win.getBounds());
  await page.evaluate(() => window.floatview.window('view-mode', 'video'));
  await sleep(600);
  const videoB = await app.evaluate(() => global.__floatview.win.getBounds());
  ok('Clock mode has its own window size', clockB.width !== videoB.width || clockB.height !== videoB.height, `clock ${clockB.width}×${clockB.height} · video ${videoB.width}×${videoB.height}`);

  // ---- C2: text-only overlay on the video, controls still clickable
  await setSection(page, 'clock', { ...(await page.evaluate(() => window.floatviewClock.settings.clock)), theme: 'shadow', overlay: { size: 'L', anchor: 'top-right', opacity: 1, hideOnHover: false, show: 'pomodoro' } });
  await page.evaluate(() => window.floatview.window('view-mode', 'video-clock'));
  await sleep(1200);
  const overlay = await page.evaluate(() => {
    const o = document.getElementById('clock-overlay');
    const cs = getComputedStyle(o);
    const r = document.getElementById('btn-play').getBoundingClientRect();
    document.body.classList.add('active');
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { display: cs.display, pe: cs.pointerEvents, kind: document.getElementById('overlay-clock').dataset.kind,
      pill: getComputedStyle(o.querySelector('.clock-pill')).backgroundColor, playReachable: !!at?.closest('#btn-play') };
  });
  await page.screenshot({ path: path.join(OUT, 'c2-overlay-text.png') });
  ok('C2 overlay shows, text-only theme, no background', overlay.display === 'flex' && overlay.kind === 'text' && /rgba\(0, 0, 0, 0\)|transparent/.test(overlay.pill), JSON.stringify(overlay));
  ok('C2 video controls still clickable under the clock', overlay.playReachable && overlay.pe === 'none');
  await setSection(page, 'clock', { ...(await page.evaluate(() => window.floatviewClock.settings.clock)), theme: 'midnight' });

  // ---- C3: only changed cards flip
  await page.evaluate(() => window.floatview.window('view-mode', 'clock'));
  await setSection(page, 'clock', { ...(await page.evaluate(() => window.floatviewClock.settings.clock)), seconds: true, animate: true, screenShows: 'time' });
  // wait for the next second change — but not :00, when the minutes card flips too
  await page.evaluate(() => new Promise((r) => { const go = () => { const ms = 1000 - (Date.now() % 1000) + 120; setTimeout(() => (new Date().getSeconds() === 0 ? go() : r()), ms); }; go(); }));
  const flips = await page.evaluate(() => [...document.querySelectorAll('#screen-clock .fc-card')].map((c) => (c.classList.contains('flipping') ? 1 : 0) + (c.hidden ? 'h' : '')));
  ok('C3 only the seconds card flips each second', String(flips[2]) === "1" && String(flips[1]) === "0", JSON.stringify(flips));
  await setSection(page, 'clock', { ...(await page.evaluate(() => window.floatviewClock.settings.clock)), seconds: false, screenShows: 'timer' });

  // ---- C4 / C14: Pomodoro with custom tiny values runs exactly as typed
  await setSection(page, 'pomodoro', { ...(await page.evaluate(() => window.floatviewClock.settings.pomodoro)),
    focusSec: 10, shortSec: 10, longSec: 0, rounds: 1, autoBreak: true, autoFocus: false, pauseVideo: true });
  await sounds(app);
  await page.evaluate(() => window.floatview.timer('pomo-start'));
  await sleep(2600);
  let s = await snap(page);
  const shown = await page.evaluate(() => [...document.querySelectorAll('#screen-clock .fc-card')].slice(0, 2).map((c) => c._value).join(':'));
  ok('C4 focus counts down from the typed 10 s', s.pomo.phase === 'focus' && s.pomo.leftSec <= 8 && s.pomo.leftSec >= 6, `leftSec ${s.pomo.leftSec}`);
  ok('C4 big display shows the countdown', /^00:0[5-8]$/.test(shown), shown);
  await page.evaluate(() => document.body.classList.add('active'));
  await page.screenshot({ path: path.join(OUT, 'c4-clock-pomodoro.png') });
  s = await waitFor(async () => { const x = await snap(page); return x.pomo.phase === 'short' ? x : null; }, 15000);
  ok('C4 break starts automatically after focus', !!s && s.pomo.running);
  await sleep(1200);
  ok('C4 video paused during the Pomodoro break', await videoPaused(page));
  s = await waitFor(async () => { const x = await snap(page); return x.pomo.phase === 'focus' ? x : null; }, 15000);
  ok('C4 then waits for Start (auto-start focus off)', !!s && !s.pomo.running && s.pomo.waiting);
  const played = await sounds(app);
  ok('C4 a sound plays at each phase change', ['start-bright.ogg', 'chime-steel.ogg', 'break-pizzicato.ogg', 'rise-clear.ogg'].every((f) => played.includes(f)), played.join(','));
  await page.evaluate(() => window.floatview.timer('pomo-start'));
  await sleep(1500);
  ok('C4 video resumes when focus starts again', !(await videoPaused(page)));
  await page.evaluate(() => window.floatview.timer('pomo-reset'));

  // ---- C6: move reminder -> break screen -> video paused -> resumes
  await page.evaluate(() => window.floatview.window('view-mode', 'video'));
  await setSection(page, 'move', { ...(await page.evaluate(() => window.floatviewClock.settings.move)),
    enabled: true, sitSec: 60, breakSec: 10, snoozeSec: 10, maxSnoozes: 1, strict: false, pauseVideo: true, mergeSec: 0 });
  await app.evaluate(() => { global.__floatview.clock.timers.move.sitMs = 59_500; });
  const bw = await waitFor(() => app.windows().find((w) => w.url().includes('break.html')), 6000);
  ok('C6 break screen opens when it is time to move', !!bw);
  await sleep(1200);
  ok('C6 reminder sound plays', (await sounds(app)).includes('bell-clear.ogg'));
  if (bw) await bw.screenshot({ path: path.join(OUT, 'c6-break-due.png') });

  // ---- C8: snooze limit
  const snoozeVisible = bw && await bw.evaluate(() => !document.getElementById('snooze').hidden);
  if (bw) await bw.click('#snooze');
  await sleep(800);
  s = await snap(page);
  ok('C8 snooze closes the break screen', s.move.state === 'snoozed' && !app.windows().some((w) => w.url().includes('break.html')), s.move.state);
  await app.evaluate(() => { global.__floatview.clock.timers.move.snoozeUntil = Date.now(); });
  const bw2 = await waitFor(() => app.windows().find((w) => w.url().includes('break.html')), 6000);
  await sleep(800);
  const snoozeAgain = bw2 && await bw2.evaluate(() => !document.getElementById('snooze').hidden);
  ok('C8 after the allowed snoozes, Snooze is gone', snoozeVisible === true && snoozeAgain === false, `first ${snoozeVisible}, then ${snoozeAgain}`);

  // Start the break from the break screen
  if (bw2) await bw2.click('#start');
  await sleep(1500);
  ok('C6 video pauses during the move break', await videoPaused(page));
  if (bw2) await bw2.screenshot({ path: path.join(OUT, 'c6-break-running.png') });
  s = await waitFor(async () => { const x = await snap(page); return x.move.state === 'sitting' ? x : null; }, 16000);
  await sleep(1200);
  ok('C6 break ends by itself, screen closes', !!s && !app.windows().some((w) => w.url().includes('break.html')));
  ok('C6 video resumes after the break', !(await videoPaused(page)));

  // ---- C9: strict mode
  await setSection(page, 'move', { ...(await page.evaluate(() => window.floatviewClock.settings.move)), strict: true });
  await page.evaluate(() => window.floatview.timer('move-break'));
  const bw3 = await waitFor(() => app.windows().find((w) => w.url().includes('break.html')), 6000);
  await sleep(800);
  const strictUi = bw3 && await bw3.evaluate(() => ({ end: document.getElementById('end').hidden, skip: document.getElementById('skip').hidden }));
  s = await page.evaluate(() => window.floatview.timer('move-skip'));
  ok('C9 strict: no way to end the break early', strictUi?.end === true && s.move.state === 'break', JSON.stringify(strictUi));
  await app.evaluate(() => { global.__floatview.clock.timers.move.breakEndsAt = Date.now(); });
  await waitFor(async () => (await snap(page)).move.state === 'sitting', 6000);
  await setSection(page, 'move', { ...(await page.evaluate(() => window.floatviewClock.settings.move)), strict: false });

  // ---- C7: being away resets the sitting timer — but not while you watch a FloatView video
  await app.evaluate(() => { global.__floatview.clock.timers.move.sitMs = 30_000; global.__floatview.clock.setTestIdle(60); });
  await sleep(1600);
  const whilePlaying = (await snap(page)).move.sitSec;
  ok('C7 no mouse input while a video plays still counts as sitting', whilePlaying >= 30, `sitSec ${whilePlaying}`);
  await page.evaluate(() => document.getElementById('native').pause());
  await sleep(1600);
  s = await snap(page);
  await app.evaluate(() => global.__floatview.clock.setTestIdle(0));
  ok('C7 idle long enough resets the sitting time', s.move.sitSec === 0 && s.move.away === true, `sitSec ${s.move.sitSec}`);
  await page.evaluate(() => document.getElementById('native').play());

  // ---- C10: custom sound is copied into app data
  const tmpSound = path.join(os.tmpdir(), `my-gong-${Date.now()}.ogg`);
  fs.copyFileSync(path.join(__dirname, '..', 'assets', 'sounds', 'pop-soft.ogg'), tmpSound);
  const added = await page.evaluate((p) => window.floatview.addSound(p), tmpSound);
  fs.rmSync(tmpSound);
  const custom = added.settings.sounds.custom[0];
  ok('C10 custom sound copied into app data', !!custom && fs.existsSync(custom.file) && custom.file.startsWith(dataDir), custom?.file);
  const bad = await page.evaluate(() => window.floatview.addSound('C:\\Windows\\win.ini').then(() => 'accepted', (e) => 'rejected'));
  ok('C10 non-audio files are refused', bad === 'rejected');

  // ---- settings validation: bad values never reach the timers
  const before = (await page.evaluate(() => window.floatviewClock.settings)).pomodoro.focusSec;
  const after = await setSection(page, 'pomodoro', { focusSec: -5, shortSec: 'abc', rounds: 1000 });
  const t2 = await setSection(page, 'clock', { theme: '../../evil', overlay: { anchor: 'nowhere' } });
  ok('Settings reject bad values', after.pomodoro.focusSec === before && after.pomodoro.rounds !== 1000 && t2.clock.theme !== '../../evil', `focus ${after.pomodoro.focusSec}`);

  // ---- C15: save a preset + set as my default, survives restart
  await setSection(page, 'pomodoro', { ...after.pomodoro, focusSec: 2400, shortSec: 480, longSec: 1200, rounds: 3,
    presets: [{ id: 'my-coding', name: 'Coding 40/8', focusSec: 2400, shortSec: 480, longSec: 1200, rounds: 3 }],
    userDefault: { id: 'my-coding', name: 'Coding 40/8', focusSec: 2400, shortSec: 480, longSec: 1200, rounds: 3 } });
  await page.evaluate(() => window.floatview.window('view-mode', 'clock'));
  await sleep(500);
  await app.evaluate(() => global.__floatview.store.flush());
  const real = errors.filter((e) => !/Autofill|Electron Security Warning/.test(e));
  await quit(app);
  await sleep(1500);
  ({ app, page } = await launch(dataDir));
  const reloaded = await page.evaluate(() => window.floatviewClock.settings);
  ok('C15 preset + my default survive a restart', reloaded.pomodoro.userDefault?.name === 'Coding 40/8' && reloaded.pomodoro.presets.length === 1 && reloaded.pomodoro.focusSec === 2400);
  ok('View mode survives a restart', reloaded.viewMode === 'clock' && await page.evaluate(() => document.body.classList.contains('mode-clock')));
  await page.evaluate(() => { document.getElementById('btn-settings').click(); window.floatviewClock.showTab('sounds'); });
  await sleep(500);
  const soundRows = await page.$$eval('.snd-row', (r) => r.length);
  const junk = await page.evaluate(() => /\[object |>false<|^false$/m.test(document.querySelector('#settings').innerText));
  ok('Settings tabs render (6 sound rows, no junk text)', soundRows === 6 && !junk, `rows ${soundRows}`);
  await page.screenshot({ path: path.join(OUT, 'c-settings-sounds.png') });
  await quit(app);

  ok('No errors in any window', real.length === 0, real.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
