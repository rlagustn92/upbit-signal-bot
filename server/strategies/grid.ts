import type { GridConfig, StrategyConfig } from '../../shared/types';
import type { BotRecord, OrderRecord } from '../db/repositories';
import { normalizePrice } from '../domain/orderMath';
import { atr, lastEma } from '../indicators';
import type { Strategy, StrategyContext, StrategyIntent } from './types';
import { candleUnitLabel } from './labels';

type GridCfg = Extract<StrategyConfig, { kind: 'grid' }>;

export interface GridLevelState {
  /** EMPTY: 매수 대기, HOLDING: 매수 체결되어 익절 매도 대기 */
  status: 'EMPTY' | 'HOLDING';
  qty: number;
  buyPrice: number;
  lastExitAt: number;
}

export interface GridState {
  basePrice: number;
  /** 실제 적용 중인 간격(%) — atr 모드에서는 기준가를 잡을 때 변동폭으로 계산 */
  spacing?: number;
  levels: Record<string, GridLevelState>;
  guardNotifiedAt?: number;
}

/** 하락장 매수 멈춤 기준: 가격이 EMA50보다 이만큼(%) 넘게 아래 */
export const DOWNTREND_GUARD_PERCENT = 3;
const GUARD_EMA = 50;
const MAX_ATR_SPACING = 5;

/** 매수 레벨 가격: 기준가 × (1 - 간격)^k  (k = 1..levels) */
export function gridLevelPrices(basePrice: number, spacingPercent: number, levels: number): number[] {
  const r = 1 - spacingPercent / 100;
  const out: number[] = [];
  for (let k = 1; k <= levels; k++) out.push(basePrice * r ** k);
  return out;
}

export function levelId(k: number): string {
  return `L${k}`;
}

/** 레벨당 주문 금액: 설정값(0이면 예산 ÷ 레벨 수) */
export function gridOrderKRW(cfg: GridConfig, budgetKRW: number): number {
  return cfg.orderKRW > 0 ? cfg.orderKRW : Math.floor(budgetKRW / Math.max(1, cfg.levels));
}

/** 변동성(ATR) 기반 간격: ATR ÷ 가격 × 배수, [최소 간격, 5%] 범위 */
export function atrSpacingPercent(atrValue: number | null, price: number, multiplier: number, minPercent: number): number {
  if (!atrValue || !(price > 0)) return minPercent;
  const pct = (atrValue / price) * 100 * multiplier;
  return Math.min(MAX_ATR_SPACING, Math.max(minPercent, Math.round(pct * 100) / 100));
}

function getState(ctx: StrategyContext<GridCfg>): GridState {
  const st = ctx.state as unknown as Partial<GridState>;
  if (!st.levels) st.levels = {};
  if (!st.basePrice) st.basePrice = ctx.config.basePrice > 0 ? ctx.config.basePrice : 0;
  return st as GridState;
}

function spacingOf(st: GridState, cfg: GridCfg): number {
  return cfg.spacingMode === 'atr' && st.spacing ? st.spacing : cfg.spacingPercent;
}

/** 기준가를 새로 잡을 때 간격도 갱신(atr 모드) */
function rebase(ctx: StrategyContext<GridCfg>, st: GridState, price: number): void {
  st.basePrice = price;
  if (ctx.config.spacingMode === 'atr') st.spacing = atrSpacingPercent(atr(ctx.bars, 14), price, ctx.config.atrMultiplier, ctx.config.spacingPercent);
}

const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: n >= 100 ? 0 : 4 });
/** 화면 문구용: 실제 주문 가격과 같도록 호가 단위로 맞춘 가격(매수 내림, 매도 올림) */
const tickPrice = (n: number, mode: 'down' | 'up') => (n > 0 ? normalizePrice(n, mode).toNumber() : n);

