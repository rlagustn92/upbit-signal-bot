import { afterEach, describe, expect, it } from 'vitest';
import type { BotRecord, OrderRecord } from '../../server/db/repositories';
import type { HlFill } from '../../server/hyperliquid/client';
import { longIntervals, replayOnBars } from '../../server/hyperliquid/replay';
import { HyperliquidWatcher, setCopyFeed, type CopyFeed, type TraderSnapshot } from '../../server/hyperliquid/watcher';
import { HyperliquidClient } from '../../server/hyperliquid/client';
import { buildStrategyConfig, validateStrategyConfig } from '../../server/strategies';
import { copyTradeStrategy } from '../../server/strategies/copyTrade';
import type { StrategyContext } from '../../server/strategies/types';
import type { StrategyConfig } from '../../shared/types';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);

function fill(time: number, side: 'B' | 'A', sz: number, startPosition: number, coin = 'BTC'): HlFill {
  return { coin, px: '100', sz: String(sz), side, time, startPosition: String(startPosition), dir: '', closedPnl: '0', fee: '0' };
}

describe('하이퍼리퀴드 체결 기록 → 롱 보유 구간', () => {
  it('진입·추가 매수·정리를 한 구간으로 묶고, 기록 전부터 들고 있던 롱은 뺀다', () => {
    const iv = longIntervals([
      fill(100, 'A', 1, 2), // 기록 전부터 롱 2개 → 일부 정리
      fill(150, 'A', 1, 1), // 나머지 정리(진입 시점을 모르므로 제외)
      fill(200, 'B', 1, 0), // 새 롱 진입
      fill(250, 'B', 1, 1), // 추가 매수
      fill(300, 'A', 2, 2), // 전부 정리
      fill(400, 'A', 1, 0), // 숏 진입(무시)
      fill(500, 'B', 3, -1), // 숏 → 롱 2개로 뒤집기
    ]);
    expect(iv).toEqual([
      { open: 200, close: 300 },
      { open: 500, close: null },
    ]);
  });

  it('롱 → 숏 한 번에 뒤집기는 롱 정리로 본다', () => {
    expect(longIntervals([fill(10, 'B', 1, 0), fill(20, 'A', 3, 1)])).toEqual([{ open: 10, close: 20 }]);
  });

  it('업비트 캔들 대입: 신호 + 지연 뒤 첫 캔들 시가에 사고팔며 수수료·미끄러짐을 뺀다', () => {
    const bars = [0, 60_000, 120_000, 180_000].map((start, i) => ({ start, open: 100 + i * 10, high: 0, low: 0, close: 100 + i * 10 + 5, volume: 1 }));
    const t = replayOnBars([{ open: 10_000, close: 130_000 }], bars, { lagMs: 30_000, fee: 0, slip: 0 });
    // 10초+30초 → 60초 캔들 시가 110에 매수, 130초+30초 → 180초 캔들 시가 130에 매도
    expect(t[0].entry).toBe(110);
    expect(t[0].exit).toBe(130);
    expect(t[0].ret).toBeCloseTo(130 / 110 - 1, 10);
    const withCost = replayOnBars([{ open: 10_000, close: 130_000 }], bars, { lagMs: 30_000, fee: 0.0005, slip: 0.0005 });
    expect(withCost[0].ret).toBeLessThan(t[0].ret);
  });
});

// ───── 전략 ─────
class FakeFeed implements CopyFeed {
  snaps = new Map<string, TraderSnapshot>();
  wanted: string[] = [];
  want(a: string[]) {
    this.wanted = a;
  }
  get(a: string) {
    return this.snaps.get(a.toLowerCase());
  }
  set(a: string, btc: number, updatedAt = 1_000_000, ok = true) {
    this.snaps.set(a, { ok, positions: { BTC: btc }, details: { BTC: { entryPx: 80000, unrealizedPnl: 0, leverage: 5 } }, accountValue: 1, updatedAt });
  }
}

