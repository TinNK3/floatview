const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolve } = require('../../src/main/resolver');
const q = require('../../src/main/queue-store');

test('YouTube playlist page plays as an embed playlist', async () => {
  const s = await resolve('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
  assert.equal(s.kind, 'embed');
  assert.equal(s.playlist, 'youtube');
  assert.match(s.url, /\/embed\/videoseries\?.*list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG/);
});

test('watch link inside a playlist keeps the list and its position', async () => {
  const s = await resolve('https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG&index=4');
  assert.match(s.url, /\/embed\/aqz-KE-bpKQ\?/);
  assert.match(s.url, /list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG/);
  assert.match(s.url, /index=3/);
  assert.equal(s.playlist, 'youtube');
  assert.equal((await resolve('https://youtu.be/aqz-KE-bpKQ')).playlist, undefined);
});

test('a bad list id is ignored', async () => {
  const s = await resolve('https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=<script>');
  assert.doesNotMatch(s.url, /list=/);
});

test('Vimeo showcase / album use the showcase player', async () => {
  for (const u of ['https://vimeo.com/showcase/1234567', 'https://vimeo.com/album/1234567']) {
    const s = await resolve(u);
    assert.equal(s.url, 'https://vimeo.com/showcase/1234567/embed');
    assert.equal(s.playlist, 'vimeo');
  }
  assert.match((await resolve('https://vimeo.com/76979871')).url, /player\.vimeo\.com\/video\/76979871/);
});

test('saved queue is validated', () => {
  const r = q.sanitizeQueue({
    items: [{ url: 'javascript:alert(1)' }, { url: 'https://a.com/x.mp4', title: 'X\u0000' }, { url: 'C:\\v\\a.mp4' }, 'junk', null],
    index: 1, repeat: 'sometimes', shuffle: 'yes', autoNext: false,
  });
  assert.deepEqual(r.items.map((i) => i.url), ['https://a.com/x.mp4', 'file:///C:/v/a.mp4']);
  assert.equal(r.items[0].title, 'X');
  assert.equal(r.index, 0); // still the same video (x.mp4) after the bad item before it was dropped
  assert.equal(r.repeat, 'off');
  assert.equal(r.shuffle, false);
  assert.equal(r.autoNext, false);
  assert.equal(q.sanitizeQueue({ items: [], index: 7 }).index, -1);
  assert.equal(q.sanitizeQueue({ items: Array.from({ length: 900 }, (_, i) => ({ url: `https://a.com/${i}.mp4` })) }).items.length, q.MAX_ITEMS);
});

test('a dropped folder becomes its media files in natural name order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-q-'));
  for (const n of ['Ep 10.mp4', 'Ep 2.mp4', 'Ep 1.mkv', 'notes.txt', 'Ep 1.mp4', 'song.mp3']) fs.writeFileSync(path.join(dir, n), 'x');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'deep.mp4'), 'x');
  const items = q.expandPaths([dir]);
  assert.deepEqual(items.map((i) => i.title), ['Ep 1.mp4', 'Ep 2.mp4', 'Ep 10.mp4', 'song.mp3']);
  assert.ok(items.every((i) => i.url.startsWith('file:///')));
  // single files and junk paths
  assert.equal(q.expandPaths([path.join(dir, 'Ep 2.mp4'), path.join(dir, 'notes.txt'), 'relative.mp4', 42]).length, 1);
});

test('playlist detection + yt-dlp flat playlist parsing', () => {
  assert.ok(q.looksLikePlaylist('https://soundcloud.com/a/sets/b'));
  assert.ok(q.looksLikePlaylist('https://www.dailymotion.com/playlist/x6hynp'));
  assert.ok(!q.looksLikePlaylist('https://example.com/video/123'));
  const items = q.parseFlatPlaylist(JSON.stringify({ entries: [
    { ie_key: 'Youtube', id: 'aqz-KE-bpKQ', url: 'aqz-KE-bpKQ', title: 'Bunny' },
    { url: 'https://site.com/v/2', title: 'Two' },
    { url: 'javascript:alert(1)' },
    { title: 'no url' },
  ] }));
  assert.deepEqual(items, [
    { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Bunny' },
    { url: 'https://site.com/v/2', title: 'Two' },
  ]);
  assert.deepEqual(q.parseFlatPlaylist('not json'), []);
});

test("review: index follows the same video when bad items are dropped; network paths refused", () => {
  const r = q.sanitizeQueue({ items: [{ url: "https://a b" }, { url: "https://x.com/1" }, { url: "https://x.com/2" }], index: 2 });
  assert.equal(r.items[r.index].url, "https://x.com/2");
  assert.equal(q.sanitizeQueue({ items: [{ url: "https://a b" }, { url: "https://x.com/1" }], index: 0 }).index, -1);
  assert.equal(q.sanitizeQueue({ items: [{ url: "file://server/share/a.mp4" }] }).items.length, 0);
  assert.equal(q.sanitizeQueue({ items: null }).items.length, 0);           // hand-edited file
  const unc = String.raw`\\server\share\videos`;
  assert.ok(require('node:path').isAbsolute(unc));                     // it IS absolute…
  assert.deepEqual(q.expandPaths([unc, '//server/share/videos']), []);  // …but network paths are refused
  assert.ok(!q.looksLikePlaylist("https://www.twitch.tv/someone/videos"));
  assert.ok(!q.looksLikePlaylist("https://www.tiktok.com/@someone"));
  assert.ok(q.looksLikePlaylist("https://www.dailymotion.com/playlist/x6hynp"));
});
