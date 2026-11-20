import {
  DEFAULT_SETTINGS, shiftPay, monthlySummary, monthKey, dayKey, earningsHistory, pendingShifts,
} from './calc.js';
import { yen, netNote } from './format.js';

const KEYS = { records: 'kyuryo.records', shifts: 'kyuryo.shifts', settings: 'kyuryo.settings', timer: 'kyuryo.timer' };
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const hm = (min) => `${Math.floor(min / 60)}時間${pad(min % 60)}分`;
const timeOf = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const rangeOf = (r) => `${timeOf(r.start)}〜${timeOf(r.end)}${dayKey(r.end) !== dayKey(r.start) ? '（翌）' : ''}`;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const dayLabel = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return `${y}年${m}月${d}日（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
};

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

// kind: 'records'（勤務記録） / 'shifts'（シフト予定）
const store = { records: load(KEYS.records, []), shifts: load(KEYS.shifts, []) };
const KIND_LABEL = { records: '勤務記録', shifts: 'シフト' };
let settings = { ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) };
let timer = load(KEYS.timer, null); // { start, breakMs, breakStart }
let viewMonth = monthKey(Date.now());
let editing = { kind: 'records', id: null };
let openDay = null;

const byStart = (a, b) => a.start - b.start;
const inMonth = (kind) => store[kind].filter((r) => monthKey(r.start) === viewMonth).sort(byStart);
const onDay = (kind, key) => store[kind].filter((r) => dayKey(r.start) === key).sort(byStart);

function removeItem(kind, id) {
  if (!confirm(`この${KIND_LABEL[kind]}を削除しますか？`)) return;
  store[kind] = store[kind].filter((o) => o.id !== id);
  save(KEYS[kind], store[kind]);
  renderAll();
}

function actionButtons(kind, item) {
  const e = document.createElement('button');
  e.className = 'small'; e.textContent = '編集';
  e.addEventListener('click', () => openEdit(kind, item));
  const x = document.createElement('button');
  x.className = 'small ghost'; x.textContent = '削除';
  x.addEventListener('click', () => removeItem(kind, item.id));
  const span = document.createElement('span');
  span.append(e, ' ', x);
  return span;
}

// ---- タイマー ----
function timerBreakMs(now) {
  return timer.breakMs + (timer.breakStart ? now - timer.breakStart : 0);
}

function renderTimer() {
  const now = Date.now();
  const status = $('timer-status');
  status.classList.toggle('working', !!timer && !timer.breakStart);
  status.classList.toggle('break', !!timer && !!timer.breakStart);
  $('btn-start').disabled = !!timer;
  $('btn-break').disabled = !timer;
  $('btn-stop').disabled = !timer;
  $('btn-cancel').hidden = !timer;
  $('btn-break').textContent = timer && timer.breakStart ? '休憩終了' : '休憩開始';
  if (!timer) {
    status.textContent = '未出勤';
    $('timer-clock').textContent = '0:00:00';
    const today = onDay('shifts', dayKey(now));
    $('timer-detail').textContent = today.length
      ? `今日のシフト: ${today.map(rangeOf).join('、')}`
      : '「出勤」を押すと計測を始めます。';
    return;
  }
  const breakMs = timerBreakMs(now);
  const sec = Math.max(0, Math.floor((now - timer.start - breakMs) / 1000));
  status.textContent = timer.breakStart ? '休憩中' : '勤務中';
  $('timer-clock').textContent = `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
  const p = shiftPay({ start: timer.start, end: now, breakMin: Math.floor(breakMs / 60000) }, settings);
  $('timer-detail').textContent =
    `${timeOf(timer.start)} 出勤 ／ 休憩 ${Math.floor(breakMs / 60000)}分 ／ ここまで ${yen(p.pay)}`;
}

