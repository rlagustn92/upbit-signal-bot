import { describe, expect, it } from 'vitest';
import { detectCross, lastRsi, rsiSeries, sma } from '../../server/indicators';
import { gridLevelPrices, gridOrderKRW, gridStrategy } from '../../server/strategies/grid';
import { rsiStrategy } from '../../server/strategies/rsi';
import { goldenCrossStrategy } from '../../server/strategies/goldenCross';
import { evaluateRiskExit, riskExitIntents } from '../../server/strategies/riskExit';
import { applyTradeToPosition } from '../../server/services/positions';
import { buildStrategyConfig, validateStrategyConfig } from '../../server/strategies';
import type { StrategyContext } from '../../server/strategies/types';
import type { BotRecord, OrderRecord } from '../../server/db/repositories';
import type { StrategyConfig } from '../../shared/types';

function bot(strategy: BotRecord['strategy'], cfg: StrategyConfig, extra: Partial<BotRecord> = {}): BotRecord {
  return {
    id: 1,
    name: 't',
    displayName: 't',
    marketCode: 'KRW-XRP',
    displaySymbol: 'XRP/KRW',
    coinName: '리플',
    strategy,
    strategyConfig: cfg,
    strategyState: {},
    budgetKRW: '100000',
    takeProfitPercent: 1,
    stopLossPercent: 3,
    active: true,
    mode: 'PAPER',
    lastSignalText: null,
    lastSignalAt: null,
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

function ctx(b: BotRecord, over: Partial<StrategyContext> = {}): StrategyContext {
  return {
    bot: b,
    config: b.strategyConfig,
    state: {},
    position: { quantity: 0, averageEntryPrice: 0, totalCost: 0 },
    price: 1000,
    closes: [],
    bars: [],
    hasActiveOrder: () => false,
    now: 1_000_000,
    ...over,
  };
}

describe('지표', () => {
  it('이동평균', () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 2)).toBe(4.5);
    expect(sma([1, 2], 5)).toBeNull();
  });
  it('RSI: 계속 오르면 100, 계속 내리면 0, 데이터 부족하면 null', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(lastRsi(up, 14)).toBe(100);
    expect(lastRsi(down, 14)).toBe(0);
    expect(lastRsi([1, 2, 3], 14)).toBeNull();
  });
  it('RSI: Wilder 방식 알려진 값(14기간)', () => {
    // 고전 예제(Wilder) 종가 — 첫 RSI ≈ 70.53
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
    const s = rsiSeries(closes, 14);
    expect(s[14]).toBeCloseTo(70.5, 0); // 교재 값 70.53(중간값 반올림 차이)
    expect(s[19]).toBeCloseTo(57.92, 0);
  });
  it('골든크로스는 "교차 이벤트"일 때만', () => {
    const flatThenUp = [...Array(25).fill(100), 101, 105];
    const r = detectCross(flatThenUp.slice(0, 26), 5, 20);
    expect(r.event).toBe('GOLDEN'); // 100=100 → 101 넘어감
    // 이미 위에 있는 상태에서는 이벤트 없음
    expect(detectCross([...flatThenUp, 110], 5, 20).event).toBeNull();
    const down = [...Array(25).fill(100), 99];
    expect(detectCross(down, 5, 20).event).toBe('DEAD');
  });
});

