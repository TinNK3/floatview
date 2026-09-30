# FloatView — Flip Clock, Pomodoro & Move Reminders · Specification v0.1

> Add-on to [SPEC.md](SPEC.md). Status: **Draft — waiting for Alex's review before any code.**
> Date: 2026-09-29 · Target version: 0.2.0

---

## 1. Problem & Goal

Alex works long hours at the desk. FloatView already keeps a video on top. Now it should also:
1. **Show the time** as a flip clock: on top of the video, or on its own.
2. **Run a Pomodoro timer** for focus sessions.
3. **Remind him to stand up and move** after sitting too long, with a break length he chooses and a sound he picks.

### Success criteria
- Switching between the 3 view modes takes **one click or one hotkey**.
- A move reminder **never gets missed**: sound + the window comes forward + a Windows notification, even when FloatView is hidden or in click-through mode.
- Timers stay **accurate to ±1 s over 8 hours**, even when the PC is busy or the window is hidden.
- Everything stays **local**: no account, no network, and sounds are built in or chosen from your own files.

## 2. The three view modes

| Mode | What you see | Typical use |
|---|---|---|
| **Video** | Video only (today's behavior) | Just watching |
| **Video + Clock** | Video with a clock on top of it | Watching while keeping an eye on the time |
| **Clock** | Clock only, in its own screen | Focus work, Pomodoro, a desk clock |

- Switch modes with a new top-bar button, the tray menu, or `Ctrl+Alt+C` (cycles Video → Video+Clock → Clock).
- In **Clock** mode the video **keeps playing in the background** (audio stays on) unless *Pause video in Clock mode* is set. Switching back shows it again. With no video open, Clock mode works on its own.
- Each mode remembers its own window size and position. For example, Clock mode can be a small 320×120 strip, and Video mode can be 960×540.

## 3. Flip clock

### 3.1 Clock styles
| Style | Look | Works in |
|---|---|---|
| **Flip cards** | Classic split-flap cards; the top half flips down on each change | Video+Clock, Clock |
| **Text only** | Just the digits with a soft shadow, **no background**, sitting on the video | Video+Clock (made for this), Clock |
| **Minimal** | Thin, large digits on a plain background | Clock |
| **Timer focus** | Big Pomodoro countdown with a small clock under it | Clock |

### 3.2 What you can customize
| Option | Choices | Default |
|---|---|---|
| Format | 24 h / 12 h (AM/PM) | 24 h |
| Seconds | show / hide | hide |
| Date line | off / "Mon 29 Sep" / full date | off |
| Theme | Dark, Light, Accent (blue), OLED black, custom colors (card, digit, background) | Dark |
| Font | 4 built-in, locally bundled free fonts (e.g. Inter, JetBrains Mono, Bebas Neue, Space Grotesk — all OFL) | JetBrains Mono |
| Size (overlay) | S / M / L / XL, or drag to scale | M |
| Position (overlay) | 9 anchor points (corners, edges, center) or free drag; snaps to the anchors | top-right |
| Opacity (overlay) | 20–100 % | 85 % |
| Flip animation | on / off (off automatically if Windows "reduce motion" is on) | on |
| Tick sound | off / soft tick each second or minute | off |
| Show timer in overlay | none / Pomodoro countdown / sitting time | Pomodoro countdown when a timer is running |

- In **Video + Clock**, the clock never blocks the controls. It sits above the video, below the top bar and the bottom controls. It hides on hover **only if** *Hide clock on hover* is on (default off).
- In **Clock** mode the whole window is the clock. You drag it by any empty area, and the digits scale with the window size.

## 4. Pomodoro

### 4.0 Rule for every time setting in this spec
**Nothing is fixed.** Every duration and count (Pomodoro, move reminder, snooze, idle, repeats) works the same way:
1. **Follow the default.** Out of the box it uses the default in the tables below. A **"Reset to default"** link sits next to each field.
2. **Pick a preset.** One click on a chip (e.g. *25/5*, *50/10*, *90/20*) fills all the fields at once.
3. **Type any value.** Free input in the field; see §4.3 for the accepted formats.

The limits are only there to catch typos: **any value from 10 seconds to 8 hours** is accepted. Values outside that range are rejected with a short message, not silently changed.

### 4.1 Behavior
```
 Focus (25) → Short break (5) → Focus → Short break → Focus → Short break → Focus → Long break (15) → repeat
                                                                         └── "Rounds before long break" = 4
```
| Setting | Allowed | Default (just a starting point) |
|---|---|---|
| Focus length | any, 10 s – 8 h | 25 min |
| Short break | any, 10 s – 8 h | 5 min |
| Long break | any, 10 s – 8 h, or **off** (never a long break) | 15 min |
| Rounds before long break | any, 1–99 | 4 |
| Auto-start breaks | on / off | on |
| Auto-start next focus | on / off | off (you press Start after a break) |
| Pause video during breaks | on / off | on |

**Presets** (one click fills focus / short / long / rounds):
| Preset | Focus | Short | Long | Rounds |
|---|---|---|---|---|
| **Default** (Classic) | 25 min | 5 | 15 | 4 |
| Deep work | 50 min | 10 | 30 | 3 |
| Quick | 15 min | 3 | 10 | 4 |
| Ultradian | 90 min | 20 | off | – |
| **+ Save current as preset…** | your values, your name (e.g. "Coding 40/8") | | | |

- Your own presets can be renamed, edited, deleted, and set as **your default**. Then "Reset to default" goes back to *your* default instead of 25/5.
- **Change just this round:** while a timer runs, `+1 min` / `+5 min` / `−1 min` buttons adjust the current phase only. The saved settings stay the same.

### 4.3 How you enter a time (all time fields)
- Type it naturally. All of these are accepted and shown back as `mm:ss` / `h:mm:ss`:
  `25` (= 25 min) · `25m` · `90s` · `1:30` (= 1 min 30 s) · `1h` · `1h20m` · `1:20:00` · `2.5` (= 2 min 30 s)
- **▲ / ▼** buttons and the mouse wheel step by 1 min. Hold **Shift** to step by 5 min, or **Alt** to step by 10 s.
- Invalid text (e.g. `abc`, `0`, `9h`) shows a red hint under the field and keeps the last valid value.

### 4.4 Controls
- Controls: **Start / Pause / Skip / Reset**, from the clock screen, the tray, and hotkeys.
- Round dots show progress (● ● ○ ○).
- A soft sound plays at each phase change (you choose the sound per event, see §6).
- The tray tooltip shows the time left (e.g. "Focus · 12:40 left").

## 5. Move reminder (stand up / stretch)

This is **separate from Pomodoro**. It watches how long you have been sitting, whether or not a Pomodoro is running.

Same rule as §4.0: follow the default, pick a preset, or type any value.

| Setting | Allowed | Default (just a starting point) |
|---|---|---|
| Remind me after sitting | any, 1 min – 8 h | 50 min |
| Move break length | any, 10 s – 8 h | 3 min |
| Snooze length | any, 10 s – 2 h | 5 min |
| Snoozes allowed in a row | 0 (no snooze) – 99, or unlimited | 2 |
| Away time that counts as a break | any, 10 s – 2 h, or "same as break length" | same as break length |
| Repeat the sound if I don't react | every any 5 s – 10 min, up to any count, or off | every 30 s, 5 times |
| Active hours | any days + any time ranges (several allowed, e.g. 09:00–12:00 and 13:00–18:00), or always | always |
| What to show | random stretch from a built-in list / your own list / just "Stand up" | built-in list |
| Strict mode | the break screen can't be closed until the countdown ends (Skip is hidden) | off |
| Pause video during move break | on / off | on |

**Presets:**
| Preset | Sit | Move break |
|---|---|---|
| **Default** | 50 min | 3 min |
| Eye rest (20-20-20) | 20 min | 20 s |
| Pomodoro-style | 25 min | 5 min |
| Hourly stretch | 60 min | 5 min |
| **+ Save current as preset…** | your values | |

- Like Pomodoro, your own presets can be saved, named, and set as **your default**.

### 5.1 How "sitting time" is counted
- The sitting clock runs while you use the PC.
- **Idle = away.** If Windows reports no mouse or keyboard input for at least the *away time* setting (default: the same as the break length, e.g. 3 min), FloatView counts that as a break you already took and **resets the sitting clock**. Coming back from lock or sleep also resets it.
- A finished Pomodoro break also resets it. The two timers never nag you twice for the same break.
- If a Pomodoro break is due within the *merge window* (any value, default 5 min, or off), the move reminder waits and merges into that break.

### 5.2 What happens when it's time to move
1. A sound plays (your chosen "Move" sound).
2. The FloatView window comes forward. If it is hidden or in mini/click-through mode, it opens a **Break screen** in the middle of the screen (about 480×300, always on top).
3. A Windows notification appears too, in case the window is covered by an exclusive full-screen game.
4. The Break screen shows: **"Time to stand up 🧍"**, a stretch suggestion (e.g. *"Roll your shoulders 10×"*), and buttons **Start break (3:00)** · **Snooze 5 min** · **Skip**. The numbers on the buttons follow your settings, and **−/+** next to the countdown lets you change *this* break only.
5. During the break: a big countdown, and the video is paused. At the end, a "Back to work" sound plays, the window returns to where it was, and the video resumes if it was playing.

### 5.3 Built-in stretch list (editable)
About 20 short, safe suggestions such as: stand and look 20 m away for 20 s (eye rest) · roll shoulders · neck side stretch · wrist circles · walk and get water · 10 calf raises · chest opener · touch toes gently. You can add, edit or remove items in Settings.

## 6. Sounds

- **Built-in sounds are synthesized in the app** (Web Audio): *Soft chime, Bell, Wood block, Digital beep, Rising tone, Gentle marimba, Tick*. No downloaded audio files, so there are no licensing issues and no network use.
- **Your own sounds:** add `.mp3 / .wav / .ogg` (≤ 5 MB each). They are copied into `%APPDATA%\FloatView\sounds`, so they keep working if the original file moves.
- You pick a sound for each event: **Focus start · Focus end · Break start · Break end · Move reminder · Tick**. Each one can be *None*.
- Volume per sound plus a master volume, with a **▶ Preview** button next to each.
- *Repeat until acknowledged* (on/off) for the Move reminder: it plays again every 30 s until you react, up to 5 times.
- Timer sounds play **even when the video is muted**, and they briefly lower the video's volume while they play ("ducking", on by default).

## 7. Stats (small and local)

- Today: focus sessions done, focus minutes, move breaks taken / snoozed / skipped, longest sitting stretch.
- A 7-day mini bar chart in Settings → Stats.
- Stored locally; **Reset stats** button.

## 8. Hotkeys (new, changeable)

| Hotkey | Action |
|---|---|
| `Ctrl+Alt+C` | Cycle view mode: Video → Video+Clock → Clock |
| `Ctrl+Alt+S` | Pomodoro start / pause |
| `Ctrl+Alt+B` | Take a move break now |
| `Ctrl+Alt+N` | Snooze the current reminder |

## 9. Technical design

### 9.1 Where the timers live
- **All timers run in the main process** as a small state machine (`src/main/timers.js`), based on **deadlines** (`endsAt = Date.now() + ms`) rather than counting ticks. That keeps them accurate when the window is hidden, the renderer is busy, or the PC was asleep.
- Sitting and idle detection use Electron's `powerMonitor.getSystemIdleTime()`, checked every 15 s, plus the `lock-screen`, `unlock-screen`, `suspend` and `resume` events.
- The main process sends `timer-state` to the renderer every second, and immediately on each phase change. The renderer only draws it.

### 9.2 New files
```
src/main/timers.js          Pomodoro + Move state machines (pure, unit-tested with a fake clock)
src/main/stats.js           daily counters
src/renderer/clock/         flip-clock.js, clock.css, fonts/ (bundled, OFL)
src/renderer/break.html     break screen (own small window, reuses the preload)
src/renderer/sounds.js      Web Audio synth presets + custom file playback + ducking
```

### 9.3 Flip animation
- Pure CSS 3D: each digit has 4 halves (top/bottom × current/next), and the top half rotates -90° over 300 ms, then the bottom half.
- Only changed digits flip. With *Reduce motion* on, digits cross-fade instead.

### 9.4 Windows
- **Main window**: gets a `viewMode` state (`video | video-clock | clock`), and each mode keeps its own saved bounds and aspect-ratio rule (Clock = free, or a clock ratio).
- **Break window**: a separate always-on-top, frameless, focusable window created only while a reminder or break is active. It uses the same security settings as the main window (sandbox, context isolation, no webview).

### 9.5 Data model additions
```json
{
  "settings": {
    "viewMode": "video",
    "clock":    { "style": "flip", "hour12": false, "seconds": false, "date": "off", "theme": "dark",
                  "font": "jetbrains-mono", "overlay": { "size": "M", "anchor": "top-right", "opacity": 0.85,
                  "hideOnHover": false, "showTimer": "pomodoro" }, "animate": true, "tick": "off" },
    // all durations stored in SECONDS, so any value (e.g. 90 s) is exact
    "pomodoro": { "focusSec": 1500, "shortSec": 300, "longSec": 900, "rounds": 4, "autoBreak": true, "autoFocus": false,
                  "pauseVideo": true, "preset": "default", "userDefault": null,
                  "presets": [ { "id": "…", "name": "Coding 40/8", "focusSec": 2400, "shortSec": 480, "longSec": 1200, "rounds": 3 } ] },
    "move":     { "enabled": true, "sitSec": 3000, "breakSec": 180, "snoozeSec": 300, "maxSnoozes": 2,
                  "awaySec": null, "mergeSec": 300, "repeat": { "everySec": 30, "times": 5 },
                  "activeHours": null, "strict": false, "pauseVideo": true, "tips": "builtin", "customTips": [],
                  "preset": "default", "userDefault": null, "presets": [] },
    "sounds":   { "master": 0.8, "duck": true, "repeatMove": true,
                  "events": { "focusStart": "chime", "focusEnd": "bell", "breakStart": "marimba",
                              "breakEnd": "rising", "move": "bell", "tick": null },
                  "custom": [ { "id": "…", "name": "my-gong.mp3", "file": "sounds/…" } ] }
  },
  "stats": { "2026-09-29": { "focusSessions": 6, "focusMin": 150, "moveTaken": 4, "moveSnoozed": 1, "moveSkipped": 0, "longestSitMin": 72 } }
}
```

### 9.6 Notifications
- Electron `Notification` shows a **local Windows toast** with no network use. Clicking it opens the Break screen.

## 10. Test plan (acceptance)

| # | Test | Pass when |
|---|---|---|
| C1 | `Ctrl+Alt+C` three times | Cycles through all 3 modes and returns to Video; video keeps playing |
| C2 | Video+Clock, "Text only" style | Digits over the video with a transparent background; controls still clickable |
| C3 | Flip animation | Only the changed digits flip; none when Reduce motion is on |
| C4 | Pomodoro with test durations (focus 6 s, break 3 s) | Correct phase order incl. long break after N rounds; sounds fire per event |
| C5 | Hide window for 10 min, then show | Timer shows the right time left (no drift) |
| C6 | Move reminder at 1 min (test) | Sound + break screen + toast; video pauses, then resumes after the break |
| C7 | Fake 4 min of idle | Sitting clock resets; no reminder |
| C8 | Snooze twice, then reminder | 3rd prompt has no Snooze button |
| C9 | Strict mode | Break screen can't be closed until the countdown ends |
| C10 | Custom sound file | Copied into app data; plays after the original is deleted |
| C11 | PC sleeps mid-focus | On resume the timer is correct and the sitting clock resets |
| C12 | Unit: timer state machine | All transitions covered with a fake clock (focus/break/long/skip/pause/reset/idle/merge) |
| C13 | Unit: time input parser | `25`, `25m`, `90s`, `1:30`, `1h20m`, `1:20:00`, `2.5` parse right; `abc`, `0`, `9h` rejected |
| C14 | Custom values end to end | Focus 7 s / break 4 s / rounds 1 / long off, and move sit 5 s / break 3 s run exactly as typed |
| C15 | Save preset + set as my default | Survives restart; "Reset to default" returns to *my* default |

## 11. Risks

| Risk | Mitigation |
|---|---|
| Reminders get annoying and you start ignoring them | Snooze limit, active hours, idle auto-reset, merge with Pomodoro breaks |
| Exclusive full-screen apps cover the break screen | Windows toast + sound as backup |
| Timers drift or stop when the window is hidden | Deadline-based timers in the main process (§9.1) |
| Bundled fonts add size | 4 fonts, woff2, Latin subset ≈ 200 KB total |
| Health advice | Stretch tips are general and gentle; no medical claims |

## 12. Milestones

| Phase | Content | Estimate |
|---|---|---|
| M1 | View modes + flip clock (styles, customization, overlay positions) | 1.5 days |
| M2 | Timer engine (Pomodoro + Move + idle), unit tests | 1 day |
| M3 | Break screen, notifications, video pause/resume | 1 day |
| M4 | Sounds (synth presets, custom files, per-event, ducking), settings UI | 1 day |
| M5 | Stats, hotkeys, smoke tests C1–C11, installer 0.2.0 | 1 day |
| **Total** | | **~5–6 days** |

## 13. Open questions (answers change the build)

1. ~~Defaults~~: **decided 2026-09-29.** All times are user-set (default, preset, or any value; §4.0). The shipped defaults stay 25/5/15×4 and 50→3.
2. **Strict mode:** off by default. Do you want it on?
3. **Break screen:** a small card in the middle of the screen (default), or **dim the whole screen** behind it so it's impossible to ignore?
4. **Active hours:** should reminders stop outside work hours? Your hours are 2–11 PM PT, so maybe 14:00–23:00?
5. **Second clock:** would a second time zone help (e.g. Vietnam time next to PT)? Not included yet.
