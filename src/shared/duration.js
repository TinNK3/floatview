// Parse and format durations typed by people. Shared by the renderer (script tag) and main/tests (require).
//   parseDuration('25') -> 1500      bare number = minutes
//   '25m' '90s' '1h' '1h20m' '1h 20m 5s'
//   '1:30' -> 90 (m:ss)   '1:20:00' -> 4800 (h:mm:ss)   '2.5' -> 150
// Returns seconds (integer) or null when the text is not a valid duration.
(function (root) {
  const MIN_SEC = 10;
  const MAX_SEC = 8 * 3600;

  function parseDuration(input, { min = MIN_SEC, max = MAX_SEC } = {}) {
    if (typeof input === 'number') return inRange(Math.round(input * 60), min, max);
    const s = String(input ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    let sec = null;

    if (/^\d+(\.\d+)?$/.test(s)) {
      sec = Math.round(parseFloat(s) * 60);
    } else if (/^\d{1,3}:\d{2}$/.test(s)) {
      const [m, ss] = s.split(':').map(Number);
      if (ss < 60) sec = m * 60 + ss;
    } else if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) {
      const [h, m, ss] = s.split(':').map(Number);
      if (m < 60 && ss < 60) sec = h * 3600 + m * 60 + ss;
    } else {
      const m = s.match(/^(?:(\d+(?:\.\d+)?) ?h(?:ours?|rs?)?)? ?(?:(\d+(?:\.\d+)?) ?m(?:in(?:utes?|s)?)?)? ?(?:(\d+) ?s(?:ec(?:onds?|s)?)?)?$/);
      if (m && (m[1] || m[2] || m[3])) {
        sec = Math.round((parseFloat(m[1] || 0) * 3600) + (parseFloat(m[2] || 0) * 60) + Number(m[3] || 0));
      }
    }
    return sec === null ? null : inRange(sec, min, max);
  }

  function inRange(sec, min, max) {
    return Number.isFinite(sec) && sec >= min && sec <= max ? sec : null;
  }

  // 1500 -> '25:00', 4800 -> '1:20:00', 45 -> '0:45'
  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  // Friendly label: 1500 -> '25 min', 90 -> '1 min 30 s', 20 -> '20 s', 5400 -> '1 h 30 min'
  function describeDuration(sec) {
    sec = Math.round(sec || 0);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return [h && `${h} h`, m && `${m} min`, s && `${s} s`].filter(Boolean).join(' ') || '0 s';
  }

  const api = { parseDuration, formatDuration, describeDuration, MIN_SEC, MAX_SEC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Duration = api;
})(typeof window !== 'undefined' ? window : globalThis);
