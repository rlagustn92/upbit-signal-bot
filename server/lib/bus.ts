import { EventEmitter } from 'node:events';
import type { CandleUnit } from '../../shared/types';
import type { OrderRecord, TradeRecord } from '../db/repositories';

/** 서비스 간 이벤트. (서비스끼리 직접 import 순환을 피하기 위함) */
export interface BusEvents {
  ticker: [market: string, price: number];
  trade: [market: string, price: number, volume: number, timestamp: number];
  candleClose: [market: string, unit: CandleUnit];
  /** 주문 상태 변화. deltaFilled: 이번 변화에서 새로 체결된 수량, transitionedToTerminal: 이번에 종료 상태가 됨 */
  orderUpdated: [order: OrderRecord, deltaFilled: number, deltaAvgPrice: number, transitionedToTerminal: boolean];
  tradeRecorded: [trade: TradeRecord];
  positionClosed: [botId: number];
  /** 화면 갱신이 필요함 */
  changed: [];
  /** 체결/시그널 목록이 바뀜 */
  activity: [];
}

export class Bus extends EventEmitter {
  emitTyped<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]): boolean {
    return super.emit(event, ...args);
  }
  onTyped<K extends keyof BusEvents>(event: K, listener: (...args: BusEvents[K]) => void): this {
    return super.on(event, listener as (...a: unknown[]) => void);
  }
}
