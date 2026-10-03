import type { OrderRecord } from '../db/repositories';
import type { UpbitCreateOrderBody } from '../upbit/types';

/** 주문 실행기. PAPER(가상)와 LIVE(업비트 실제)가 같은 인터페이스를 가진다. */
export interface Executor {
  readonly mode: 'PAPER' | 'LIVE';
  /** 주문 전송. 결과(접수/거절/체결)는 OrderService의 콜백으로 반영한다. */
  place(order: OrderRecord, body: UpbitCreateOrderBody): Promise<void>;
  /** 주문 취소 요청 */
  cancel(order: OrderRecord): Promise<void>;
}

export interface FillInput {
  price: string;
  volume: string;
  fee: string;
  tradeUuid: string | null;
  timestamp: string;
}