$('btn-start').addEventListener('click', () => {
  timer = { start: Date.now(), breakMs: 0, breakStart: null };
  save(KEYS.timer, timer); renderTimer();
});
$('btn-break').addEventListener('click', () => {
  if (!timer) return;
  const now = Date.now();
  if (timer.breakStart) { timer.breakMs += now - timer.breakStart; timer.breakStart = null; }
  else timer.breakStart = now;
  save(KEYS.timer, timer); renderTimer();
});
$('btn-stop').addEventListener('click', () => {
  if (!timer) return;
  const now = Date.now();
  store.records.push({
    id: crypto.randomUUID(), start: timer.start, end: now,
    breakMin: Math.round(timerBreakMs(now) / 60000),
  });
  viewMonth = monthKey(timer.start);
  timer = null;
  localStorage.removeItem(KEYS.timer);
  save(KEYS.records, store.records);
  renderAll();
});
$('btn-cancel').addEventListener('click', () => {
  if (!timer || !confirm('計測中の勤務を記録せずに取り消しますか？')) return;
  timer = null;
  localStorage.removeItem(KEYS.timer);
  renderTimer();
});

// ---- カレンダー ----
function tag(cls, text) {
  const s = document.createElement('span');
  s.className = `tag ${cls}`; s.textContent = text;
  return s;
}

function renderCalendar() {
  const [y, m] = viewMonth.split('-').map(Number);
  const body = $('cal-body'); body.replaceChildren();
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const today = dayKey(Date.now());
  for (let i = 0; i < first; i++) body.append(document.createElement('span'));
  for (let d = 1; d <= days; d++) {
    const key = `${viewMonth}-${pad(d)}`;
    const recs = onDay('records', key);
    const shifts = onDay('shifts', key);
    const b = document.createElement('button');
    b.type = 'button';
    const dow = (first + d - 1) % 7;
    b.className = 'cal-day' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '') + (key === today ? ' today' : '');
    const num = document.createElement('span');
    num.className = 'num'; num.textContent = d;
    b.append(num);
    const parts = [dayLabel(key)];
    if (recs.length) {
      const pays = recs.map((r) => shiftPay(r, settings));
      const worked = pays.reduce((a, p) => a + p.worked, 0);
      const pay = pays.reduce((a, p) => a + p.pay, 0);
      b.append(tag('rec', `${Math.floor(worked / 60)}:${pad(worked % 60)}`), tag('rec', yen(pay)));
      parts.push(`勤務 ${hm(worked)} ${yen(pay)}`);
    }
    for (const s of shifts) {
      b.append(tag('shift', `${timeOf(s.start)}-${timeOf(s.end)}`));
      parts.push(`シフト ${rangeOf(s)}`);
    }
    b.setAttribute('aria-label', parts.join('、'));
    b.addEventListener('click', () => openDayDialog(key));
    body.append(b);
  }
}

// ---- 日ごとの確認・修正 ----
const dayDialog = $('day-dialog');

function renderDayDialog() {
  if (!openDay) return;
  $('day-title').textContent = dayLabel(openDay);
  for (const kind of ['records', 'shifts']) {
    const ul = $(kind === 'records' ? 'day-records' : 'day-shifts');
    ul.replaceChildren();
    const items = onDay(kind, openDay);
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'none'; li.textContent = 'なし';
      ul.append(li);
    }
    for (const r of items) {
      const p = shiftPay(r, settings);
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = `${rangeOf(r)}　休憩${p.breakMin}分　${hm(p.worked)}　${kind === 'shifts' ? '見込み ' : ''}${yen(p.pay)}`;
      li.append(text, actionButtons(kind, r));
      ul.append(li);
    }
  }
}

function openDayDialog(key) {
  openDay = key;
  renderDayDialog();
  dayDialog.showModal();
}
dayDialog.addEventListener('close', () => { openDay = null; });
$('day-close').addEventListener('click', () => dayDialog.close());
$('day-add-record').addEventListener('click', () => openEdit('records', null, openDay));
$('day-add-shift').addEventListener('click', () => openEdit('shifts', null, openDay));

// ---- 月の集計 ----
function row(tbody, label, value, cls) {
  const tr = tbody.insertRow();
  if (cls) tr.className = cls;
  tr.insertCell().textContent = label;
  tr.insertCell().textContent = value;
}

