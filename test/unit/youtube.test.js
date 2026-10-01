const test = require('node:test');
const assert = require('node:assert/strict');
const yt = require('../../src/main/youtube');

const page = (data) => `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;

test('video id only from real YouTube addresses', () => {
  assert.equal(yt.videoIdFrom('https://www.youtube.com/watch?v=sVTy_wmn5SU&list=RDsVTy_wmn5SU'), 'sVTy_wmn5SU');
  assert.equal(yt.videoIdFrom('https://youtu.be/sVTy_wmn5SU?si=abc'), 'sVTy_wmn5SU');
  assert.equal(yt.videoIdFrom('https://www.youtube-nocookie.com/embed/sVTy_wmn5SU?list=PLx'), 'sVTy_wmn5SU');
  assert.equal(yt.videoIdFrom('sVTy_wmn5SU'), 'sVTy_wmn5SU');
  assert.equal(yt.videoIdFrom('https://evil.example/watch?v=sVTy_wmn5SU'), null);
  assert.equal(yt.videoIdFrom('https://www.youtube.com/embed/videoseries?list=PLx'), null);
  assert.equal(yt.videoIdFrom('not a link'), null);
});

test('suggestions: new (lockup) and old (compactVideoRenderer) page formats, no duplicates, not the current video', () => {
  const data = { contents: { twoColumnWatchNextResults: { secondaryResults: { secondaryResults: { results: [
    { lockupViewModel: { contentId: 'AAAAAAAAAAA', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', metadata: { lockupMetadataViewModel: { title: { content: 'Super Shy' } } } } },
    { lockupViewModel: { contentId: 'PLplaylistX', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', metadata: { lockupMetadataViewModel: { title: { content: 'A playlist' } } } } },
    { compactVideoRenderer: { videoId: 'BBBBBBBBBBB', title: { simpleText: 'Ditto' } } },
    { compactVideoRenderer: { videoId: 'AAAAAAAAAAA', title: { runs: [{ text: 'dup' }] } } },
    { lockupViewModel: { contentId: 'CURRENTVID1', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', metadata: {} } },
    { lockupViewModel: { contentId: 'bad id', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO' } },
  ] } } } } };
  const s = yt.suggestions(yt.initialData(page(data)), { exclude: 'CURRENTVID1' });
  assert.deepEqual(s, [
    { url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', title: 'Super Shy' },
    { url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB', title: 'Ditto' },
  ]);
  assert.equal(yt.suggestions(yt.initialData(page(data)), { limit: 1 }).length, 1);
});

test('Mix / playlist side panel', () => {
  const data = { contents: { twoColumnWatchNextResults: { playlist: { playlist: { contents: [
    { playlistPanelVideoRenderer: { videoId: 'AAAAAAAAAAA', title: { simpleText: 'OMG' } } },
    { playlistPanelVideoRenderer: { videoId: 'BBBBBBBBBBB', title: { simpleText: 'Ditto' } } },
  ] } } } } };
  assert.deepEqual(yt.panelPlaylist(yt.initialData(page(data))).map((x) => x.title), ['OMG', 'Ditto']);
});

test('broken or missing page data is handled', () => {
  assert.equal(yt.initialData('<html>nothing</html>'), null);
  assert.equal(yt.initialData('var ytInitialData = {broken;</script>'), null);
  assert.deepEqual(yt.suggestions(null), []);
  assert.deepEqual(yt.panelPlaylist(null), []);
});

test('ad block list is well-formed', () => {
  assert.ok(yt.AD_PATTERNS.length >= 10);
  for (const p of yt.AD_PATTERNS) assert.match(p, /^\*:\/\/[^/]+\/.*$/);
  assert.ok(yt.AD_PATTERNS.some((p) => p.includes('doubleclick.net')));
  // never block the video itself
  assert.ok(!yt.AD_PATTERNS.some((p) => /googlevideo|\/embed\/|youtube\.com\/\*$/.test(p)));
});
