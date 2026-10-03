import type { OrderRecord } from '../db/repositories';
import { log } from '../lib/logger';
import { UpbitApiError, UpbitNetworkError, UpbitRateLimitError } from '../upbit/errors';
import type { UpbitRestClient } from '../upbit/rest';
import type { UpbitCreateOrderBody, UpbitOrder } from '../upbit/types';
import type { Executor } from './types';

export interface LiveSink {
  applyUpbitOrder(orderId: number, u: UpbitOrder): Promise<void>;
  markRejected(orderId: number, code: string, message: string): void;
  markUnknown(orderId: number, message: string): void;
  reconcileUnknown(orderId: number): Promise<void>;
  /** 마지막 안전장치: 실제 주문 직전 LIVE 허용 여부 재확인 */
  liveAllowed(): { ok: boolean; reason: string };
}

/**
 * 실전 실행기 — 업비트 실제 주문 API(POST /v1/orders, DELETE /v1/order)를 호출한다.
 * - 주문 응답 성공 ≠ 체결. 체결은 myOrder WS / REST 동기화로 별도 추적한다.
 * - 네트워크 오류로 응답을 못 받으면 UNKNOWN으로 두고 identifier로 생성 여부를 조회한다(중복 주문 방지).
 * - 자동 재시도하지 않는다.
 */
export class LiveExecutor implements Executor {
  readonly mode = 'LIVE' as const;

  constructor(
    private readonly rest: UpbitRestClient,
    private readonly sink: LiveSink,
  ) {}

  async place(order: OrderRecord, body: UpbitCreateOrderBody): Promise<void> {
    const gate = this.sink.liveAllowed();
    if (!gate.ok) {
      this.sink.markRejected(order.id, 'LIVE_LOCKED', gate.reason);
      return;
    }
    let res: UpbitOrder | null = null;
    try {
      res = await this.rest.createOrder(body);
    } catch (e) {
      if (e instanceof UpbitApiError && (e.status >= 500 || e.status === 408)) {
        // 게이트웨이/서버 오류는 주문이 실제로 생성됐을 수 있다 → 거절로 단정하지 않고 identifier로 확인
        log.error('ORDER', `LIVE 주문 응답 오류 ${e.status} ${order.identifier} → identifier로 생성 여부 확인`);
        this.sink.markUnknown(order.id, e.friendlyMessage);
        setTimeout(() => void this.sink.reconcileUnknown(order.id), 1500);
      } else if (e instanceof UpbitApiError) {
        log.warn('ORDER', `LIVE 주문 거절 ${order.identifier}: ${e.status} ${e.code} ${e.upbitMessage}`);
        this.sink.markRejected(order.id, e.code, e.friendlyMessage);
      } else if (e instanceof UpbitRateLimitError) {
        // 429/418은 서버가 요청을 처리하지 않은 것 → 거절로 처리(다음 평가 때 다시 판단)
        this.sink.markRejected(order.id, 'RATE_LIMIT', e.friendlyMessage);
      } else if (e instanceof UpbitNetworkError) {
        log.error('ORDER', `LIVE 주문 응답 유실 ${order.identifier} → identifier로 생성 여부 확인`);
        this.sink.markUnknown(order.id, e.friendlyMessage);
        setTimeout(() => void this.sink.reconcileUnknown(order.id), 1500);
      } else {
        this.sink.markRejected(order.id, 'UNKNOWN_ERROR', (e as Error).message);
      }
      return;
    }
    // 여기부터는 업비트가 주문을 받은 뒤다. 이후 어떤 실패도 "거절"이 아니라 "확인 필요"로 다룬다.
    if (!res || !res.uuid) {
      log.error('ORDER', `LIVE 주문 응답에 uuid가 없음 ${order.identifier} → identifier로 확인`);
      this.sink.markUnknown(order.id, '주문 응답을 확인하지 못해 업비트에 다시 확인하고 있어요.');
      setTimeout(() => void this.sink.reconcileUnknown(order.id), 1500);
      return;
    }
    log.info('ORDER', `LIVE 주문 접수 ${order.identifier} uuid=${res.uuid} state=${res.state}`);
    try {
      await this.sink.applyUpbitOrder(order.id, res);
    } catch (e) {
      log.error('ORDER', `LIVE 주문 접수 후 반영 실패 ${order.identifier}: ${(e as Error).message} → 다시 확인`);
      this.sink.markUnknown(order.id, '주문은 접수됐고 상태를 다시 확인하고 있어요.');
      setTimeout(() => void this.sink.reconcileUnknown(order.id), 1500);
    }
  }

  async cancel(order: OrderRecord): Promise<void> {
    try {
      const res = await this.rest.cancelOrder(order.upbitUuid ? { uuid: order.upbitUuid } : { identifier: order.identifier });
      log.info('ORDER_CANCEL', `LIVE 취소 접수 ${order.identifier} state=${res.state}`);
      await this.sink.applyUpbitOrder(order.id, res);
    } catch (e) {
      if (e instanceof UpbitApiError && e.code === 'order_not_found') {
        await this.sink.reconcileUnknown(order.id);
        return;
      }
      log.warn('ORDER_CANCEL', `LIVE 취소 실패 ${order.identifier}: ${(e as Error).message}`);
      throw e;
    }
  }
}
