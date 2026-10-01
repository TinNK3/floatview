// Playlist ("Up next") helpers: validation of the saved queue, expanding dropped folders,
// and reading a site's playlist/album through yt-dlp. Pure Node, no Electron.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { nativeFormat, normalize } = require('./resolver');

const MAX_ITEMS = 500;
const DEFAULT_QUEUE = { items: [], index: -1, repeat: 'off', shuffle: false, autoNext: true, suggest: true };

const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

function cleanUrl(v) {
  if (typeof v !== 'string' || v.length > 4096) return null;
  try {
    const u = normalize(v);
    if (u.protocol === 'file:' && u.hostname) return null; // file://server/share: network path
    return u.toString();
  } catch { return null; }
}

function sanitizeQueue(q, cur = DEFAULT_QUEUE) {
  if (!q || typeof q !== 'object') return cur;
  if (!Array.isArray(q.items)) return { ...DEFAULT_QUEUE, ...cur, items: Array.isArray(cur.items) ? cur.items : [] };
  const mapped = q.items.map((it) => {
    const url = cleanUrl(it?.url);
    return url ? { url, title: cleanText(it.title, 200) } : null;
  });
  // The index must keep pointing at the same video after bad items are dropped.
  let index = -1;
  if (Number.isInteger(q.index) && q.index >= 0 && q.index < mapped.length && mapped[q.index]) {
    index = mapped.slice(0, q.index).filter(Boolean).length;
  }
  const items = mapped.filter(Boolean).slice(0, MAX_ITEMS);
  if (index >= items.length) index = -1;
  return {
    items,
    index,
    repeat: ['off', 'all', 'one'].includes(q.repeat) ? q.repeat : (cur.repeat || 'off'),
    shuffle: typeof q.shuffle === 'boolean' ? q.shuffle : !!cur.shuffle,
    autoNext: typeof q.autoNext === 'boolean' ? q.autoNext : cur.autoNext !== false,
    suggest: typeof q.suggest === 'boolean' ? q.suggest : cur.suggest !== false, // end of list: keep going with YouTube suggestions
  };
}

// "Episode 2" before "Episode 10".
const naturalCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const isMediaFile = (p) => {
  try { return !!nativeFormat(pathToFileURL(p)); } catch { return false; }
};

// Dropped files and folders -> playable files. Folders are read one level deep, in name order.
function expandPaths(paths) {
  const out = [];
  for (const p of Array.isArray(paths) ? paths.slice(0, MAX_ITEMS) : []) {
    // Local drives only: a \\server\share path would make Windows log in to that server.
    if (typeof p !== 'string' || !path.isAbsolute(p) || /^[\\/]{2}/.test(p)) continue;
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      let entries = [];
      try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { continue; }
      // Name check first (no disk access per file), then sort only the media files.
      const media = entries.filter((d) => d.isFile() && isMediaFile(path.join(p, d.name))).map((d) => d.name).sort(naturalCompare);
      for (const n of media) {
        out.push(path.join(p, n));
        if (out.length >= MAX_ITEMS) break;
      }
    } else if (st.isFile() && isMediaFile(p)) out.push(p);
    if (out.length >= MAX_ITEMS) break;
  }
  return out.slice(0, MAX_ITEMS).map((f) => ({ url: pathToFileURL(f).toString(), title: path.basename(f) }));
}

// A link that probably is a list of videos (worth asking yt-dlp about).
// Only real playlist / album pages, not whole channels or any /videos/ page.
const looksLikePlaylist = (url) => /[?&]list=|\/playlists?\/|\/playlist\b|\/albums?\/|\/showcase\/|\/sets\/|\/series\//i.test(url);

function parseFlatPlaylist(json) {
  let data;
  try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch { return []; }
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  return entries.map((e) => {
    let url = e?.webpage_url || e?.url;
    if (url && !/^https?:\/\//.test(url) && e?.ie_key === 'Youtube' && /^[\w-]{11}$/.test(e.id || '')) url = `https://www.youtube.com/watch?v=${e.id}`;
    url = cleanUrl(url);
    return url && /^https?:/.test(url) ? { url, title: cleanText(e.title, 200) } : null;
  }).filter(Boolean).slice(0, MAX_ITEMS);
}

function ytDlpPlaylist(exe, url, timeoutMs = 25000) {
  return new Promise((resolve) => {
    if (!exe) return resolve([]);
    execFile(exe, ['--flat-playlist', '-J', '--no-warnings', '--playlist-end', String(MAX_ITEMS), url],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => resolve(err ? [] : parseFlatPlaylist(stdout)));
  });
}

module.exports = { DEFAULT_QUEUE, MAX_ITEMS, sanitizeQueue, expandPaths, looksLikePlaylist, parseFlatPlaylist, ytDlpPlaylist, naturalCompare };