describe('그리드', () => {
  const cfg = buildStrategyConfig('grid', { spacingPercent: 1, levels: 3, reentryCooldownSec: 60 }) as Extract<StrategyConfig, { kind: 'grid' }>;
  it('레벨 가격 = 기준가 × (1-간격)^k', () => {
    const p = gridLevelPrices(1000, 1, 3);
    expect(p[0]).toBeCloseTo(990);
    expect(p[1]).toBeCloseTo(980.1);
    expect(p[2]).toBeCloseTo(970.299);
  });
  it('한 칸 금액: 0이면 예산 ÷ 칸 수', () => {
    expect(gridOrderKRW(cfg, 90000)).toBe(30000);
    expect(gridOrderKRW({ ...cfg, orderKRW: 7000 }, 90000)).toBe(7000);
  });
  it('기준가에서는 사지 않고, 레벨에 닿으면 그 레벨만 매수', () => {
    const b = bot('grid', cfg);
    const c = ctx(b, { price: 1000 });
    gridStrategy.initialize(c as never);
    expect(gridStrategy.onTicker(c as never)).toHaveLength(0);
    const c2 = { ...c, price: 985 };
    const intents = gridStrategy.onTicker(c2 as never);
    expect(intents).toHaveLength(1);
    expect(intents[0].order).toMatchObject({ side: 'bid', purpose: 'GRID_BUY', gridLevelId: 'L1', kind: 'limit' });
  });
  it('같은 레벨에 활성 주문이 있으면 중복 주문하지 않음', () => {
    const b = bot('grid', cfg);
    const c = ctx(b, { price: 1000, state: {} });
    gridStrategy.initialize(c as never);
    const c2 = { ...c, price: 985, hasActiveOrder: (_p: unknown, lv?: string | null) => lv === 'L1' };
    expect(gridStrategy.onTicker(c2 as never)).toHaveLength(0);
  });
  it('매수 체결 → 익절 매도 예약, 매도 체결 → 칸 비움 + 재진입 대기', () => {
    const b = bot('grid', cfg);
    const state = {};
    const c = ctx(b, { price: 1000, state });
    gridStrategy.initialize(c as never);
    gridStrategy.onOrderUpdate(c as never, { purpose: 'GRID_BUY', gridLevelId: 'L1' } as OrderRecord, 10, 990);
    const sell = gridStrategy.onTicker({ ...c, price: 995 } as never);
    expect(sell[0].order).toMatchObject({ side: 'ask', purpose: 'GRID_SELL', volume: '10', gridLevelId: 'L1' });
    expect(sell[0].order!.limitPrice).toBeCloseTo(999.9);
    gridStrategy.onOrderUpdate({ ...c, now: 2_000_000 } as never, { purpose: 'GRID_SELL', gridLevelId: 'L1' } as OrderRecord, 10, 1000);
    // 쿨다운(60초) 안에는 다시 사지 않음
    expect(gridStrategy.onTicker({ ...c, price: 985, now: 2_030_000 } as never)).toHaveLength(0);
    expect(gridStrategy.onTicker({ ...c, price: 985, now: 2_061_000 } as never)).toHaveLength(1);
  });
  it('비어 있을 때 가격이 2칸 이상 오르면 기준가 이동(무한 그물망)', () => {
    const b = bot('grid', cfg);
    const c = ctx(b, { price: 1000, state: {} });
    gridStrategy.initialize(c as never);
    const r = gridStrategy.onTicker({ ...c, price: 1030 } as never);
    expect(r[0].signalType).toBe('INFO');
    expect((c.state as { basePrice: number }).basePrice).toBe(1030);
  });
});

