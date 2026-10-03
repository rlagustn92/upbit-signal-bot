import crypto from 'node:crypto';
import { ENGINE, STRATEGY_DEFAULTS } from '../config/strategyDefaults';
import type { OrderRecord } from '../db/repositories';
import { D, normalizeVolume, toPlain } from '../domain/orderMath';
import { log } from '../lib/logger';
import type { UpbitCreateOrderBody } from '../upbit/types';
import type { Executor, FillInput } from './types';

export interface PaperSink {
  markPlaced(orderId: number, patch: Partial<OrderRecord>): OrderRecord;
  recordPaperFill(orderId: number, fill: FillInput): void;
  markCancelled(orderId: number): void;
  activePaperOrders(market?: string): OrderRecord[];
  getPrice(market: string): number | null;
  feeRate(side: 'bid' | 'ask'): number;
}

/**
 * 모의투자 실행기 — 업비트에 아무 요청도 보내지 않는다.
 * - 시장가 매수(price): 최근 체결가 × (1 + 미끄러짐)으로 즉시 체결
 * - 시장가 매도(market): 최근 체결가 × (1 - 미끄러짐)으로 즉시 체결
 * - 지정가: 접수 후, 실시간 체결가가 지정가에 닿으면(매수: ≤, 매도: ≥) 지정가로 체결
 *   (주문 시점에 이미 닿아 있으면 즉시 체결 — 실제 거래소에서 테이커로 체결되는 것과 같음)
 * - 수수료: 기본 수수료율(strategyDefaults.feeRateDefault)
 */
export class PaperExecutor implements Executor {
  readonly mode = 'PAPER' as const;

  constructor(private readonly sink: PaperSink) {}

  async place(order: OrderRecord, body: UpbitCreateOrderBody): Promise<void> {
    const uuid = `paper-${crypto.randomUUID()}`;
    const placed = this.sink.markPlaced(order.id, { upbitUuid: uuid, state: 'OPEN', upbitState: 'wait' });
    const price = this.sink.getPrice(order.marketCode);
    if (price == null) return; // 가격이 들어오면 onTrade에서 처리

    if (body.ord_type === 'price' || body.ord_type === 'market') {
      this.fillMarket(placed, price);
    } else if (body.ord_type === 'limit') {
      this.tryFillLimit(placed, price, true);
    }
  }

  async cancel(order: OrderRecord): Promise<void> {
    this.sink.markCancelled(order.id);
  }

  /** 실시간 체결 이벤트마다 호출 */
  onTrade(market: string, tradePrice: number): void {
    for (const o of this.sink.activePaperOrders(market)) {
      if (o.ordType === 'limit') this.tryFillLimit(o, tradePrice, false);
      else if (o.state === 'OPEN') this.fillMarket(o, tradePrice);
    }
  }

  private fillMarket(o: OrderRecord, lastPrice: number): void {
    const slip = ENGINE.paperSlippagePercent / 100;
    const ts = new Date().toISOString();
    if (o.side === 'bid') {
      const fillPrice = D(lastPrice).mul(1 + slip);
      const total = D(o.price ?? 0); // 시장가 매수: price = 총액
      const vol = normalizeVolume(total.div(fillPrice));
      if (vol.lte(0)) return;
      const funds = fillPrice.mul(vol);
      this.sink.recordPaperFill(o.id, {
        price: toPlain(fillPrice.toDecimalPlaces(8)),
        volume: toPlain(vol),
        fee: toPlain(funds.mul(this.sink.feeRate('bid')).toDecimalPlaces(8)),
        tradeUuid: `paper-trade-${crypto.randomUUID()}`,
        timestamp: ts,
      });
    } else {
      const fillPrice = D(lastPrice).mul(1 - slip);
      const vol = D(o.remainingVolume ?? o.volume ?? 0);
      if (vol.lte(0)) return;
      const funds = fillPrice.mul(vol);
      this.sink.recordPaperFill(o.id, {
        price: toPlain(fillPrice.toDecimalPlaces(8)),
        volume: toPlain(vol),
        fee: toPlain(funds.mul(this.sink.feeRate('ask')).toDecimalPlaces(8)),
        tradeUuid: `paper-trade-${crypto.randomUUID()}`,
        timestamp: ts,
      });
    }
  }

  private tryFillLimit(o: OrderRecord, tradePrice: number, atPlacement: boolean): void {
    const limit = D(o.price ?? 0);
    const crossed = o.side === 'bid' ? D(tradePrice).lte(limit) : D(tradePrice).gte(limit);
    if (!crossed) return;
    const vol = D(o.remainingVolume ?? o.volume ?? 0);
    if (vol.lte(0)) return;
    // 주문 시점에 이미 지정가보다 유리하면(테이커 즉시 체결) 시장 가격으로, 호가창에서 기다리던 주문은 지정가로 체결
    const fillPrice = !atPlacement ? limit : o.side === 'bid' ? Decimal_min(limit, D(tradePrice)) : Decimal_max(limit, D(tradePrice));
    const funds = fillPrice.mul(vol);
    log.debug('ORDER', `PAPER 지정가 체결 ${o.identifier} ${o.side} ${vol.toFixed()} @ ${fillPrice.toFixed()}`);
    this.sink.recordPaperFill(o.id, {
      price: toPlain(fillPrice),
      volume: toPlain(vol),
      fee: toPlain(funds.mul(this.sink.feeRate(o.side)).toDecimalPlaces(8)),
      tradeUuid: `paper-trade-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
    });
  }
}

const Decimal_min = (a: ReturnType<typeof D>, b: ReturnType<typeof D>) => (a.lt(b) ? a : b);
const Decimal_max = (a: ReturnType<typeof D>, b: ReturnType<typeof D>) => (a.gt(b) ? a : b);

export const PAPER_FEE_RATE = STRATEGY_DEFAULTS.feeRateDefault;
