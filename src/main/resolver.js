// Turns a pasted link into a PlaybackSource the renderer knows how to play.
//   { kind: 'native', url, format: 'file' | 'hls' | 'dash', title }
//   { kind: 'embed',  url, provider, title }     -> loaded top-level in a <webview>
//   { kind: 'web',    url, title }               -> full page in a <webview> + video-only script
const { execFile } = require('node:child_process');
const path = require('node:path');

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'file:']);

function normalize(input) {
  let text = String(input || '').trim();
  if (!text) throw new Error('Empty link');
  // Windows path pasted directly, e.g. C:\Videos\a.mp4
  if (/^[a-zA-Z]:[\\/]/.test(text)) text = 'file:///' + text.replace(/\\/g, '/');
  // Bare domain, e.g. youtu.be/abc
  else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) text = 'https://' + text;
  const url = new URL(text);
  if (!ALLOWED_SCHEMES.has(url.protocol)) throw new Error(`Links starting with "${url.protocol}" are not allowed`);
  return url;
}

function nativeFormat(url) {
  const p = url.pathname.toLowerCase();
  if (p.endsWith('.m3u8')) return 'hls';
  if (p.endsWith('.mpd')) return 'dash';
  if (/\.(mp4|m4v|webm|mov|ogv|ogg|mp3|m4a|wav|opus|flac)$/.test(p)) return 'file';
  return null;
}

function fileTitle(url) {
  return decodeURIComponent(path.posix.basename(url.pathname)) || url.hostname;
}

// ---- Provider modules: match(url) -> bool, resolve(url) -> source -------------

const youtube = {
  name: 'youtube',
  match: (u) => /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(u.hostname),
  id(u) {
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1).split('/')[0];
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/);
    return m ? m[1] : null;
  },
  resolve(u, { startAt = 0 } = {}) {
    const id = this.id(u);
    if (!id) return null; // channel page, search page... -> fall through to web mode
    const t = startAt || parseTime(u.searchParams.get('t') || u.searchParams.get('start'));
    // controls=0: FloatView draws its own controls; two control bars would overlap.
    const q = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0', modestbranding: '1', controls: '0', iv_load_policy: '3' });
    if (t) q.set('start', String(Math.floor(t)));
    const list = u.searchParams.get('list');
    if (list) q.set('list', list);
    return { kind: 'embed', provider: 'youtube', url: `https://www.youtube-nocookie.com/embed/${id}?${q}` };
  },
};

const vimeo = {
  name: 'vimeo',
  match: (u) => /(^|\.)vimeo\.com$/.test(u.hostname),
  resolve(u) {
    const m = u.pathname.match(/(?:^|\/)(\d{5,})(?:\/([0-9a-f]{6,}))?/);
    if (!m) return null;
    const q = new URLSearchParams({ autoplay: '1', controls: '0', title: '0', byline: '0', portrait: '0' });
    if (m[2]) q.set('h', m[2]);
    return { kind: 'embed', provider: 'vimeo', url: `https://player.vimeo.com/video/${m[1]}?${q}` };
  },
};

const twitch = {
  name: 'twitch',
  match: (u) => /(^|\.)twitch\.tv$/.test(u.hostname) && !u.hostname.startsWith('player.'),
  resolve(u) {
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    const q = new URLSearchParams({ parent: 'twitch.tv', autoplay: 'true', muted: 'false' });
    if (parts[0] === 'videos' && parts[1]) q.set('video', parts[1]);
    else if (parts[1] === 'clip' && parts[2]) {
      return { kind: 'embed', provider: 'twitch', url: `https://clips.twitch.tv/embed?clip=${parts[2]}&parent=twitch.tv&autoplay=true` };
    } else q.set('channel', parts[0]);
    return { kind: 'embed', provider: 'twitch', url: `https://player.twitch.tv/?${q}` };
  },
};

const PROVIDERS = [youtube, vimeo, twitch];

function parseTime(v) {
  if (!v) return 0;
  if (/^\d+$/.test(v)) return Number(v);
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

// ---- yt-dlp bridge (optional, local exe only) ---------------------------------

function ytDlp(exe, url, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(exe, ['-g', '-f', 'b', '--no-playlist', '--no-warnings', '-e', url],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        const streamUrl = lines.find((l) => /^https?:\/\//.test(l));
        if (!streamUrl) return resolve(null);
        const title = lines.find((l) => !/^https?:\/\//.test(l));
        let format = 'file';
        try { format = nativeFormat(new URL(streamUrl)) || (/m3u8/.test(streamUrl) ? 'hls' : 'file'); } catch {}
        resolve({ kind: 'native', format, url: streamUrl, title });
      });
  });
}

// ---- Main entry --------------------------------------------------------------

async function resolve(input, { ytDlpPath = null, startAt = 0 } = {}) {
  const url = normalize(input);
  const original = url.toString();

  const format = nativeFormat(url);
  if (format) return { kind: 'native', format, url: original, title: fileTitle(url), original };

  if (url.protocol === 'file:') throw new Error('This file type is not supported');

  for (const p of PROVIDERS) {
    if (p.match(url)) {
      const src = p.resolve(url, { startAt });
      if (src) return { ...src, original };
    }
  }

  if (ytDlpPath) {
    const src = await ytDlp(ytDlpPath, original);
    if (src) return { ...src, original };
  }

  return { kind: 'web', url: original, original };
}

module.exports = { resolve, normalize, nativeFormat, parseTime, PROVIDERS };