describe('RSI 전략', () => {
  // 이전 방식(dip) 동작 확인 — 추세 필터 끔
  const cfg = buildStrategyConfig('rsi', { period: 14, oversold: 30, overbought: 70, splitRatio: 0.5, maxEntries: 2, entryMode: 'dip', trendEmaPeriod: 0 }) as Extract<StrategyConfig, { kind: 'rsi' }>;
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const crash = [...up, 120, 110, 100, 90, 80, 70];
  it('과매도선 하향 돌파 시 1회만 매수, 다시 올라와야 재무장', () => {
    const b = bot('rsi', cfg);
    const state: Record<string, unknown> = {};
    rsiStrategy.initialize(ctx(b, { closes: up, state }) as never);
    expect(state.armed).toBe(true);
    const r1 = rsiStrategy.onCandleClose(ctx(b, { closes: crash, state }) as never);
    expect(r1).toHaveLength(1);
    expect(r1[0].order).toMatchObject({ side: 'bid', purpose: 'ENTRY', kind: 'market', krwAmount: 50000 });
    expect(r1[0].reason).toContain('RSI');
    // 계속 과매도여도 반복 매수 금지
    expect(rsiStrategy.onCandleClose(ctx(b, { closes: [...crash, 60], state }) as never)).toHaveLength(0);
  });
  it('시작 시 이미 과매도면 바로 사지 않는다', () => {
    const b = bot('rsi', cfg);
    const state: Record<string, unknown> = {};
    rsiStrategy.initialize(ctx(b, { closes: crash, state }) as never);
    expect(state.armed).toBe(false);
    expect(rsiStrategy.onCandleClose(ctx(b, { closes: [...crash, 60], state }) as never)).toHaveLength(0);
  });
  it('최대 진입 횟수 제한', () => {
    const b = bot('rsi', cfg);
    const state: Record<string, unknown> = { armed: true, entries: 2 };
    expect(rsiStrategy.onCandleClose(ctx(b, { closes: crash, state }) as never)).toHaveLength(0);
  });
  it('과매수 도달 시 보유분 전량 매도', () => {
    const b = bot('rsi', cfg);
    const r = rsiStrategy.onCandleClose(ctx(b, { closes: up, state: {}, position: { quantity: 1, averageEntryPrice: 100, totalCost: 100 } }) as never);
    expect(r[0].order).toMatchObject({ side: 'ask', purpose: 'EXIT', volume: 'ALL' });
  });
  it('진입 횟수는 체결 완료 시에만 증가', () => {
    const b = bot('rsi', cfg);
    const state: Record<string, unknown> = { entries: 0 };
    rsiStrategy.onOrderUpdate(ctx(b, { state }) as never, { purpose: 'ENTRY', state: 'REJECTED', executedVolume: '0' } as OrderRecord, 0, 0);
    expect(state.entries).toBe(0);
    rsiStrategy.onOrderUpdate(ctx(b, { state }) as never, { purpose: 'ENTRY', state: 'FILLED', executedVolume: '1' } as OrderRecord, 1, 100);
    expect(state.entries).toBe(1);
  });
});

describe('골든크로스 전략', () => {
  const cfg = buildStrategyConfig('goldenCross', { shortPeriod: 5, longPeriod: 20, maType: 'SMA', volumeMultiplier: 0 }) as Extract<StrategyConfig, { kind: 'goldenCross' }>;
  const golden = [...Array(25).fill(100), 101];
  it('교차 이벤트에서 매수, 이미 보유 중이면 추가 매수 안 함', () => {
    const b = bot('goldenCross', cfg);
    const r = goldenCrossStrategy.onCandleClose(ctx(b, { closes: golden, state: {} }) as never);
    expect(r[0].order).toMatchObject({ side: 'bid', purpose: 'ENTRY' });
    const held = goldenCrossStrategy.onCandleClose(ctx(b, { closes: golden, state: {}, position: { quantity: 1, averageEntryPrice: 1, totalCost: 1 } }) as never);
    expect(held[0].order).toBeUndefined();
  });
  it('위에 머물러 있기만 하면 매수 신호 없음', () => {
    const b = bot('goldenCross', cfg);
    expect(goldenCrossStrategy.onCandleClose(ctx(b, { closes: [...golden, 105], state: {} }) as never)).toHaveLength(0);
  });
  it('데드크로스에서 전량 매도', () => {
    const b = bot('goldenCross', cfg);
    const r = goldenCrossStrategy.onCandleClose(ctx(b, { closes: [...Array(25).fill(100), 99], state: {}, position: { quantity: 2, averageEntryPrice: 100, totalCost: 200 } }) as never);
    expect(r[0].order).toMatchObject({ side: 'ask', purpose: 'EXIT', volume: 'ALL' });
  });
});

