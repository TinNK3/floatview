// Builds docs/themes/gallery.html from assets/themes/themes.json + assets/sounds/sounds.json.
// The data is embedded so the page opens by double-click (browsers block fetch() on file://).
// Run: node docs/themes/build-gallery.js
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const themes = JSON.parse(fs.readFileSync(path.join(root, 'assets/themes/themes.json'), 'utf8')).themes;
const sounds = JSON.parse(fs.readFileSync(path.join(root, 'assets/sounds/sounds.json'), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const roleOf = (id) => Object.entries(sounds.defaults).filter(([, v]) => v === id).map(([k]) => k);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FloatView Themes</title>
<link rel="stylesheet" href="../../assets/fonts/fonts.css">
<link rel="stylesheet" href="../../src/renderer/clock/flip-clock.css">
<style>
  :root { --bg: #0b0c0f; --panel: #14161c; --line: rgba(255,255,255,.08); --text: #eceef3; --muted: #8a91a0; --accent: #6aa7ff; color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 Inter, "Segoe UI", system-ui, sans-serif; }
  header { padding: 48px 48px 8px; max-width: 1480px; margin: 0 auto; }
  h1 { font: 800 40px/1.1 Inter, sans-serif; letter-spacing: -.03em; margin: 0 0 8px; }
  header p { color: var(--muted); margin: 0; max-width: 760px; }
  .controls { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
  .controls button { height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line); background: #171a21; color: var(--text); cursor: pointer; font: inherit; }
  .controls button[aria-pressed=true] { background: var(--accent); color: #06142b; border-color: transparent; font-weight: 600; }
  h2 { font: 700 13px/1 Inter, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 40px 0 16px; }
  main { padding: 0 48px 64px; max-width: 1480px; margin: 0 auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 20px; }
  .tile { border-radius: 18px; overflow: hidden; border: 1px solid var(--line); background: var(--panel); }
  .stage { height: 250px; display: grid; place-items: center; position: relative; overflow: hidden; }
  .stage.video { background:
    radial-gradient(40% 55% at 72% 38%, rgba(255,214,170,.9), rgba(255,214,170,0) 70%),
    linear-gradient(170deg, transparent 58%, #3f6b3a 58.5%, #2c4f2a 75%),
    linear-gradient(190deg, transparent 64%, #5c8a45 64.5%, #3d6431 100%),
    linear-gradient(to bottom, #f3b8c5 0%, #f6d3c4 45%, #c9e2f0 100%); }
  .stage.scan::after { content: ''; position: absolute; inset: 0; pointer-events: none;
    background: repeating-linear-gradient(to bottom, rgba(0,0,0,.25) 0 1px, transparent 1px 3px); }
  .overlay-card { padding: 14px 22px; border-radius: 18px; }
  .info { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 14px 18px; border-top: 1px solid var(--line); }
  .info b { font-size: 15px; }
  .info span { color: var(--muted); font-size: 12.5px; text-align: right; }
  .info a { color: var(--muted); }
  .swatches { display: flex; gap: 4px; padding: 0 18px 16px; }
  .swatches i { width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--line); }
  .dots { display: flex; gap: 6px; justify-content: center; }
  .dots i { width: 8px; height: 8px; border-radius: 50%; background: var(--fc-muted); opacity: .5; }
  .dots i.on { background: var(--fc-accent); opacity: 1; }
  table { width: 100%; border-collapse: collapse; background: var(--panel); border-radius: 14px; overflow: hidden; }
  td, th { padding: 10px 14px; border-bottom: 1px solid var(--line); text-align: left; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; }
  td button { height: 30px; width: 30px; border-radius: 50%; border: 0; background: var(--accent); color: #06142b; cursor: pointer; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 999px; background: rgba(106,167,255,.12); color: #9cc4ff; font-size: 12px; margin-right: 4px; }
  footer { color: var(--muted); font-size: 12.5px; padding: 0 48px 48px; max-width: 1480px; margin: 0 auto; }
</style>
</head>
<body>
<header>
  <h1>FloatView themes</h1>
  <p>${themes.length} clock themes and ${sounds.sounds.length} sounds. Everything here is bundled locally — fonts are SIL OFL, sounds are CC0 (Kenney), palettes are inspired by MIT-licensed editor themes. The clocks below are the real component the app will use.</p>
  <div class="controls">
    <button id="t24" aria-pressed="true">24 h</button><button id="t12" aria-pressed="false">12 h</button>
    <button id="tsec" aria-pressed="true">Seconds</button><button id="tdate" aria-pressed="true">Date</button>
    <button id="tpomo" aria-pressed="false">Show as Pomodoro timer</button>
  </div>
</header>
<main>
  ${[...new Set(themes.map((t) => t.group))].map((g) => `
  <h2>${esc(g)}</h2>
  <div class="grid">
    ${themes.filter((t) => t.group === g).map((t) => {
      const c = t.colors;
      const overlay = t.group === 'Overlay';
      const stageBg = overlay ? '' : `background: radial-gradient(120% 120% at 50% 0%, ${c.bg2 || c.bg}, ${c.bg});`;
      const inner = overlay
        ? `<div class="overlay-card" style="background:${c.bg};${t.card.blur ? `backdrop-filter:blur(${t.card.blur}px);` : ''}"><div class="clock" data-id="${t.id}"></div></div>`
        : `<div><div class="clock" data-id="${t.id}"></div><div class="dots" hidden><i class="on"></i><i class="on"></i><i></i><i></i></div></div>`;
      const sw = [c.bg, c.cardTop, c.digit, c.accent, c.accent2].filter((x) => x && x.startsWith('#'));
      const credit = t.inspiredBy ? (t.inspiredBy.url ? `<a href="${esc(t.inspiredBy.url)}">${esc(t.inspiredBy.name)}</a>` : esc(t.inspiredBy.name)) + (t.inspiredBy.license ? ` · ${esc(t.inspiredBy.license)}` : '') : 'FloatView original';
      return `<article class="tile">
      <div class="stage${overlay ? ' video' : ''}${t.card.scanlines ? ' scan' : ''}" style="${stageBg}">${inner}</div>
      <div class="info"><b>${esc(t.name)}</b><span>${esc(t.font.family)} ${t.font.weight} · ${esc(t.kind)}<br>${credit}</span></div>
      <div class="swatches">${sw.map((x) => `<i title="${x}" style="background:${x}"></i>`).join('')}</div>
    </article>`;
    }).join('')}
  </div>`).join('')}

  <h2>Sounds</h2>
  <table>
    <tr><th></th><th>Sound</th><th>Default for</th><th>File</th></tr>
    ${sounds.sounds.map((s) => `<tr><td><button data-file="${esc(s.file)}" data-gain="${s.gain}" aria-label="Play ${esc(s.name)}">▶</button></td><td>${esc(s.name)}</td><td>${roleOf(s.id).map((r) => `<span class="tag">${esc(r)}</span>`).join('') || '—'}</td><td style="color:var(--muted)">${esc(s.file)}</td></tr>`).join('')}
  </table>
</main>
<footer>Fonts: JetBrains Mono, Inter, Space Mono, Bebas Neue, Oswald, Orbitron, Share Tech Mono, VT323, Barlow Condensed (SIL OFL 1.1, via Fontsource) · DSEG7 by keshikan (SIL OFL 1.1). Sounds by Kenney.nl (CC0). Palette credits: Dracula, Nord, Catppuccin, Tokyo Night, Gruvbox, Rosé Pine (MIT).</footer>

<script src="../../src/renderer/clock/flip-clock.js"></script>
<script>
  const THEMES = ${JSON.stringify(themes)};
  const opts = { hour12: false, seconds: true, date: 'short' };
  let pomo = false, pomoLeft = 24 * 60 + 59;
  const clocks = [...document.querySelectorAll('.clock')].map((el) => {
    const t = THEMES.find((x) => x.id === el.dataset.id);
    el.style.setProperty('--fc-h', t.group === 'Overlay' ? '92px' : '110px');
    const c = new FlipClock(el, opts);
    c.setTheme(t);
    return c;
  });
  const pad = (n) => String(n).padStart(2, '0');
  function tick() {
    if (pomo) {
      pomoLeft = pomoLeft > 0 ? pomoLeft - 1 : 25 * 60;
      clocks.forEach((c) => c.show({ a: pad(Math.floor(pomoLeft / 60)), b: pad(pomoLeft % 60), c: null,
        meta: '<span class="fc-accent">Focus</span><span>Round 3 / 4</span>' }));
    } else clocks.forEach((c) => { Object.assign(c.opts, opts); c.tick(); });
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  }
  tick();
  const toggle = (id, fn) => document.getElementById(id).addEventListener('click', (e) => { fn(e.currentTarget); });
  const press = (el, on) => el.setAttribute('aria-pressed', String(on));
  toggle('t24', (b) => { opts.hour12 = false; press(b, true); press(document.getElementById('t12'), false); });
  toggle('t12', (b) => { opts.hour12 = true; press(b, true); press(document.getElementById('t24'), false); });
  toggle('tsec', (b) => { opts.seconds = !opts.seconds; press(b, opts.seconds); });
  toggle('tdate', (b) => { opts.date = opts.date === 'off' ? 'short' : 'off'; press(b, opts.date !== 'off'); });
  toggle('tpomo', (b) => { pomo = !pomo; press(b, pomo); document.querySelectorAll('.dots').forEach((d) => { d.hidden = !pomo; }); });
  document.querySelectorAll('td button').forEach((b) => b.addEventListener('click', () => {
    const a = new Audio('../../assets/sounds/' + b.dataset.file); a.volume = Number(b.dataset.gain); a.play();
  }));
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'gallery.html'), html);
console.log('wrote docs/themes/gallery.html with', themes.length, 'themes and', sounds.sounds.length, 'sounds');
