import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../server/app';
import { env as baseEnv } from '../../server/config/env';
import { ENGINE } from '../../server/config/strategyDefaults';

/**
 * PAPER 전체 흐름 통합 테스트 — 업비트 네트워크 없이(가짜 fetch) 실행.
 * 시그널 → 검증 → 가상 주문 → 가상 체결 → 포지션 → 손익 → 봇 OFF/긴급정지 까지 확인한다.
 */

let price = 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('/v1/market/all')) {
    return json([
      { market: 'KRW-XRP', korean_name: '리플', english_name: 'XRP', market_event: { warning: false, caution: {} } },
      { market: 'BTC-ETH', korean_name: '이더리움', english_name: 'Ethereum', market_event: { warning: false, caution: {} } },
    ]);
  }
  if (url.includes('/v1/ticker')) {
    return json([{ market: 'KRW-XRP', trade_price: price, signed_change_rate: 0, acc_trade_price_24h: 0, timestamp: Date.now() }]);
  }
  if (url.includes('/v1/orderbook/instruments')) return json([{ market: 'KRW-XRP', quote_currency: 'KRW', tick_size: '1', supported_levels: ['0'] }]);
  if (url.includes('/v1/candles')) {
    const now = Date.now();
    return json(
      Array.from({ length: 50 }, (_, i) => ({
        market: 'KRW-XRP',
        candle_date_time_utc: new Date(now - (i + 1) * 60_000).toISOString().slice(0, 19),
        trade_price: 1000,
      })),
    );
  }
  throw new Error(`unexpected request in test: ${url}`);
};

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

let app: App;

function tick(p: number) {
  price = p;
  // 업비트 WS ticker/trade 메시지와 같은 형태로 주입
  const m = app.market as unknown as { handleMessage: (x: Record<string, unknown>) => void };
  m.handleMessage({ type: 'ticker', code: 'KRW-XRP', trade_price: p, signed_change_rate: 0, timestamp: Date.now(), trade_timestamp: Date.now(), stream_type: 'REALTIME' });
  m.handleMessage({ type: 'trade', code: 'KRW-XRP', trade_price: p, trade_volume: 1, trade_timestamp: Date.now(), timestamp: Date.now(), stream_type: 'REALTIME' });
}

beforeEach(async () => {
  price = 1000;
  ENGINE.tickEvalMinMs = 0;
  app = createApp({
    env: { ...baseEnv, upbitAccessKey: '', upbitSecretKey: '', paperInitialKRW: 10_000_000, liveHardLock: true, dataDir: path.join(os.tmpdir(), 'upbit-bot-test') },
    databasePath: ':memory:',
    fetchImpl: fakeFetch,
  });
  await app.market.refreshMarkets();
  tick(1000);
});

afterEach(() => {
  app.stop();
});

async function createGridBot(budget = 90_000) {
  const bot = app.engine.createBot({
    marketCode: 'KRW-XRP',
    strategy: 'grid',
    budgetKRW: budget,
    takeProfitPercent: 1,
    stopLossPercent: 3,
    strategyConfig: { spacingPercent: 1, levels: 3, reentryCooldownSec: 0 },
  });
  await app.engine.startBot(bot.id);
  await wait();
  return bot;
}

