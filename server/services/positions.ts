import type { OrderSide } from '../../shared/types';
import type { PositionRecord, Repo } from '../db/repositories';
import { D, toPlain } from '../domain/orderMath';
import { log } from '../lib/logger';

const DUST = D('0.000000001');

export interface PositionMath {
  quantity: string;
  totalCost: string;
  averageEntryPrice: string;
  realizedPnl: string;
}

export interface TradeEffect {
  next: PositionMath;
  /** 매도 시: 이번 체결의 실현손익(매도 수수료 차감) */
  realized: string | null;
  /** 매도 시: 이번 체결분의 원가(평단 × 수량, 매수 수수료 포함) */
  costBasis: string | null;
}

/**
 * 포지션 계산(순수 함수).
 * - 매수: 수량 += v, 총원가 += 체결금액 + 수수료, 평단 = 총원가 ÷ 수량  (평단에 매수 수수료 포함)
 * - 매도: 원가 = 평단 × v, 실현손익 = (체결금액 - 매도 수수료) - 원가, 수량 -= v, 총원가 -= 원가
 */
export function applyTradeToPosition(prev: PositionMath, side: OrderSide, price: string, volume: string, fee: string): TradeEffect {
  const qty = D(prev.quantity);
  const cost = D(prev.totalCost);
  const v = D(volume);
  const funds = D(price).mul(v);
  const f = D(fee);
  if (side === 'bid') {
    const nq = qty.plus(v);
    const nc = cost.plus(funds).plus(f);
    return {
      next: { quantity: toPlain(nq), totalCost: toPlain(nc), averageEntryPrice: nq.gt(0) ? toPlain(nc.div(nq)) : '0', realizedPnl: prev.realizedPnl },
      realized: null,
      costBasis: null,
    };
  }
  const avg = qty.gt(0) ? cost.div(qty) : D(0);
  const sellVol = v.gt(qty) ? qty : v; // 봇 포지션보다 많이 판 경우(수동 매매 등) 초과분은 원가 0으로 본다
  const costBasis = avg.mul(sellVol);
  const proceeds = funds.minus(f);
  const realized = proceeds.minus(costBasis);
  let nq = qty.minus(sellVol);
  let nc = cost.minus(costBasis);
  if (nq.lte(DUST)) {
    nq = D(0);
    nc = D(0);
  }
  return {
    next: {
      quantity: toPlain(nq),
      totalCost: toPlain(nc.lt(0) ? 0 : nc),
      averageEntryPrice: nq.gt(0) ? toPlain(nc.div(nq)) : '0',
      realizedPnl: toPlain(D(prev.realizedPnl).plus(realized)),
    },
    realized: toPlain(realized),
    costBasis: toPlain(costBasis),
  };
}

export class PositionService {
  constructor(private readonly repo: Repo) {}

  get(botId: number, marketCode: string): PositionRecord {
    return (
      this.repo.getPosition(botId, marketCode) ?? {
        botId,
        marketCode,
        quantity: '0',
        averageEntryPrice: '0',
        totalCost: '0',
        realizedPnl: '0',
        updatedAt: new Date().toISOString(),
      }
    );
  }

  /** 체결 1건 반영. 반환값: 실현손익/원가(매도) 및 포지션이 0이 되었는지 */
  apply(botId: number, marketCode: string, side: OrderSide, price: string, volume: string, fee: string): TradeEffect & { closed: boolean } {
    const prev = this.get(botId, marketCode);
    const eff = applyTradeToPosition(prev, side, price, volume, fee);
    this.repo.upsertPosition({ botId, marketCode, ...eff.next });
    const closed = side === 'ask' && D(prev.quantity).gt(0) && D(eff.next.quantity).eq(0);
    log.info(
      'POSITION',
      `bot#${botId} ${marketCode} ${side === 'bid' ? '매수' : '매도'} ${volume}@${price} → 보유 ${eff.next.quantity}, 평단 ${D(eff.next.averageEntryPrice).toFixed(2)}${eff.realized ? `, 실현손익 ${D(eff.realized).toFixed(0)}원` : ''}`,
    );
    return { ...eff, closed };
  }
}
