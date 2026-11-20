import test from 'node:test';
import assert from 'node:assert/strict';
import { wallsFor, wallStatus } from '../js/walls.js';
import { withholdingTax, shiftPay, nightMinutes, roundInsurance, monthlySummary, earningsHistory, pendingShifts, combinedSummary, buildShift, shiftTemplates, yearPlan, DEFAULT_SETTINGS } from '../js/calc.js';

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
  const h = earningsHistory([rec('2025-12-10'), rec('2026-01-05'), rec('2026-01-06'), rec('2026-02-01')], [{ id: 'a', ...S }]);
  assert.deepEqual(h.months.map((m) => m.key), ['2026-02', '2026-01', '2025-12']);
  assert.deepEqual(h.years.map((y) => [y.year, y.gross, y.days]), [['2026', 28800, 3], ['2025', 9600, 1]]);
  assert.equal(h.total.gross, 38400);
  assert.equal(h.total.net, 38400);
  assert.equal(h.total.worked, 1920);
});

test('記録のある日・同じ勤務先のシフトは見込みから外す', () => {
  const mk = (d, w) => ({ workplaceId: w, start: at(`${d}T09:00`), end: at(`${d}T17:00`), breakMin: 0 });
  const rec = mk('2026-11-20', 'a');
  const other = mk('2026-11-20', 'b');
  const later = mk('2026-11-21', 'a');
  assert.deepEqual(pendingShifts([mk('2026-11-20', 'a'), other, later], [rec]), [other, later]);
});

test('勤務先ごとの設定で計算して合算する', () => {
  const A = { id: 'a', ...S, hourlyWage: 1000, taxColumn: 'kou' };
  const B = { id: 'b', ...S, hourlyWage: 1500, taxColumn: 'otsu', commutePerDay: 300 };
  const mk = (d, w) => ({ workplaceId: w, start: at(`${d}T09:00`), end: at(`${d}T17:00`), breakMin: 0 });
  const c = combinedSummary([mk('2026-11-02', 'a'), mk('2026-11-03', 'b'), mk('2026-11-04', 'b'), { ...mk('2026-11-05'), workplaceId: 'gone' }], [A, B]);
  assert.equal(c.parts.length, 2);
  assert.equal(c.wage, 16000 + 24000);
  assert.equal(c.commute, 600);
  assert.equal(c.incomeTax, Math.floor(24000 * 0.03063));
  assert.equal(c.net, c.gross - c.incomeTax);
  assert.equal(c.days, 4);
});

test('シフトの組み立てと型', () => {
  const n = buildShift('2026-11-20', '22:00', '05:00', 60);
  assert.equal(n.end - n.start, 7 * 3600000);
  assert.equal(buildShift('2026-11-20', '09:00', '10:00', 60), null);
  assert.equal(buildShift('2026-11-20', '', '10:00', 0), null);
  const mk = (d, s, e, w = 'a') => ({ workplaceId: w, ...buildShift(d, s, e, 60) });
  const t = shiftTemplates([mk('2026-11-01', '09:00', '18:00'), mk('2026-11-02', '17:00', '22:00'), mk('2026-11-03', '09:00', '18:00'), mk('2026-11-04', '09:00', '18:00', 'b')]);
  assert.deepEqual(t.map((x) => [x.workplaceId, x.start, x.end, x.count]), [['a', '09:00', '18:00', 2], ['b', '09:00', '18:00', 1], ['a', '17:00', '22:00', 1]]);
  const zero = { workplaceId: 'a', start: at('2026-11-05T17:36:10'), end: at('2026-11-05T17:36:40'), breakMin: 0 };
  assert.deepEqual(shiftTemplates([zero]), []);
});

test('年間の実績・予定・計画', () => {
  const W = [{ id: 'a', ...S, hourlyWage: 1000, commutePerDay: 500 }];
  const mk = (d) => ({ workplaceId: 'a', start: at(`${d}T09:00`), end: at(`${d}T17:00`), breakMin: 0 });
  const y = yearPlan([mk('2026-01-10'), mk('2026-11-02'), mk('2025-12-31')], [mk('2026-11-02'), mk('2026-11-25'), mk('2026-12-05')], W, 2026, at('2026-11-20T12:00'), 50000);
  assert.equal(y.months[0].actualGross, 8500);
  assert.equal(y.months[10].actualWage, 8000);
  assert.equal(y.months[10].pendingGross, 8500);
  assert.equal(y.months[11].pendingWage, 8000);
  assert.equal(y.planned, 0);
  assert.deepEqual(y.actual, { tax: 16000, social: 17000 });
  assert.deepEqual(y.forecast, { tax: 32000, social: 34000 });
  const p = yearPlan([mk('2026-01-10')], [], W, 2026, at('2026-10-20T12:00'), 50000);
  assert.deepEqual(p.months.map((m) => m.planned), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50000, 50000]);
  assert.equal(p.forecast.tax, 108000);
});

