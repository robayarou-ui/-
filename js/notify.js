import { dayKey } from './calc.js';

const MIN = 60000;
const PAYDAY_HOUR = 9;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// いま出すべき通知を返す。sent は通知済みキーの集合。
// シフト: 開始の leadMin 分前から開始時刻まで。給料日: 当日の9時以降に1回。
export function dueNotifications({ shifts, workplaces, prefs, now, sent }) {
  const out = [];
  const nameOf = (id) => (workplaces.find((w) => w.id === id) || workplaces[0] || {}).name || '';
  const multi = workplaces.length > 1;
  if (prefs.notifyShift) {
    const lead = Math.max(0, prefs.notifyLeadMin ?? 60) * MIN;
    for (const s of shifts) {
      const key = `shift:${s.id}:${s.start}`;
      if (sent.has(key) || now < s.start - lead || now >= s.start) continue;
      const mins = Math.ceil((s.start - now) / MIN);
      out.push({
        key, title: 'もうすぐシフトです',
        body: `${multi ? `${nameOf(s.workplaceId)} ` : ''}${hhmm(s.start)}〜${hhmm(s.end)}（あと${mins}分）`,
      });
    }
  }
  if (prefs.notifyPayday) {
    const d = new Date(now);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (d.getHours() >= PAYDAY_HOUR) {
      for (const w of workplaces) {
        if (!(w.payday > 0) || Math.min(w.payday, last) !== d.getDate()) continue;
        const key = `payday:${w.id}:${dayKey(now)}`;
        if (sent.has(key)) continue;
        out.push({ key, title: '今日は給料日です', body: multi ? `${w.name}の給料日です。` : '給料日です。' });
      }
    }
  }
  return out;
}