function makeBot(cfgInput: Record<string, unknown>, budget = '200000'): BotRecord {
  const cfg = buildStrategyConfig('copyTrade', cfgInput as never);
  return {
    id: 1,
    name: 't',
    displayName: 't',
    marketCode: 'KRW-BTC',
    displaySymbol: 'BTC/KRW',
    coinName: '비트코인',
    strategy: 'copyTrade',
    strategyConfig: cfg,
    strategyState: {},
    budgetKRW: budget,
    takeProfitPercent: 2,
    stopLossPercent: 10,
    active: true,
    mode: 'PAPER',
    lastSignalText: null,
    lastSignalAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

type Ctx = StrategyContext<Extract<StrategyConfig, { kind: 'copyTrade' }>>;
function makeCtx(b: BotRecord, state: Record<string, unknown>, qty = 0): Ctx {
  return {
    bot: b,
    config: b.strategyConfig as Ctx['config'],
    state,
    position: { quantity: qty, averageEntryPrice: qty ? 100 : 0, totalCost: 0 },
    price: 100,
    closes: [],
    bars: [],
    hasActiveOrder: () => false,
    now: 1_000_000,
  };
}
const order = (side: 'bid' | 'ask', purpose: string, gridLevelId: string, state = 'FILLED') => ({ side, purpose, gridLevelId, state }) as unknown as OrderRecord;

describe('고수 따라하기 전략', () => {
  let feed: FakeFeed;
  afterEach(() => setCopyFeed(new HyperliquidWatcher(new HyperliquidClient())));
  const setup = (cfg: Record<string, unknown> = {}) => {
    feed = new FakeFeed();
    setCopyFeed(feed);
    const b = makeBot({ addresses: [A, B], ...cfg });
    const state: Record<string, unknown> = {};
    copyTradeStrategy.initialize(makeCtx(b, state));
    return { b, state };
  };

  it('켤 때 이미 롱인 사람은 따라 사지 않고, 정리했다가 다시 롱을 잡으면 그 사람 몫(예산 ÷ 인원)만 산다', () => {
    const { b, state } = setup();
    expect(feed.wanted).toEqual([A, B]);
    feed.set(A, 1);
    feed.set(B, 0);
    expect(copyTradeStrategy.onTicker(makeCtx(b, state))).toEqual([]);
    feed.set(A, 0);
    expect(copyTradeStrategy.onTicker(makeCtx(b, state))).toEqual([]);
    feed.set(A, 2);
    const out = copyTradeStrategy.onTicker(makeCtx(b, state));
    expect(out).toHaveLength(1);
    expect(out[0].order).toMatchObject({ side: 'bid', purpose: 'ENTRY', kind: 'market', krwAmount: 100000, gridLevelId: A });
  });

  it('산 사람이 롱을 정리하면 그 몫을 판다(마지막 몫이면 전부), 숏으로 바꿔도 판다', () => {
    const { b, state } = setup({ joinExisting: true });
    feed.set(A, 1);
    feed.set(B, 0);
    const buy = copyTradeStrategy.onTicker(makeCtx(b, state));
    expect(buy[0].order?.gridLevelId).toBe(A);
    copyTradeStrategy.onOrderUpdate(makeCtx(b, state, 0.001), order('bid', 'ENTRY', A), 0.001, 100);
    feed.set(A, -1);
    const sell = copyTradeStrategy.onTicker(makeCtx(b, state, 0.001));
    expect(sell[0].order).toMatchObject({ side: 'ask', purpose: 'EXIT', volume: 'ALL', gridLevelId: A });
    expect(sell[0].reason).toContain('숏');
    copyTradeStrategy.onOrderUpdate(makeCtx(b, state, 0), order('ask', 'EXIT', A), 0.001, 100);
    expect(copyTradeStrategy.onTicker(makeCtx(b, state, 0))).toEqual([]);
  });

  it('두 사람 몫을 들고 있으면 한 사람이 정리할 때 그 사람 수량만 판다', () => {
    const { b, state } = setup({ joinExisting: true });
    feed.set(A, 1);
    feed.set(B, 1);
    copyTradeStrategy.onTicker(makeCtx(b, state));
    copyTradeStrategy.onOrderUpdate(makeCtx(b, state, 0.001), order('bid', 'ENTRY', A), 0.001, 100);
    const second = copyTradeStrategy.onTicker(makeCtx(b, state, 0.001));
    expect(second[0].order?.gridLevelId).toBe(B);
    copyTradeStrategy.onOrderUpdate(makeCtx(b, state, 0.003), order('bid', 'ENTRY', B), 0.002, 100);
    feed.set(B, 0);
    const sell = copyTradeStrategy.onTicker(makeCtx(b, state, 0.003));
    expect(sell[0].order).toMatchObject({ side: 'ask', volume: '0.00200000', gridLevelId: B });
  });

  it('조회가 끊기거나 오래된 값이면 매매하지 않고 한 번 알린다', () => {
    const { b, state } = setup({ joinExisting: true });
    feed.set(A, 1, 1_000_000 - 120_000); // 2분 전 값
    feed.set(B, 1, 1_000_000, false); // 조회 실패
    const out = copyTradeStrategy.onTicker(makeCtx(b, state));
    expect(out).toHaveLength(1);
    expect(out[0].signalType).toBe('INFO');
    expect(out[0].order).toBeUndefined();
    expect(copyTradeStrategy.onTicker(makeCtx(b, state))).toEqual([]);
  });

  it('손절로 전부 팔리면 그 사람이 아직 롱이어도 다시 사지 않고, 정리 후 새 롱부터 따라 산다', () => {
    const { b, state } = setup({ joinExisting: true });
    feed.set(A, 1);
    feed.set(B, 0);
    copyTradeStrategy.onTicker(makeCtx(b, state));
    copyTradeStrategy.onOrderUpdate(makeCtx(b, state, 0.001), order('bid', 'ENTRY', A), 0.001, 100);
    copyTradeStrategy.onPositionClosed(makeCtx(b, state, 0));
    expect(copyTradeStrategy.onTicker(makeCtx(b, state))).toEqual([]);
    feed.set(A, 0);
    copyTradeStrategy.onTicker(makeCtx(b, state));
    feed.set(A, 1);
    expect(copyTradeStrategy.onTicker(makeCtx(b, state))[0].order?.side).toBe('bid');
  });

  it('주소 형식·한 사람 몫 최소 금액을 검사한다', () => {
    const bad = buildStrategyConfig('copyTrade', { addresses: `${A}\n0x1234` } as never);
    expect(validateStrategyConfig(bad, 200000, 5000).join(' ')).toContain('지갑 주소 형식');
    const many = buildStrategyConfig('copyTrade', { addresses: [A, B, '0x' + 'c'.repeat(40), '0x' + 'd'.repeat(40), '0x' + 'e'.repeat(40)] } as never);
    expect(validateStrategyConfig(many, 20000, 5000).join(' ')).toContain('한 사람 몫');
    expect(validateStrategyConfig(many, 200000, 5000)).toEqual([]);
  });
});
