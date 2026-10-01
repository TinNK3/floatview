<p align="center">
  <img src="docs/banner.png" alt="FloatView — paste a link, the video floats on top of every window" width="100%">
</p>

<p align="center">
  <img alt="Windows 10/11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0b0c0f?logo=windows&logoColor=6aa7ff">
  <img alt="Electron 44" src="https://img.shields.io/badge/Electron-44-0b0c0f?logo=electron&logoColor=6aa7ff">
  <img alt="Version 0.3.1" src="https://img.shields.io/badge/version-0.3.1-6aa7ff">
  <img alt="No telemetry" src="https://img.shields.io/badge/telemetry-none-0b0c0f">
</p>

# FloatView

Paste a video link → it plays in a small floating window that **stays on top of every other window**.
Local only: no accounts, no telemetry, nothing leaves the PC except the video stream itself.

**New in 0.3:** playlists — paste several links, YouTube/Vimeo playlists, whole folders; plays the next video by itself.
**0.2:** a flip clock (on the video or on its own), a Pomodoro timer, and stand-up / move reminders — every time is yours to set.

| Playing on top | Paste a link | Resize big or small |
|---|---|---|
| ![Player with controls](docs/screenshot-player.png) | ![Link box with recent links](docs/screenshot-link.png) | ![Size panel](docs/screenshot-size.png) |

