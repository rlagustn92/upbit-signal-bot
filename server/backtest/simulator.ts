import type { OrderPurpose, StrategyConfig, StrategyKind } from '../../shared/types';
import type { BotRecord, OrderRecord } from '../db/repositories';
import { normalizePrice } from '../domain/orderMath';
import type { Bar } from '../indicators';
import { STRATEGIES } from '../strategies';
import { riskExitIntents } from '../strategies/riskExit';
import type { StrategyContext, StrategyIntent } from '../strategies/types';

/**
 * 백테스트 시뮬레이터
 * - 실제 봇과 똑같은 전략 코드(onTicker/onCandleClose/onOrderUpdate)와 공통 위험 관리(riskExit)를 과거 캔들 위에서 돌린다.
 * - 캔들 안의 가격 흐름은 알 수 없으므로 양봉은 시가→저가→고가→종가, 음봉은 시가→고가→저가→종가 순서로 움직였다고 가정하고
 *   구간을 잘게 나눠(실시간 가격처럼) 전략에 넣는다.
 * - 체결 규칙은 모의투자(PAPER)와 같다: 시장가 = 그 순간 가격 ±미끄러짐, 지정가 = 가격이 닿으면 지정가로 전량 체결, 수수료 0.05%.
 * - 손익은 봇 예산 기준(예산 + 확정 손익 + 평가 손익).
 * - 실제 봇은 손절 체결 후 자동으로 꺼지지만, 백테스트에서는 "손실 후 쉬는 시간"(없으면 60분) 뒤 다시 켠 것으로 보고 계속 진행한다.
 */

export interface BacktestInput {
  marketCode: string;
  strategy: StrategyKind;
  config: StrategyConfig;
  budgetKRW: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  /** 시뮬레이션에 쓰는 캔들(시간 오름차순, 닫힌 캔들만) */
  bars: Bar[];
  unitMs: number;
  /**
   * 전략이 지표 계산에 쓰는 캔들 단위(ms). 시뮬레이션 캔들보다 크면 시뮬레이션 캔들을 묶어서 만든다.
   * 예) 그리드: 가격 흐름은 5분봉으로 촘촘히, 하락장 판단/ATR은 60분봉으로
   */
  analysisUnitMs?: number;
  /** 앞부분 지표 준비용 캔들 수(이 구간에서는 매매하지 않음) */
  warmup: number;
  feeRate?: number;
  /** 시장가 미끄러짐(기본 0.05%, 모의투자와 같음) */
  slippage?: number;
  /** 캔들 한 구간(시가→저가 등)을 몇 단계로 나눠 가격을 넣을지 */
  stepsPerSegment?: number;
}

export interface BacktestTrade {
  /** 매도 체결 시각(ms) */
  at: number;
  purpose: OrderPurpose;
  price: number;
  volume: number;
  /** 수수료 포함 확정 손익(원) */
  pnl: number;
  /** 매입 원가 대비 % */
  pnlPercent: number;
}

export interface BacktestFill {
  at: number;
  side: 'bid' | 'ask';
  purpose: OrderPurpose;
  price: number;
  volume: number;
  krw: number;
}

export interface BacktestMetrics {
  startAt: number;
  endAt: number;
  bars: number;
  finalEquity: number;
  totalReturnPercent: number;
  buyHoldPercent: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  /** 평균 수익 ÷ 평균 손실 (실제 손익비) */
  payoffRatio: number | null;
  /** 총 수익 ÷ 총 손실 */
  profitFactor: number | null;
  /** 1회 매도당 평균 손익(원) */
  expectancy: number;
  maxDrawdownPercent: number;
  feesPaid: number;
  stopLosses: number;
  /** 코인을 들고 있던 시간 비율(%) */
  exposurePercent: number;
  buys: number;
  /** 끝날 때 아직 들고 있는 코인 평가 손익(원) */
  openPnl: number;
}

export interface BacktestResult {
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  fills: BacktestFill[];
  /** 자산 곡선(최대 400개 지점) */
  equity: Array<{ t: number; equity: number; price: number }>;
  notes: string[];
}

