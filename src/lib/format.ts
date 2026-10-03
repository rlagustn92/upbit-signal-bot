// 화면 표시용 포맷터 (원/수량/퍼센트/상대시간)

export function won(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

export function signedWon(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const r = Math.round(n);
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r).toLocaleString('ko-KR')}원`;
}

/** 코인 가격: 100원 이상은 정수, 그 아래는 소수 표시 */
export function price(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (v == null || !Number.isFinite(v)) return '-';
  const digits = v >= 100 ? 0 : v >= 1 ? 2 : 6;
  return v.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

export function signedPercent(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const v = Number(n.toFixed(digits));
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function qty(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (v == null || !Number.isFinite(v)) return '-';
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 8 });
}

/** "방금 전", "12분 전", "3시간 전", "어제 19:30", "9/28 14:05" */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = now - t;
  if (diff < 60_000) return '방금 전';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  const d = new Date(t);
  const today = new Date(now);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === today.toDateString()) return `${Math.floor(diff / 3600_000)}시간 전`;
  const y = new Date(now - 86400_000);
  if (d.toDateString() === y.toDateString()) return `어제 ${hhmm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
}

export function baseSymbol(displaySymbol: string): string {
  return displaySymbol.split('/')[0];
}