function renderMonth() {
  const [y, m] = viewMonth.split('-').map(Number);
  $('month-h').textContent = `${y}年${m}月`;
  const list = inMonth('records');
  const s = monthlySummary(list, settings);
  $('sum-net').textContent = yen(s.net);
  $('sum-net-box').classList.toggle('negative', s.net < 0);
  $('sum-net-note').textContent = netNote(s);

  const pay = $('sum-pay'); pay.replaceChildren();
  row(pay, '基本給', yen(s.base));
  if (settings.nightPremium) row(pay, '深夜割増', yen(s.nightPay));
  if (settings.overtimePremium) row(pay, '残業割増', yen(s.overtimePay));
  if (s.commute) row(pay, '交通費', yen(s.commute));
  row(pay, '支給額合計', yen(s.gross), 'total');

  const ded = $('sum-ded'); ded.replaceChildren();
  row(ded, '所得税', yen(s.incomeTax));
  if (settings.employmentInsurance) row(ded, '雇用保険', yen(s.employment));
  if (settings.socialInsuranceMode !== 'none') {
    row(ded, '健康保険', yen(s.health));
    row(ded, '厚生年金', yen(s.pension));
  }
  if (s.residentTax) row(ded, '住民税', yen(s.residentTax));
  row(ded, '差し引き合計', yen(s.deductions), 'total');

  $('sum-hours').textContent =
    `出勤 ${s.days}日 ／ 実働 ${hm(s.worked)}（うち深夜 ${hm(s.night)}、残業 ${hm(s.overtime)}）`;

  const pending = pendingShifts(inMonth('shifts'), list);
  const forecast = $('sum-forecast');
  forecast.hidden = pending.length === 0;
  if (pending.length) {
    const f = monthlySummary([...list, ...pending], settings);
    forecast.textContent =
      `シフト予定 ${pending.length}件を含めた見込み: 支給額 ${yen(f.gross)} ／ 手取り ${yen(f.net)}`;
  }

  const body = $('records'); body.replaceChildren();
  for (const r of list) {
    const p = shiftPay(r, settings);
    const d = new Date(r.start);
    const tr = body.insertRow();
    tr.insertCell().textContent = `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
    tr.insertCell().textContent = timeOf(r.start);
    tr.insertCell().textContent = timeOf(r.end) + (dayKey(r.end) !== dayKey(r.start) ? '（翌）' : '');
    tr.insertCell().textContent = `${p.breakMin}分`;
    tr.insertCell().textContent = hm(p.worked);
    const c = tr.insertCell(); c.className = 'num'; c.textContent = yen(p.pay);
    tr.insertCell().append(actionButtons('records', r));
  }
  $('records-empty').hidden = list.length > 0;
  $('btn-csv').disabled = list.length === 0;
}

function shiftMonth(delta) {
  const [y, m] = viewMonth.split('-').map(Number);
  viewMonth = monthKey(new Date(y, m - 1 + delta, 1).getTime());
  renderCalendar(); renderMonth();
}
$('month-prev').addEventListener('click', () => shiftMonth(-1));
$('month-next').addEventListener('click', () => shiftMonth(1));

// ---- これまでの稼ぎ ----
function renderHistory() {
  const h = earningsHistory(store.records, settings);
  $('hist-gross').textContent = yen(h.total.gross);
  $('hist-net').textContent = yen(h.total.net);
  $('hist-hours').textContent = hm(h.total.worked);
  const body = $('history'); body.replaceChildren();
  const line = (cls, label, v) => {
    const tr = body.insertRow(); tr.className = cls;
    for (const t of [label, `${v.days}日`, hm(v.worked), yen(v.gross), yen(v.deductions), yen(v.net)]) {
      tr.insertCell().textContent = t;
    }
    return tr;
  };
  for (const y of h.years) {
    line('year', `${y.year}年 合計`, y);
    for (const m of y.months) {
      const tr = line('month', `${Number(m.key.slice(5))}月`, m);
      const cell = tr.cells[0];
      const b = document.createElement('button');
      b.className = 'small ghost'; b.textContent = cell.textContent;
      b.setAttribute('aria-label', `${y.year}年${cell.textContent}を表示`);
      b.addEventListener('click', () => {
        viewMonth = m.key; renderCalendar(); renderMonth();
        $('month-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      cell.replaceChildren(b);
    }
  }
  $('history-empty').hidden = h.months.length > 0;
}

// ---- 追加・編集 ----
const dialog = $('edit-dialog');
const form = $('edit-form');

function openEdit(kind, item, day) {
  editing = { kind, id: item ? item.id : null };
  $('edit-title').textContent = `${KIND_LABEL[kind]}を${item ? '編集' : '追加'}`;
  $('edit-error').textContent = '';
  const f = form.elements;
  if (item) {
    f.date.value = dayKey(item.start);
    f.start.value = timeOf(item.start);
    f.end.value = timeOf(item.end);
    f.breakMin.value = item.breakMin;
  } else {
    f.date.value = day || (monthKey(Date.now()) === viewMonth ? dayKey(Date.now()) : `${viewMonth}-01`);
    f.start.value = '09:00'; f.end.value = '18:00'; f.breakMin.value = 60;
  }
  dialog.showModal();
}
$('btn-add').addEventListener('click', () => openEdit('records', null));
$('btn-add-shift').addEventListener('click', () => openEdit('shifts', null));
$('edit-cancel').addEventListener('click', () => dialog.close());

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = form.elements;
  const start = new Date(`${f.date.value}T${f.start.value}`).getTime();
  let end = new Date(`${f.date.value}T${f.end.value}`).getTime();
  const breakMin = Number(f.breakMin.value);
  if (Number.isNaN(start) || Number.isNaN(end)) { $('edit-error').textContent = '日付と時刻を入力してください。'; return; }
  if (end <= start) { const d = new Date(end); d.setDate(d.getDate() + 1); end = d.getTime(); }
  if (!(breakMin >= 0) || breakMin * 60000 >= end - start) {
    $('edit-error').textContent = '休憩は勤務時間より短くしてください。'; return;
  }
  const data = { start, end, breakMin: Math.round(breakMin) };
  const { kind, id } = editing;
  if (id) store[kind] = store[kind].map((r) => (r.id === id ? { ...r, ...data } : r));
  else store[kind].push({ id: crypto.randomUUID(), ...data });
  save(KEYS[kind], store[kind]);
  viewMonth = monthKey(start);
  dialog.close();
  renderAll();
});

// ---- CSV ----
$('btn-csv').addEventListener('click', () => {
  const lines = [['日付', '開始', '終了', '休憩(分)', '実働(分)', '深夜(分)', '残業(分)', '支給額'].join(',')];
  for (const r of inMonth('records')) {
    const p = shiftPay(r, settings);
    lines.push([dayKey(r.start), timeOf(r.start), timeOf(r.end), p.breakMin, p.worked, p.night, p.overtime, p.pay].join(','));
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kyuryo-${viewMonth}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---- 設定 ----
const settingsForm = $('settings');

function fillSettings() {
  for (const el of settingsForm.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = !!settings[el.name];
    else el.value = settings[el.name];
  }
  syncSettingsVisibility();
}

function syncSettingsVisibility() {
  for (const el of settingsForm.querySelectorAll('[data-mode]')) {
    el.hidden = el.dataset.mode !== settings.socialInsuranceMode;
  }
  settingsForm.elements.employmentInsuranceRate.closest('label').hidden = !settings.employmentInsurance;
  settingsForm.elements.dependents.closest('label').hidden = settings.taxColumn !== 'kou';
}

settingsForm.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.name) return;
  if (el.type === 'checkbox') settings[el.name] = el.checked;
  else if (el.type === 'number') settings[el.name] = Math.max(0, Number(el.value) || 0);
  else settings[el.name] = el.value;
  save(KEYS.settings, settings);
  syncSettingsVisibility();
  renderAll();
});
settingsForm.addEventListener('submit', (ev) => ev.preventDefault());

function renderAll() { renderCalendar(); renderMonth(); renderHistory(); renderDayDialog(); renderTimer(); }

fillSettings();
renderAll();
setInterval(renderTimer, 1000);
window.addEventListener('storage', () => {
  store.records = load(KEYS.records, []);
  store.shifts = load(KEYS.shifts, []);
  settings = { ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) };
  timer = load(KEYS.timer, null);
  fillSettings(); renderAll();
});
