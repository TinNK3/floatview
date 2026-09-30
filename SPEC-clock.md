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

### 4.1 Behavior
```
 Focus (25) → Short break (5) → Focus → Short break → Focus → Short break → Focus → Long break (15) → repeat
                                                                         └── "Rounds before long break" = 4
```
| Setting | Range | Default |
|---|---|---|
| Focus length | 5–120 min | 25 |
| Short break | 1–30 min | 5 |
| Long break | 5–60 min | 15 |
| Rounds before long break | 2–8 | 4 |
| Auto-start breaks | on / off | on |
| Auto-start next focus | on / off | off (you press Start after a break) |
| Pause video during breaks | on / off | on |
| Presets | *Classic 25/5*, *Deep work 50/10*, *Short 15/3*, + save your own | Classic |

- Controls: **Start / Pause / Skip / Reset**, from the clock screen, the tray, and hotkeys.
- Round dots show progress (● ● ○ ○).
- A soft sound plays at each phase change (you choose the sound per event, see §6).
- The tray tooltip shows the time left (e.g. "Focus · 12:40 left").

## 5. Move reminder (stand up / stretch)

This is **separate from Pomodoro**. It watches how long you have been sitting, whether or not a Pomodoro is running.

| Setting | Range | Default |
|---|---|---|
| Remind me every | 15–180 min of sitting | 50 min |
| Break length (short break) | 1–20 min | 3 min |
| Active hours | e.g. 08:00–18:00, weekdays only | always |
| What to show | random stretch from a built-in list / your own list / just "Stand up" | built-in list |
| Snooze | 5 / 10 min, max 2 snoozes in a row | 5 min |
| Strict mode | the break screen can't be closed until the countdown ends (Skip is hidden) | off |
| Pause video during move break | on / off | on |

### 5.1 How "sitting time" is counted
- The sitting clock runs while you use the PC.
- **Idle = away.** If Windows reports no mouse or keyboard input for ≥ the break length (e.g. 3 min), FloatView counts that as a break you already took and **resets the sitting clock**. Coming back from lock or sleep also resets it.
- A finished Pomodoro break also resets it. The two timers never nag you twice for the same break.
- If a Pomodoro break is due within 5 minutes, the move reminder waits and merges into that break.

### 5.2 What happens when it's time to move
1. A sound plays (your chosen "Move" sound).
2. The FloatView window comes forward. If it is hidden or in mini/click-through mode, it opens a **Break screen** in the middle of the screen (about 480×300, always on top).
3. A Windows notification appears too, in case the window is covered by an exclusive full-screen game.
4. The Break screen shows: **"Time to stand up 🧍"**, a stretch suggestion (e.g. *"Roll your shoulders 10×"*), and buttons **Start break (3:00)** · **Snooze 5 min** · **Skip**.
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
    "pomodoro": { "focus": 25, "short": 5, "long": 15, "rounds": 4, "autoBreak": true, "autoFocus": false,
                  "pauseVideo": true, "preset": "classic", "custom": [] },
    "move":     { "enabled": true, "every": 50, "breakMin": 3, "activeHours": null, "snoozeMin": 5,
                  "maxSnoozes": 2, "strict": false, "pauseVideo": true, "tips": "builtin", "customTips": [] },
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

1. **Defaults:** is **50 min sitting → 3 min move break** right for you, or something else (e.g. 45/5)?
2. **Strict mode:** off by default. Do you want it on?
3. **Break screen:** a small card in the middle of the screen (default), or **dim the whole screen** behind it so it's impossible to ignore?
4. **Active hours:** should reminders stop outside work hours? Your hours are 2–11 PM PT, so maybe 14:00–23:00?
5. **Second clock:** would a second time zone help (e.g. Vietnam time next to PT)? Not included yet.
