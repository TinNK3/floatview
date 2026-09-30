const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration, formatDuration, describeDuration } = require('../../src/shared/duration');

test('accepts the formats people type', () => {
  const cases = {
    '25': 1500, '25m': 1500, '25 min': 1500, '90s': 90, '90 sec': 90, '1:30': 90, '1h': 3600,
    '1h20m': 4800, '1h 20m 5s': 4805, '1:20:00': 4800, '2.5': 150, ' 45 ': 2700, '8h': 28800, '10s': 10,
  };
  for (const [text, sec] of Object.entries(cases)) assert.equal(parseDuration(text), sec, text);
});

test('rejects nonsense and out-of-range values', () => {
  for (const bad of ['abc', '0', '', '9h', '5s', '1:75', '-5', '1:2:3:4', 'm']) assert.equal(parseDuration(bad), null, bad);
});

test('custom limits', () => {
  assert.equal(parseDuration('1', { min: 60, max: 120 }), 60);
  assert.equal(parseDuration('3', { min: 60, max: 120 }), null);
});

test('formats', () => {
  assert.equal(formatDuration(1500), '25:00');
  assert.equal(formatDuration(4800), '1:20:00');
  assert.equal(formatDuration(45), '0:45');
  assert.equal(describeDuration(90), '1 min 30 s');
  assert.equal(describeDuration(5400), '1 h 30 min');
});
