import { DEFAULT_SETTINGS, shiftPay, monthlySummary, monthKey } from './calc.js';

const KEYS = { records: 'kyuryo.records', settings: 'kyuryo.settings', timer: 'kyuryo.timer' };
const $ = (id) => document.getElementById(id);
const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
const pad = (n) => String(n).padStart(2, '0');
const hm = (min) => `${Math.floor(min / 60)}時間${pad(min % 60)}分`;
const timeOf = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dateOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

let records = load(KEYS.records, []);
let settings = { ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) };
let timer = load(KEYS.timer, null); // { start, breakMs, breakStart }
let viewMonth = monthKey(Date.now());
let editingId = null;

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
    $('timer-detail').textContent = '「出勤」を押すと計測を始めます。';
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
  records.push({
    id: crypto.randomUUID(), start: timer.start, end: now,
    breakMin: Math.round(timerBreakMs(now) / 60000),
  });
  viewMonth = monthKey(timer.start);
  timer = null;
  localStorage.removeItem(KEYS.timer);
  save(KEYS.records, records);
  renderAll();
});
$('btn-cancel').addEventListener('click', () => {
  if (!timer || !confirm('計測中の勤務を記録せずに取り消しますか？')) return;
  timer = null;
  localStorage.removeItem(KEYS.timer);
  renderTimer();
});

// ---- 月の集計 ----
const monthRecords = () => records
  .filter((r) => monthKey(r.start) === viewMonth)
  .sort((a, b) => a.start - b.start);

function row(tbody, label, value, cls) {
  const tr = tbody.insertRow();
  if (cls) tr.className = cls;
  tr.insertCell().textContent = label;
  tr.insertCell().textContent = value;
}

function renderMonth() {
  const [y, m] = viewMonth.split('-').map(Number);
  $('month-h').textContent = `${y}年${m}月`;
  const list = monthRecords();
  const s = monthlySummary(list, settings);
  $('sum-net').textContent = yen(s.net);

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

  const body = $('records'); body.replaceChildren();
  for (const r of list) {
    const p = shiftPay(r, settings);
    const d = new Date(r.start);
    const tr = body.insertRow();
    tr.insertCell().textContent = `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
    tr.insertCell().textContent = timeOf(r.start);
    tr.insertCell().textContent = timeOf(r.end) + (dateOf(r.end) !== dateOf(r.start) ? '（翌）' : '');
    tr.insertCell().textContent = `${p.breakMin}分`;
    tr.insertCell().textContent = hm(p.worked);
    const c = tr.insertCell(); c.className = 'num'; c.textContent = yen(p.pay);
    const act = tr.insertCell();
    const e = document.createElement('button');
    e.className = 'small'; e.textContent = '編集';
    e.addEventListener('click', () => openEdit(r));
    const x = document.createElement('button');
    x.className = 'small ghost'; x.textContent = '削除';
    x.addEventListener('click', () => {
      if (!confirm('この記録を削除しますか？')) return;
      records = records.filter((o) => o.id !== r.id);
      save(KEYS.records, records); renderMonth();
    });
    act.append(e, ' ', x);
  }
  $('records-empty').hidden = list.length > 0;
  $('btn-csv').disabled = list.length === 0;
}

function shiftMonth(delta) {
  const [y, m] = viewMonth.split('-').map(Number);
  viewMonth = monthKey(new Date(y, m - 1 + delta, 1).getTime());
  renderMonth();
}
$('month-prev').addEventListener('click', () => shiftMonth(-1));
$('month-next').addEventListener('click', () => shiftMonth(1));

// ---- 記録の追加・編集 ----
const dialog = $('edit-dialog');
const form = $('edit-form');

function openEdit(record) {
  editingId = record ? record.id : null;
  $('edit-title').textContent = record ? '勤務記録を編集' : '勤務記録を追加';
  $('edit-error').textContent = '';
  const f = form.elements;
  if (record) {
    f.date.value = dateOf(record.start);
    f.start.value = timeOf(record.start);
    f.end.value = timeOf(record.end);
    f.breakMin.value = record.breakMin;
  } else {
    const today = monthKey(Date.now()) === viewMonth ? dateOf(Date.now()) : `${viewMonth}-01`;
    f.date.value = today; f.start.value = '09:00'; f.end.value = '18:00'; f.breakMin.value = 60;
  }
  dialog.showModal();
}
$('btn-add').addEventListener('click', () => openEdit(null));
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
  if (editingId) records = records.map((r) => (r.id === editingId ? { ...r, ...data } : r));
  else records.push({ id: crypto.randomUUID(), ...data });
  save(KEYS.records, records);
  viewMonth = monthKey(start);
  dialog.close();
  renderMonth();
});

// ---- CSV ----
$('btn-csv').addEventListener('click', () => {
  const lines = [['日付', '開始', '終了', '休憩(分)', '実働(分)', '深夜(分)', '残業(分)', '支給額'].join(',')];
  for (const r of monthRecords()) {
    const p = shiftPay(r, settings);
    lines.push([dateOf(r.start), timeOf(r.start), timeOf(r.end), p.breakMin, p.worked, p.night, p.overtime, p.pay].join(','));
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
  renderMonth(); renderTimer();
});
settingsForm.addEventListener('submit', (ev) => ev.preventDefault());

function renderAll() { renderTimer(); renderMonth(); }

fillSettings();
renderAll();
setInterval(renderTimer, 1000);
window.addEventListener('storage', () => {
  records = load(KEYS.records, []);
  settings = { ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) };
  timer = load(KEYS.timer, null);
  fillSettings(); renderAll();
});
