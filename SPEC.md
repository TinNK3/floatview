# FloatView — Specification v0.1

> Working name. A small desktop app that plays video from any link in a floating window that **always stays on top** of other windows.
> Date: 2026-09-28 · Owner: Alex · Status: Draft, waiting for review

---

## 1. Problem & Goal

When you watch a video in a browser tab and then switch to another tab or app, the video gets hidden. Browser Picture-in-Picture helps, but it doesn't work on every site, has few controls, and closes when the tab closes.

**Goal:** paste a link → the video plays in a small borderless window that stays on top of everything (browsers, IDE, Office, even full-screen apps), keeps playing when you work elsewhere, and can be moved, resized, and made see-through.

### Success criteria
- Paste a link, video is playing in **≤ 3 s** (for YouTube / direct MP4 on a normal connection).
- The window **never goes behind** another window when you Alt+Tab, click another app, or switch browser tabs.
- The video **does not pause or stutter** when the window is not focused.
- Idle RAM **≤ 250 MB**; CPU **≤ 10%** while playing 1080p (hardware decoding).

## 2. Scope

### In scope (v1 — MVP)
| # | Feature |
|---|---|
| F1 | Link input box (paste with Ctrl+V, or drag-and-drop a link/file into the window) |
| F2 | Auto-detect the link type and pick the right player (see §4) |
| F3 | **Always-on-top** window, level set above normal and full-screen windows |
| F4 | Borderless window: drag to move, drag edges to resize, keep aspect ratio (16:9, 9:16, free) |
| F5 | Basic controls: play/pause, seek, volume, mute, speed 0.25×–3× |
| F6 | Opacity slider 20%–100% |
| F7 | **Click-through mode**: mouse clicks pass through the video to the app behind (toggle by hotkey) |
| F8 | Global hotkeys (work even when the app is not focused) — see §6 |
| F9 | Snap to screen corners; remember last position, size, and monitor |
| F10 | Recent links history (last 20), stored locally |
| F11 | System tray icon: show/hide, pin on/off, quit |

### Later (v2+)
- Several floating windows at once (multi-video)
- Playlist / queue
- Local files (MP4, MKV, subtitles .srt/.vtt)
- Auto-hide when the mouse is near (window slides away)
- "Fit to region": crop part of a video (e.g. only the code area of a tutorial)
- Link from clipboard auto-detect
- macOS build

### Out of scope
- DRM streaming (Netflix, Disney+, Prime Video, Spotify) — needs a Widevine licence; not worth it for v1
- Downloading/saving videos
- Accounts, cloud sync, analytics — **the app is 100% local, no telemetry**

## 3. Supported Sources

| Source | Example | How to play |
|---|---|---|
| YouTube (video, Shorts, live) | `youtube.com/watch?v=…`, `youtu.be/…` | Official embed player (`youtube-nocookie.com/embed/ID`) |
| Vimeo | `vimeo.com/123` | Official embed player |
| Twitch (live / VOD) | `twitch.tv/name` | Official embed (`parent=` parameter set) |
| Facebook / TikTok / X / Instagram | public post links | Full web page inside a sandboxed webview, CSS injected to show only the video element |
| Direct files | `.mp4`, `.webm`, `.mov`, `.mp3` | HTML5 `<video>` |
| HLS / DASH streams | `.m3u8`, `.mpd` | `hls.js` / `dash.js` |
| Any other page | anything | Fallback: open the page in the webview, find the biggest `<video>` and make it fill the window |
| (optional) yt-dlp | sites without an embed | If `yt-dlp.exe` is found locally, get the direct stream URL and play it in `<video>` |

Rule: try the **official embed first**, then direct stream, then the full-page fallback.

## 4. Link Resolution Flow

```
paste link
   │
   ├─ is file extension .mp4/.webm/.m3u8/.mpd?  ── yes ─→ Native player (<video> + hls.js/dash.js)
   │
   ├─ matches a known provider (YouTube/Vimeo/Twitch)? ── yes ─→ Embed player
   │
   ├─ yt-dlp available and enabled? ── yes ─→ resolve stream URL ─→ Native player
   │
   └─ else ─→ Web fallback (sandboxed webview + "video-only" CSS/JS)
                   │
                   └─ no <video> found after 10 s → show error "This site can't be played here — open in browser?"
```

