import type { StrategyConfig } from '../../shared/types';
import { lastEma, rsiSeries } from '../indicators';
import type { Strategy, StrategyIntent } from './types';
import { candleUnitLabel } from './labels';

type RsiCfg = Extract<StrategyConfig, { kind: 'rsi' }>;

interface RsiState {
  lastRsi?: number;
  /** dip 모드: 과매도선 위로 올라온 뒤에만 다음 진입 가능(같은 하락에서 반복 매수 방지) */
  armed?: boolean;
  /** rebound 모드: 과매도선 아래로 내려간 적이 있음(이제 위로 올라오면 반등 확인) */
  dipped?: boolean;
  entries?: number;
  trendNotifiedAt?: number;
}

const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: n >= 100 ? 0 : 4 });

/**
 * RSI 과매도 반등
 * - 확정 캔들 종가로 RSI(Wilder) 계산
 * - rebound(기본): RSI가 과매도선 아래로 내려갔다가 "다시 위로 올라오는 순간"(반등 확인) 분할 매수
 *   → 떨어지는 칼날을 잡지 않는다. 다음 매수는 다시 과매도로 내려갔다 올라올 때
 * - dip: 과매도선 아래로 "내려가는 순간" 매수(이전 방식), 위로 올라와야 재무장
 * - 추세 필터: 종가가 EMA(trendEmaPeriod, 기본 200) 위일 때만 매수 → 하락장에서 계속 물리는 것 방지
 * - 최대 maxEntries회(1회 = 예산 × splitRatio), RSI ≥ 과매수선이면 전량 매도
 * - 익절/손절/트레일링/하루 손실 한도는 공통 위험 관리
 */
export const rsiStrategy: Strategy<RsiCfg> = {
  kind: 'rsi',
  candleUnit: (cfg) => cfg.candleUnit,
  minCandles: (cfg) => Math.max(cfg.period + 2, cfg.trendEmaPeriod > 0 ? cfg.trendEmaPeriod + 20 : 0),

  initialize(ctx) {
    const st = ctx.state as RsiState;
    const s = rsiSeries(ctx.closes, ctx.config.period);
    const rsi = s[s.length - 1] ?? null;
    if (rsi != null) st.lastRsi = rsi;
    // 시작할 때 이미 과매도 구간이면 바로 사지 않는다(dip: 한 번 올라왔다 다시 떨어질 때, rebound: 새로 내려갔다 올라올 때)
    if (st.armed === undefined) st.armed = rsi == null ? true : rsi >= ctx.config.oversold;
    if (st.dipped === undefined) st.dipped = false;
    if (st.entries === undefined) st.entries = 0;
    return [];
  },

  onTicker: () => [],

  onCandleClose(ctx) {
    const cfg = ctx.config;
    const st = ctx.state as RsiState;
    const out: StrategyIntent[] = [];
    const s = rsiSeries(ctx.closes, cfg.period);
    const rsi = s[s.length - 1] ?? null;
    if (rsi == null) return out;
    const prev = st.lastRsi ?? s[s.length - 2] ?? rsi;
    st.lastRsi = rsi;
    const r = rsi.toFixed(1);
    const unit = candleUnitLabel(cfg.candleUnit);

    if (ctx.position.quantity > 0 && rsi >= cfg.overbought && !ctx.hasActiveOrder(['EXIT', 'TAKE_PROFIT', 'STOP_LOSS'])) {
      out.push({
        signalType: 'SELL',
        signalValue: `RSI=${r}`,
        reason: `RSI ${r}로 과매수선(${cfg.overbought}) 도달해서 코인 팔기 (${unit})`,
        order: { side: 'ask', purpose: 'EXIT', kind: 'market', volume: 'ALL' },
      });
      return out;
    }

    // 진입 신호 판단
    let signal = false;
    if (cfg.entryMode === 'rebound') {
      if (rsi < cfg.oversold) st.dipped = true;
      signal = !!st.dipped && prev < cfg.oversold && rsi >= cfg.oversold;
    } else {
      if (rsi >= cfg.oversold) st.armed = true;
      signal = !!st.armed && rsi < cfg.oversold;
    }
    const entries = st.entries ?? 0;
    if (!signal || entries >= cfg.maxEntries || ctx.hasActiveOrder(['ENTRY'])) return out;
    // 같은 신호로 다시 사지 않도록 신호를 소모
    st.dipped = false;
    st.armed = false;

    // 추세 필터
    if (cfg.trendEmaPeriod > 0) {
      const ema = lastEma(ctx.closes, cfg.trendEmaPeriod);
      const last = ctx.closes[ctx.closes.length - 1];
      if (ema == null || last <= ema) {
        out.push({
          signalType: 'INFO',
          signalValue: `RSI=${r}${ema != null ? ` / EMA${cfg.trendEmaPeriod}=${fmt(ema)}` : ''}`,
          reason:
            ema == null
              ? `RSI 반등 신호가 있었지만 장기 추세(EMA${cfg.trendEmaPeriod})를 계산할 데이터가 부족해서 사지 않았어요`
              : `RSI 반등 신호가 있었지만 가격이 장기 추세선(EMA${cfg.trendEmaPeriod}) 아래(하락장)라서 사지 않았어요`,
        });
        return out;
      }
    }

    const krw = Math.floor(Number(ctx.bot.budgetKRW) * cfg.splitRatio);
    out.push({
      signalType: 'BUY',
      signalValue: `RSI=${r}`,
      reason:
        cfg.entryMode === 'rebound'
          ? `RSI가 ${cfg.oversold} 아래로 내려갔다가 ${r}로 다시 올라와서(반등 확인) ${entries + 1}차 매수 (${unit})`
          : `RSI ${r}로 떨어져서 ${entries + 1}차 매수 (${unit}, 과매도선 ${cfg.oversold})`,
      order: { side: 'bid', purpose: 'ENTRY', kind: 'market', krwAmount: krw },
    });
    return out;
  },

  onOrderUpdate(ctx, order) {
    const st = ctx.state as RsiState;
    // 진입 횟수는 실제 체결 기준으로 센다(거절/무체결 취소는 세지 않음). 엔진은 종료 전환 시 1회만 호출한다.
    const finished = order.state === 'FILLED' || order.state === 'PARTIALLY_FILLED_CANCELLED';
    if (order.purpose === 'ENTRY' && finished && Number(order.executedVolume) > 0) {
      st.entries = (st.entries ?? 0) + 1;
    }
  },

  onPositionClosed(ctx) {
    (ctx.state as RsiState).entries = 0;
  },

  describe(bot, cfg) {
    const how = cfg.entryMode === 'rebound' ? `${cfg.oversold} 아래로 내려갔다가 다시 올라오면(반등 확인)` : `${cfg.oversold} 아래로 내려가면`;
    return {
      title: `RSI ${cfg.oversold} ${cfg.entryMode === 'rebound' ? '반등 확인 후' : '아래에서'} 나눠 사기`,
      description:
        `${candleUnitLabel(cfg.candleUnit)} RSI(${cfg.period})가 ${how} 최대 ${cfg.maxEntries}번 나눠 사고, ${cfg.overbought} 이상이면 팔아요. ` +
        `${cfg.trendEmaPeriod > 0 ? `장기 추세선(EMA${cfg.trendEmaPeriod}) 위일 때만 사요. ` : ''}익절 +${bot.takeProfitPercent}% / 손절 -${bot.stopLossPercent}%`,
      range: `RSI ${cfg.oversold} 이하 진입`,
    };
  },
};