test('年収の基準額', () => {
  const amounts = (y, p) => wallsFor(y, p).walls.map((w) => w.amount);
  assert.deepEqual(amounts(2026, 'student'), [1780000, 1590000, 1970000, 1500000]);
  assert.deepEqual(amounts(2026, 'dependent'), [1780000, 1360000, 1300000]);
  assert.deepEqual(amounts(2027, 'spouse'), [1780000, 1690000, 2070000, 1300000]);
  assert.deepEqual(amounts(2026, 'none'), [1780000]);
  assert.deepEqual(amounts(2025, 'dependent'), [1600000, 1230000, 1300000]);
  assert.deepEqual(wallsFor(2024, 'none').walls, []);
  assert.deepEqual(wallsFor(2028, 'none').walls, []);
  const [self, , social] = wallsFor(2026, 'dependent').walls;
  const st = (w, a, f) => { const r = wallStatus(w, { tax: a, social: a }, { tax: f, social: f }); return [r.state, r.remaining]; };
  assert.deepEqual(st(self, 1000000, 1780000), ['ok', 0]);
  assert.deepEqual(st(self, 1000000, 1780001), ['warn', -1]);
  assert.deepEqual(st(self, 1780001, 1900000), ['over', -120000]);
  assert.deepEqual(st(social, 1299999, 1299999), ['ok', 0]);
  assert.deepEqual(st(social, 1200000, 1300000), ['warn', -1]);
});

test('バックアップの書き出しと読み込み', async () => {
  const { makeBackup, parseBackup } = await import('../js/backup.js');
  const W = [{ id: 'a', name: '店', color: '#123456', payday: 25, ...S }];
  const rec = { id: 'r1', workplaceId: 'a', start: at('2026-11-02T09:00'), end: at('2026-11-02T17:00'), breakMin: 30 };
  const data = { records: [rec], shifts: [], workplaces: W, prefs: { goal: 5 } };
  assert.deepEqual(parseBackup(JSON.stringify(makeBackup(data))), data);
  const bad = (d) => () => parseBackup(JSON.stringify({ app: 'kyuryo-timer', data: d }));
  assert.throws(() => parseBackup('x'));
  assert.throws(() => parseBackup('{"app":"other","data":{}}'));
  assert.throws(bad({ workplaces: [] }));
  assert.throws(bad({ workplaces: W, records: [{ ...rec, workplaceId: 'zzz' }] }));
  assert.throws(bad({ workplaces: W, records: [{ ...rec, start: 'x' }] }));
  const fixed = parseBackup(JSON.stringify({ app: 'kyuryo-timer', data: { workplaces: [{ id: 'a', hourlyWage: -5, commutePerDay: 1e308, taxColumn: 'zz', color: 'red' }] } }));
  assert.equal(fixed.workplaces[0].commutePerDay, 0);
  assert.equal(fixed.workplaces[0].hourlyWage, DEFAULT_SETTINGS.hourlyWage);
  assert.equal(fixed.workplaces[0].taxColumn, 'kou');
  assert.equal(fixed.workplaces[0].color, '#1f6feb');
});

test('通知のタイミング', async () => {
  const { dueNotifications } = await import('../js/notify.js');
  const W = [{ id: 'a', name: '店', payday: 31 }];
  const shift = { id: 's1', workplaceId: 'a', start: at('2026-11-20T18:00'), end: at('2026-11-20T22:00') };
  const run = (now, prefs, sent = new Set()) => dueNotifications({ shifts: [shift], workplaces: W, prefs, now: at(now), sent });
  const P = { notifyShift: true, notifyLeadMin: 60, notifyPayday: true };
  assert.deepEqual(run('2026-11-20T16:59', P), []);
  const due = run('2026-11-20T17:00', P);
  assert.equal(due.length, 1);
  assert.equal(due[0].body, '18:00〜22:00（あと60分）');
  assert.deepEqual(run('2026-11-20T17:30', P, new Set([due[0].key])), []);
  assert.deepEqual(run('2026-11-20T18:00', P), []);
  assert.deepEqual(run('2026-11-20T17:30', { ...P, notifyShift: false }), []);
  assert.deepEqual(run('2026-11-30T08:59', P), []);
  assert.deepEqual(run('2026-11-30T09:00', P).map((n) => n.title), ['今日は給料日です']);
  assert.deepEqual(run('2026-11-29T12:00', P), []);
  assert.deepEqual(run('2026-11-30T12:00', { ...P, notifyPayday: false }), []);
});