Each provider is a small plugin module: `match(url) → bool`, `resolve(url) → PlaybackSource`. New sites = new module, no core changes.

## 5. Technical Design

### 5.1 Stack (recommended)
| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** (latest stable) | Built-in Chromium = same video codecs everywhere; strong always-on-top API; `<webview>` for the fallback |
| UI | React + TypeScript + Vite, Tailwind | Fast to build; small overlay controls |
| Players | HTML5 video, hls.js, dash.js, provider iframes | |
| Storage | `electron-store` (JSON in `%APPDATA%\FloatView`) | Settings + history, local only |
| Packaging | electron-builder, **NSIS per-user installer** | Installs without admin rights (the work PC is non-admin) |

Alternative: **Tauri 2** (uses WebView2, installer ~10 MB vs ~90 MB, less RAM). Trade-off: codec support depends on the system WebView2 and there is no `<webview>` tag, so the web fallback is harder. Choose Tauri only if app size matters more than site coverage.

### 5.2 The "stays on top" part (core requirement)
```ts
win = new BrowserWindow({
  frame: false, transparent: true, alwaysOnTop: true,
  skipTaskbar: false, hasShadow: true,
  webPreferences: { backgroundThrottling: false }   // keep playing when unfocused
});
win.setAlwaysOnTop(true, 'screen-saver');          // above full-screen apps
win.setVisibleOnAllWorkspaces(true);               // follow virtual desktops
```
- Re-apply `setAlwaysOnTop` on `blur` and every 2 s as a guard (some Windows apps steal the top level).
- Click-through: `win.setIgnoreMouseEvents(true, { forward: true })`; a small "unlock" handle stays clickable on hover.
- `powerSaveBlocker.start('prevent-display-sleep')` while playing.

### 5.3 Process layout
```
Main process
 ├─ WindowManager      (create/restore windows, always-on-top guard, snap, bounds memory)
 ├─ HotkeyService      (globalShortcut)
 ├─ TrayService
 ├─ Store              (settings, history)
 └─ ResolverRegistry   (provider modules, optional yt-dlp bridge via child_process)
Renderer (per window)
 ├─ LinkBar            (input, drop zone, recent list)
 ├─ PlayerHost         (NativePlayer | EmbedPlayer | WebFallbackPlayer)
 └─ OverlayControls    (auto-hide after 2 s of no mouse movement)
```

### 5.4 Security
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in every renderer.
- The web fallback runs in a **separate session partition** (`persist:fallback`) so site cookies don't mix with anything else; user can clear it from Settings.
- Block pop-ups and new windows from embedded pages (`setWindowOpenHandler → deny`).
- Only `http/https/file` schemes accepted; reject `javascript:` and others.
- No telemetry, no auto-upload, no crash reporter to external servers. Auto-update **off** by default.

## 6. UX

### Window states
1. **Empty**: small card (360×120) with the link box + recent links.
2. **Playing**: only the video; controls fade in on hover.
3. **Click-through**: video only, 60% opacity by default, small lock icon in the corner.
4. **Mini**: collapses to 240×135 in the nearest corner.

### Default hotkeys (all changeable)
| Hotkey | Action |
|---|---|
| `Ctrl+Alt+Space` | Play / pause |
| `Ctrl+Alt+V` | Show window + focus link box (paste new link) |
| `Ctrl+Alt+T` | Toggle click-through |
| `Ctrl+Alt+↑ / ↓` | Opacity +/- 10% |
| `Ctrl+Alt+← / →` | Seek -/+ 10 s |
| `Ctrl+Alt+H` | Hide / show window |
| `Ctrl+Alt+P` | Toggle always-on-top (pin) |

### Settings screen
Default opacity · default size & corner · start with Windows · hotkeys · yt-dlp path (optional) · clear history · clear fallback cookies.

