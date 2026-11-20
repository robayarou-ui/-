import {
  MONTHLY_ROWS, KOU_UPPER, OTSU_LOW_RATE, OTSU_UPPER, PER_EXTRA_DEPENDENT,
} from './tax-table.js';

export const DEFAULT_SETTINGS = {
  hourlyWage: 1200,
  nightPremium: true,
  overtimePremium: true,
  commutePerDay: 0,
  taxColumn: 'kou',
  dependents: 0,
  employmentInsurance: false,
  employmentInsuranceRate: 0.5,
  socialInsuranceMode: 'none',
  healthRate: 5.0,
  pensionRate: 9.15,
  healthFixed: 0,
  pensionFixed: 0,
  residentTax: 0,
};

const MIN = 60000;
const PREMIUM = 0.25;
const NIGHT_START_H = 22;
const NIGHT_END_H = 5;
const DAILY_LEGAL_MIN = 480;

// 22:00〜翌5:00 に重なる分数（端末のローカル時刻で判定）
export function nightMinutes(startMs, endMs) {
  if (endMs <= startMs) return 0;
  let total = 0;
  const d = new Date(startMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  while (d.getTime() < endMs) {
    const from = new Date(d); from.setHours(NIGHT_START_H);
    const to = new Date(d); to.setDate(to.getDate() + 1); to.setHours(NIGHT_END_H);
    const overlap = Math.min(endMs, to.getTime()) - Math.max(startMs, from.getTime());
    if (overlap > 0) total += overlap;
    d.setDate(d.getDate() + 1);
  }
  return Math.floor(total / MIN);
}

// 1回の勤務の時間と支給額。休憩は深夜以外の時間から先に差し引く。
export function shiftPay(record, settings) {
  const span = Math.max(0, Math.floor((record.end - record.start) / MIN));
  const breakMin = Math.min(span, Math.max(0, record.breakMin || 0));
  const worked = span - breakMin;
  const rawNight = nightMinutes(record.start, record.end);
  const night = Math.min(worked, Math.max(0, rawNight - Math.max(0, breakMin - (span - rawNight))));
  const overtime = Math.max(0, worked - DAILY_LEGAL_MIN);
  const perMin = settings.hourlyWage / 60;
  const base = worked * perMin;
  const nightPay = settings.nightPremium ? night * perMin * PREMIUM : 0;
  const overtimePay = settings.overtimePremium ? overtime * perMin * PREMIUM : 0;
  return {
    worked, night, overtime, breakMin,
    base: Math.round(base),
    nightPay: Math.round(nightPay),
    overtimePay: Math.round(overtimePay),
    pay: Math.round(base + nightPay + overtimePay),
  };
}

// 源泉徴収税額（月額表）。taxable = 社会保険料等控除後の給与等の金額
export function withholdingTax(taxable, column = 'kou', dependents = 0) {
  const x = Math.max(0, Math.floor(taxable));
  if (column === 'otsu') {
    if (x < MONTHLY_ROWS[0][0]) return Math.floor(x * OTSU_LOW_RATE);
    for (let i = OTSU_UPPER.length - 1; i >= 0; i--) {
      const [from, tax, rate] = OTSU_UPPER[i];
      if (x >= from) return tax + Math.floor((x - from) * rate);
    }
    return findRow(x)[10];
  }
  const n = Math.max(0, Math.floor(dependents));
  const col = Math.min(n, 7);
  const extra = (n - col) * PER_EXTRA_DEPENDENT;
  if (x < MONTHLY_ROWS[0][0]) return 0;
  let tax;
  const top = KOU_UPPER[0][0];
  if (x < top) {
    tax = findRow(x)[2 + col];
  } else {
    for (let i = KOU_UPPER.length - 1; i >= 0; i--) {
      const [from, bases, rate] = KOU_UPPER[i];
      if (x >= from) { tax = bases[col] + Math.floor((x - from) * rate); break; }
    }
  }
  return Math.max(0, tax - extra);
}

function findRow(x) {
  let lo = 0, hi = MONTHLY_ROWS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x >= MONTHLY_ROWS[mid][1]) lo = mid + 1; else hi = mid;
  }
  return MONTHLY_ROWS[lo];
}

// 被保険者負担分の端数処理: 50銭以下切り捨て、50銭超切り上げ
export function roundInsurance(amount) {
  const yen = Math.floor(amount);
  return amount - yen > 0.5 + 1e-9 ? yen + 1 : yen;
}

export function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function dayKey(ms) {
  const d = new Date(ms);
  return `${monthKey(ms)}-${String(d.getDate()).padStart(2, '0')}`;
}

// 1か月分の集計。records はその月の勤務だけを渡す。
export function monthlySummary(records, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const t = { shifts: records.length, worked: 0, night: 0, overtime: 0, base: 0, nightPay: 0, overtimePay: 0, wage: 0 };
  const days = new Set();
  for (const r of records) {
    const p = shiftPay(r, s);
    t.worked += p.worked; t.night += p.night; t.overtime += p.overtime;
    t.base += p.base; t.nightPay += p.nightPay; t.overtimePay += p.overtimePay; t.wage += p.pay;
    days.add(dayKey(r.start));
  }
  t.days = days.size;
  t.commute = Math.round(t.days * (s.commutePerDay || 0));
  t.gross = t.wage + t.commute;

  let health = 0, pension = 0;
  if (s.socialInsuranceMode === 'rate') {
    health = roundInsurance(t.gross * s.healthRate / 100);
    pension = roundInsurance(t.gross * s.pensionRate / 100);
  } else if (s.socialInsuranceMode === 'fixed') {
    health = Math.round(s.healthFixed || 0);
    pension = Math.round(s.pensionFixed || 0);
  }
  const employment = s.employmentInsurance
    ? roundInsurance(t.gross * s.employmentInsuranceRate / 100) : 0;
  const social = health + pension + employment;
  // 通勤手当は非課税として扱う
  const taxable = Math.max(0, t.wage - social);
  const incomeTax = withholdingTax(taxable, s.taxColumn, s.dependents);
  const residentTax = Math.round(s.residentTax || 0);
  const deductions = social + incomeTax + residentTax;
  return {
    ...t, health, pension, employment, social, taxable,
    incomeTax, residentTax, deductions, net: t.gross - deductions,
  };
}
