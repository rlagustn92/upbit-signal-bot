import type { StrategyConfig } from '../../shared/types';
import { averageVolume, detectCross } from '../indicators';
import type { Strategy, StrategyIntent } from './types';
import { candleUnitLabel } from './labels';

type GcCfg = Extract<StrategyConfig, { kind: 'goldenCross' }>;

interface GcState {
  lastCross?: 'GOLDEN' | 'DEAD';
  lastCrossCandleCount?: number;
}

const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: n >= 100 ? 0 : 4 });

/**
 * 골든크로스 돌파
 * - 확정 캔들 기준 단기/장기 이동평균(EMA 기본, SMA 선택)
 * - "이전 short ≤ long && 현재 short > long" 교차 이벤트에서만 매수 (상태가 아니라 이벤트)
 * - 거래량 확인: 교차 봉 거래량이 최근 20봉 평균 × 배수 이상일 때만(가짜 돌파 거르기)
 * - 포지션이 없을 때만 1회 진입(중복 진입 방지), 데드크로스 이벤트에서 전량 매도
 * - ATR 손절/트레일링 익절/하루 손실 한도는 공통 위험 관리(riskExit)
 */
export const goldenCrossStrategy: Strategy<GcCfg> = {
  kind: 'goldenCross',
  candleUnit: (cfg) => cfg.candleUnit,
  // EMA는 앞부분 값이 안정되도록 장기 기간의 3배 이상 데이터를 쓴다
  minCandles: (cfg) => Math.max(cfg.longPeriod * 3, cfg.longPeriod + 25),

  initialize: () => [],
  onTicker: () => [],

  onCandleClose(ctx) {
    const cfg = ctx.config;
    const st = ctx.state as GcState;
    const out: StrategyIntent[] = [];
    const { event, short, long } = detectCross(ctx.closes, cfg.shortPeriod, cfg.longPeriod, cfg.maType);
    if (!event || short == null || long == null) return out;
    // 같은 캔들에서 이벤트가 두 번 처리되지 않도록
    if (st.lastCrossCandleCount === ctx.closes.length && st.lastCross === event) return out;
    st.lastCross = event;
    st.lastCrossCandleCount = ctx.closes.length;
    const unit = candleUnitLabel(cfg.candleUnit);
    const ma = cfg.maType === 'EMA' ? 'EMA' : 'MA';
    const value = `${ma}${cfg.shortPeriod}=${fmt(short)} / ${ma}${cfg.longPeriod}=${fmt(long)}`;

    if (event === 'GOLDEN') {
      if (ctx.position.quantity > 0 || ctx.hasActiveOrder(['ENTRY'])) {
        out.push({ signalType: 'INFO', signalValue: value, reason: `골든크로스 발생했지만 이미 코인을 들고 있어서 추가로 사지 않아요 (${unit})` });
        return out;
      }
      if (cfg.volumeMultiplier > 0 && ctx.bars.length) {
        const avg = averageVolume(ctx.bars, 20);
        const vol = ctx.bars[ctx.bars.length - 1].volume;
        if (avg != null && vol < avg * cfg.volumeMultiplier) {
          out.push({
            signalType: 'INFO',
            signalValue: `${value} / 거래량 ${(avg > 0 ? vol / avg : 0).toFixed(2)}배`,
            reason: `골든크로스가 나왔지만 거래량이 평소의 ${cfg.volumeMultiplier}배에 못 미쳐서 진짜 돌파로 보지 않고 사지 않았어요 (${unit})`,
          });
          return out;
        }
      }
      out.push({
        signalType: 'BUY',
        signalValue: value,
        reason: `${cfg.shortPeriod}선이 ${cfg.longPeriod}선을 위로 뚫어서(골든크로스${cfg.volumeMultiplier > 0 ? ', 거래량 확인' : ''}) 코인 사기 (${unit})`,
        order: { side: 'bid', purpose: 'ENTRY', kind: 'market', krwAmount: Math.floor(Number(ctx.bot.budgetKRW) * cfg.entryRatio) },
      });
    } else if (event === 'DEAD') {
      if (cfg.exitOnDeadCross && ctx.position.quantity > 0 && !ctx.hasActiveOrder(['EXIT', 'TAKE_PROFIT', 'STOP_LOSS'])) {
        out.push({
          signalType: 'SELL',
          signalValue: value,
          reason: `${cfg.shortPeriod}선이 ${cfg.longPeriod}선 아래로 내려가서(데드크로스) 코인 팔기 (${unit})`,
          order: { side: 'ask', purpose: 'EXIT', kind: 'market', volume: 'ALL' },
        });
      } else {
        out.push({ signalType: 'INFO', signalValue: value, reason: `데드크로스 발생 (${unit}) — 보유 코인이 없어 대기` });
      }
    }
    return out;
  },

  onOrderUpdate: () => {},
  onPositionClosed: () => {},

  describe(bot, cfg) {
    const ma = cfg.maType === 'EMA' ? 'EMA' : '이평';
    const extras = [
      cfg.volumeMultiplier > 0 ? `거래량이 평소의 ${cfg.volumeMultiplier}배 이상일 때만` : '',
      cfg.atrStopMultiplier > 0 ? `변동폭(ATR)×${cfg.atrStopMultiplier} 손절` : '',
      cfg.trailingStopPercent > 0 ? `+${bot.takeProfitPercent}% 이후 최고가에서 ${cfg.trailingStopPercent}% 내려오면 익절` : `익절 +${bot.takeProfitPercent}%`,
    ].filter(Boolean);
    return {
      title: `${ma} ${cfg.shortPeriod} / ${cfg.longPeriod} 골든크로스`,
      description: `${candleUnitLabel(cfg.candleUnit)} 기준 ${cfg.shortPeriod}선이 ${cfg.longPeriod}선을 위로 뚫는 순간 사고, ${cfg.exitOnDeadCross ? '아래로 뚫으면 팔아요' : '익절/손절 기준에서 팔아요'}. ${extras.join(' · ')} · 손절 최대 -${bot.stopLossPercent}%`,
      range: `${ma} ${cfg.shortPeriod}/${cfg.longPeriod} 교차 (${candleUnitLabel(cfg.candleUnit)})`,
    };
  },
};
