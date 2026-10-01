// YouTube helpers for "Up next": read the suggestions (and a Mix list) from a watch page,
// and the list of ad / ad-tracking addresses FloatView blocks.
// No API key, no sign-in: the same public page a browser gets.

// 11 characters, but not "videoseries" (the playlist embed), which happens to be 11 long too
const VIDEO_ID = /^(?!videoseries$)[\w-]{11}$/;

function videoIdFrom(input) {
  if (typeof input !== 'string') return null;
  if (VIDEO_ID.test(input)) return input;
  try {
    const u = new URL(input);
    if (!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(u.hostname)) return null;
    if (u.hostname.endsWith('youtu.be')) { const id = u.pathname.slice(1).split('/')[0]; return VIDEO_ID.test(id) ? id : null; }
    const v = u.searchParams.get('v');
    if (VIDEO_ID.test(v || '')) return v;
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})(?:$|[/?])/);
    return m && VIDEO_ID.test(m[1]) ? m[1] : null;
  } catch { return null; }
}

// The page embeds its data as `var ytInitialData = {...};`
function initialData(html) {
  if (typeof html !== 'string') return null;
  const start = html.indexOf('ytInitialData = ');
  if (start < 0) return null;
  const from = html.indexOf('{', start);
  const end = html.indexOf(';</script>', from);
  if (from < 0 || end < 0) return null;
  try { return JSON.parse(html.slice(from, end)); } catch { return null; }
}

// Walk the whole object (YouTube moves things around often; don't depend on exact paths).
function walk(node, visit, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 60) return;
  visit(node);
  for (const v of Array.isArray(node) ? node : Object.values(node)) walk(v, visit, depth + 1);
}

const text = (t) => (typeof t === 'string' ? t : t?.content ?? t?.simpleText ?? (Array.isArray(t?.runs) ? t.runs.map((r) => r.text).join('') : ''));

// Suggested videos ("Up next" column on youtube.com). Old and new (lockup) page formats.
function suggestions(data, { exclude = null, limit = 40 } = {}) {
  const out = [];
  const seen = new Set(exclude ? [exclude] : []);
  const add = (id, title) => {
    if (!VIDEO_ID.test(id || '') || seen.has(id) || out.length >= limit) return;
    seen.add(id);
    out.push({ url: `https://www.youtube.com/watch?v=${id}`, title: String(title || '').trim().slice(0, 200) });
  };
  const results = data?.contents?.twoColumnWatchNextResults?.secondaryResults ?? data;
  walk(results, (n) => {
    const lv = n.lockupViewModel;
    if (lv && lv.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') add(lv.contentId, text(lv.metadata?.lockupMetadataViewModel?.title));
    const cv = n.compactVideoRenderer;
    if (cv) add(cv.videoId, text(cv.title));
  });
  return out;
}

// The videos of a Mix / playlist shown in the side panel of a watch?v=…&list=… page.
function panelPlaylist(data, { limit = 200 } = {}) {
  const out = [];
  const seen = new Set();
  walk(data?.contents?.twoColumnWatchNextResults?.playlist ?? null, (n) => {
    const p = n.playlistPanelVideoRenderer;
    if (p && VIDEO_ID.test(p.videoId || '') && !seen.has(p.videoId) && out.length < limit) {
      seen.add(p.videoId);
      out.push({ url: `https://www.youtube.com/watch?v=${p.videoId}`, title: text(p.title).slice(0, 200) });
    }
  });
  return out;
}

// Ad and ad-tracking addresses (YouTube + the usual ad networks on web pages).
// Electron URL-pattern syntax: scheme://host/path with * wildcards.
const AD_PATTERNS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://imasdk.googleapis.com/*',
  '*://*.youtube.com/api/stats/ads*',
  '*://*.youtube.com/pagead/*',
  '*://*.youtube.com/ptracking*',
  '*://*.youtube.com/get_midroll_info*',
  '*://*.youtube-nocookie.com/api/stats/ads*',
  '*://*.youtube-nocookie.com/pagead/*',
  '*://*.youtube-nocookie.com/ptracking*',
  '*://*.adnxs.com/*',
  '*://*.amazon-adsystem.com/*',
  '*://*.taboola.com/*',
  '*://*.outbrain.com/*',
];

module.exports = { videoIdFrom, initialData, suggestions, panelPlaylist, AD_PATTERNS };
