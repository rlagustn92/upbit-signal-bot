// 하이퍼리퀴드 체결 기록 → '롱 보유 구간' 복원 → 업비트 원화 캔들에 대입해 '따라 했으면' 수익을 계산
// (레버리지 없이, 수량은 무시하고 방향만 따라 함. 숏은 따라 하지 않음 = 그동안 현금)
import type { Bar } from '../indicators';
import type { HlFill } from './client';

export interface LongInterval {
  open: number;
  /** 아직 보유 중이면 null */
  close: number | null;
}

const EPS = 1e-9;

/** 한 코인의 체결 기록(시간순)에서 롱 보유 구간을 찾는다. 기록 시작 전부터 들고 있던 롱은 진입 시점을 모르므로 제외 */
export function longIntervals(fills: HlFill[]): LongInterval[] {
  const out: LongInterval[] = [];
  let cur: LongInterval | null = null;
  for (const f of [...fills].sort((a, b) => a.time - b.time)) {
    const before = Number(f.startPosition);
    const after = before + (f.side === 'B' ? 1 : -1) * Number(f.sz);
    if (before <= EPS && after > EPS) cur = { open: f.time, close: null };
    else if (before > EPS && after <= EPS && cur) {
      // 기록 시작 전부터 들고 있던 롱(cur 없음)의 청산은 진입 시점을 모르므로 무시
      cur.close = f.time;
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export interface ReplayTrade {
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  /** 수수료·미끄러짐 포함 수익률(소수) */
  ret: number;
  open: boolean;
}

/** 신호 시각 + 지연(lagMs) 뒤 처음 시작하는 캔들의 시가에 시장가 체결한다고 가정 */
export function replayOnBars(
  intervals: LongInterval[],
  bars: Bar[],
  opt: { lagMs: number; fee: number; slip: number },
): ReplayTrade[] {
  const out: ReplayTrade[] = [];
  if (!bars.length) return out;
  const firstAfter = (t: number) => {
    let lo = 0;
    let hi = bars.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].start < t) lo = mid + 1;
      else hi = mid;
    }
    return lo < bars.length ? lo : -1;
  };
  for (const iv of intervals) {
    const ei = firstAfter(iv.open + opt.lagMs);
    if (ei < 0) continue;
    let xi = iv.close != null ? firstAfter(iv.close + opt.lagMs) : -1;
    const open = xi < 0;
    if (open) xi = bars.length - 1;
    if (xi < ei) xi = ei;
    const entry = bars[ei].open * (1 + opt.slip);
    const exitRaw = open ? bars[xi].close : bars[xi].open;
    const exit = exitRaw * (1 - opt.slip);
    out.push({ entryTime: bars[ei].start, exitTime: bars[xi].start, entry, exit, ret: (exit * (1 - opt.fee)) / (entry * (1 + opt.fee)) - 1, open });
  }
  return out;
}
