import type { CandleUnit, OrderPurpose, SignalType, StrategyConfig, StrategyKind } from '../../shared/types';
import type { BotRecord, OrderRecord } from '../db/repositories';
import type { Bar } from '../indicators';

/**
 * 전략이 엔진에 돌려주는 "의도". 전략은 주문을 직접 보내지 않는다.
 * 엔진이 Signal 기록 → Risk/중복/예산 검증 → 주문 순서로 처리한다.
 */
export interface StrategyIntent {
  signalType: SignalType;
  /** 사람이 읽는 지표 값. 예: "RSI=28.4" */
  signalValue: string | null;
  /** 사람이 읽는 이유. 예: "RSI 28.4로 떨어져서 1차 매수" */
  reason: string;
  order?: IntentOrder;
}

export interface IntentOrder {
  side: 'bid' | 'ask';
  purpose: OrderPurpose;
  /** limit: 지정가, market: 시장가(매수는 금액, 매도는 수량) */
  kind: 'limit' | 'market';
  /** 지정가 가격(보정 전) */
  limitPrice?: number;
  /** 매수에 쓸 KRW(수수료 포함 상한) */
  krwAmount?: number;
  /** 매도 수량. 'ALL' = 이 봇의 보유 수량 전부 */
  volume?: string | 'ALL';
  gridLevelId?: string;
}

export interface PositionView {
  quantity: number;
  averageEntryPrice: number;
  totalCost: number;
}

export interface StrategyContext<C extends StrategyConfig = StrategyConfig> {
  bot: BotRecord;
  config: C;
  /** 전략 상태(엔진이 평가 후 DB에 저장) */
  state: Record<string, unknown>;
  position: PositionView;
  /** 최근 체결가 */
  price: number;
  /** 확정된(닫힌) 캔들 종가, 시간 오름차순 */
  closes: number[];
  /** 확정된 캔들 OHLCV(ATR·거래량 계산용), 시간 오름차순 */
  bars: Bar[];
  /** 같은 목적/레벨의 활성 주문이 있는지 */
  hasActiveOrder: (purposes: OrderPurpose[], gridLevelId?: string | null) => boolean;
  now: number;
}

export interface Strategy<C extends StrategyConfig = StrategyConfig> {
  readonly kind: StrategyKind;
  /** 필요한 캔들 단위(없으면 null) */
  candleUnit(config: C): CandleUnit | null;
  /** 필요한 최소 캔들 개수 */
  minCandles(config: C): number;
  /** 봇 시작 시 1회(캔들 히스토리 로드 후) */
  initialize(ctx: StrategyContext<C>): StrategyIntent[];
  /** 실시간 가격 */
  onTicker(ctx: StrategyContext<C>): StrategyIntent[];
  /** 캔들 확정(재도장 방지를 위해 닫힌 캔들만) */
  onCandleClose(ctx: StrategyContext<C>): StrategyIntent[];
  /** 이 봇의 주문 상태 변화(체결/취소) */
  onOrderUpdate(ctx: StrategyContext<C>, order: OrderRecord, filledVolume: number, avgPrice: number): void;
  /** 포지션이 0이 됨(손절/익절 등) */
  onPositionClosed(ctx: StrategyContext<C>): void;
  /** 카드에 보여줄 전략 제목/설명/범위 */
  describe(bot: BotRecord, config: C, state: Record<string, unknown>): { title: string; description: string; range: string };
}
