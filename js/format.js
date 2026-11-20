export function yen(n) {
  const v = Math.round(n);
  return (v < 0 ? '−¥' : '¥') + Math.abs(v).toLocaleString('ja-JP');
}

// 手取りがマイナスのときに理由を説明する文。マイナスでなければ空文字。
export function netNote(s) {
  if (s.net >= 0) return '';
  if (s.gross === 0) {
    return 'この月は勤務記録がありませんが、住民税など毎月の差し引きがあるためマイナスになっています。';
  }
  return '差し引き合計が支給額合計を上回っているため、手取りがマイナスになっています。';
}