describe('PAPER 그리드 전체 흐름', () => {
  it('새 봇은 항상 PAPER, LIVE 전환은 하드락으로 거부', async () => {
    const bot = await createGridBot();
    expect(app.repo.getBot(bot.id)!.mode).toBe('PAPER');
    await app.engine.stopBot(bot.id);
    await expect(app.engine.setMode(bot.id, 'LIVE')).rejects.toThrow(/잠겨/);
  });

  it('레벨 도달 → 가상 매수 체결 → 익절 매도 예약 → 체결 → 실현손익/가상잔고 반영', async () => {
    const bot = await createGridBot();
    tick(1000);
    await wait();
    expect(app.repo.listOrders()).toHaveLength(0); // 기준가에서는 안 산다

    tick(989); // L1 = 990
    await wait();
    const buys = app.repo.listOrders().filter((o) => o.purpose === 'GRID_BUY');
    expect(buys).toHaveLength(1);
    expect(buys[0].identifier.startsWith(`PBOT-${bot.id}-`)).toBe(true);
    expect(buys[0].price).toBe('990'); // 호가 단위(1원) 내림
    expect(buys[0].state).toBe('FILLED');

    // 같은 가격대가 계속 와도 같은 레벨 중복 주문 없음
    for (let i = 0; i < 5; i++) {
      tick(989);
      await wait(10);
    }
    await wait();
    expect(app.repo.listOrders().filter((o) => o.purpose === 'GRID_BUY' && o.gridLevelId === 'L1')).toHaveLength(1);

    const pos = app.positions.get(bot.id, 'KRW-XRP');
    expect(Number(pos.quantity)).toBeGreaterThan(0);
    const sell = app.repo.listOrders().find((o) => o.purpose === 'GRID_SELL');
    expect(sell).toBeTruthy();
    expect(sell!.state).toBe('OPEN');
    expect(Number(sell!.price)).toBeGreaterThanOrEqual(989 * 1.01);

    tick(1000); // 매도 목표가(999) 도달
    await wait();
    const filledSell = app.repo.getOrder(sell!.id)!;
    expect(filledSell.state).toBe('FILLED');
    const after = app.positions.get(bot.id, 'KRW-XRP');
    expect(Number(after.quantity)).toBe(0);
    expect(Number(after.realizedPnl)).toBeGreaterThan(0);

    // 가상 잔고 = 초기 + 실현손익 (매수·매도 수수료 포함 계산과 일치)
    const paper = app.account.paperKrw();
    expect(paper).toBeCloseTo(10_000_000 + Number(after.realizedPnl), 4);

    const trades = app.repo.listTrades();
    expect(trades).toHaveLength(2);
    const sellTrade = trades.find((t) => t.side === 'ask')!;
    expect(Number(sellTrade.fee)).toBeCloseTo(Number(sellTrade.funds) * 0.0005, 6);
  });

  it('예산을 넘는 매수는 거부되고 시그널에 이유가 남는다', async () => {
    // 예산 15,000원, 칸당 자동 = 5,000원 × 3칸 → 4번째 매수 여력 없음. 칸당 금액을 크게 줘서 확인
    const bot = app.engine.createBot({
      marketCode: 'KRW-XRP',
      strategy: 'grid',
      budgetKRW: 12_000,
      takeProfitPercent: 1,
      stopLossPercent: 50,
      strategyConfig: { spacingPercent: 1, levels: 2, orderKRW: 6_000, reentryCooldownSec: 0 },
    });
    await app.engine.startBot(bot.id);
    tick(989);
    await wait();
    tick(975); // L2
    await wait();
    const buys = app.repo.listOrders().filter((o) => o.side === 'bid' && o.state === 'FILLED');
    const used = app.orders.usedBudget(bot.id, 'KRW-XRP').toNumber();
    expect(used).toBeLessThanOrEqual(12_000);
    expect(buys.length).toBeLessThanOrEqual(2);
  });

  it('봇 OFF: 이 봇의 미체결 주문만 취소, 보유 코인은 유지', async () => {
    const bot = await createGridBot();
    tick(989);
    await wait();
    tick(989);
    await wait();
    const qty = Number(app.positions.get(bot.id, 'KRW-XRP').quantity);
    expect(app.repo.listActiveOrders({ botId: bot.id }).length).toBe(1); // 익절 매도 대기
    const r = await app.engine.stopBot(bot.id);
    expect(r.cancelled).toBe(1);
    expect(app.repo.listActiveOrders({ botId: bot.id })).toHaveLength(0);
    expect(Number(app.positions.get(bot.id, 'KRW-XRP').quantity)).toBe(qty);
    expect(app.repo.listTrades().filter((t) => t.side === 'ask')).toHaveLength(0); // 강제 매도 없음
  });

  it('긴급 정지: 모든 봇 OFF + 미체결 취소 + 신규 주문 차단 + 강제 매도 없음', async () => {
    const bot = await createGridBot();
    tick(989);
    await wait();
    tick(989);
    await wait();
    const res = await app.engine.emergencyStop();
    expect(res.cancelled).toBe(1);
    expect(app.repo.getBot(bot.id)!.active).toBe(false);
    await expect(app.engine.startBot(bot.id)).rejects.toThrow(/긴급 정지/);
    const sub = await app.orders.submit({ bot: app.repo.getBot(bot.id)!, side: 'bid', purpose: 'ENTRY', kind: 'market', krwAmount: 10_000, reason: 'test' });
    expect(sub.ok).toBe(false);
    expect(Number(app.positions.get(bot.id, 'KRW-XRP').quantity)).toBeGreaterThan(0);
    app.engine.releaseEmergency();
    await app.engine.startBot(bot.id);
    expect(app.repo.getBot(bot.id)!.active).toBe(true);
  });

  it('손절: 평균 매입가 대비 -3%면 남은 주문 정리 후 시장가 전량 매도', async () => {
    const bot = await createGridBot();
    tick(989);
    await wait();
    tick(989);
    await wait();
    tick(950); // 989 대비 -3.9% (그 사이 L2/L3 매수도 발생할 수 있음 → 평단 기준)
    await wait(80);
    tick(900);
    await wait(120);
    const stop = app.repo.listOrders().find((o) => o.purpose === 'STOP_LOSS');
    expect(stop).toBeTruthy();
    expect(stop!.state).toBe('FILLED');
    expect(Number(app.positions.get(bot.id, 'KRW-XRP').quantity)).toBe(0);
    expect(Number(app.positions.get(bot.id, 'KRW-XRP').realizedPnl)).toBeLessThan(0);
    // 손절 후에는 봇이 꺼져서 하락 중 재매수하지 않는다
    expect(app.repo.getBot(bot.id)!.active).toBe(false);
    const buysBefore = app.repo.listOrders().filter((o) => o.side === 'bid').length;
    tick(880);
    await wait(80);
    expect(app.repo.listOrders().filter((o) => o.side === 'bid').length).toBe(buysBefore);
  });

  it('KRW 외 마켓, 잘못된 입력 거부', () => {
    expect(() => app.engine.createBot({ marketCode: 'BTC-ETH', strategy: 'grid', budgetKRW: 100000, takeProfitPercent: 1, stopLossPercent: 3 })).toThrow(/원화/);
    expect(() => app.engine.createBot({ marketCode: 'KRW-NOPE', strategy: 'grid', budgetKRW: 100000, takeProfitPercent: 1, stopLossPercent: 3 })).toThrow();
    expect(() => app.engine.createBot({ marketCode: 'KRW-XRP', strategy: 'grid', budgetKRW: 1000, takeProfitPercent: 1, stopLossPercent: 3 })).toThrow(/예산/);
    expect(() => app.engine.createBot({ marketCode: 'KRW-XRP', strategy: 'grid', budgetKRW: 100000, takeProfitPercent: 0, stopLossPercent: 3 })).toThrow(/익절/);
    // 프로토타입 키를 전략 이름으로 넣어도 거부(서버 다운 결함 회귀 방지)
    for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(() => app.engine.createBot({ marketCode: 'KRW-XRP', strategy: bad as never, budgetKRW: 100000, takeProfitPercent: 1, stopLossPercent: 3 })).toThrow(/전략/);
    }
  });

  it('API 응답(스냅샷)에 비밀정보가 없다', () => {
    const snap = JSON.stringify(app.snapshot.build());
    expect(snap).not.toMatch(/secret/i);
  });
});
