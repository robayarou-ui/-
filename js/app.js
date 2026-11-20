import {
  DEFAULT_SETTINGS, WORKPLACE_COLORS, shiftPay, settingsFor, combinedSummary, monthKey, dayKey,
  earningsHistory, pendingShifts, buildShift, shiftTemplates, yearPlan,
} from './calc.js';
import { PROFILES, wallsFor, wallStatus } from './walls.js';

const KEYS = {
  records: 'kyuryo.records', shifts: 'kyuryo.shifts', settings: 'kyuryo.settings',
  workplaces: 'kyuryo.workplaces', prefs: 'kyuryo.prefs', timer: 'kyuryo.timer',
};
const $ = (id) => document.getElementById(id);
const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
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
const store = { records: [], shifts: [] };
const KIND_LABEL = { records: '勤務記録', shifts: 'シフト' };
let workplaces = [];
let prefs = {};
let timer = null; // { start, breakMs, breakStart, workplaceId }
let viewMonth = monthKey(Date.now());
let viewYear = new Date().getFullYear();
let editing = { kind: 'records', id: null };
let openDay = null;
let bulk = null; // { workplaceId, start, end, breakMin }

function newWorkplace(base = {}) {
  const n = workplaces.length;
  return {
    ...DEFAULT_SETTINGS, ...base, id: crypto.randomUUID(),
    name: `勤務先${n + 1}`, color: WORKPLACE_COLORS[n % WORKPLACE_COLORS.length], payday: 0,
  };
}

function loadState() {
  store.records = load(KEYS.records, []);
  store.shifts = load(KEYS.shifts, []);
  timer = load(KEYS.timer, null);
  prefs = { goal: 0, editWp: null, timerWp: null, profile: 'student', planMonthly: 0, yearLimit: 0, ...load(KEYS.prefs, {}) };
  workplaces = load(KEYS.workplaces, []);
  if (!workplaces.length) {
    // 勤務先が1つだった頃の設定を引き継ぐ
    workplaces = [newWorkplace(load(KEYS.settings, {}))];
    save(KEYS.workplaces, workplaces);
  }
  const first = workplaces[0].id;
  for (const kind of ['records', 'shifts']) {
    if (store[kind].some((r) => !r.workplaceId)) {
      store[kind] = store[kind].map((r) => (r.workplaceId ? r : { ...r, workplaceId: first }));
      save(KEYS[kind], store[kind]);
    }
  }
  const has = (id) => workplaces.some((w) => w.id === id);
  if (!has(prefs.editWp)) prefs.editWp = first;
  if (!has(prefs.timerWp)) prefs.timerWp = first;
}

const wpOf = (r) => settingsFor(r, workplaces);
const payOf = (r) => shiftPay(r, wpOf(r));
const multi = () => workplaces.length > 1;
const byStart = (a, b) => a.start - b.start;
const inMonth = (kind) => store[kind].filter((r) => monthKey(r.start) === viewMonth).sort(byStart);
const onDay = (kind, key) => store[kind].filter((r) => dayKey(r.start) === key).sort(byStart);
const withName = (r, text) => (multi() ? `${wpOf(r).name} ${text}` : text);
// シフトの型（開始・終了が HH:MM）の表示。休憩が違う型を見分けられるようにする。
const templateLabel = (t) => withName(t, `${t.start}〜${t.end}${t.breakMin ? ` 休憩${t.breakMin}分` : ''}`);

function fillWpSelect(select, value) {
  select.replaceChildren(...workplaces.map((w) => new Option(w.name, w.id)));
  select.value = value;
}

function wpLabel(w) {
  const span = document.createElement('span');
  const dot = document.createElement('span');
  dot.className = 'wp-dot'; dot.style.background = w.color;
  span.append(dot, w.name);
  return span;
}

function addItem(kind, data) {
  store[kind].push({ id: crypto.randomUUID(), ...data });
  save(KEYS[kind], store[kind]);
}

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

