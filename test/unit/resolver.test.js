const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve, normalize, parseTime } = require('../../src/main/resolver');

test('direct files and streams play natively', async () => {
  assert.deepEqual(
    (({ kind, format }) => ({ kind, format }))(await resolve('https://x.com/a/b.MP4?token=1')),
    { kind: 'native', format: 'file' });
  assert.equal((await resolve('https://cdn.test/live/index.m3u8')).format, 'hls');
  assert.equal((await resolve('https://cdn.test/manifest.mpd')).format, 'dash');
});

test('YouTube links of every shape become the embed player', async () => {
  const cases = [
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    'youtube.com/watch?v=aqz-KE-bpKQ&feature=share',
    'https://youtu.be/aqz-KE-bpKQ',
    'https://m.youtube.com/watch?v=aqz-KE-bpKQ',
    'https://www.youtube.com/shorts/aqz-KE-bpKQ',
    'https://www.youtube.com/live/aqz-KE-bpKQ',
    'https://www.youtube.com/embed/aqz-KE-bpKQ',
  ];
  for (const c of cases) {
    const s = await resolve(c);
    assert.equal(s.kind, 'embed', c);
    assert.match(s.url, /^https:\/\/www\.youtube-nocookie\.com\/embed\/aqz-KE-bpKQ\?/, c);
  }
});

test('YouTube start time is kept', async () => {
  assert.match((await resolve('https://youtu.be/aqz-KE-bpKQ?t=1m30s')).url, /start=90/);
  assert.match((await resolve('https://youtu.be/aqz-KE-bpKQ', { startAt: 42.7 })).url, /start=42/);
});

test('YouTube pages without a video id fall back to web mode', async () => {
  assert.equal((await resolve('https://www.youtube.com/@somechannel')).kind, 'web');
});

test('Vimeo and Twitch', async () => {
  assert.match((await resolve('https://vimeo.com/76979871')).url, /player\.vimeo\.com\/video\/76979871/);
  assert.match((await resolve('https://vimeo.com/76979871/abcdef1234')).url, /h=abcdef1234/);
  assert.match((await resolve('https://www.twitch.tv/somechannel')).url, /player\.twitch\.tv\/\?.*channel=somechannel/);
  assert.match((await resolve('https://www.twitch.tv/videos/123456')).url, /video=123456/);
});

test('unknown sites use the web fallback', async () => {
  const s = await resolve('https://www.facebook.com/watch/?v=1');
  assert.equal(s.kind, 'web');
});

test('dangerous schemes are rejected, Windows paths accepted', async () => {
  await assert.rejects(resolve('javascript:alert(1)'));
  await assert.rejects(resolve('data:text/html,hi'));
  await assert.rejects(resolve('   '));
  assert.equal(normalize('C:\\Videos\\a b.mp4').protocol, 'file:');
  assert.equal((await resolve('C:\\Videos\\clip.webm')).kind, 'native');
  await assert.rejects(resolve('C:\\Videos\\notes.txt'));
});

test('missing yt-dlp does not break resolution', async () => {
  const s = await resolve('https://example.com/page', { ytDlpPath: 'C:\\nope\\yt-dlp.exe' });
  assert.equal(s.kind, 'web');
});

test('parseTime', () => {
  assert.equal(parseTime('90'), 90);
  assert.equal(parseTime('1h2m3s'), 3723);
  assert.equal(parseTime('garbage'), 0);
});
