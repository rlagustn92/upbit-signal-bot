import type { CandleUnit, OrderPurpose, PermissionState, StrategyKind, SystemStateDTO } from '../../shared/types';

// ▶ 화면 문구는 이 파일에서 관리한다 (화면 = 쉬운 말, 코드 = 업비트 용어)

/** 원본 UI의 전략 표시명 유지 */
export const STRATEGY_LABEL: Record<StrategyKind, string> = {
  grid: '무한 그물망(그리드)',
  rsi: '과매도 반등 줍줍(RSI)',
  goldenCross: '골든크로스 돌파',
  bollinger: '볼린저 반등',
};

export const CANDLE_LABEL: Record<CandleUnit, string> = {
  '1m': '1분봉',
  '3m': '3분봉',
  '5m': '5분봉',
  '10m': '10분봉',
  '15m': '15분봉',
  '30m': '30분봉',
  '60m': '60분봉',
  '240m': '4시간봉',
  '1d': '일봉',
};

export const MODE_LABEL = { PAPER: '모의', LIVE: '실전' } as const;

/** 체결 배지 */
export function tradeBadge(side: 'bid' | 'ask', purpose: OrderPurpose, pnl: number | null): { text: string; tone: 'buy' | 'profit' | 'neutral' } {
  if (side === 'bid') return { text: '코인 사기', tone: 'buy' };
  if (purpose === 'STOP_LOSS') return { text: '손절 팔기', tone: 'neutral' };
  if (pnl != null && pnl >= 0) return { text: '익절 팔기', tone: 'profit' };
  return { text: '코인 팔기', tone: 'neutral' };
}

export const PERMISSION_TEXT: Record<PermissionState, string> = {
  OK: '가능',
  DENIED: '권한 없음',
  UNKNOWN: '확인 불가',
  NOT_CHECKED: '확인 전',
};

export interface StatusChip {
  text: string;
  chip: string;
  dot: string;
  pulse: boolean;
}

/** 헤더 상태 칩 — 실제 시스템 상태를 그대로 보여준다 */
export function systemChip(sys: SystemStateDTO | null, backendConnected: boolean, liveActive: boolean): StatusChip {
  const mode = liveActive ? '실전' : '모의투자';
  if (!backendConnected || !sys) return { text: '서버 연결 끊김', chip: 'bg-rose-50 text-[#F04452]', dot: 'bg-rose-500', pulse: false };
  switch (sys.status) {
    case 'EMERGENCY_STOP':
      return { text: '긴급 정지 중', chip: 'bg-rose-50 text-[#F04452]', dot: 'bg-rose-500', pulse: false };
    case 'CONNECTING':
      return { text: '업비트 연결 중', chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500', pulse: true };
    case 'DISCONNECTED':
      return { text: sys.publicStream === 'RECONNECTING' ? '재연결 중' : '시세 연결 끊김', chip: 'bg-rose-50 text-[#F04452]', dot: 'bg-rose-500', pulse: true };
    case 'DEGRADED':
      return { text: `${mode} · 계좌 연결 확인 필요`, chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500', pulse: true };
    default:
      return {
        text: sys.activeBots > 0 ? `${mode} · ${sys.activeBots}개 봇 감시 중` : '정상 연결 · 대기 중',
        chip: 'bg-[#E8F3FF] text-[#1B64DA]',
        dot: 'bg-emerald-500',
        pulse: sys.activeBots > 0,
      };
  }
}