// よく使うシフトのボタン。押すと onPick(型) を呼ぶ。
function renderTemplates(container, onPick) {
  const list = shiftTemplates([...store.shifts, ...store.records]);
  container.replaceChildren(...list.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = templateLabel(t);
    b.addEventListener('click', () => onPick(t));
    return b;
  }));
  return list.length;
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
  $('timer-wp-label').hidden = !multi();
  $('timer-wp').disabled = !!timer;
  if (!timer) {
    status.textContent = '未出勤';
    $('timer-clock').textContent = '0:00:00';
    const today = onDay('shifts', dayKey(now));
    $('timer-detail').textContent = today.length
      ? `今日のシフト: ${today.map((s) => withName(s, rangeOf(s))).join('、')}`
      : '「出勤」を押すと計測を始めます。';
    return;
  }
  const breakMs = timerBreakMs(now);
  const sec = Math.max(0, Math.floor((now - timer.start - breakMs) / 1000));
  status.textContent = timer.breakStart ? '休憩中' : '勤務中';
  $('timer-clock').textContent = `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
  const p = payOf({ start: timer.start, end: now, breakMin: Math.floor(breakMs / 60000), workplaceId: timer.workplaceId });
  $('timer-detail').textContent =
    `${timeOf(timer.start)} 出勤 ／ 休憩 ${Math.floor(breakMs / 60000)}分 ／ ここまで ${yen(p.pay)}`;
}

$('timer-wp').addEventListener('change', (ev) => {
  prefs.timerWp = ev.target.value; save(KEYS.prefs, prefs);
});
$('btn-start').addEventListener('click', () => {
  timer = { start: Date.now(), breakMs: 0, breakStart: null, workplaceId: prefs.timerWp };
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
  addItem('records', {
    start: timer.start, end: now, breakMin: Math.round(timerBreakMs(now) / 60000),
    workplaceId: wpOf(timer).id,
  });
  viewMonth = monthKey(timer.start);
  timer = null;
  localStorage.removeItem(KEYS.timer);
  renderAll();
});
$('btn-cancel').addEventListener('click', () => {
  if (!timer || !confirm('計測中の勤務を記録せずに取り消しますか？')) return;
  timer = null;
  localStorage.removeItem(KEYS.timer);
  renderTimer();
});

// ---- カレンダー ----
function tag(cls, text, color) {
  const s = document.createElement('span');
  s.className = `tag ${cls}`; s.textContent = text;
  if (color) s.style.setProperty('--wp', color);
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
      const pays = recs.map(payOf);
      const worked = pays.reduce((a, p) => a + p.worked, 0);
      const pay = pays.reduce((a, p) => a + p.pay, 0);
      const color = wpOf(recs[0]).color;
      b.append(tag('rec', `${Math.floor(worked / 60)}:${pad(worked % 60)}`, color), tag('rec', yen(pay), color));
      parts.push(`勤務 ${hm(worked)} ${yen(pay)}`);
    }
    for (const s of shifts) {
      b.append(tag('shift', `${timeOf(s.start)}-${timeOf(s.end)}`, wpOf(s).color));
      parts.push(`シフト ${withName(s, rangeOf(s))}`);
    }
    const paydays = workplaces.filter((w) => w.payday > 0 && Math.min(w.payday, days) === d);
    if (paydays.length) {
      b.append(tag('pay', '給料日'));
      parts.push(`給料日${multi() ? `（${paydays.map((w) => w.name).join('、')}）` : ''}`);
    }
    b.setAttribute('aria-label', parts.join('、'));
    b.addEventListener('click', () => (bulk ? toggleBulkDay(key) : openDayDialog(key)));
    body.append(b);
  }
  $('bulk-bar').hidden = !bulk;
  $('btn-bulk').hidden = !!bulk;
  body.classList.toggle('bulk-on', !!bulk);
  if (bulk) {
    $('bulk-text').textContent =
      `まとめて追加中: ${templateLabel(bulk)}。追加する日を押してください（もう一度押すと取り消し）。`;
  }
}

// ---- まとめて追加 ----
function toggleBulkDay(key) {
  const same = onDay('shifts', key).find((s) =>
    s.workplaceId === bulk.workplaceId && timeOf(s.start) === bulk.start && timeOf(s.end) === bulk.end
    && s.breakMin === bulk.breakMin);
  if (same) {
    store.shifts = store.shifts.filter((s) => s.id !== same.id);
    save(KEYS.shifts, store.shifts);
  } else {
    addItem('shifts', { ...buildShift(key, bulk.start, bulk.end, bulk.breakMin), workplaceId: bulk.workplaceId });
  }
  renderAll();
}
$('btn-bulk').addEventListener('click', () => openEdit('bulk', null));
$('bulk-done').addEventListener('click', () => { bulk = null; renderCalendar(); });

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
      const p = payOf(r);
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = withName(r, `${rangeOf(r)}　休憩${p.breakMin}分　${hm(p.worked)}　${kind === 'shifts' ? '見込み ' : ''}${yen(p.pay)}`);
      li.append(text, actionButtons(kind, r));
      ul.append(li);
    }
  }
  const day = openDay;
  const count = renderTemplates($('day-templates'), (t) => {
    const shift = buildShift(day, t.start, t.end, t.breakMin);
    if (!shift) return;
    addItem('shifts', { ...shift, workplaceId: wpOf(t).id });
    renderAll();
  });
  $('day-templates-h').hidden = count === 0;
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

function renderGoal(actual, forecast) {
  const goal = prefs.goal || 0;
  const input = $('goal-input');
  if (document.activeElement !== input) input.value = goal || '';
  $('goal-bar').hidden = !goal;
  if (!goal) { $('goal-text').textContent = '目標金額を入れると、達成度をグラフで表示します。'; return; }
  const pending = Math.max(0, forecast - actual);
  const scale = Math.max(goal, forecast, 1);
  $('goal-actual').style.width = `${(actual / scale) * 100}%`;
  $('goal-pending').style.width = `${(pending / scale) * 100}%`;
  const pct = Math.floor((actual / goal) * 100);
  let text = actual >= goal
    ? `目標達成（${pct}%）。目標 ${yen(goal)} を ${yen(actual - goal)} 上回っています。`
    : `達成度 ${pct}%。目標 ${yen(goal)} まであと ${yen(goal - actual)}。`;
  if (pending && actual < goal) {
    text += forecast >= goal
      ? `シフト予定を含めると達成見込みです（見込み ${yen(forecast)}）。`
      : `シフト予定を含めてもあと ${yen(goal - forecast)} 足りません。`;
  }
  $('goal-text').textContent = text;
  $('goal-bar').setAttribute('aria-label', text);
}
$('goal-input').addEventListener('input', (ev) => {
  prefs.goal = Math.max(0, Math.round(Number(ev.target.value) || 0));
  save(KEYS.prefs, prefs);
  renderMonth();
});

function renderMonth() {
  const [y, m] = viewMonth.split('-').map(Number);
  $('month-h').textContent = `${y}年${m}月`;
  const list = inMonth('records');
  const s = combinedSummary(list, workplaces);
  $('sum-net').textContent = yen(s.net);

  const pay = $('sum-pay'); pay.replaceChildren();
  row(pay, '基本給', yen(s.base));
  if (s.nightPay) row(pay, '深夜割増', yen(s.nightPay));
  if (s.overtimePay) row(pay, '残業割増', yen(s.overtimePay));
  if (s.commute) row(pay, '交通費', yen(s.commute));
  row(pay, '支給額合計', yen(s.gross), 'total');

  const ded = $('sum-ded'); ded.replaceChildren();
  row(ded, '所得税', yen(s.incomeTax));
  if (s.employment) row(ded, '雇用保険', yen(s.employment));
  if (s.health) row(ded, '健康保険', yen(s.health));
  if (s.pension) row(ded, '厚生年金', yen(s.pension));
  if (s.residentTax) row(ded, '住民税', yen(s.residentTax));
  row(ded, '差し引き合計', yen(s.deductions), 'total');

  $('sum-hours').textContent =
    `出勤 ${s.days}日 ／ 実働 ${hm(s.worked)}（うち深夜 ${hm(s.night)}、残業 ${hm(s.overtime)}）`;

  const pending = pendingShifts(inMonth('shifts'), list);
  const f = pending.length ? combinedSummary([...list, ...pending], workplaces) : s;
  const forecast = $('sum-forecast');
  forecast.hidden = pending.length === 0;
  if (pending.length) {
    forecast.textContent =
      `シフト予定 ${pending.length}件を含めた見込み: 支給額 ${yen(f.gross)} ／ 手取り ${yen(f.net)}`;
  }
  renderGoal(s.gross, f.gross);

  const parts = $('sum-parts'); parts.replaceChildren();
  $('sum-parts-table').hidden = s.parts.length < 2;
  for (const p of s.parts) {
    const tr = parts.insertRow();
    tr.insertCell().append(wpLabel(p.workplace));
    for (const t of [hm(p.worked), yen(p.gross), yen(p.net)]) tr.insertCell().textContent = t;
  }

  const body = $('records'); body.replaceChildren();
  $('records-table').classList.toggle('single', !multi());
  for (const r of list) {
    const p = payOf(r);
    const d = new Date(r.start);
    const tr = body.insertRow();
    tr.insertCell().textContent = `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
    const w = tr.insertCell(); w.className = 'wp-col'; w.append(wpLabel(wpOf(r)));
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
  const h = earningsHistory(store.records, workplaces);
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

