import type { StrategyConfig } from '../../shared/types';
import { lastEma, sma } from '../indicators';
import type { Strategy, StrategyIntent } from './types';
import { candleUnitLabel } from './labels';

type BbCfg = Extract<StrategyConfig, { kind: 'bollinger' }>;

interface BbState {
  /** 매수 체결 시점의 마지막 확정 캔들 시작 시각(보유 캔들 수 계산용) */
  entryBarStart?: number;
}

const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: n >= 100 ? 0 : 4 });

/** 마지막 period개 종가의 평균과 표준편차(모집단) */
export function bollinger(closes: number[], period: number, k: number): { mid: number; lower: number; upper: number; sd: number } | null {
  if (closes.length < period) return null;
  const mid = sma(closes, period);
  if (mid == null) return null;
  let s = 0;
  for (let i = closes.length - period; i < closes.length; i++) s += (closes[i] - mid) ** 2;
  const sd = Math.sqrt(s / period);
  return { mid, sd, lower: mid - k * sd, upper: mid + k * sd };
}

/**
 * 볼린저 반등 (평균 회귀)
 * - 확정 캔들 종가가 큰 추세(EMA) 위인데 볼린저 하단(평균 - k×표준편차) 아래로 내려오면 시장가 매수
 *   → "올라가는 흐름 속의 일시적인 과한 하락"만 산다
 * - 종가가 중심선(평균)으로 돌아오면 전량 매도(익절/본전 근처)
 * - maxHoldBars 캔들이 지나도 안 돌아오면 전량 매도(시간 손절) — 연구에서 고정 손절보다 성과가 좋았음
 * - 손절 %(봇 공통)는 급락 대비 안전장치로만 동작. 공통 목표 익절은 쓰지 않는다(중심선 복귀에서 팜)
 * 근거: scripts/research.ts (60분봉, EMA100, k=2.5, 최대 50봉) — 과거 결과는 미래 수익을 보장하지 않음
 */
export const bollingerStrategy: Strategy<BbCfg> = {
  kind: 'bollinger',
  candleUnit: (cfg) => cfg.candleUnit,
  minCandles: (cfg) => Math.max(cfg.trendEmaPeriod * 3, cfg.period + 5),

  initialize: () => [],
  onTicker: () => [],

  onCandleClose(ctx) {
    const cfg = ctx.config;
    const st = ctx.state as BbState;
    const out: StrategyIntent[] = [];
    const bb = bollinger(ctx.closes, cfg.period, cfg.k);
    if (!bb) return out;
    const close = ctx.closes[ctx.closes.length - 1];
    const unit = candleUnitLabel(cfg.candleUnit);
    const value = `종가 ${fmt(close)} / 하단 ${fmt(bb.lower)} / 중심 ${fmt(bb.mid)}`;

    if (ctx.position.quantity > 0) {
      if (ctx.hasActiveOrder(['EXIT', 'TAKE_PROFIT', 'STOP_LOSS'])) return out;
      // 보유 캔들 수: 매수 때 기억한 캔들부터 몇 개가 더 닫혔는지
      const lastStart = ctx.bars.length ? ctx.bars[ctx.bars.length - 1].start : 0;
      if (st.entryBarStart == null) st.entryBarStart = lastStart; // 재시작 등으로 기록이 없으면 지금부터 센다
      const idx = ctx.bars.findIndex((b) => b.start === st.entryBarStart);
      const held = idx >= 0 ? ctx.bars.length - 1 - idx : Number.POSITIVE_INFINITY;
      if (close >= bb.mid) {
        out.push({
          signalType: 'SELL',
          signalValue: value,
          reason: `종가가 볼린저 중심선(${fmt(bb.mid)}원)으로 돌아와서 전량 팔기 (${unit})`,
          order: { side: 'ask', purpose: 'EXIT', kind: 'market', volume: 'ALL' },
        });
      } else if (cfg.maxHoldBars > 0 && held >= cfg.maxHoldBars) {
        out.push({
          signalType: 'SELL',
          signalValue: `${value} / ${held === Number.POSITIVE_INFINITY ? cfg.maxHoldBars : held}봉 보유`,
          reason: `${cfg.maxHoldBars}개 캔들이 지나도 중심선으로 돌아오지 않아서 정리 (시간 손절, ${unit})`,
          order: { side: 'ask', purpose: 'EXIT', kind: 'market', volume: 'ALL' },
        });
      }
      return out;
    }

    if (ctx.hasActiveOrder(['ENTRY'])) return out;
    if (!(close < bb.lower)) return out;
    if (cfg.trendEmaPeriod > 0) {
      const ema = lastEma(ctx.closes, cfg.trendEmaPeriod);
      if (ema == null) return out;
      if (!(close > ema)) {
        out.push({
          signalType: 'INFO',
          signalValue: `${value} / EMA${cfg.trendEmaPeriod} ${fmt(ema)}`,
          reason: `볼린저 하단 아래로 내려왔지만 큰 추세선(EMA${cfg.trendEmaPeriod}) 아래라서(하락 흐름) 사지 않았어요 (${unit})`,
        });
        return out;
      }
    }
    out.push({
      signalType: 'BUY',
      signalValue: value,
      reason: `상승 흐름 속에서 종가가 볼린저 하단(${fmt(bb.lower)}원) 아래로 과하게 내려와서 코인 사기 (${unit})`,
      order: { side: 'bid', purpose: 'ENTRY', kind: 'market', krwAmount: Math.floor(Number(ctx.bot.budgetKRW) * cfg.entryRatio) },
    });
    return out;
  },

  onOrderUpdate(ctx, order, filledVolume) {
    if (order.purpose === 'ENTRY' && order.side === 'bid' && filledVolume > 0) {
      const st = ctx.state as BbState;
      st.entryBarStart = ctx.bars.length ? ctx.bars[ctx.bars.length - 1].start : undefined;
    }
  },

  onPositionClosed(ctx) {
    delete (ctx.state as BbState).entryBarStart;
  },

  describe(bot, cfg) {
    return {
      title: `볼린저(${cfg.period}, ${cfg.k}) 반등`,
      description:
        `${candleUnitLabel(cfg.candleUnit)} 종가가 ${cfg.trendEmaPeriod > 0 ? `큰 추세선(EMA${cfg.trendEmaPeriod}) 위에서 ` : ''}볼린저 하단 아래로 과하게 내려오면 사고, 중심선으로 돌아오면 팔아요.` +
        `${cfg.maxHoldBars > 0 ? ` ${cfg.maxHoldBars}개 캔들 안에 안 돌아오면 정리해요.` : ''} 급락 대비 손절 -${bot.stopLossPercent}%`,
      range: `볼린저 하단 매수 → 중심선 매도 (${candleUnitLabel(cfg.candleUnit)})`,
    };
  },
};
