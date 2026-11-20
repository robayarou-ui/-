import test from 'node:test';
import assert from 'node:assert/strict';
import { yen, netNote } from '../js/format.js';
import { monthlySummary, DEFAULT_SETTINGS } from '../js/calc.js';

test('金額の表示', () => {
  assert.equal(yen(0), '¥0');
  assert.equal(yen(35143), '¥35,143');
  assert.equal(yen(-5000), '−¥5,000');
  assert.equal(yen(-0.4), '¥0');
});

test('手取りがマイナスのときの説明', () => {
  const empty = monthlySummary([], { ...DEFAULT_SETTINGS, residentTax: 5000 });
  assert.equal(empty.net, -5000);
  assert.match(netNote(empty), /勤務記録がありません/);
  assert.match(netNote({ net: -100, gross: 3000, shifts: 1 }), /差し引き合計が支給額合計を上回って/);
  assert.match(netNote({ net: -5000, gross: 0, shifts: 1 }), /差し引き合計が支給額合計を上回って/);
  assert.equal(netNote({ net: 0, gross: 0, shifts: 0 }), '');
  assert.equal(netNote({ net: 1000, gross: 1000, shifts: 1 }), '');
});