describe('익절/손절 (평균 매입가 기준)', () => {
  it('손절 조건', () => {
    expect(evaluateRiskExit({ price: 97, averageEntryPrice: 100, quantity: 1, takeProfitPercent: 2, stopLossPercent: 3, useTakeProfit: true }).action).toBe('STOP_LOSS');
    expect(evaluateRiskExit({ price: 97.1, averageEntryPrice: 100, quantity: 1, takeProfitPercent: 2, stopLossPercent: 3, useTakeProfit: true }).action).toBeNull();
  });
  it('익절 조건(그리드는 공통 익절 사용 안 함)', () => {
    expect(evaluateRiskExit({ price: 102, averageEntryPrice: 100, quantity: 1, takeProfitPercent: 2, stopLossPercent: 3, useTakeProfit: true }).action).toBe('TAKE_PROFIT');
    expect(evaluateRiskExit({ price: 102, averageEntryPrice: 100, quantity: 1, takeProfitPercent: 2, stopLossPercent: 3, useTakeProfit: false }).action).toBeNull();
  });
  it('보유가 없으면 아무것도 안 함', () => {
    expect(evaluateRiskExit({ price: 50, averageEntryPrice: 0, quantity: 0, takeProfitPercent: 2, stopLossPercent: 3, useTakeProfit: true }).action).toBeNull();
  });
  it('이미 청산 주문이 있으면 중복 생성 안 함', () => {
    const b = bot('rsi', buildStrategyConfig('rsi'));
    const base = ctx(b, { price: 90, position: { quantity: 1, averageEntryPrice: 100, totalCost: 100 } });
    expect(riskExitIntents(base)).toHaveLength(1);
    expect(riskExitIntents({ ...base, hasActiveOrder: () => true })).toHaveLength(0);
  });
});

describe('포지션/손익 계산', () => {
  const empty = { quantity: '0', totalCost: '0', averageEntryPrice: '0', realizedPnl: '0' };
  it('분할 매수 시 평단 = (체결금액 + 수수료) ÷ 수량', () => {
    const a = applyTradeToPosition(empty, 'bid', '100', '1', '0.05').next;
    const b = applyTradeToPosition(a, 'bid', '80', '1', '0.04').next;
    expect(Number(b.quantity)).toBe(2);
    expect(Number(b.totalCost)).toBeCloseTo(180.09);
    expect(Number(b.averageEntryPrice)).toBeCloseTo(90.045);
  });
  it('매도 시 실현손익 = (체결금액 - 매도수수료) - 평단×수량', () => {
    const pos = applyTradeToPosition(empty, 'bid', '100', '2', '0.1').next; // 평단 100.05
    const s = applyTradeToPosition(pos, 'ask', '110', '1', '0.055');
    expect(Number(s.realized)).toBeCloseTo(110 - 0.055 - 100.05);
    expect(Number(s.next.quantity)).toBe(1);
    expect(Number(s.next.averageEntryPrice)).toBeCloseTo(100.05);
    const s2 = applyTradeToPosition(s.next, 'ask', '90', '1', '0.045');
    expect(Number(s2.next.quantity)).toBe(0);
    expect(Number(s2.next.totalCost)).toBe(0);
    expect(Number(s2.next.realizedPnl)).toBeCloseTo(110 - 0.055 - 100.05 + (90 - 0.045 - 100.05));
  });
});

describe('전략 설정 검증', () => {
  it('기본값 + 사용자 값', () => {
    const c = buildStrategyConfig('grid', { spacingPercent: 1.5 }) as Extract<StrategyConfig, { kind: 'grid' }>;
    expect(c.spacingPercent).toBe(1.5);
    expect(c.levels).toBeGreaterThan(0);
  });
  it('칸당 금액이 최소 주문 금액보다 작으면 거부', () => {
    const c = buildStrategyConfig('grid', { levels: 50 });
    expect(validateStrategyConfig(c, 100_000, 5000).length).toBeGreaterThan(0);
  });
  it('RSI 기준 순서 검증', () => {
    const c = buildStrategyConfig('rsi', { oversold: 80, overbought: 70 });
    expect(validateStrategyConfig(c, 1_000_000, 5000).length).toBeGreaterThan(0);
  });
});

