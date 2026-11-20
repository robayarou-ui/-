import test from 'node:test';
import assert from 'node:assert/strict';
import { withholdingTax, shiftPay, nightMinutes, roundInsurance, monthlySummary, earningsHistory, pendingShifts, DEFAULT_SETTINGS } from '../js/calc.js';

const at = (s) => new Date(s).getTime();
const S = { ...DEFAULT_SETTINGS, hourlyWage: 1200 };

test('源泉徴収税額 甲欄', () => {
  assert.equal(withholdingTax(104999, 'kou', 0), 0);
  assert.equal(withholdingTax(105000, 'kou', 0), 170);
  assert.equal(withholdingTax(106999, 'kou', 0), 170);
  assert.equal(withholdingTax(107000, 'kou', 0), 280);
  assert.equal(withholdingTax(739999, 'kou', 0), 71380);
  assert.equal(withholdingTax(739999, 'kou', 7), 26110);
  assert.equal(withholdingTax(739999, 'kou', 9), 26110 - 3220);
  assert.equal(withholdingTax(740000, 'kou', 0), 71680);
  assert.equal(withholdingTax(750000, 'kou', 0), 71680 + 2042);
  assert.equal(withholdingTax(790000, 'kou', 1), 75420);
  assert.equal(withholdingTax(4000000, 'kou', 0), 1125270 + Math.floor(500000 * 0.45945));
  assert.equal(withholdingTax(107000, 'kou', 3), 0);
});

test('源泉徴収税額 乙欄', () => {
  assert.equal(withholdingTax(100000, 'otsu'), 3063);
  assert.equal(withholdingTax(105000, 'otsu'), 3800);
  assert.equal(withholdingTax(739999, 'otsu'), 257700);
  assert.equal(withholdingTax(800000, 'otsu'), 259200 + 24504);
  assert.equal(withholdingTax(1710000, 'otsu'), 655400);
});

test('深夜時間', () => {
  assert.equal(nightMinutes(at('2026-11-20T09:00'), at('2026-11-20T18:00')), 0);
  assert.equal(nightMinutes(at('2026-11-20T21:00'), at('2026-11-21T06:00')), 420);
  assert.equal(nightMinutes(at('2026-11-20T03:00'), at('2026-11-20T23:00')), 180);
});

test('1回の勤務', () => {
  const p = shiftPay({ start: at('2026-11-20T09:00'), end: at('2026-11-20T19:00'), breakMin: 60 }, S);
  assert.deepEqual([p.worked, p.night, p.overtime], [540, 0, 60]);
  assert.equal(p.pay, 9 * 1200 + 300);
  const n = shiftPay({ start: at('2026-11-20T20:00'), end: at('2026-11-21T00:00'), breakMin: 30 }, S);
  assert.deepEqual([n.worked, n.night], [210, 120]);
  assert.equal(n.pay, 4200 + 600);
  const off = shiftPay({ start: at('2026-11-20T20:00'), end: at('2026-11-21T00:00'), breakMin: 0 }, { ...S, nightPremium: false });
  assert.equal(off.pay, 4800);
});

test('保険料の端数処理', () => {
  assert.equal(roundInsurance(100.5), 100);
  assert.equal(roundInsurance(100.51), 101);
  assert.equal(roundInsurance(100.4), 100);
});

test('月の集計', () => {
  const recs = [];
  for (let d = 1; d <= 20; d++) {
    const day = String(d).padStart(2, '0');
    recs.push({ start: at(`2026-11-${day}T09:00`), end: at(`2026-11-${day}T18:00`), breakMin: 60 });
  }
  const m = monthlySummary(recs, { ...S, commutePerDay: 500, employmentInsurance: true, residentTax: 1000 });
  assert.equal(m.wage, 192000);
  assert.equal(m.commute, 10000);
  assert.equal(m.gross, 202000);
  assert.equal(m.employment, 1010);
  assert.equal(m.taxable, 190990);
  assert.equal(m.incomeTax, withholdingTax(190990, 'kou', 0));
  assert.equal(m.net, 202000 - 1010 - m.incomeTax - 1000);
  const r = monthlySummary(recs, { ...S, socialInsuranceMode: 'rate' });
  assert.equal(r.health, 9600);
  assert.equal(r.pension, 17568);
});

test('これまでの稼ぎ', () => {
  const rec = (d) => ({ start: at(`${d}T09:00`), end: at(`${d}T17:00`), breakMin: 0 });
  const h = earningsHistory([rec('2025-12-10'), rec('2026-01-05'), rec('2026-01-06'), rec('2026-02-01')], S);
  assert.deepEqual(h.months.map((m) => m.key), ['2026-02', '2026-01', '2025-12']);
  assert.deepEqual(h.years.map((y) => [y.year, y.gross, y.days]), [['2026', 28800, 3], ['2025', 9600, 1]]);
  assert.equal(h.total.gross, 38400);
  assert.equal(h.total.net, 38400);
  assert.equal(h.total.worked, 1920);
});

test('記録のある日のシフトは見込みから外す', () => {
  const a = { start: at('2026-11-20T09:00'), end: at('2026-11-20T17:00'), breakMin: 0 };
  const b = { start: at('2026-11-21T09:00'), end: at('2026-11-21T17:00'), breakMin: 0 };
  assert.deepEqual(pendingShifts([a, b], [a]), [b]);
});
