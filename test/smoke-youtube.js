// End-to-end test against real YouTube: Mix lists, suggestions, "More from YouTube", ad blocking.
// Needs internet.   Usage: npm run smoke:youtube   (optional: FV_PLAYLIST=<a playlist link> to check one too)
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
    env: { ...process.env, FLOATVIEW_TEST: '1', FLOATVIEW_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fv-yt-')) },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForFunction(() => window.FVQueue);
  const q = () => page.evaluate(() => JSON.parse(JSON.stringify(window.FVQueue.state)));
  const st = () => page.evaluate(async () => { const wv = document.querySelector('#stage webview'); try { return await wv.executeJavaScript('window.__fv && window.__fv.status()'); } catch { return null; } });
  const waitFor = async (fn, ms = 30000, step = 500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); } return null; };

  // ---- optional: a real playlist link (e.g. your own, unlisted)
  if (process.env.FV_PLAYLIST) {
    await page.evaluate((u) => window.FVQueue.submit(u), process.env.FV_PLAYLIST);
    const s = await waitFor(async () => { const x = await st(); return x?.yt?.count ? x : null; });
    ok('your playlist link plays as a list', !!s, s ? `${s.yt.count} video(s), first: ${s.yt.title}` : '');
  }

  // ---- a YouTube Mix (list=RD…) plays as a whole list
  await page.evaluate(() => window.FVQueue.submit('https://www.youtube.com/watch?v=sVTy_wmn5SU&list=RDsVTy_wmn5SU'));
  const mix = await waitFor(async () => { const x = await st(); return x?.yt?.count > 10 ? x : null; });
  ok('a YouTube Mix plays as a whole list', !!mix, mix ? `${mix.yt.count} videos` : '');
  ok('the current video id is known', mix?.ytId === 'sVTy_wmn5SU', mix?.ytId);

  // ---- "+ Suggestions" adds what YouTube suggests for the video that is playing
  const before = (await q()).items.length;
  await page.evaluate(() => window.FVQueue.addSuggestions());
  const after = await waitFor(async () => { const x = await q(); return x.items.length > before + 5 ? x : null; }, 20000);
  ok('+ Suggestions adds YouTube suggestions', !!after, after ? `+${after.items.length - before}: ${after.items.slice(before, before + 3).map((i) => i.title).join(' | ')}` : '');
  ok('suggestions have titles and are YouTube links', !!after && after.items.slice(before).every((i) => i.title && /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(i.url)));
  await page.evaluate(() => window.FVQueue.openPanel(true));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'y1-suggestions.png') });
  await page.evaluate(() => window.FVQueue.openPanel(false));

  // ---- end of the list on a YouTube video -> keeps going with suggestions
  await page.evaluate(() => document.getElementById('q-clear').click());
  await page.evaluate(() => window.FVQueue.submit('https://www.youtube.com/watch?v=aqz-KE-bpKQ'));
  await waitFor(async () => { const x = await st(); return x?.duration > 30 && x.currentTime > 0.5 ? x : null; });
  const len1 = (await q()).items.length;
  await page.evaluate(async () => { const wv = document.querySelector('#stage webview'); await wv.executeJavaScript('(() => { const v = document.querySelector("video"); v.currentTime = v.duration - 1.5; v.play(); })()'); });
  const cont = await waitFor(async () => { const x = await q(); return x.items.length > len1 + 5 && x.index === len1 ? x : null; }, 40000);
  ok('at the end of the list, YouTube suggestions keep playing', !!cont, cont ? `now playing #${cont.index + 1}: ${cont.items[cont.index].title}` : `items ${(await q()).items.length}`);

  // ---- ad blocking: ad requests from the page are cancelled; off = allowed
  const tryAd = () => page.evaluate(async () => {
    const wv = document.querySelector('#stage webview');
    return wv.executeJavaScript("fetch('https://googleads.g.doubleclick.net/pagead/id', { mode: 'no-cors' }).then(() => 'loaded', (e) => 'blocked')");
  });
  const blockedBefore = await app.evaluate(() => global.__floatview.state.adsBlocked || 0);
  const on = await tryAd();
  const blockedAfter = await app.evaluate(() => global.__floatview.state.adsBlocked || 0);
  await page.evaluate(() => window.floatview.setSetting('blockAds', false));
  const off = await tryAd();
  await page.evaluate(() => window.floatview.setSetting('blockAds', true));
  ok('ad requests are blocked (and counted)', on === 'blocked' && blockedAfter > blockedBefore, `${on}, count ${blockedBefore}→${blockedAfter}`);
  ok('with "Block ads" off they are allowed', off === 'loaded', off);
  ok('the video itself still plays with ads blocked', !!(await waitFor(async () => { const x = await st(); return x?.currentTime > 1 && !x.paused ? x : null; }, 20000)));

  await page.evaluate(() => document.body.classList.add('active'));
  await page.screenshot({ path: path.join(OUT, 'y2-playing.png') });
  await app.evaluate(({ app: a }) => { a.isQuitting = true; a.quit(); });
  const real = errors.filter((e) => !/Autofill|Electron Security Warning|ERR_BLOCKED_BY_CLIENT/.test(e));
  ok('no errors in the window', real.length === 0, real.slice(0, 3).join(' | '));
  const bad = results.filter((r) => !r.pass);
  console.log(`\n${results.length - bad.length}/${results.length} passed. Screenshots: ${OUT}`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