/**
 * 무한 그물망(그리드)
 * - 기준가 아래로 간격(%)마다 매수 칸 N개. 간격은 고정 또는 최근 변동폭(ATR)에 맞춰 자동(spacingMode)
 * - 가격이 칸에 닿으면 그 칸 가격으로 지정가 매수(칸당 1개 주문만: gridLevelId로 중복 방지)
 * - 매수 체결 → 체결가 × (1 + 익절%) 지정가 매도 / 매도 체결 → 칸 비움(재진입 대기 후 다시 사용)
 * - 하락장 매수 멈춤(downtrendGuard): 분석봉 EMA50보다 3% 넘게 아래면 새로 사지 않음(익절 매도는 계속)
 * - 들고 있는 칸·진행 중 주문이 없고 가격이 기준가보다 2칸 이상 오르면 기준가를 따라 올린다(무한 그물망)
 * - 손절·하루 손실 한도는 공통 위험 관리가 담당
 */
export const gridStrategy: Strategy<GridCfg> = {
  kind: 'grid',
  candleUnit: (cfg) => (cfg.spacingMode === 'atr' || cfg.downtrendGuard ? cfg.analysisUnit : null),
  minCandles: (cfg) => (cfg.spacingMode === 'atr' || cfg.downtrendGuard ? GUARD_EMA + 20 : 0),

  initialize(ctx) {
    const st = getState(ctx);
    // 켤 때 들고 있는 칸/진행 중 주문이 없으면 지금 가격으로 기준가를 새로 잡는다
    // (꺼져 있던 동안 가격이 내려갔다고 켜자마자 여러 칸을 한꺼번에 사지 않도록)
    const holding = Object.values(st.levels).some((l) => l.status === 'HOLDING' && l.qty > 0);
    const active = ctx.hasActiveOrder(['GRID_BUY', 'GRID_SELL']);
    if (ctx.price > 0 && (!st.basePrice || (!holding && !active && !(ctx.config.basePrice > 0)))) rebase(ctx, st, ctx.price);
    return [];
  },

  onTicker(ctx) {
    const st = getState(ctx);
    const cfg = ctx.config;
    const out: StrategyIntent[] = [];
    if (!(ctx.price > 0)) return out;
    if (!st.basePrice) rebase(ctx, st, ctx.price);
    const spacing = spacingOf(st, cfg);

    const prices = gridLevelPrices(st.basePrice, spacing, cfg.levels);
    const anyHolding = Object.values(st.levels).some((l) => l.status === 'HOLDING');
    const anyActive = prices.some((_, i) => ctx.hasActiveOrder(['GRID_BUY', 'GRID_SELL'], levelId(i + 1)));

    // 무한 그물망: 비어 있을 때 가격이 위로 멀어지면 기준가를 따라 올린다
    if (!anyHolding && !anyActive && ctx.price > st.basePrice * (1 + (2 * spacing) / 100)) {
      const prev = st.basePrice;
      rebase(ctx, st, ctx.price);
      out.push({
        signalType: 'INFO',
        signalValue: `기준가 ${fmt(prev)} → ${fmt(ctx.price)}`,
        reason: `가격이 올라서 그물망 기준가를 ${fmt(ctx.price)}원으로 옮겼어요${cfg.spacingMode === 'atr' ? ` (간격 ${spacingOf(st, cfg)}%)` : ''}`,
      });
      return out;
    }

    // 하락장 매수 멈춤: 새로 사는 것만 막고, 이미 산 칸의 익절 매도는 계속
    let buyPaused = false;
    if (cfg.downtrendGuard) {
      const ema = lastEma(ctx.bars.map((b) => b.close), GUARD_EMA);
      if (ema != null && ctx.price < ema * (1 - DOWNTREND_GUARD_PERCENT / 100)) {
        buyPaused = true;
        if (st.guardNotifiedAt === undefined || ctx.now - st.guardNotifiedAt > 3600_000) {
          st.guardNotifiedAt = ctx.now;
          out.push({
            signalType: 'INFO',
            signalValue: `EMA${GUARD_EMA}=${fmt(ema)}`,
            reason: `하락 추세가 강해서(가격이 ${candleUnitLabel(cfg.analysisUnit)} 50선보다 ${DOWNTREND_GUARD_PERCENT}% 넘게 아래) 새로 사지 않고 기다려요`,
          });
        }
      }
    }

    const orderKRW = gridOrderKRW(cfg, Number(ctx.bot.budgetKRW));
    prices.forEach((levelPrice, i) => {
      const id = levelId(i + 1);
      const lv: GridLevelState = st.levels[id] ?? { status: 'EMPTY', qty: 0, buyPrice: 0, lastExitAt: 0 };
      st.levels[id] = lv;

      if (lv.status === 'EMPTY') {
        if (buyPaused) return;
        if (ctx.price > levelPrice) return;
        if (ctx.hasActiveOrder(['GRID_BUY', 'GRID_SELL'], id)) return;
        if (ctx.now - lv.lastExitAt < cfg.reentryCooldownSec * 1000) return;
        out.push({
          signalType: 'BUY',
          signalValue: `${i + 1}번째 칸 ${fmt(tickPrice(levelPrice, 'down'))}원`,
          reason: `가격이 그물망 ${i + 1}번째 칸(${fmt(tickPrice(levelPrice, 'down'))}원)까지 내려와서 코인 사기`,
          order: { side: 'bid', purpose: 'GRID_BUY', kind: 'limit', limitPrice: levelPrice, krwAmount: orderKRW, gridLevelId: id },
        });
      } else if (lv.status === 'HOLDING' && lv.qty > 0) {
        if (ctx.hasActiveOrder(['GRID_SELL', 'GRID_BUY'], id)) return;
        const target = lv.buyPrice * (1 + ctx.bot.takeProfitPercent / 100);
        out.push({
          signalType: 'SELL',
          signalValue: `목표가 ${fmt(tickPrice(target, 'up'))}원`,
          reason: `${i + 1}번째 칸에서 산 코인을 +${ctx.bot.takeProfitPercent}% 가격(${fmt(tickPrice(target, 'up'))}원)에 팔도록 예약`,
          order: { side: 'ask', purpose: 'GRID_SELL', kind: 'limit', limitPrice: target, volume: String(lv.qty), gridLevelId: id },
        });
      }
    });
    return out;
  },

  onCandleClose: () => [],

  onOrderUpdate(ctx, order, filledVolume, avgPrice) {
    if (!order.gridLevelId) return;
    const st = getState(ctx);
    const lv: GridLevelState = st.levels[order.gridLevelId] ?? { status: 'EMPTY', qty: 0, buyPrice: 0, lastExitAt: 0 };
    if (order.purpose === 'GRID_BUY' && filledVolume > 0) {
      // 여러 번 부분 체결될 수 있으므로 누적 평균
      const prevCost = lv.qty * lv.buyPrice;
      lv.qty += filledVolume;
      lv.buyPrice = (prevCost + filledVolume * avgPrice) / lv.qty;
      lv.status = 'HOLDING';
    } else if (order.purpose === 'GRID_SELL' && filledVolume > 0) {
      lv.qty = Math.max(0, lv.qty - filledVolume);
      if (lv.qty <= 1e-12) {
        lv.qty = 0;
        lv.buyPrice = 0;
        lv.status = 'EMPTY';
        lv.lastExitAt = ctx.now;
      }
    }
    st.levels[order.gridLevelId] = lv;
  },

  onPositionClosed(ctx) {
    const st = getState(ctx);
    for (const lv of Object.values(st.levels)) {
      lv.status = 'EMPTY';
      lv.qty = 0;
      lv.buyPrice = 0;
      lv.lastExitAt = ctx.now;
    }
  },

  describe(bot: BotRecord, cfg: GridCfg, state) {
    const st = state as unknown as Partial<GridState>;
    const base = st.basePrice || cfg.basePrice;
    const spacing = cfg.spacingMode === 'atr' && st.spacing ? st.spacing : cfg.spacingPercent;
    const levels = base ? gridLevelPrices(base, spacing, cfg.levels) : [];
    const low = levels.length ? levels[levels.length - 1] : 0;
    const spacingText = cfg.spacingMode === 'atr' ? `변동폭 맞춤 간격(지금 ${spacing}%)` : `${spacing}% 간격`;
    return {
      title: `${spacingText} ${cfg.levels}칸 그물망`,
      description:
        `가격이 ${spacing}% 내려갈 때마다 나눠 사고, 산 가격보다 +${bot.takeProfitPercent}% 오르면 팔아요. ` +
        `${cfg.downtrendGuard ? '하락 추세가 강하면 새로 사지 않아요. ' : ''}평균 매입가 대비 -${bot.stopLossPercent}%면 손절해요.`,
      range: base ? `${fmt(low)} ~ ${fmt(base)}원` : '기준가 대기 중',
    };
  },
};

export type { OrderRecord };