// ---- 年収チェックと収入計画 ----
const manYen = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n > 0 ? yen(n) : '');
const limitText = (w) => `${yen(w.amount)}${w.under ? '未満' : '以下'}`;

function renderYear() {
  $('year-h').textContent = `${viewYear}年の収入`;
  const y = yearPlan(store.records, store.shifts, workplaces, viewYear, Date.now(), prefs.planMonthly);
  $('year-actual').textContent = yen(y.actualGross);
  $('year-forecast').textContent = yen(y.actualGross + y.pendingGross);
  $('year-total').textContent = yen(y.actualGross + y.pendingGross + y.planned);

  const sum = (m) => m.actualGross + m.pendingGross + m.planned;
  const max = Math.max(1, ...y.months.map(sum));
  const current = monthKey(Date.now());
  $('year-chart').replaceChildren(...y.months.map((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    if (m.key === current) b.className = 'current';
    const val = document.createElement('span');
    val.className = 'val'; val.textContent = manYen(sum(m));
    const stack = document.createElement('span');
    stack.className = 'stack'; stack.style.height = `${(sum(m) / max) * 78}%`;
    for (const [cls, v] of [['rec', m.actualGross], ['pend', m.pendingGross], ['plan', m.planned]]) {
      if (!v) continue;
      const seg = document.createElement('span');
      seg.className = `seg ${cls}`; seg.style.flex = `${v} 0 0`;
      stack.append(seg);
    }
    const mon = document.createElement('span');
    mon.className = 'mon'; mon.textContent = `${m.month}月`;
    b.append(val, stack, mon);
    b.setAttribute('aria-label',
      `${viewYear}年${m.month}月 実績 ${yen(m.actualGross)}、シフト予定 ${yen(m.pendingGross)}、計画 ${yen(m.planned)}。この月を表示`);
    b.addEventListener('click', () => {
      viewMonth = m.key; renderCalendar(); renderMonth();
      $('month-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return b;
  }));

  for (const [id, key] of [['plan-input', 'planMonthly'], ['limit-input', 'yearLimit']]) {
    if (document.activeElement !== $(id)) $(id).value = prefs[key] || '';
  }
  const select = $('profile-select');
  if (!select.options.length) select.replaceChildren(...PROFILES.map((p) => new Option(p.label, p.id)));
  select.value = prefs.profile;

  const set = wallsFor(viewYear, prefs.profile);
  const walls = [...set.walls];
  if (prefs.yearLimit > 0) {
    walls.unshift({ id: 'custom', basis: 'tax', amount: prefs.yearLimit, title: '自分で決めた上限', effect: '' });
  }
  $('walls').replaceChildren(...walls.map((wall) => {
    const w = wallStatus(wall, y.actual, y.forecast);
    const li = document.createElement('li');
    li.className = w.state;
    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('span'); title.textContent = w.title;
    const limit = document.createElement('span'); limit.textContent = limitText(w);
    head.append(title, limit);
    const bar = document.createElement('div');
    bar.className = 'goal-bar';
    const scale = Math.max(w.amount, w.forecast, 1);
    const a = document.createElement('span'); a.className = 'a'; a.style.width = `${(w.actual / scale) * 100}%`;
    const f = document.createElement('span'); f.className = 'f'; f.style.width = `${(Math.max(0, w.forecast - w.actual) / scale) * 100}%`;
    bar.append(a, f);
    const state = document.createElement('p');
    state.className = 'state';
    const basis = w.basis === 'social' ? '（交通費を含む）' : '';
    state.textContent = w.state === 'over'
      ? `実績 ${yen(w.actual)}${basis}で、すでに基準を超えています。`
      : w.state === 'warn'
        ? `実績 ${yen(w.actual)}${basis}。年間見込み ${yen(w.forecast)} だと ${yen(-w.remaining)} 超えます。`
        : `実績 ${yen(w.actual)}${basis}。年間見込み ${yen(w.forecast)} で、基準まであと ${yen(w.remaining)} です。`;
    li.append(head, bar, state);
    if (w.effect) {
      const effect = document.createElement('p');
      effect.className = 'effect'; effect.textContent = w.effect;
      li.append(effect);
    }
    return li;
  }));
  $('walls-label').textContent = set.label
    ? `${set.label}で比べています。`
    : `${viewYear}年の基準額には対応していません（令和7年分以降に対応）。`;
}
$('year-prev').addEventListener('click', () => { viewYear -= 1; renderYear(); });
$('year-next').addEventListener('click', () => { viewYear += 1; renderYear(); });
$('profile-select').addEventListener('change', (ev) => {
  prefs.profile = ev.target.value; save(KEYS.prefs, prefs); renderYear();
});
for (const [id, key] of [['plan-input', 'planMonthly'], ['limit-input', 'yearLimit']]) {
  $(id).addEventListener('input', (ev) => {
    prefs[key] = Math.max(0, Math.round(Number(ev.target.value) || 0));
    save(KEYS.prefs, prefs); renderYear();
  });
}

// ---- 追加・編集（kind が 'bulk' のときは、まとめて追加するシフトの型を決める） ----
const dialog = $('edit-dialog');
const form = $('edit-form');

function openEdit(kind, item, day) {
  editing = { kind, id: item ? item.id : null };
  const isBulk = kind === 'bulk';
  $('edit-title').textContent = isBulk ? 'まとめて追加するシフト' : `${KIND_LABEL[kind]}を${item ? '編集' : '追加'}`;
  $('edit-submit').textContent = isBulk ? '日付を選ぶ' : '保存';
  $('edit-error').textContent = '';
  $('edit-date-label').hidden = isBulk;
  $('edit-wp-label').hidden = !multi();
  const f = form.elements;
  f.date.required = !isBulk;
  fillWpSelect(f.workplaceId, item ? wpOf(item).id : prefs.timerWp);
  if (item) {
    f.date.value = dayKey(item.start);
    f.start.value = timeOf(item.start);
    f.end.value = timeOf(item.end);
    f.breakMin.value = item.breakMin;
  } else {
    f.date.value = day || (monthKey(Date.now()) === viewMonth ? dayKey(Date.now()) : `${viewMonth}-01`);
    f.start.value = '09:00'; f.end.value = '18:00'; f.breakMin.value = 60;
  }
  renderTemplates($('edit-templates'), (t) => {
    f.workplaceId.value = wpOf(t).id;
    f.start.value = t.start; f.end.value = t.end; f.breakMin.value = t.breakMin;
  });
  $('edit-templates').hidden = !!item;
  dialog.showModal();
}
$('btn-add').addEventListener('click', () => openEdit('records', null));
$('btn-add-shift').addEventListener('click', () => openEdit('shifts', null));
$('edit-cancel').addEventListener('click', () => dialog.close());

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = form.elements;
  const { kind, id } = editing;
  const day = kind === 'bulk' ? dayKey(Date.now()) : f.date.value;
  const shift = buildShift(day, f.start.value, f.end.value, f.breakMin.value);
  if (!shift) {
    $('edit-error').textContent = '日付と時刻を入力し、休憩は勤務時間より短くしてください。';
    return;
  }
  const workplaceId = f.workplaceId.value;
  if (kind === 'bulk') {
    bulk = { workplaceId, start: f.start.value, end: f.end.value, breakMin: shift.breakMin };
    dialog.close();
    renderCalendar();
    $('bulk-bar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  const data = { ...shift, workplaceId };
  if (id) {
    store[kind] = store[kind].map((r) => (r.id === id ? { ...r, ...data } : r));
    save(KEYS[kind], store[kind]);
  } else addItem(kind, data);
  viewMonth = monthKey(shift.start);
  dialog.close();
  renderAll();
});

// ---- CSV ----
const csvCell = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
$('btn-csv').addEventListener('click', () => {
  const lines = [['日付', '勤務先', '開始', '終了', '休憩(分)', '実働(分)', '深夜(分)', '残業(分)', '支給額'].join(',')];
  for (const r of inMonth('records')) {
    const p = payOf(r);
    lines.push([dayKey(r.start), wpOf(r).name, timeOf(r.start), timeOf(r.end), p.breakMin, p.worked, p.night, p.overtime, p.pay].map(csvCell).join(','));
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kyuryo-${viewMonth}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---- 設定（勤務先ごと） ----
const settingsForm = $('settings');
const editWp = () => workplaces.find((w) => w.id === prefs.editWp) || workplaces[0];

function fillSettings() {
  const w = editWp();
  fillWpSelect($('wp-select'), w.id);
  fillWpSelect($('timer-wp'), timer ? wpOf(timer).id : prefs.timerWp);
  $('wp-delete').disabled = workplaces.length < 2;
  for (const el of settingsForm.elements) {
    if (!el.name || el === document.activeElement) continue;
    if (el.type === 'checkbox') el.checked = !!w[el.name];
    else el.value = w[el.name];
  }
  syncSettingsVisibility();
}

function syncSettingsVisibility() {
  const w = editWp();
  for (const el of settingsForm.querySelectorAll('[data-mode]')) {
    el.hidden = el.dataset.mode !== w.socialInsuranceMode;
  }
  settingsForm.elements.employmentInsuranceRate.closest('label').hidden = !w.employmentInsurance;
  settingsForm.elements.dependents.closest('label').hidden = w.taxColumn !== 'kou';
}

settingsForm.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.name) return;
  const w = editWp();
  if (el.type === 'checkbox') w[el.name] = el.checked;
  else if (el.name === 'payday') w.payday = Math.min(31, Math.max(0, Math.round(Number(el.value) || 0)));
  else if (el.type === 'number') w[el.name] = Math.max(0, Number(el.value) || 0);
  else if (el.name === 'name') w.name = el.value.trim() || '勤務先';
  else w[el.name] = el.value;
  save(KEYS.workplaces, workplaces);
  renderAll();
});
settingsForm.addEventListener('submit', (ev) => ev.preventDefault());

$('wp-select').addEventListener('change', (ev) => {
  prefs.editWp = ev.target.value; save(KEYS.prefs, prefs); fillSettings();
});
$('wp-add').addEventListener('click', () => {
  document.activeElement?.blur?.();
  const w = newWorkplace();
  workplaces.push(w);
  prefs.editWp = w.id;
  save(KEYS.workplaces, workplaces); save(KEYS.prefs, prefs);
  renderAll();
  settingsForm.elements.name.focus();
  settingsForm.elements.name.select();
});
$('wp-delete').addEventListener('click', () => {
  const w = editWp();
  if (workplaces.length < 2) return;
  if (timer && wpOf(timer).id === w.id) { alert('計測中の勤務先は削除できません。先に退勤するか取り消してください。'); return; }
  const mine = (r) => wpOf(r).id === w.id;
  const n = store.records.filter(mine).length;
  const k = store.shifts.filter(mine).length;
  if (!confirm(`「${w.name}」を削除しますか？\nこの勤務先の勤務記録 ${n}件とシフト ${k}件も削除されます。`)) return;
  store.records = store.records.filter((r) => !mine(r));
  store.shifts = store.shifts.filter((r) => !mine(r));
  workplaces = workplaces.filter((x) => x.id !== w.id);
  if (bulk && bulk.workplaceId === w.id) bulk = null;
  prefs.editWp = workplaces[0].id;
  if (prefs.timerWp === w.id) prefs.timerWp = workplaces[0].id;
  save(KEYS.records, store.records); save(KEYS.shifts, store.shifts);
  save(KEYS.workplaces, workplaces); save(KEYS.prefs, prefs);
  renderAll();
});

function renderAll() {
  fillSettings(); renderCalendar(); renderMonth(); renderYear(); renderHistory(); renderDayDialog(); renderTimer();
}

loadState();
renderAll();
setInterval(renderTimer, 1000);
window.addEventListener('storage', () => { loadState(); renderAll(); });
