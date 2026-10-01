// End-to-end test for "Up next": several links, auto-advance, Previous/Next, repeat,
// YouTube playlists, folders, persistence.   Usage: npm run smoke:queue
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = process.env.SMOKE_OUT || path.join(__dirname, '..', 'smoke-out');
const SOUNDS = path.join(__dirname, '..', 'assets', 'sounds');
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
  await page.waitForFunction(() => window.FVQueue);
  return { app, page };
}
const quit = (app) => app.evaluate(({ app: a }) => { a.isQuitting = true; a.quit(); });
const qstate = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.FVQueue.state)));
async function waitFor(fn, ms = 15000, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-queue-'));
  const media = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-media-'));
  // three short local "videos" (CC0 sounds from the app) + a folder in the wrong name order
  const files = ['chime-steel.ogg', 'break-pizzicato.ogg', 'bell-clear.ogg'].map((f, i) => {
    const dest = path.join(media, `Track ${i + 1}.ogg`);
    fs.copyFileSync(path.join(SOUNDS, f), dest);
    return dest;
  });
  const folder = path.join(media, 'album');
  fs.mkdirSync(folder);
  for (const n of ['Ep 10.ogg', 'Ep 2.ogg', 'Ep 1.ogg']) fs.copyFileSync(path.join(SOUNDS, 'pop-soft.ogg'), path.join(folder, n));

  let { app, page } = await launch(dataDir);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // ---- paste 3 links (one per line) into the link box -> plays all, in order, by itself
  await page.focus('#link-input');
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    document.getElementById('link-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, files.join('\r\n'));
  let s = await waitFor(async () => { const x = await qstate(page); return x.items.length === 3 ? x : null; }, 5000);
  ok('pasting 3 lines queues 3 videos', !!s, s && s.items.map((i) => i.title || i.url.split('/').pop()).join(' | '));
  const order = [];
  const done = await waitFor(async () => {
    const x = await qstate(page);
    if (order.at(-1) !== x.index) order.push(x.index);
    return x.index === 2 && await page.evaluate(() => document.getElementById('native').ended);
  }, 20000);
  ok('plays them one after another by itself', !!done && order.join(',') === '0,1,2', `order ${order.join(',')}`);
  await sleep(2000);
  ok('stops at the end (repeat off)', (await qstate(page)).index === 2);

  // ---- a video that can't play is skipped, the list goes on
  const broken = path.join(media, 'Broken.mp4');
  fs.writeFileSync(broken, 'this is not a video');
  await page.evaluate((t) => window.FVQueue.submit(t), [files[0], broken, files[2]].join('\n'));
  const order2 = [];
  const skipped = await waitFor(async () => {
    const x = await qstate(page);
    if (order2.at(-1) !== x.index) order2.push(x.index);
    return x.index === 2;
  }, 20000);
  ok('a video that cannot play is skipped', !!skipped && order2.join(',') === '0,1,2', `order ${order2.join(',')}`);

  // ---- a YouTube video that is unavailable (YouTube shows its own error page) is skipped too
  await page.evaluate((t) => window.FVQueue.submit(t), [files[0], 'https://www.youtube.com/watch?v=xxxxxxxxxxx', files[2]].join('\n'));
  let ytErr = '';
  const order3 = [];
  const ytSkipped = await waitFor(async () => {
    const x = await qstate(page);
    if (order3.at(-1) !== x.index) order3.push(x.index);
    const e = await page.evaluate(() => (document.getElementById('error').hidden ? '' : document.getElementById('error-text').textContent));
    if (e) ytErr = e;
    return x.index === 2;
  }, 40000, 300);
  ok('an unavailable YouTube video is reported and skipped', !!ytSkipped && /unavailable/i.test(ytErr), `${order3.join(',')} · "${ytErr}"`);
  await page.evaluate((t) => window.FVQueue.submit(t), files.join('\n'));
  await waitFor(async () => (await qstate(page)).index === 2 && await page.evaluate(() => document.getElementById('native').ended), 20000);

  // ---- Previous / Next buttons are visible and work
  await page.evaluate(() => document.body.classList.add('active'));
  const navVisible = await page.evaluate(() => getComputedStyle(document.getElementById('btn-next')).display !== 'none');
  await page.click('#btn-prev');
  await sleep(700);
  const afterPrev = (await qstate(page)).index;
  await page.click('#btn-next');
  await sleep(700);
  ok('Previous / Next buttons show and work', navVisible && afterPrev === 1 && (await qstate(page)).index === 2, `prev->${afterPrev}`);
  await page.screenshot({ path: path.join(OUT, 'q1-controls.png') });

  // ---- repeat all wraps around; repeat one replays
  await page.evaluate(() => { document.getElementById('btn-queue').click(); });
  await sleep(300);
  await page.click('#q-repeat'); // off -> all
  const wrapped = await waitFor(async () => (await qstate(page)).index === 0, 8000);
  ok('Repeat all: after the last comes the first', !!wrapped);
  await page.click('#q-repeat'); // all -> one
  const idx = (await qstate(page)).index;
  const opened = await app.evaluate(() => global.__floatview.store.get('history').length);
  await sleep(4500);
  ok('Repeat one: stays on the same video', (await qstate(page)).index === idx, `index ${idx}`);
  await page.click('#q-repeat'); // one -> off
  await page.screenshot({ path: path.join(OUT, 'q2-panel.png') });

  // ---- "+ Queue" adds without interrupting
  await page.evaluate(() => window.FVQueue.openPanel(false));
  await page.evaluate(() => document.getElementById('btn-new').click());
  await page.fill('#link-input', 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');
  await page.click('#btn-enqueue');
  await sleep(500);
  s = await qstate(page);
  ok('+ Queue adds to the end', s.items.length === 4 && s.items[3].url.endsWith('flower.mp4'));
  await page.keyboard.press('Escape');

  // ---- a dropped folder is read in natural order
  const fromFolder = await page.evaluate((p) => window.floatview.expandPaths([p]), folder);
  ok('a folder becomes its files in name order (Ep 1, Ep 2, Ep 10)', fromFolder.map((i) => i.title).join(',') === 'Ep 1.ogg,Ep 2.ogg,Ep 10.ogg', fromFolder.map((i) => i.title).join(','));

  // ---- YouTube playlist link: whole list, Next moves inside it
  await page.evaluate(() => window.FVQueue.submit('https://www.youtube.com/playlist?list=UUSMOQeBJ2RAnuFungnQOxLg'));
  const yt = await waitFor(async () => {
    const st = await page.evaluate(async () => { const wv = document.querySelector('#stage webview'); try { return await wv.executeJavaScript('window.__fv && window.__fv.status()'); } catch { return null; } });
    return st?.yt?.count > 1 ? st : null;
  }, 30000, 500);
  ok('YouTube playlist link loads the whole list', !!yt, yt ? `${yt.yt.count} videos` : 'no list');
  if (yt) {
    await page.evaluate(() => window.FVQueue.next());
    const moved = await waitFor(async () => {
      const st = await page.evaluate(async () => { const wv = document.querySelector('#stage webview'); try { return await wv.executeJavaScript('window.__fv.status()'); } catch { return null; } });
      return st?.yt?.index === 1 ? st : null;
    }, 15000, 500);
    await sleep(1500);
    const title = await page.evaluate(() => document.getElementById('title').textContent);
    ok('Next moves to video 2 of the YouTube list', !!moved && /2\/\d+/.test(title), title);
    await page.evaluate(() => document.body.classList.add('active'));
    await page.screenshot({ path: path.join(OUT, 'q3-youtube-list.png') });
  }

  // ---- saved across restarts
  await app.evaluate(() => global.__floatview.store.flush());
  await sleep(500);
  const before = await qstate(page);
  const real = errors.filter((e) => !/Autofill|Electron Security Warning/.test(e));
  await quit(app);
  await sleep(1500);
  ({ app, page } = await launch(dataDir));
  await sleep(800);
  const after = await qstate(page);
  const resumeBtn = await page.evaluate(() => { const b = document.getElementById('empty-queue'); return !b.hidden && b.textContent; });
  ok('Up next is kept after a restart', after.items.length === before.items.length && after.items.length >= 5, `${after.items.length} items`);
  ok('empty screen offers "Up next" to continue', /Up next \(\d+\)/.test(resumeBtn || ''), String(resumeBtn));
  await page.screenshot({ path: path.join(OUT, 'q4-empty-resume.png') });
  await quit(app);

  ok('no errors in the window', real.length === 0, real.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
