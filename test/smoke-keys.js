// End-to-end test for Settings → Keys.   Usage: npm run smoke:keys
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = process.env.SMOKE_OUT || path.join(__dirname, '..', 'smoke-out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({
    ...(process.env.SMOKE_EXE ? { executablePath: process.env.SMOKE_EXE, args: [] } : { args: [path.join(__dirname, '..')] }),
    env: { ...process.env, FLOATVIEW_TEST: '1', FLOATVIEW_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fv-keys-')) },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForFunction(() => window.floatviewKeys && window.floatviewClock);
  await app.evaluate(() => global.__floatview.win.setBounds({ width: 620, height: 640 }));
  const hk = () => app.evaluate(() => global.__floatview.store.get('settings').hotkeys);
  const registered = (a) => app.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), a);
  const rowMsg = (action) => page.$eval(`.key-row[data-action="${action}"]`, (r) => r.querySelector('.key-msg')?.textContent || '');
  const change = (action) => page.click(`.key-row[data-action="${action}"] .key-actions button`);

  // General tab -> "Keyboard shortcuts…" opens the Keys tab
  await page.evaluate(() => document.getElementById('empty-settings').click());
  await sleep(300);
  await page.click('#s-keys');
  await sleep(600);
  const text = await page.$eval('.tab-panel[data-panel="keys"]', (p) => p.innerText);
  const rows = await page.$$eval('.tab-panel[data-panel="keys"] .key-list:not(.local) .key-row', (r) => r.length);
  ok('"Keyboard shortcuts…" opens the Keys tab', !(await page.$eval('.tab-panel[data-panel="keys"]', (p) => p.hidden)));
  ok('every shortcut listed with a plain name (no code names)', rows === 17 && !/toggleHide|cycleView|playPause|moveSnooze/.test(text) && /Show \/ hide FloatView/.test(text), `${rows} rows`);
  ok('keys shown as key caps', (await page.$$eval('.tab-panel[data-panel="keys"] kbd', (k) => k.length)) > 40);
  await page.screenshot({ path: path.join(OUT, 'k1-keys-tab.png') });

  // Change "Bigger window" to Ctrl+Alt+J by pressing the keys
  await change('sizeUp');
  await sleep(200);
  const recUi = await page.$eval('.key-row[data-action="sizeUp"]', (r) => r.classList.contains('recording') && /Press the new keys/.test(r.textContent));
  await page.screenshot({ path: path.join(OUT, 'k2-recording.png') });
  await page.keyboard.press('Control+Alt+KeyJ');
  await sleep(700);
  ok('Change → press keys records the new shortcut', recUi && (await hk()).sizeUp === 'Ctrl+Alt+J', (await hk()).sizeUp);
  ok('the new shortcut really works system-wide (registered)', await registered('Ctrl+Alt+J'));
  ok('the old one is released', !(await registered('Ctrl+Alt+=')) || (await hk()).sizeDown === 'Ctrl+Alt+=');

  // Same keys for another action -> refused with a clear message
  await change('sizeDown');
  await page.keyboard.press('Control+Alt+KeyJ');
  await sleep(600);
  ok('a clash is refused with a message', (await hk()).sizeDown === 'Ctrl+Alt+-' && /already used/.test(await rowMsg('sizeDown')), await rowMsg('sizeDown'));

  // A plain key (no Ctrl/Alt) is not accepted; Esc cancels and shortcuts come back
  await change('sizeDown');
  await page.keyboard.press('KeyQ');
  await sleep(300);
  const plainMsg = await rowMsg('sizeDown');
  const stillRec = await page.evaluate(() => window.floatviewKeys.recording);
  await page.keyboard.press('Escape');
  await sleep(500);
  ok('a key without Ctrl/Alt/Win is explained, not saved', /Add Ctrl, Alt or Win/.test(plainMsg) && stillRec === 'sizeDown' && (await hk()).sizeDown === 'Ctrl+Alt+-', plainMsg);
  ok('Esc cancels and all shortcuts work again', !(await page.evaluate(() => window.floatviewKeys.recording)) && await registered('Ctrl+Alt+J'));

  // × removes; Reset restores the defaults
  await page.click('.key-row[data-action="sizeUp"] .key-actions .quiet');
  await sleep(500);
  ok('× removes a shortcut', (await hk()).sizeUp === '' && !(await registered('Ctrl+Alt+J')));
  page.once('dialog', (d) => d.accept());
  await page.click('text=Reset all to defaults');
  await sleep(600);
  ok('Reset all to defaults', (await hk()).sizeUp === 'Ctrl+Alt+=');

  // The main process refuses junk no matter what the page sends
  const bad1 = await page.evaluate(() => window.floatview.setHotkey('sizeUp', 'J'));
  const bad2 = await page.evaluate(() => window.floatview.setHotkey('constructor', 'Ctrl+Alt+K'));
  const bad3 = await page.evaluate(() => window.floatview.setHotkey('sizeUp', 'Ctrl+Alt+J; rm -rf /'));
  ok('main refuses invalid shortcuts / actions', !!bad1.error && !!bad2.error && !!bad3.error && (await hk()).sizeUp === 'Ctrl+Alt+=');

  // "taken by another app" marks exactly the ones Windows refused
  const failed = (await page.evaluate(() => window.floatview.getHotkeys())).failed;
  const marked = await page.$$eval('.key-row.taken', (r) => r.map((x) => x.dataset.action));
  ok('"taken by another app" warning matches what Windows refused', JSON.stringify(failed.sort()) === JSON.stringify(marked.sort()), `${marked.length} taken`);

  await app.evaluate(({ app: a }) => { a.isQuitting = true; a.quit(); });
  const real = errors.filter((e) => !/Autofill|Electron Security Warning/.test(e));
  ok('no errors in the window', real.length === 0, real.slice(0, 3).join(' | '));
  const bad = results.filter((r) => !r.pass);
  console.log(`\n${results.length - bad.length}/${results.length} passed. Screenshots: ${OUT}`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