## 7. Non-functional Requirements
| Area | Requirement |
|---|---|
| Platform | Windows 10/11 x64 first; macOS later |
| Install | Per-user, no admin rights |
| Performance | Hardware video decoding on; idle RAM ≤ 250 MB; start-up ≤ 2 s |
| Reliability | If a stream fails, show a clear message + "Open in browser" button; never a blank window |
| Multi-monitor | Remember the monitor; if it is gone, move the window back to the primary screen |
| DPI | Sharp on 100%–200% scaling |
| Privacy | All data stays in `%APPDATA%\FloatView`; no network calls except the video itself |

## 8. Data Model (local JSON)
```json
{
  "settings": {
    "opacity": 1.0, "clickThroughOpacity": 0.6,
    "defaultCorner": "bottom-right", "defaultSize": [480, 270],
    "alwaysOnTopLevel": "screen-saver", "launchAtLogin": false,
    "hotkeys": { "playPause": "Ctrl+Alt+Space", "...": "..." },
    "ytDlpPath": null
  },
  "window": { "x": 1400, "y": 780, "w": 480, "h": 270, "displayId": 1, "aspect": "16:9" },
  "history": [ { "url": "https://youtu.be/…", "title": "…", "provider": "youtube", "lastPosition": 312, "openedAt": "2026-09-28T09:00:00Z" } ]
}
```
Bonus: `lastPosition` lets a video **resume** where you stopped.

## 9. Test Plan (acceptance)
| # | Test | Pass when |
|---|---|---|
| T1 | Paste YouTube link | Plays ≤ 3 s |
| T2 | Paste `.m3u8` live stream | Plays, live latency shown |
| T3 | Alt+Tab to Chrome, VS Code, Excel | Video still visible on top |
| T4 | Open an app in full screen (F11 browser, full-screen game/PowerPoint) | Video still visible (documented if a specific exclusive-fullscreen game blocks it) |
| T5 | Leave window unfocused 30 min | No pause, no stutter |
| T6 | Click-through on, click the app behind | The click lands in the app behind |
| T7 | Global hotkeys while another app has focus | All work |
| T8 | Unplug second monitor | Window moves to primary screen |
| T9 | Facebook / TikTok public video | Web fallback shows only the video |
| T10 | Broken link / private video | Clear error + "Open in browser" |
| T11 | Install on non-admin account | Installs and runs |

## 10. Known Risks
| Risk | Mitigation |
|---|---|
| Sites change their HTML → web fallback breaks | Per-site CSS/JS rules in separate files, easy to update; yt-dlp as backup |
| YouTube blocks some videos from embedding ("Video unavailable") | Fall back to full-page mode for that video |
| Exclusive full-screen games draw over everything | Out of our control; document it (borderless-window games are fine) |
| Embedding sites may conflict with their Terms of Service | Personal use only; no downloading; no ad blocking by default |
| DRM sites won't play | Out of scope; show a clear message |

## 11. Milestones
| Phase | Content | Estimate |
|---|---|---|
| M1 | Electron shell: floating window, always-on-top guard, drag/resize, tray | 1–2 days |
| M2 | Native player (MP4/HLS/DASH) + YouTube/Vimeo/Twitch embed | 2 days |
| M3 | Controls overlay, opacity, click-through, global hotkeys | 2 days |
| M4 | Web fallback + FB/TikTok/X rules, optional yt-dlp | 2–3 days |
| M5 | Settings, history + resume, multi-monitor, per-user installer, test pass (§9) | 2 days |
| **Total MVP** | | **~9–11 days** |

## 12. Open Questions (for Alex)
1. Is this for **personal use** only, or will other people / customers use it? (affects signing, auto-update, branding)
2. Do you need **Netflix/Disney+-type (DRM) sites**? If yes, we need the castLabs Electron build + Widevine — adds work.
3. Do you want **several videos at once** in v1, or is one enough?
4. **Electron** (best site coverage, ~90 MB) or **Tauri** (small, ~10 MB, fewer sites)? Recommendation: Electron.
5. Any name preference instead of "FloatView"?