// ───────── 실전형 강화 기능 ─────────
import { atr, averageVolume, emaSeries } from '../../server/indicators';
import { atrSpacingPercent } from '../../server/strategies/grid';
import type { Bar } from '../../server/indicators';

const mkBars = (closes: number[], vol = 10, range = 1): Bar[] => closes.map((c, i) => ({ start: i * 60_000, open: c, high: c + range, low: c - range, close: c, volume: vol }));

describe('지표(EMA/ATR/거래량)', () => {
  it('EMA는 SMA로 시작해 최근 값에 가중', () => {
    const e = emaSeries([1, 2, 3, 4, 5, 6], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
    expect(e[5]).toBeCloseTo(5);
  });
  it('ATR = 평균 변동폭', () => {
    expect(atr(mkBars(Array(30).fill(100), 1, 2), 14)).toBeCloseTo(4);
  });
  it('평균 거래량(마지막 봉 제외)', () => {
    const b = mkBars(Array(25).fill(100), 10);
    b[b.length - 1].volume = 100;
    expect(averageVolume(b, 20)).toBe(10);
  });
});

describe('RSI 반등 확인 + 추세 필터', () => {
  const cfg = buildStrategyConfig('rsi', { period: 14, oversold: 30, overbought: 70, splitRatio: 0.33, maxEntries: 3, entryMode: 'rebound', trendEmaPeriod: 0 }) as Extract<StrategyConfig, { kind: 'rsi' }>;
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const crash = [...up, 120, 110, 100, 90, 80, 70];
  it('과매도로 떨어지는 동안은 사지 않고, 다시 올라올 때 산다', () => {
    const b = bot('rsi', cfg);
    const state: Record<string, unknown> = {};
    rsiStrategy.initialize(ctx(b, { closes: up, state }) as never);
    expect(rsiStrategy.onCandleClose(ctx(b, { closes: crash, state }) as never)).toHaveLength(0); // 떨어지는 칼날
    const bounce = [...crash, 85, 100, 115];
    let r: ReturnType<typeof rsiStrategy.onCandleClose> = [];
    for (let k = 1; k <= 3 && !r.length; k++) r = rsiStrategy.onCandleClose(ctx(b, { closes: bounce.slice(0, crash.length + k), state }) as never);
    expect(r[0]?.order).toMatchObject({ side: 'bid', purpose: 'ENTRY' });
    expect(r[0]?.reason).toContain('반등 확인');
  });
  it('추세 필터: 장기 추세선 아래면 반등 신호가 와도 사지 않음', () => {
    const cfgT = { ...cfg, trendEmaPeriod: 50 };
    const b = bot('rsi', cfgT);
    const down = Array.from({ length: 60 }, (_, i) => 300 - i * 3); // 긴 하락(마지막 123)
    const state: Record<string, unknown> = { dipped: true, lastRsi: 25, entries: 0, armed: false };
    const r = rsiStrategy.onCandleClose(ctx(b, { closes: [...down, 153], state }) as never); // 급반등했지만 EMA50(약 196) 아래
    expect(r.every((x) => !x.order)).toBe(true);
    expect(r.some((x) => x.reason.includes('하락장'))).toBe(true);
    // 같은 데이터에서 추세 필터를 끄면 매수
    const r2 = rsiStrategy.onCandleClose(ctx(bot('rsi', cfg), { closes: [...down, 153], state: { dipped: true, lastRsi: 25, entries: 0 } }) as never);
    expect(r2.some((x) => x.order?.side === 'bid')).toBe(true);
  });
});

describe('골든크로스 거래량 확인', () => {
  const cfg = buildStrategyConfig('goldenCross', { shortPeriod: 5, longPeriod: 20, maType: 'SMA', volumeMultiplier: 1.5 }) as Extract<StrategyConfig, { kind: 'goldenCross' }>;
  const closes = [...Array(25).fill(100), 101];
  it('거래량이 부족하면 사지 않는다', () => {
    const r = goldenCrossStrategy.onCandleClose(ctx(bot('goldenCross', cfg), { closes, bars: mkBars(closes, 10), state: {} }) as never);
    expect(r[0].order).toBeUndefined();
    expect(r[0].reason).toContain('거래량');
  });
  it('거래량이 충분하면 산다', () => {
    const bars = mkBars(closes, 10);
    bars[bars.length - 1].volume = 20;
    const r = goldenCrossStrategy.onCandleClose(ctx(bot('goldenCross', cfg), { closes, bars, state: {} }) as never);
    expect(r[0].order).toMatchObject({ side: 'bid', purpose: 'ENTRY' });
  });
});

describe('트레일링 익절 / 변동성 손절', () => {
  const base = { averageEntryPrice: 100, quantity: 1, takeProfitPercent: 2, stopLossPercent: 5, useTakeProfit: true };
  it('목표 도달 전에는 팔지 않고, 도달 후 최고가에서 내려오면 판다', () => {
    expect(evaluateRiskExit({ ...base, price: 102.5, trailingStopPercent: 1, peak: 102.5 }).action).toBeNull();
    expect(evaluateRiskExit({ ...base, price: 103.9, trailingStopPercent: 1, peak: 105 }).action).toBe('TAKE_PROFIT');
    expect(evaluateRiskExit({ ...base, price: 104.5, trailingStopPercent: 1, peak: 105 }).action).toBeNull();
  });
  it('트레일링 매도는 평단 위에서만(손실 구간은 손절 담당)', () => {
    expect(evaluateRiskExit({ ...base, price: 99, trailingStopPercent: 5, peak: 103 }).action).toBeNull();
  });
  it('ATR 손절가가 % 손절가보다 가까우면 ATR 손절', () => {
    const r = evaluateRiskExit({ ...base, price: 97, atrStopPrice: 97.5 });
    expect(r.action).toBe('STOP_LOSS');
    expect(r.kind).toBe('ATR_STOP');
    expect(evaluateRiskExit({ ...base, price: 97.6, atrStopPrice: 97.5 }).action).toBeNull();
    // ATR 손절가가 더 멀면 % 손절(최대 손실 한도) 적용
    expect(evaluateRiskExit({ ...base, price: 94.9, atrStopPrice: 90 }).kind).toBe('PERCENT_STOP');
  });
});

describe('그리드 변동성 간격 / 하락장 매수 멈춤', () => {
  it('ATR 간격은 [최소 간격, 5%] 범위', () => {
    expect(atrSpacingPercent(2, 100, 1, 1)).toBe(2);
    expect(atrSpacingPercent(0.1, 100, 1, 1)).toBe(1);
    expect(atrSpacingPercent(20, 100, 1, 1)).toBe(5);
  });
  it('가격이 EMA50보다 3% 넘게 아래면 새로 사지 않음(알림만)', () => {
    const cfg = buildStrategyConfig('grid', { spacingPercent: 1, levels: 3, downtrendGuard: true }) as Extract<StrategyConfig, { kind: 'grid' }>;
    const b = bot('grid', cfg);
    const bars = mkBars(Array(70).fill(1100));
    const state = {};
    gridStrategy.initialize(ctx(b, { price: 1000, state, bars }) as never);
    const r = gridStrategy.onTicker(ctx(b, { price: 985, state, bars }) as never);
    expect(r.some((x) => x.order?.side === 'bid')).toBe(false);
    expect(r.some((x) => x.signalType === 'INFO' && x.reason.includes('하락 추세'))).toBe(true);
  });
});
