// End-to-end smoke test: launches the real app and plays real links.
// Usage: npm run smoke  (screenshots go to $SMOKE_OUT or ./smoke-out)
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = process.env.SMOKE_OUT || path.join(__dirname, '..', 'smoke-out');
const ONLY = process.argv[2];
const LINKS = {
  mp4: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  hls: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  youtube: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  vimeo: 'https://vimeo.com/1084537',
  web: 'https://www.w3schools.com/html/html5_video.asp',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };

async function status(page) {
  return page.evaluate(async () => {
    const wv = document.querySelector('#stage webview');
    if (wv) { try { return await wv.executeJavaScript('window.__fv ? window.__fv.status() : null'); } catch { return null; } }
    const v = document.getElementById('native');
    return v.hidden ? null : { found: true, currentTime: v.currentTime, paused: v.paused, w: v.videoWidth, h: v.videoHeight };
  });
}

async function waitPlaying(page, ms = 30000) {
  const end = Date.now() + ms;
  let s = null;
  while (Date.now() < end) {
    s = await status(page);
    if (s?.found && s.currentTime > 1.5) return s;
    const err = await page.$eval('#error', (e) => (e.hidden ? null : e.textContent.trim())).catch(() => null);
    if (err) return { error: err };
    await sleep(500);
  }
  return s;
}

async function open(page, link) {
  await page.evaluate(() => { if (!document.body.classList.contains('is-empty')) document.getElementById('btn-new').click(); });
  await page.fill('#link-input', link);
  await page.press('#link-input', 'Enter');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-smoke-'));
  const app = await electron.launch({
    ...(process.env.SMOKE_EXE ? { executablePath: process.env.SMOKE_EXE, args: [] } : { args: [path.join(__dirname, '..')] }),
    env: { ...process.env, FLOATVIEW_TEST: '1', FLOATVIEW_DATA_DIR: dataDir },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#link-input');
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, '0-empty.png') });

  ok('window is always on top', await app.evaluate(() => global.__floatview.win.isAlwaysOnTop()));

  for (const [name, link] of Object.entries(LINKS)) {
    if (ONLY && ONLY !== name) continue;
    await open(page, link);
    const s = await waitPlaying(page, name === 'web' ? 40000 : 30000);
    await page.mouse.move(200, 150);
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, `1-${name}.png`) });
    ok(`${name} plays`, !!(s?.found && s.currentTime > 1.5), JSON.stringify(s)?.slice(0, 160));
  }

  // A stream that never starts must show an error, not a frozen black screen.
  if (!ONLY) {
    await open(page, 'https://vimeo.com/76979871');
    const stuck = await page.waitForSelector('#error:not([hidden])', { timeout: 40000 }).then(() => true).catch(() => false);
    ok('stuck video shows an error', stuck);
  }

  // Focus another window: we must stay on top and keep playing.
  await open(page, LINKS.hls);
  await waitPlaying(page);
  const before = await status(page);
  await app.evaluate(({ BrowserWindow }) => {
    const other = new BrowserWindow({ width: 900, height: 700, x: 0, y: 0, show: true, title: 'other' });
    other.loadURL('data:text/html,<h1>Another app</h1>');
    other.focus();
    global.__other = other;
  });
  await sleep(5000);
  const after = await status(page);
  const top = await app.evaluate(() => ({ onTop: global.__floatview.win.isAlwaysOnTop(), fvFocused: global.__floatview.win.isFocused(), otherFocused: global.__other.isFocused(), otherOnTop: global.__other.isAlwaysOnTop() }));
  ok('stays on top while another window has focus', top.onTop && !top.otherOnTop, JSON.stringify(top));
  ok('keeps playing while unfocused', !!(before && after && after.currentTime > before.currentTime + 3),
    `${before?.currentTime?.toFixed(1)} -> ${after?.currentTime?.toFixed(1)}`);
  await app.evaluate(() => global.__other.destroy());

  // Click-through on/off
  await page.evaluate(() => window.floatview.window('click-through'));
  await sleep(400);
  const ct = await app.evaluate(() => ({ on: global.__floatview.state.clickThrough, op: global.__floatview.win.getOpacity() }));
  await page.screenshot({ path: path.join(OUT, '2-click-through.png') });
  ok('click-through turns on with lower opacity', ct.on && ct.op < 1, JSON.stringify(ct));
  await page.evaluate(() => window.floatview.window('click-through'));
  await sleep(300);
  ok('click-through turns off', await app.evaluate(() => !global.__floatview.state.clickThrough));

  // Pause via global-hotkey path
  await app.evaluate(() => global.__floatview.win.webContents.send('command', 'pause'));
  await sleep(1200);
  ok('pause command works', (await status(page))?.paused === true);

  // History + resume point saved
  await app.evaluate(() => global.__floatview.store.flush());
  const hist = JSON.parse(fs.readFileSync(path.join(dataDir, 'floatview.json'), 'utf8')).history;
  ok('history recorded', hist.length >= (ONLY ? 1 : Object.keys(LINKS).length), hist.map((h) => `${h.provider}:${(h.title || '').slice(0, 30)}`).join(' | '));

  await page.evaluate(() => document.getElementById('btn-settings').click());
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, '3-settings.png') });

  const real = errors.filter((e) => !/Autofill|ERR_BLOCKED_BY_CLIENT|Electron Security Warning/.test(e));
  ok('no renderer errors', real.length === 0, real.slice(0, 3).join(' | '));

  await app.evaluate(({ app: a }) => { a.isQuitting = true; a.quit(); });
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
