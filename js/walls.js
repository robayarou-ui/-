// 年収の基準額（いわゆる「年収の壁」）。給与収入だけの人を前提にした目安。
// 出典（国税庁タックスアンサー・厚生労働省、令和8年4月1日現在法令等）:
//   No.1199 基礎控除 / No.1410 給与所得控除 / No.1180 扶養控除 / No.1177 特定親族特別控除
//   No.1191 配偶者控除 / No.1195 配偶者特別控除
//   https://www.mhlw.go.jp/stf/taiou_001_00002.html （年収の壁への対応）
// basis: 'tax' = 交通費を除く給与収入、'social' = 交通費を含む収入
// under: true は「未満」、false は「以下」が基準

export const PROFILES = [
  { id: 'student', label: '19〜22歳で、親などの扶養に入っている' },
  { id: 'dependent', label: '親などの扶養に入っている（上記以外の年齢）' },
  { id: 'spouse', label: '配偶者の扶養に入っている' },
  { id: 'none', label: '扶養に入っていない' },
];

const man = (n) => Math.round(n * 10000);

function taxWalls(v) {
  return [
    { id: 'self', profiles: ['student', 'dependent', 'spouse', 'none'], basis: 'tax', amount: v.self,
      title: '自分の所得税', effect: 'これを超えると、自分の給料に所得税がかかります。' },
    { id: 'dep', profiles: ['dependent'], basis: 'tax', amount: v.dep,
      title: '扶養控除', effect: 'これを超えると、扶養している家族が扶養控除を受けられなくなり、家族の税金が増えます。' },
    { id: 'student-full', profiles: ['student'], basis: 'tax', amount: v.studentFull,
      title: '家族の控除（満額）', effect: 'これを超えると、扶養している家族の控除（63万円）が段階的に減り、家族の税金が増えます。' },
    { id: 'student-end', profiles: ['student'], basis: 'tax', amount: v.studentEnd,
      title: '家族の控除（上限）', effect: 'これを超えると、扶養している家族の控除がなくなります。' },
    { id: 'spouse-full', profiles: ['spouse'], basis: 'tax', amount: v.spouseFull,
      title: '配偶者の控除（満額）', effect: 'これを超えると、配偶者が受ける控除（38万円）が段階的に減り、配偶者の税金が増えます。' },
    { id: 'spouse-end', profiles: ['spouse'], basis: 'tax', amount: v.spouseEnd, under: v.spouseEndUnder,
      title: '配偶者の控除（上限）', effect: 'これを超えると、配偶者が受ける控除がなくなります。' },
  ];
}

const SOCIAL_WALLS = [
  { id: 'social', profiles: ['dependent', 'spouse'], basis: 'social', amount: man(130), under: true,
    title: '社会保険の扶養', effect: 'この金額以上になる見込みだと、家族の健康保険の扶養から外れ、自分で保険料を払います。' },
  { id: 'social-student', profiles: ['student'], basis: 'social', amount: man(150), under: true,
    title: '社会保険の扶養', effect: 'この金額以上になる見込みだと、家族の健康保険の扶養から外れ、自分で保険料を払います。' },
];

const SETS = [
  { from: 2026, label: '令和8年分・令和9年分の基準',
    walls: [...taxWalls({ self: man(178), dep: man(136), studentFull: man(159), studentEnd: man(197), spouseFull: man(169), spouseEnd: man(207) }), ...SOCIAL_WALLS] },
  { from: 2025, label: '令和7年分の基準',
    walls: [...taxWalls({ self: man(160), dep: man(123), studentFull: man(150), studentEnd: man(188), spouseFull: man(160), spouseEnd: 2016000, spouseEndUnder: true }), ...SOCIAL_WALLS] },
];

export function wallsFor(year, profile) {
  const set = SETS.find((s) => year >= s.from);
  if (!set) return { label: null, walls: [] };
  return { label: set.label, walls: set.walls.filter((w) => w.profiles.includes(profile)) };
}

// actual / forecast は { tax, social } の年間金額。state: over=実績で超過、warn=見込みで超過、ok
export function wallStatus(wall, actual, forecast) {
  const a = actual[wall.basis];
  const f = forecast[wall.basis];
  const exceeds = (x) => (wall.under ? x >= wall.amount : x > wall.amount);
  const max = wall.under ? wall.amount - 1 : wall.amount;
  return {
    ...wall, actual: a, forecast: f, remaining: max - f,
    state: exceeds(a) ? 'over' : exceeds(f) ? 'warn' : 'ok',
  };
}