## Install
Two builds (`npm run dist` → `dist\`):
- **`FloatView-Setup-0.3.1.exe`** — installs per-user (no admin) to `%LOCALAPPDATA%\Programs\FloatView` and adds a Start-menu shortcut.
- **`FloatView-0.3.1-portable.exe`** — one file, no install; double-click to run (first start takes a few seconds while it unpacks).

## Resize: big or small
- **Drag the grip** in the bottom-right corner (shows on hover). The window keeps the video's shape.
- **Size button** (↗↙ in the top bar): *Small* / *Medium* / *Large* / *Huge* (20 / 33 / 50 / 75 % of the screen width), **−** / **+** steps, or type an exact width in px.
- **Keys:** `Ctrl+Alt+=` bigger · `Ctrl+Alt+-` smaller (from any app), or `+` / `-` inside the window.
- The window edge also works: grab just outside the border, like any Windows window.
- A size label (e.g. `960 × 540`) appears while you resize. The window never grows past the screen.

## Up next: playlists, albums, auto-play
- **Several links at once:** paste them (one per line) into the link box → they play one after another.
- **+ Queue** (or `Shift+Enter`) adds a link to the end without stopping what's playing.
- **YouTube playlists** (`youtube.com/playlist?list=…` or a video link with `&list=…`) and **Vimeo showcases/albums** play as a whole list; ⏮ / ⏭ move inside the list and the title shows the position (e.g. *2/200*).
- **Files and folders:** drop several files, or a whole folder — its videos play in name order (*Ep 1, Ep 2 … Ep 10*).
- **Other sites' albums/playlists:** with *yt-dlp* set in Settings, FloatView reads the list and queues every video.
- When a video ends the next one starts. **Repeat** off / all / one, **Shuffle**, **Autoplay** on/off — in the *Up next* panel (list button in the top bar).
- A video that can't play (deleted, private, broken file) is skipped instead of stopping the list.
- The list is saved; the start screen offers **▶ Up next (N)** to continue.

## Clock, Pomodoro & move reminders
Switch view with the ⏱ button in the top bar, the tray menu, or `Ctrl+Alt+C`:

| View | What you see |
|---|---|
| **Video** | just the video |
| **Video + Clock** | the clock on top of the video (9 positions, 4 sizes, adjustable opacity) |
| **Clock only** | a full-window flip clock + Pomodoro panel; the video keeps playing (or pauses — your choice) |

- **15 themes** (flip cards, text-only overlay, LED, terminal, neon, Dracula/Nord/Catppuccin-style…), 10 fonts, custom colors. Preview them all in `docs/themes/gallery.html`.
- **Pomodoro:** focus → short break → … → long break. Presets *25/5*, *50/10*, *15/3*, *90/20*, or **type any time** (`25`, `90s`, `1:30`, `1h20m`), save your own presets and set **your own default**. ±1 / +5 min for the current round only.
- **Move reminder:** after sitting a set time (default 50 min) a break screen asks you to stand up, with a stretch idea and a countdown (default 3 min). Snooze (limit is yours), Skip, or *strict mode*. Being away from the PC (idle / locked / asleep) counts as a break — but **watching a FloatView video without touching the mouse still counts as sitting**. Optional active hours.
- **Sounds:** 13 built-in CC0 sounds (Kenney) or your own mp3/wav/ogg, one per event, with volume and preview. The video volume dips while a timer sound plays.
- **Stats:** focus sessions, focus time, move breaks taken/snoozed/skipped, longest sitting, 7-day chart. Local only.

## Use
- Paste a link and press **Play**, or press **Ctrl+V** anywhere in the window, or drag a link/file onto it.
- Hover to see the controls; they fade out after ~2 s.
- Drag the top bar to move. Drag an edge to resize. Near a screen edge, the window snaps to it.
- Closing (✕) hides the window to the tray. Quit from the tray menu or from Settings.

| Hotkey (works from any app) | Action |
|---|---|
| `Ctrl+Alt+Space` | Play / pause |
| `Ctrl+Alt+V` | Show FloatView and paste a new link |
| `Ctrl+Alt+T` | Click-through on/off (clicks go to the app behind) |
| `Ctrl+Alt+↑ / ↓` | Opacity ±10% |
| `Ctrl+Alt+← / →` | Seek −/+10 s |
| `Ctrl+Alt+H` | Hide / show |
| `Ctrl+Alt+P` | Always-on-top on/off |
| `Ctrl+Alt+=` / `Ctrl+Alt+-` | Bigger / smaller window |
| `Ctrl+Alt+C` | Switch view: Video → Video + Clock → Clock |
| `Ctrl+Alt+S` | Pomodoro start / pause |
| `Ctrl+Alt+B` | Take a move break now |
| `Ctrl+Alt+N` | Snooze the stand-up reminder |
| `Ctrl+Alt+PageDown` / `PageUp` | Next / previous video |

Inside the window: `Space`/`K` play (in Clock mode: start/pause the Pomodoro), `←/→` seek 5 s, `↑/↓` volume, `M` mute, `N` new link, `Shift+N` / `Shift+P` next / previous video, `Esc` close panels.
In click-through mode, hover the lock in the top-right corner and click it to turn click-through off.

Change any of them in **Settings → Keys**: click *Change* and press the new keys (Ctrl, Alt or Win plus a key). A clash, or a shortcut already taken by another app, is flagged on its row; *Reset all to defaults* puts them back.

## What plays
| Link | How |
|---|---|
| `.mp4 .webm .mov .mp3 …`, local files | built-in player |
| `.m3u8` (HLS), `.mpd` (DASH) | hls.js / dash.js |
| YouTube (watch, youtu.be, Shorts, live), Vimeo, Twitch | official embed player |
| Any other page (Facebook, TikTok, news sites…) | page opens in a sandbox, only its biggest video is shown |
| Sites with no player found | set **yt-dlp.exe** in Settings; FloatView asks it for the stream URL |

Not supported: DRM services (Netflix, Disney+, Prime Video, Spotify).

## Develop
```
npm install
npm start          # run the app
npm test           # unit tests (resolver, store, timer engine, time parser)
npm run smoke      # end-to-end: launches the app, plays MP4/HLS/YouTube/Vimeo/web links
npm run smoke:clock  # end-to-end: view modes, flip clock, Pomodoro, move breaks, sounds, settings
npm run smoke:queue  # end-to-end: Up next, auto-advance, repeat, YouTube playlists, folders
npm run dist       # build the installer into dist\
```
`SMOKE_EXE=dist\win-unpacked\FloatView.exe npm run smoke` runs the same test against the packaged build.
The banner is `docs/banner/banner.html`; re-render it with `powershell docs\banner\render.ps1`.

## Layout
```
src/main/main.js        window, always-on-top guard, tray, hotkeys, IPC, security
src/main/resolver.js    link → playback source (provider modules + yt-dlp bridge)
src/main/store.js       settings + history JSON in %APPDATA%\FloatView
src/main/timers.js      Pomodoro + move-reminder state machine (pure, unit-tested)
src/main/clock-main.js  timer loop, idle/lock detection, break window, sounds, stats
src/main/clock-settings.js  clock/timer/sound defaults + validation
src/main/queue-store.js  Up next: validation, folder expansion, yt-dlp album lists
src/preload.js          the only bridge between UI and main process
src/renderer/           UI (plain HTML/CSS/JS), players.js = native + webview players
src/renderer/inject/    script injected into web pages to find and drive the <video>
src/renderer/clock/     flip-clock component; clock-ui.js = views, Pomodoro panel, settings tabs
src/renderer/break.*    the stand-up break window
src/renderer/queue.js   Up next: playlist, auto-advance, previous/next, repeat/shuffle
assets/                 themes.json, OFL fonts, CC0 sounds (see docs/THEMES.md)
```

## Known limits
- Some old videos use an encoding Electron can't decode (e.g. vimeo.com/76979871). FloatView shows "This video is stuck" and offers *Open in browser*.
- Games in *exclusive* full-screen draw above every window. Borderless full-screen is fine.
- Drag-and-drop onto a web-page video doesn't work (the page takes the drop). Use Ctrl+V instead.
