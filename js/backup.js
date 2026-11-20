import { DEFAULT_SETTINGS } from './calc.js';

const APP = 'kyuryo-timer';

export function makeBackup({ records, shifts, workplaces, prefs }, nowMs = Date.now()) {
  return { app: APP, version: 1, exportedAt: new Date(nowMs).toISOString(), data: { records, shifts, workplaces, prefs } };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function cleanItems(list, ids) {
  if (!Array.isArray(list)) throw new Error('勤務記録またはシフトの形式が正しくありません。');
  return list.map((r) => {
    const ok = isObj(r) && typeof r.id === 'string' && Number.isFinite(r.start) && Number.isFinite(r.end)
      && r.end >= r.start && ids.has(r.workplaceId);
    if (!ok) throw new Error('勤務記録またはシフトに読み込めないデータがあります。');
    const breakMin = Number.isFinite(r.breakMin) && r.breakMin >= 0 ? Math.round(r.breakMin) : 0;
    return { id: r.id, start: r.start, end: r.end, breakMin, workplaceId: r.workplaceId };
  });
}

// バックアップのテキストを検証して、保存できる形にして返す。不正なら Error を投げる。
export function parseBackup(text) {
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('バックアップファイルを読み取れませんでした。'); }
  if (!isObj(json) || json.app !== APP || !isObj(json.data)) throw new Error('給料タイマーのバックアップファイルではありません。');
  const d = json.data;
  if (!Array.isArray(d.workplaces) || !d.workplaces.length) throw new Error('勤務先のデータがありません。');
  const workplaces = d.workplaces.map((w) => {
    if (!isObj(w) || typeof w.id !== 'string' || !w.id) throw new Error('勤務先のデータが正しくありません。');
    const out = { id: w.id, name: String(w.name || '勤務先').slice(0, 30), color: /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : '#1f6feb' };
    out.payday = Number.isFinite(w.payday) ? Math.min(31, Math.max(0, Math.round(w.payday))) : 0;
    for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
      const v = w[k];
      if (typeof def === 'number') out[k] = Number.isFinite(v) && v >= 0 ? v : def;
      else if (typeof def === 'boolean') out[k] = typeof v === 'boolean' ? v : def;
      else out[k] = typeof v === 'string' ? v : def;
    }
    if (!['kou', 'otsu'].includes(out.taxColumn)) out.taxColumn = DEFAULT_SETTINGS.taxColumn;
    if (!['none', 'rate', 'fixed'].includes(out.socialInsuranceMode)) out.socialInsuranceMode = DEFAULT_SETTINGS.socialInsuranceMode;
    return out;
  });
  const ids = new Set(workplaces.map((w) => w.id));
  if (ids.size !== workplaces.length) throw new Error('勤務先のデータが重複しています。');
  return {
    workplaces,
    records: cleanItems(d.records ?? [], ids),
    shifts: cleanItems(d.shifts ?? [], ids),
    prefs: isObj(d.prefs) ? d.prefs : {},
  };
}