interface SimOrder {
  id: number;
  side: 'bid' | 'ask';
  purpose: OrderPurpose;
  price: number;
  volume: number;
  krwAmount: number;
  gridLevelId: string | null;
}

const KST = 9 * 3600_000;
const kstDay = (t: number) => Math.floor((t + KST) / 86_400_000);
const EXIT_PURPOSES: OrderPurpose[] = ['EXIT', 'TAKE_PROFIT', 'STOP_LOSS'];
const VOL_DP = 1e8;
const floorVol = (v: number) => Math.floor(v * VOL_DP + 1e-6) / VOL_DP;
const roundVol = (v: number) => Math.round(v * VOL_DP) / VOL_DP;

export function runBacktest(input: BacktestInput): BacktestResult {
  const fee = input.feeRate ?? 0.0005;
  const slip = input.slippage ?? 0.0005;
  const steps = Math.max(1, input.stepsPerSegment ?? 6);
  const strategy = STRATEGIES[input.strategy];
  const cfg = input.config as StrategyConfig & { cooldownAfterLossMin: number; dailyLossLimitPercent: number };
  const bars = input.bars;
  const budget = input.budgetKRW;
  const minOrder = 5000;
  const notes: string[] = [];

  const bot: BotRecord = {
    id: 1,
    name: 'backtest',
    displayName: 'backtest',
    marketCode: input.marketCode,
    displaySymbol: input.marketCode,
    coinName: input.marketCode,
    strategy: input.strategy,
    strategyConfig: input.config,
    strategyState: {},
    budgetKRW: String(budget),
    takeProfitPercent: input.takeProfitPercent,
    stopLossPercent: input.stopLossPercent,
    active: true,
    mode: 'PAPER',
    lastSignalText: null,
    lastSignalAt: null,
    createdAt: '',
    updatedAt: '',
  };

  let state: Record<string, unknown> = {};
  let qty = 0;
  let cost = 0;
  let realized = 0;
  let feesPaid = 0;
  let orders: SimOrder[] = [];
  let nextOrderId = 1;
  let active = true;
  let restartAt = 0;
  let stopLosses = 0;
  let buys = 0;
  let heldBars = 0;
  const realizedByDay = new Map<number, number>();
  const trades: BacktestTrade[] = [];
  const fills: BacktestFill[] = [];
  const equity: BacktestResult['equity'] = [];

  const window = Math.max(strategy.minCandles(input.config) + 50, 400);
  let closedBars: Bar[] = [];
  let closes: number[] = [];
  const aMs = input.analysisUnitMs && input.analysisUnitMs > input.unitMs ? input.analysisUnitMs : 0;
  // 분석 캔들(묶음) — 완성된 묶음만 지표에 쓴다(재도장 방지)
  const agg: Bar[] = [];
  let aggUpTo = 0; // bars[0..aggUpTo) 까지 묶음에 반영됨
  let cur: Bar | null = null;
  const advanceAgg = (endExclusive: number) => {
    for (; aggUpTo < endExclusive; aggUpTo++) {
      const b = bars[aggUpTo];
      const bucket = Math.floor(b.start / aMs) * aMs;
      if (cur && cur.start !== bucket) {
        agg.push(cur);
        cur = null;
      }
      if (!cur) cur = { start: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      else {
        cur.high = Math.max(cur.high, b.high);
        cur.low = Math.min(cur.low, b.low);
        cur.close = b.close;
        cur.volume += b.volume;
      }
      if (b.start + input.unitMs >= bucket + aMs) {
        agg.push(cur);
        cur = null;
      }
    }
  };
  const setClosed = (endExclusive: number) => {
    if (aMs) {
      advanceAgg(endExclusive);
      closedBars = agg.slice(Math.max(0, agg.length - window));
    } else {
      closedBars = bars.slice(Math.max(0, endExclusive - window), endExclusive);
    }
    closes = closedBars.map((b) => b.close);
  };

  const ctxAt = (price: number, now: number): StrategyContext => ({
    bot,
    config: input.config,
    state,
    position: { quantity: qty, averageEntryPrice: qty > 0 ? cost / qty : 0, totalCost: cost },
    price,
    closes,
    bars: closedBars,
    hasActiveOrder: (purposes, gridLevelId) => orders.some((o) => purposes.includes(o.purpose) && (gridLevelId === undefined || o.gridLevelId === gridLevelId)),
    now,
  });

  const asRecord = (o: SimOrder, avg: number, filled: number): OrderRecord =>
    ({
      id: o.id,
      botId: 1,
      identifier: `BT-${o.id}`,
      upbitUuid: null,
      marketCode: input.marketCode,
      side: o.side,
      ordType: 'limit',
      price: String(o.price),
      volume: String(o.volume),
      executedVolume: String(filled),
      remainingVolume: '0',
      averagePrice: String(avg),
      executedFunds: String(avg * filled),
      paidFee: '0',
      reservedKrw: '0',
      state: 'FILLED',
      upbitState: 'done',
      purpose: o.purpose,
      gridLevelId: o.gridLevelId,
      reason: null,
      strategySignalId: null,
      mode: 'PAPER',
      errorCode: null,
      errorMessage: null,
      createdAt: '',
      updatedAt: '',
    }) as OrderRecord;

  /** 체결 처리(포지션·손익·전략 콜백). 실제 엔진(onOrderUpdated/onPositionClosed)과 같은 순서 */
  const fill = (o: SimOrder, price: number, volume: number, now: number) => {
    if (o.side === 'bid') {
      const funds = price * volume;
      const f = funds * fee;
      qty = roundVol(qty + volume);
      cost += funds + f;
      feesPaid += f;
      buys++;
      fills.push({ at: now, side: 'bid', purpose: o.purpose, price, volume, krw: funds + f });
    } else {
      const vol = Math.min(volume, qty);
      if (!(vol > 0)) return;
      const proceeds = price * vol;
      const f = proceeds * fee;
      const part = qty > 0 ? cost * (vol / qty) : 0;
      const pnl = proceeds - f - part;
      // 수량은 8자리(업비트와 같음)로 맞춰서 부동소수점 찌꺼기가 '보유 중'으로 남지 않게
      qty = roundVol(qty - vol) < 1e-8 ? 0 : roundVol(qty - vol);
      cost = qty === 0 ? 0 : cost - part;
      realized += pnl;
      feesPaid += f;
      realizedByDay.set(kstDay(now), (realizedByDay.get(kstDay(now)) ?? 0) + pnl);
      trades.push({ at: now, purpose: o.purpose, price, volume: vol, pnl, pnlPercent: part > 0 ? (pnl / part) * 100 : 0 });
      fills.push({ at: now, side: 'ask', purpose: o.purpose, price, volume: vol, krw: proceeds - f });
      volume = vol;
      if (pnl < 0) state._lossAt = now;
    }
    strategy.onOrderUpdate(ctxAt(price, now), asRecord(o, price, volume), volume, price);
    if (o.side === 'ask' && qty === 0) strategy.onPositionClosed(ctxAt(price, now));
    if (o.side === 'ask' && o.purpose === 'STOP_LOSS') {
      // 실제 봇: 손절 후 자동 OFF → 백테스트: 쉬는 시간 뒤 다시 켠 것으로 가정
      stopLosses++;
      if (input.strategy === 'grid') delete state.basePrice;
      orders = [];
      active = false;
      restartAt = now + Math.max(cfg.cooldownAfterLossMin, 60) * 60_000;
    }
  };

  const entryBlocked = (now: number): boolean => {
    if (cfg.dailyLossLimitPercent > 0) {
      const today = realizedByDay.get(kstDay(now)) ?? 0;
      if (today <= -(budget * cfg.dailyLossLimitPercent) / 100) return true;
    }
    if (cfg.cooldownAfterLossMin > 0 && state._lossAt && now < Number(state._lossAt) + cfg.cooldownAfterLossMin * 60_000) return true;
    return false;
  };

  const usedBudget = () => cost + orders.filter((o) => o.side === 'bid').reduce((a, o) => a + o.krwAmount, 0);

  const process = (intents: StrategyIntent[], price: number, now: number) => {
    for (const intent of intents) {
      if (!active) return;
      const ord = intent.order;
      if (!ord) continue;
      if (ord.side === 'bid' && entryBlocked(now)) continue;
      // 같은 목적/칸의 진행 중 주문이 있으면 중복 주문 안 함
      if (orders.some((o) => o.purpose === ord.purpose && o.gridLevelId === (ord.gridLevelId ?? null))) continue;
      if (EXIT_PURPOSES.includes(ord.purpose)) orders = []; // 청산 전 다른 주문 취소

      if (ord.side === 'bid') {
        const krw = Math.floor(ord.krwAmount ?? 0);
        if (krw < minOrder * (1 + fee)) continue;
        if (usedBudget() + krw > budget + 1e-6) continue;
        const funds = krw / (1 + fee);
        if (ord.kind === 'market') {
          const p = price * (1 + slip);
          const vol = floorVol(funds / p);
          if (vol > 0) fill({ id: nextOrderId++, side: 'bid', purpose: ord.purpose, price: p, volume: vol, krwAmount: krw, gridLevelId: ord.gridLevelId ?? null }, p, vol, now);
        } else {
          const lp = normalizePrice(ord.limitPrice ?? price, 'down').toNumber();
          const vol = floorVol(funds / lp);
          if (vol > 0) orders.push({ id: nextOrderId++, side: 'bid', purpose: ord.purpose, price: lp, volume: vol, krwAmount: krw, gridLevelId: ord.gridLevelId ?? null });
        }
      } else {
        const want = ord.volume === 'ALL' || ord.volume == null ? qty : Math.min(Number(ord.volume), qty);
        const vol = floorVol(want);
        if (!(vol > 0)) continue;
        if (ord.kind === 'market') {
          const p = price * (1 - slip);
          fill({ id: nextOrderId++, side: 'ask', purpose: ord.purpose, price: p, volume: vol, krwAmount: 0, gridLevelId: ord.gridLevelId ?? null }, p, vol, now);
        } else {
          const lp = normalizePrice(ord.limitPrice ?? price, 'up').toNumber();
          orders.push({ id: nextOrderId++, side: 'ask', purpose: ord.purpose, price: lp, volume: vol, krwAmount: 0, gridLevelId: ord.gridLevelId ?? null });
        }
      }
    }
  };

  /** 가격이 지정가에 닿은 주문 체결 */
  const matchLimits = (price: number, now: number) => {
    if (!orders.length) return;
    for (const o of [...orders]) {
      const hit = o.side === 'bid' ? price <= o.price : price >= o.price;
      if (!hit) continue;
      orders = orders.filter((x) => x.id !== o.id);
      fill(o, o.price, o.side === 'ask' ? Math.min(o.volume, qty) : o.volume, now);
      if (!active) return;
    }
  };

  const evalTicker = (price: number, now: number) => {
    const ctx = ctxAt(price, now);
    const intents = riskExitIntents(ctx);
    if (!intents.length) intents.push(...strategy.onTicker(ctx));
    process(intents, price, now);
  };

  const start = Math.min(Math.max(1, input.warmup), bars.length - 1);
  if (bars.length < 2 || start >= bars.length) {
    return { metrics: emptyMetrics(budget), trades, fills, equity, notes: ['캔들이 부족해서 백테스트를 할 수 없어요.'] };
  }
  setClosed(start);
  const firstPrice = bars[start].open;
  process(strategy.initialize(ctxAt(firstPrice, bars[start].start)), firstPrice, bars[start].start);

  let peakEquity = budget;
  let maxDd = 0;
  const sampleEvery = Math.max(1, Math.ceil((bars.length - start) / 400));

  for (let i = start; i < bars.length; i++) {
    const b = bars[i];
    if (!active && b.start >= restartAt) {
      active = true;
      setClosed(i);
      process(strategy.initialize(ctxAt(b.open, b.start)), b.open, b.start);
    }
    // 캔들 안 가격 흐름(양봉: 시→저→고→종, 음봉: 시→고→저→종)을 잘게 나눠 실시간 가격처럼 넣는다
    const path = b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close];
    const segMs = input.unitMs / (3 * steps);
    let k = 0;
    for (let s = 0; s < 3; s++) {
      for (let j = s === 0 ? 0 : 1; j <= steps; j++) {
        const p = path[s] + ((path[s + 1] - path[s]) * j) / steps;
        const now = b.start + Math.round(segMs * k++);
        matchLimits(p, now);
        if (active) evalTicker(p, now);
      }
    }
    // 캔들 확정
    const closeAt = b.start + input.unitMs;
    setClosed(i + 1);
    if (active) process(strategy.onCandleClose(ctxAt(b.close, closeAt)), b.close, closeAt);

    if (qty > 0) heldBars++;
    const eq = budget + realized + (qty * b.close - cost);
    peakEquity = Math.max(peakEquity, eq);
    maxDd = Math.max(maxDd, peakEquity > 0 ? ((peakEquity - eq) / peakEquity) * 100 : 0);
    if ((i - start) % sampleEvery === 0 || i === bars.length - 1) equity.push({ t: closeAt, equity: Math.round(eq), price: b.close });
  }

  const last = bars[bars.length - 1];
  const openPnl = qty * last.close - cost;
  const finalEquity = budget + realized + openPnl;
  const winsArr = trades.filter((t) => t.pnl > 0);
  const lossArr = trades.filter((t) => t.pnl <= 0);
  const sumWin = winsArr.reduce((a, t) => a + t.pnl, 0);
  const sumLoss = lossArr.reduce((a, t) => a + t.pnl, 0);
  const avgWin = winsArr.length ? sumWin / winsArr.length : 0;
  const avgLoss = lossArr.length ? sumLoss / lossArr.length : 0;
  if (qty > 0) notes.push('끝나는 시점에 아직 코인을 들고 있어서, 그 평가 손익도 최종 수익률에 포함했어요.');
  if (stopLosses) notes.push(`손절 ${stopLosses}번 — 실제 봇은 손절 후 자동으로 꺼지지만, 여기서는 쉬는 시간 뒤 다시 켠 것으로 계산했어요.`);

  return {
    metrics: {
      startAt: bars[start].start,
      endAt: last.start + input.unitMs,
      bars: bars.length - start,
      finalEquity: Math.round(finalEquity),
      totalReturnPercent: ((finalEquity - budget) / budget) * 100,
      buyHoldPercent: ((last.close - firstPrice) / firstPrice) * 100,
      trades: trades.length,
      wins: winsArr.length,
      losses: lossArr.length,
      winRate: trades.length ? (winsArr.length / trades.length) * 100 : 0,
      avgWin,
      avgLoss,
      payoffRatio: winsArr.length && lossArr.length && avgLoss < 0 ? avgWin / -avgLoss : null,
      profitFactor: sumLoss < 0 ? sumWin / -sumLoss : null,
      expectancy: trades.length ? (sumWin + sumLoss) / trades.length : 0,
      maxDrawdownPercent: maxDd,
      feesPaid,
      stopLosses,
      exposurePercent: ((heldBars / Math.max(1, bars.length - start)) * 100),
      buys,
      openPnl,
    },
    trades,
    fills,
    equity,
    notes,
  };
}

function emptyMetrics(budget: number): BacktestMetrics {
  return {
    startAt: 0,
    endAt: 0,
    bars: 0,
    finalEquity: budget,
    totalReturnPercent: 0,
    buyHoldPercent: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    payoffRatio: null,
    profitFactor: null,
    expectancy: 0,
    maxDrawdownPercent: 0,
    feesPaid: 0,
    stopLosses: 0,
    exposurePercent: 0,
    buys: 0,
    openPnl: 0,
  };
}
