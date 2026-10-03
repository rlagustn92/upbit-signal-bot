import type { OrderState } from '../../shared/types';
import { D } from './orderMath';

/** 업비트 원본 상태 → 내부 상태. 업비트가 상태를 추가하면 이 함수만 고친다. */
export function mapUpbitState(
  upbitState: string,
  executedVolume: string | number | null | undefined,
  remainingVolume?: string | number | null,
): OrderState {
  const executed = D(executedVolume ?? 0);
  switch (upbitState) {
    case 'wait':
      return executed.gt(0) ? 'PARTIALLY_FILLED' : 'OPEN';
    case 'watch':
      return 'WATCH';
    case 'trade': // myOrder 전용: 체결 발생 이벤트
      return remainingVolume != null && D(remainingVolume).lte(0) ? 'FILLED' : 'PARTIALLY_FILLED';
    case 'done':
      return 'FILLED';
    case 'cancel':
      return executed.gt(0) ? 'PARTIALLY_FILLED_CANCELLED' : 'CANCELLED';
    case 'prevented':
      return 'PREVENTED';
    default:
      return 'UNKNOWN';
  }
}

const TERMINAL: ReadonlySet<OrderState> = new Set<OrderState>([
  'FILLED',
  'CANCELLED',
  'PARTIALLY_FILLED_CANCELLED',
  'PREVENTED',
  'REJECTED',
]);

export function isTerminal(state: OrderState): boolean {
  return TERMINAL.has(state);
}

/** 아직 거래소에 살아 있을 수 있는(또는 결과 미확인) 상태 */
export function isActive(state: OrderState): boolean {
  return !isTerminal(state);
}
