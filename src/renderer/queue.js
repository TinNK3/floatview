/* global api, $, ui, body, player, session, toast, openLink, setTitle */
// "Up next": a playlist of links/files that plays one after another.
// - several links pasted at once, "+ Queue", dropped files or folders, a yt-dlp album
// - auto-advance when a video ends, Previous / Next, repeat off/all/one, shuffle
// - YouTube playlist links keep YouTube's own list; Next/Previous drive it, and when the
//   list ends FloatView's queue takes over.
// Loaded after renderer.js and shares its globals.

(async function queueUI() {
  let q = await api.getQueue();
  let played = new Set(); // shuffle: indexes already played in this round
  let saveTimer = null;
  let skip = null;       // pending "can't play -> next" (kept here, not on the session: a failed resolve has no session)
  let submitSeq = 0;     // only the latest pasted link may act after a slow yt-dlp lookup
  const MAX_ITEMS = 500;
  // Fire and forget: the local list is the truth. (Taking the reply back could undo a change
  // made while the save was in flight.) Main validates the same way before storing.
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { api.setQueue(q); }, 250); };

  const panel = $('queue-panel');
  const list = $('q-list');

  // ------------------------------------------------------------------ helpers

  // One link per line (a path may contain spaces, so lines, not words).
  function parseLinks(text) {
    const seen = new Set();
    const valid = (l) => {
      if (/^[a-z]:[\\/]/i.test(l)) return true;                       // Windows path (spaces allowed)
      if (/\s/.test(l)) return false;                                // a web link has no spaces
      if (/^(https?|file):\/\//i.test(l)) { try { new URL(l); return true; } catch { return false; } }
      return /^[\w-]+(\.[\w-]+)+(\/|$)/i.test(l);                    // bare domain: youtu.be/abc
    };
    return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .filter(valid)
      .filter((l) => (seen.has(l) ? false : seen.add(l)));
  }

  function labelFor(url) {
    try {
      const u = new URL(/^[a-z]:[\\/]/i.test(url) ? 'file:///' + url.replace(/\\/g, '/') : url);
      if (u.protocol === 'file:') return decodeURIComponent(u.pathname.split('/').pop());
      const v = u.searchParams.get('v');
      return u.hostname.replace(/^www\./, '') + (v ? ` · ${v}` : u.pathname !== '/' ? u.pathname.slice(0, 40) : '');
    } catch { return url.slice(0, 60); }
  }

  // Compare links in one form: C:\a b.mp4 == file:///C:/a%20b.mp4, youtu.be/x == https://youtu.be/x
  const norm = (u) => {
    if (typeof u !== 'string') return '';
    try {
      const t = u.trim();
      const href = new URL(/^[a-z]:[\\/]/i.test(t) ? 'file:///' + t.replace(/\\/g, '/') : /^[a-z][\w+.-]*:/i.test(t) ? t : 'https://' + t).href;
      return href.replace(/\/$/, '');
    } catch { return u; }
  };
  const sameUrl = (a, b) => a === b || norm(a) === norm(b);
  const current = () => q.items[q.index] || null;

  // ------------------------------------------------------------------ playing

  function playIndex(i, opts = {}) {
    if (i < 0 || i >= q.items.length) return;
    skip = null; // a new pick cancels any pending skip
    q.index = i;
    played.add(i);
    save();
    render();
    openLink(q.items[i].url, { ...opts, fromQueue: true });
  }

  // Play this link now: jump to it if it is already queued, else put it right after the current one.
  function playNow(url, opts = {}) {
    const found = q.items.findIndex((it) => sameUrl(it.url, url));
    if (found >= 0) return playIndex(found, opts);
    const at = q.index >= 0 ? q.index + 1 : q.items.length;
    q.items.splice(at, 0, { url, title: '' });
    played = new Set([...played].map((k) => (k >= at ? k + 1 : k))); // items after it moved down one
    if (q.items.length > MAX_ITEMS) q.items.length = MAX_ITEMS;
    playIndex(at, opts);
  }

  function enqueue(items, { playIfIdle = true } = {}) {
    const room = MAX_ITEMS - q.items.length;
    const fresh = items.filter((it) => !q.items.some((x) => sameUrl(x.url, it.url))).slice(0, Math.max(0, room));
    q.items.push(...fresh.map((it) => ({ url: it.url, title: it.title || '' })));
    save();
    render();
    toast(fresh.length ? `Added ${fresh.length} to Up next` : room <= 0 ? `Up next is full (${MAX_ITEMS})` : 'Already in Up next');
    if (playIfIdle && !player && fresh.length) playIndex(q.items.length - fresh.length);
  }

  function replaceWith(items) {
    q.items = items.slice(0, MAX_ITEMS).map((it) => ({ url: it.url, title: it.title || '' }));
    q.index = -1;
    played = new Set();
    save();
    toast(`Playing ${items.length} videos`);
    playIndex(0);
  }

  // Next in our own list. auto = the video ended by itself. Repeat-one only replays the item
  // that is actually playing (not after it was removed, and never a video that can't play).
  function queueNext({ auto = false } = {}) {
    if (!q.items.length) return false;
    const stillCurrent = current() && session && (sameUrl(current().url, session.source.original) || sameUrl(current().url, session.source.url));
    if (auto && q.repeat === 'one' && stillCurrent) { playIndex(q.index); return true; }
    let i;
    if (q.shuffle) {
      let left = q.items.map((_, k) => k).filter((k) => !played.has(k) && k !== q.index);
      if (!left.length && q.repeat === 'all') { played = new Set([q.index]); left = q.items.map((_, k) => k).filter((k) => k !== q.index); }
      if (!left.length) { if (!auto) toast('End of Up next'); return false; }
      i = left[Math.floor(Math.random() * left.length)];
    } else {
      i = q.index + 1;
      if (i >= q.items.length) {
        if (q.repeat !== 'all') { if (!auto) toast('End of Up next'); return false; }
        i = 0;
        played = new Set();
      }
    }
    playIndex(i);
    return true;
  }

  async function next() {
    // A YouTube playlist moves inside YouTube first; at its last video we continue with our list.
    if (player && session?.source.playlist === 'youtube') {
      const r = await player.cmd('next');
      if (r === 'yt') return;
    }
    if (!queueNext()) return;
  }

  async function prev() {
    if (player && session?.last?.currentTime > 5) return player.cmd('seekTo', 0);
    if (player && session?.source.playlist === 'youtube') {
      const r = await player.cmd('prev');
      if (r === 'yt') return;
    }
    if (q.index > 0) playIndex(q.index - 1);
    else if (q.repeat === 'all' && q.items.length) playIndex(q.items.length - 1);
    else if (player) player.cmd('seekTo', 0);
  }

  // ------------------------------------------------------------------ input

  async function submit(text, { append = false } = {}) {
    const links = parseLinks(text);
    const seq = ++submitSeq;
    if (!links.length) { if (String(text).trim()) openLink(String(text).trim()); return; }
    if (links.length === 1) {
      // An album/playlist page? Ask yt-dlp (only if set up; YouTube/Vimeo lists play natively).
      if (!/(youtube\.com|youtu\.be|vimeo\.com)/i.test(links[0])) {
        const openAt = openSeq; // eslint-disable-line no-undef -- renderer.js global
        ui.loading.hidden = false;
        const items = await api.expandPlaylist(links[0]).catch(() => []);
        // Something newer happened while yt-dlp was thinking: drop this result.
        if (seq !== submitSeq || openAt !== openSeq) return; // eslint-disable-line no-undef
        ui.loading.hidden = true; // openLink shows it again for the real load
        if (items.length > 1) return append ? enqueue(items) : replaceWith(items);
      }
      return append ? enqueue([{ url: links[0] }]) : playNow(links[0]);
    }
    const items = links.map((url) => ({ url }));
    return append ? enqueue(items) : replaceWith(items);
  }

  async function dropped(e) {
    const files = [...(e.dataTransfer.files || [])].map((f) => api.pathForFile(f)).filter(Boolean);
    if (files.length) {
      const items = await api.expandPaths(files);
      if (!items.length) return toast('No playable files there');
      if (items.length === 1 && files.length === 1) return playNow(items[0].url);
      return player ? enqueue(items) : replaceWith(items);
    }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (text) submit(text, { append: !!player && parseLinks(text).length > 1 });
  }

  // ------------------------------------------------------------------ end of video -> next

  // Called by renderer.js on every status poll.
  function onStatus(s) {
    if (!session) return;
    // YouTube playlist position in the title bar
    $('btn-next').dataset.yt = s.yt ? `${s.yt.index + 1}/${s.yt.count}` : '';
    // The page's own title updates would drop the position, so re-apply it on every poll.
    if (s.yt && s.yt.title) {
      const label = `${s.yt.title}  ·  ${s.yt.index + 1}/${s.yt.count}`;
      if (ui.title.textContent !== label) setTitle(label);
    }
    refreshNav(s);
    // An ad being skipped ends too — that is not the end of the real video.
    if (s.ad) { session.endedAt = 0; if (s.adSkipped && !session.adToast) { session.adToast = true; toast('Ad skipped', 1200); } return; }
    if (!s.ended || s.duration === null) { session.endedAt = 0; return; }
    if (!session.endedAt) session.endedAt = Date.now();
    if (session.advanced || !q.autoNext) return;
    // A YouTube list that isn't finished advances by itself; give it a moment, then nudge.
    const ytMore = s.yt && s.yt.index < s.yt.count - 1;
    // A Vimeo showcase moves to its next video by itself too: give it time before we step in.
    const wait = ytMore ? 4000 : session.source.playlist === 'vimeo' ? 6000 : 1200;
    if (Date.now() - session.endedAt < wait) return;
    session.advanced = true;
    if (ytMore) { player.cmd('next'); session.advanced = false; session.endedAt = 0; return; }
    if (queueNext({ auto: true })) return;
    // End of the list on a YouTube video: like YouTube's autoplay, keep going with its suggestions.
    if (q.suggest && currentYouTubeId() && !session.suggestTried) {
      session.suggestTried = true;
      const sess = session;
      addSuggestions({ play: true, onlyIf: sess }).then((n) => { if (!n && session === sess) session.advanced = false; });
      return;
    }
    // Nothing to play next (end of list, repeat off): keep checking, so turning on
    // Repeat or adding a video afterwards continues right away.
    session.advanced = false;
  }

  // ------------------------------------------------------------------ YouTube suggestions

  function currentYouTubeId() {
    if (!session) return null;
    const live = session.last?.ytId;
    if (live) return live;
    const m = String(session.source.url || '').match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})(?:[?/]|$)/);
    return m && m[1] !== 'videoseries' ? m[1] : null; // "videoseries" is the playlist embed, not a video
  }

  // Add YouTube's suggestions for the video that is playing; play the first new one if asked.
  async function addSuggestions({ play = false, onlyIf = null } = {}) {
    const id = currentYouTubeId();
    if (!id) { toast('Suggestions work while a YouTube video is playing'); return 0; }
    const btn = $('q-add-suggest');
    btn.disabled = true;
    toast('Loading suggestions from YouTube…', 1500);
    const items = await api.youtubeSuggestions(id).catch(() => []);
    btn.disabled = false;
    if (!items.length) { toast('YouTube sent no suggestions this time'); return 0; }
    // Full list (500): make room by dropping videos already watched (before the current one).
    const fresh = items.filter((it) => !q.items.some((x) => sameUrl(x.url, it.url)));
    const overflow = q.items.length + fresh.length - MAX_ITEMS;
    if (overflow > 0 && q.index > 0) {
      const drop = Math.min(overflow, q.index);
      q.items.splice(0, drop);
      q.index -= drop;
      played = new Set([...played].filter((k) => k >= drop).map((k) => k - drop));
    }
    const before = q.items.length;
    enqueue(items, { playIfIdle: false });
    const added = q.items.length - before;
    // Only start it if the user hasn't picked something else while YouTube was answering.
    if (play && added && (!onlyIf || session === onlyIf)) playIndex(before);
    return added;
  }

  // A video in the list can't play (deleted, private, blocked, broken file): don't stop the
  // whole list — say so and move on, unless the user picks something else first.
  // The skip is cancelled if, within 2.5 s, the user picks or pastes something else (openSeq
  // changes), the list moves, or the error goes away by itself (a stalled stream recovers).
  function onError() {
    if (!q.autoNext || !current()) return;
    if (skip && skip.index === q.index) return; // already scheduled for this item
    const more = q.shuffle || q.repeat === 'all' || q.index < q.items.length - 1;
    if (!more || q.items.length < 2) return;
    const mine = { index: q.index, seq: openSeq }; // eslint-disable-line no-undef -- renderer.js global
    skip = mine;
    toast('This one can’t play — skipping to the next', 2500);
    setTimeout(() => {
      const stillThere = skip === mine && q.index === mine.index && openSeq === mine.seq && !ui.error.hidden; // eslint-disable-line no-undef
      if (!stillThere) return;
      skip = null;
      ui.error.hidden = true;
      queueNext({ auto: true }); // repeat-one never replays it: the item isn't the playing one
    }, 2500);
  }

  function onTitle(title) {
    const it = current();
    if (!it || !session || !sameUrl(it.url, session.source.original) && !sameUrl(it.url, session.source.url)) return;
    if (title && it.title !== title) { it.title = title; save(); render(); }
  }

  // ------------------------------------------------------------------ UI

  function refreshNav(s) {
    const many = q.items.length > 1 || !!(s?.yt ?? session?.last?.yt);
    body.classList.toggle('has-queue', many);
    $('btn-queue').dataset.count = q.items.length ? String(q.items.length) : '';
    $('empty-queue').hidden = !q.items.length;
    $('empty-queue').textContent = `▶ Up next (${q.items.length})`;
  }

  function render() {
    $('q-count').textContent = q.items.length ? `${q.index + 1 > 0 ? q.index + 1 + ' / ' : ''}${q.items.length}` : 'empty';
    $('q-auto').classList.toggle('on', q.autoNext);
    $('q-suggest').classList.toggle('on', q.suggest !== false);
    $('q-shuffle').classList.toggle('on', q.shuffle);
    $('q-repeat').classList.toggle('on', q.repeat !== 'off');
    $('q-repeat').textContent = `Repeat: ${q.repeat}`;
    list.replaceChildren(...q.items.map((it, i) => {
      const li = document.createElement('li');
      li.className = i === q.index ? 'now' : '';
      li.title = it.url;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = i === q.index ? '▶' : String(i + 1);
      const t = document.createElement('span'); t.className = 't'; t.textContent = it.title || labelFor(it.url);
      const x = document.createElement('button'); x.className = 'x'; x.title = 'Remove'; x.textContent = '×';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        q.items.splice(i, 1);
        if (i <= q.index) q.index -= 1; // removing the current one: Next plays the item that moved into its place
        played = new Set([...played].filter((k) => k !== i).map((k) => (k > i ? k - 1 : k)));
        save(); render();
      });
      li.append(n, t, x);
      li.addEventListener('click', () => playIndex(i));
      return li;
    }));
    refreshNav();
  }

  function openPanel(open = panel.hidden) {
    panel.hidden = !open;
    $('btn-queue').setAttribute('aria-expanded', String(open));
    $('btn-queue').classList.toggle('on', open);
    if (open) { render(); list.querySelector('.now')?.scrollIntoView({ block: 'nearest' }); }
  }

  $('btn-queue').addEventListener('click', () => openPanel());
  $('q-close').addEventListener('click', () => openPanel(false));
  $('q-auto').addEventListener('click', () => { q.autoNext = !q.autoNext; save(); render(); });
  $('q-shuffle').addEventListener('click', () => { q.shuffle = !q.shuffle; played = new Set(q.index >= 0 ? [q.index] : []); save(); render(); });
  $('q-repeat').addEventListener('click', () => { q.repeat = { off: 'all', all: 'one', one: 'off' }[q.repeat]; save(); render(); });
  $('q-suggest').addEventListener('click', () => { q.suggest = q.suggest === false; save(); render(); toast(q.suggest ? 'When the list ends, YouTube suggestions keep playing' : 'Stops at the end of the list'); });
  $('q-add-suggest').addEventListener('click', () => addSuggestions());
  $('q-clear').addEventListener('click', () => { q.items = []; q.index = -1; played = new Set(); save(); render(); toast('Up next cleared'); });
  $('btn-next').addEventListener('click', next);
  $('btn-prev').addEventListener('click', prev);
  $('btn-enqueue').addEventListener('click', () => { submit(ui.linkInput.value, { append: true }); ui.linkInput.value = ''; });
  $('empty-queue').addEventListener('click', () => playIndex(q.index >= 0 ? q.index : 0));

  // Shift+Enter in the link box = add to queue. Pasting several lines into the (one-line) box
  // would lose the line breaks, so take them straight from the clipboard.
  ui.linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); submit(ui.linkInput.value, { append: true }); ui.linkInput.value = ''; }
  });
  ui.linkInput.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (parseLinks(text).length > 1) { e.preventDefault(); submit(text); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || e.ctrlKey || e.altKey || e.metaKey) return;
    // stopImmediatePropagation: renderer.js would also treat Shift+N as "n" (new link)
    if (e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); e.stopImmediatePropagation(); next(); }
    if (e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); e.stopImmediatePropagation(); prev(); }
    if (e.key === 'Escape' && !panel.hidden) { e.stopImmediatePropagation(); openPanel(false); }
  }, true);

  api.onCommand((c) => { if (c === 'next') next(); if (c === 'prev') prev(); });

  render();
  window.FVQueue = { submit, dropped, playNow, onStatus, onTitle, onError, next, prev, openPanel, addSuggestions, get state() { return q; } };
})();
