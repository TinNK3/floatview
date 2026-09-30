# FloatView clock themes & assets

Preview everything: open **`docs/themes/gallery.html`** (double-click; works offline). Rebuild it after editing the data with `node docs/themes/build-gallery.js`.

## What's collected

| Asset | Count | Where | License |
|---|---|---|---|
| Clock themes | 15 | `assets/themes/themes.json` | FloatView's own; palettes credited below |
| Fonts | 10 families / 16 files (≈ 370 KB) | `assets/fonts/` + `fonts.css` | SIL OFL 1.1 — see `assets/fonts/LICENSES.md` |
| Sounds | 13 (all < 22 KB) | `assets/sounds/` + `sounds.json` | CC0 (Kenney) — see `assets/sounds/LICENSES.md` |
| Flip-clock component | 1 | `src/renderer/clock/flip-clock.{js,css}` | FloatView's own code |

## The 15 themes

| Group | Theme | Style | Font | Palette source |
|---|---|---|---|---|
| FloatView | **Midnight** (default) | flip | JetBrains Mono 700 | original |
| Classic | **Paper** | flip, light | Inter 800 | look inspired by 1960s Braun product design |
| Classic | **Solari** | flip, board | Barlow Condensed 700 | look inspired by split-flap departure boards |
| Dev themes | **Dracula** | flip | Oswald 500 | [Dracula](https://draculatheme.com) · MIT |
| Dev themes | **Nord** | flip | Inter 600 | [Nord](https://www.nordtheme.com) · MIT |
| Dev themes | **Catppuccin Mocha** | flip | Space Mono 700 | [Catppuccin](https://catppuccin.com) · MIT |
| Dev themes | **Catppuccin Latte** | flip, light | Space Mono 700 | [Catppuccin](https://catppuccin.com) · MIT |
| Dev themes | **Tokyo Night** | flip | JetBrains Mono 700 | [Tokyo Night](https://github.com/tokyo-night/tokyo-night-vscode-theme) · MIT |
| Dev themes | **Gruvbox** | flip | Bebas Neue | [Gruvbox](https://github.com/morhetz/gruvbox) · MIT/X11 |
| Dev themes | **Rosé Pine** | flip | Oswald 500 | [Rosé Pine](https://rosepinetheme.com) · MIT |
| Overlay | **Glass** | text on blurred glass | Inter 800 | original — made for *Video + Clock* |
| Overlay | **Shadow text** | text only, no background | Oswald 700 | original — made for *Video + Clock* |
| Digital | **Terminal** | green phosphor + scanlines | VT323 | original |
| Digital | **LED** | 7-segment with faint "88" | DSEG7 Classic | original (font by keshikan, OFL) |
| Digital | **Neon** | flip, glowing | Orbitron 900 | look inspired by synthwave art |

Theme names of third-party palettes only credit where the colors come from. FloatView is not affiliated with or endorsed by those projects. Hex values are re-mixed for clock cards (card top/bottom, hinge, glow), not copied as whole themes. Proprietary looks (Fliqlo, Solari, Braun) are described in words only; no graphics or trademarks are reused.

## Design rules used (from research, see SPEC-clock.md)
- One card holds a **pair of digits** and is close to square (width = 1.18 × height). Digits are **≈ 78 % of card height**.
- **No colon** between flip cards (classic split-flap look). Text and LED styles keep the colon.
- **Hinge:** a 1.5 px dark line with a 1 px light highlight under it, plus two small side pins.
- **Top half is slightly lighter** (1 px inner highlight). The **bottom half is darker near the hinge**, fading out by about 30 %.
- **Flip:** 4 layers per card; the top flap falls with ease-in, and the bottom flap lands with ease-out and a tiny overshoot. Total 520 ms, with `perspective` = 4 × card height.
- **Reduced motion:** no flaps (flip themes) or a short fade (text themes).
- **Tabular digits** (`tnum`) wherever the font supports them, so timers don't jitter.

## Adding a theme
Add an entry to `assets/themes/themes.json`. The fields are explained in its `$comment`: `kind`, `font.{family,weight,tracking,scale,metaFamily}`, `colors.{bg,bg2,cardTop,cardBottom,digit,hinge,accent,accent2,muted,meta,glow}`, `card.{radius,shadow,blur,scanlines,ghost}`, `separator`, `inspiredBy`. Then rebuild the gallery. A new font needs its woff2 + `LICENSE.txt` in `assets/fonts/<family>/` and a line in `fonts.css`.

## Research references
- FlipClock.js (MIT) and pqina Flip/Tick (MIT): layer structure, perspective and flap shading. Studied, not copied.
- Fliqlo screensaver, Solari *Cifra 3* (Gino Valle, 1965): pair-per-card layout, no colon.
- Palette hex values were verified against each project's official repo or site.
