import { atr } from '../indicators';
import type { StrategyContext, StrategyIntent } from './types';

export interface RiskExitInput {
  price: number;
  averageEntryPrice: number;
  quantity: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  /** 그리드는 칸별 익절을 쓰므로 공통 익절을 끈다 */
  useTakeProfit: boolean;
  /** 트레일링 익절(%) — 0이면 목표 익절에서 바로 매도 */
  trailingStopPercent?: number;
  /** 보유 시작 이후 최고가(트레일링용) */
  peak?: number;
  /** 변동성(ATR) 손절 가격 — 손절 % 가격과 비교해 더 가까운(높은) 쪽을 쓴다 */
  atrStopPrice?: number | null;
}

export interface RiskExitResult {
  action: 'STOP_LOSS' | 'TAKE_PROFIT' | null;
  pnlPercent: number;
  kind?: 'PERCENT_STOP' | 'ATR_STOP' | 'TARGET' | 'TRAILING';
}

/**
 * 익절/손절 판단 (모든 전략 공통)
 * 기준: 포지션 평균 매입단가 = (체결금액 + 매수 수수료) ÷ 보유수량 → 분할 매수로 평단이 바뀌어도 실제 포지션 기준
 *  수익률 = (현재가 - 평균 매입단가) ÷ 평균 매입단가 × 100  (매도 수수료는 판단에 포함하지 않음)
 *  손절: 현재가 ≤ max(평단 × (1 - 손절%), ATR 손절가)  → STOP_LOSS 시장가 전량 매도
 *  익절: 트레일링 꺼짐 → 수익률 ≥ 익절%면 매도
 *        트레일링 켜짐 → 최고가가 평단 × (1 + 익절%)에 한 번 닿은 뒤, 최고가 대비 트레일링%만큼 내려오면 매도
 *                        (단, 그때 가격이 평단보다 높을 때만 — 손실 구간은 손절이 담당)
 */
export function evaluateRiskExit(i: RiskExitInput): RiskExitResult {
  if (!(i.quantity > 0) || !(i.averageEntryPrice > 0) || !(i.price > 0)) return { action: null, pnlPercent: 0 };
  const avg = i.averageEntryPrice;
  const pnlPercent = ((i.price - avg) / avg) * 100;

  if (i.stopLossPercent > 0) {
    const pctStop = avg * (1 - i.stopLossPercent / 100);
    const useAtr = i.atrStopPrice != null && i.atrStopPrice > pctStop && i.atrStopPrice < avg;
    const stop = useAtr ? i.atrStopPrice! : pctStop;
    if (i.price <= stop) return { action: 'STOP_LOSS', pnlPercent, kind: useAtr ? 'ATR_STOP' : 'PERCENT_STOP' };
  }

  if (i.useTakeProfit && i.takeProfitPercent > 0) {
    const target = avg * (1 + i.takeProfitPercent / 100);
    const trail = i.trailingStopPercent ?? 0;
    if (trail > 0) {
      const peak = Math.max(i.peak ?? 0, i.price);
      if (peak >= target && i.price <= peak * (1 - trail / 100) && i.price > avg) return { action: 'TAKE_PROFIT', pnlPercent, kind: 'TRAILING' };
    } else if (i.price >= target) {
      return { action: 'TAKE_PROFIT', pnlPercent, kind: 'TARGET' };
    }
  }
  return { action: null, pnlPercent };
}

interface RiskState {
  peak?: number;
  entryAtr?: number;
}

const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: n >= 100 ? 0 : 4 });

export function riskExitIntents(ctx: StrategyContext): StrategyIntent[] {
  const cfg = ctx.config as unknown as Record<string, unknown>;
  const risk = ((ctx.state._risk as RiskState | undefined) ?? {}) as RiskState;
  if (ctx.position.quantity > 0) {
    risk.peak = Math.max(risk.peak ?? 0, ctx.price);
    // ATR 손절: 처음 보유한 시점의 변동폭을 기억해 둔다
    const atrMult = Number(cfg.atrStopMultiplier ?? 0);
    if (atrMult > 0 && risk.entryAtr == null) {
      const a = atr(ctx.bars, 14);
      if (a != null) risk.entryAtr = a;
    }
    ctx.state._risk = risk;
  } else if (ctx.state._risk) {
    delete ctx.state._risk; // 보유가 없으면 초기화
    return [];
  }

  const atrMult = Number(cfg.atrStopMultiplier ?? 0);
  const atrStopPrice = atrMult > 0 && risk.entryAtr ? ctx.position.averageEntryPrice - atrMult * risk.entryAtr : null;
  const trailing = Number(cfg.trailingStopPercent ?? 0);
  const r = evaluateRiskExit({
    price: ctx.price,
    averageEntryPrice: ctx.position.averageEntryPrice,
    quantity: ctx.position.quantity,
    takeProfitPercent: ctx.bot.takeProfitPercent,
    stopLossPercent: ctx.bot.stopLossPercent,
    useTakeProfit: ctx.bot.strategy !== 'grid',
    trailingStopPercent: ctx.bot.strategy !== 'grid' ? trailing : 0,
    peak: risk.peak,
    atrStopPrice,
  });
  if (!r.action) return [];
  if (ctx.hasActiveOrder(['STOP_LOSS', 'TAKE_PROFIT', 'EXIT'])) return [];
  const p = r.pnlPercent.toFixed(2);
  if (r.action === 'STOP_LOSS') {
    return [
      {
        signalType: 'SELL',
        signalValue: `${p}%`,
        reason:
          r.kind === 'ATR_STOP'
            ? `평균 매입가 대비 ${p}% — 변동폭(ATR)×${atrMult} 손절가(${fmt(atrStopPrice!)}원)에 닿아서 전량 팔기`
            : `평균 매입가 대비 ${p}%로 손절선(-${ctx.bot.stopLossPercent}%)에 닿아서 전량 팔기`,
        order: { side: 'ask', purpose: 'STOP_LOSS', kind: 'market', volume: 'ALL' },
      },
    ];
  }
  return [
    {
      signalType: 'SELL',
      signalValue: `+${p}%`,
      reason:
        r.kind === 'TRAILING'
          ? `목표 익절(+${ctx.bot.takeProfitPercent}%)을 넘은 뒤 최고가(${fmt(risk.peak ?? ctx.price)}원)에서 ${trailing}% 내려와서 익절 (+${p}%)`
          : `평균 매입가 대비 +${p}%로 목표 익절(+${ctx.bot.takeProfitPercent}%)에 닿아서 전량 팔기`,
      order: { side: 'ask', purpose: 'TAKE_PROFIT', kind: 'market', volume: 'ALL' },
    },
  ];
}
