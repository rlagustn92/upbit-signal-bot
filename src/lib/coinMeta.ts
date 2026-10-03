// 코인 아이콘/배지 색 (원본 UI 디자인 그대로). 목록에 없는 코인은 첫 글자 + 회색 배지.
const META: Record<string, { icon: string; badgeBg: string }> = {
  BTC: { icon: '₿', badgeBg: 'bg-amber-100 text-amber-700' },
  ETH: { icon: 'Ξ', badgeBg: 'bg-blue-100 text-blue-700' },
  XRP: { icon: '✕', badgeBg: 'bg-zinc-100 text-zinc-800' },
  SOL: { icon: '◎', badgeBg: 'bg-purple-100 text-purple-700' },
  DOGE: { icon: '🐕', badgeBg: 'bg-yellow-100 text-yellow-800' },
};

const FALLBACK_BG = ['bg-emerald-100 text-emerald-700', 'bg-sky-100 text-sky-700', 'bg-rose-100 text-rose-700', 'bg-orange-100 text-orange-700', 'bg-gray-100 text-gray-700'];

export function coinMeta(base: string): { icon: string; badgeBg: string } {
  const m = META[base];
  if (m) return m;
  let h = 0;
  for (const ch of base) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { icon: base.slice(0, 1), badgeBg: FALLBACK_BG[h % FALLBACK_BG.length] };
}

/** 모달의 빠른 선택(원본 UI의 4개 코인 순서 유지). 이름/가격은 업비트 실제 데이터로 채운다 */
export const QUICK_PICK_MARKETS = ['KRW-DOGE', 'KRW-BTC', 'KRW-ETH', 'KRW-SOL'];
