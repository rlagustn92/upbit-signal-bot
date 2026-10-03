import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });

export { Decimal };
export type Num = Decimal.Value;

export const D = (v: Num): Decimal => new Decimal(v);

/** Decimal → 지수표기 없는 문자열(뒤 0 제거) */
export function toPlain(v: Num): string {
  const s = D(v).toFixed();
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/**
 * 원화(KRW) 마켓 호가 단위.
 * 출처: docs/upbit-reference/docs_krw-market-info.md (2025-07-31 개편 정책, 2026-09 문서 기준)
 * 실제 주문 시에는 MarketRules가 /v1/orderbook/instruments 의 tick_size를 우선 사용하고,
 * 현재가와 다른 가격대(그리드 하단 레벨 등)에만 이 표를 사용한다.
 */
const KRW_TICK_TABLE: Array<[min: number, tick: string]> = [
  [2_000_000, '1000'],
  [1_000_000, '1000'],
  [500_000, '500'],
  [100_000, '100'],
  [50_000, '50'],
  [10_000, '10'],
  [5_000, '5'],
  [1_000, '1'],
  [100, '1'],
  [10, '0.1'],
  [1, '0.01'],
  [0.1, '0.001'],
  [0.01, '0.0001'],
  [0.001, '0.00001'],
  [0.0001, '0.000001'],
  [0.00001, '0.0000001'],
];

export function krwTickSize(price: Num): Decimal {
  const p = D(price);
  for (const [min, tick] of KRW_TICK_TABLE) {
    if (p.gte(min)) return D(tick);
  }
  return D('0.00000001');
}

export type TickFn = (price: Decimal) => Decimal;
export type RoundMode = 'down' | 'up' | 'nearest';

/** 가격 → 호가 단위 배수로 보정. 매수는 down(더 비싸게 사지 않음), 매도는 up(더 싸게 팔지 않음) 권장 */
export function normalizePrice(price: Num, mode: RoundMode, tickOf: TickFn = krwTickSize): Decimal {
  const p = D(price);
  if (!p.isFinite() || p.lte(0)) throw new Error('가격은 0보다 커야 합니다.');
  const roundTo = (tick: Decimal): Decimal => {
    const q = p.div(tick);
    const n = mode === 'down' ? q.floor() : mode === 'up' ? q.ceil() : q.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return n.mul(tick);
  };
  let tick = tickOf(p);
  let out = roundTo(tick);
  // 가격대 경계를 넘어가면 그 가격대의 호가 단위로 한 번 더 보정
  const tick2 = tickOf(out.gt(0) ? out : p);
  if (!tick2.eq(tick)) {
    tick = tick2;
    out = roundTo(tick);
  }
  if (out.lte(0)) out = tick;
  return out;
}

export function isOnTick(price: Num, tickOf: TickFn = krwTickSize): boolean {
  const p = D(price);
  return p.gt(0) && p.mod(tickOf(p)).eq(0);
}

/** 업비트 주문 수량 소수 자릿수 상한(8자리)으로 내림 */
export const VOLUME_DECIMALS = 8;
export function normalizeVolume(volume: Num, decimals = VOLUME_DECIMALS): Decimal {
  const v = D(volume);
  if (!v.isFinite() || v.lt(0)) throw new Error('수량은 0 이상이어야 합니다.');
  return v.toDecimalPlaces(decimals, Decimal.ROUND_DOWN);
}

/** 예산(KRW)으로 살 수 있는 최대 수량(수수료 포함해서 예산 이하) */
export function volumeForBudget(budgetKRW: Num, price: Num, feeRate: Num): Decimal {
  const b = D(budgetKRW);
  const p = D(price);
  if (p.lte(0)) throw new Error('가격은 0보다 커야 합니다.');
  return normalizeVolume(b.div(p.mul(D(1).plus(feeRate))));
}

export interface AmountRule {
  minTotal: Num; // 최소 주문 금액(KRW)
  maxTotal?: Num | null; // 최대 주문 금액(KRW)
}

export interface AmountCheck {
  ok: boolean;
  total: Decimal;
  code?: 'UNDER_MIN_TOTAL' | 'OVER_MAX_TOTAL' | 'INVALID';
  message?: string;
}

const won = (v: Num) => D(v).toNumber().toLocaleString('ko-KR');

/** 주문 총액 검증. 지정가: price×volume, 시장가 매수: price(총액), 시장가 매도: 현재가×volume */
export function validateOrderAmount(total: Num, rule: AmountRule): AmountCheck {
  const t = D(total);
  if (!t.isFinite() || t.lte(0)) return { ok: false, total: t, code: 'INVALID', message: '주문 금액이 올바르지 않습니다.' };
  if (t.lt(rule.minTotal)) {
    return { ok: false, total: t, code: 'UNDER_MIN_TOTAL', message: `최소 주문 금액(${won(rule.minTotal)}원)보다 작습니다.` };
  }
  if (rule.maxTotal != null && D(rule.maxTotal).gt(0) && t.gt(rule.maxTotal)) {
    return { ok: false, total: t, code: 'OVER_MAX_TOTAL', message: `최대 주문 금액(${won(rule.maxTotal)}원)을 넘습니다.` };
  }
  return { ok: true, total: t };
}
