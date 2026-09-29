const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, HISTORY_LIMIT } = require('../../src/main/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fv-'));

test('defaults are filled in and new keys survive old files', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'floatview.json'), JSON.stringify({ settings: { opacity: 0.5 } }));
  const s = new Store(dir);
  assert.equal(s.get('settings').opacity, 0.5);
  assert.equal(s.get('settings').aspect, 'auto');
  assert.equal(s.get('settings').hotkeys.playPause, 'Ctrl+Alt+Space');
});

test('corrupt file falls back to defaults', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'floatview.json'), '{nope');
  assert.equal(new Store(dir).get('settings').opacity, 1);
});

test('history: newest first, no duplicates, capped, keeps resume point', () => {
  const s = new Store(tmp());
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) s.addHistory({ url: `u${i}`, title: `t${i}` });
  assert.equal(s.get('history').length, HISTORY_LIMIT);
  assert.equal(s.get('history')[0].url, `u${HISTORY_LIMIT + 4}`);
  s.updateHistory('u10', { lastPosition: 99 });
  s.addHistory({ url: 'u10', title: 'again' });
  assert.equal(s.get('history')[0].url, 'u10');
  assert.equal(s.get('history')[0].lastPosition, 99);
  assert.equal(s.get('history').filter((h) => h.url === 'u10').length, 1);
});

test('flush writes to disk', () => {
  const dir = tmp();
  const s = new Store(dir);
  s.addHistory({ url: 'x', title: 'y' });
  s.flush();
  assert.equal(new Store(dir).get('history')[0].url, 'x');
});
