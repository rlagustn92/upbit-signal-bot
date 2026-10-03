import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../server/app';
import { env as baseEnv } from '../../server/config/env';
import { ENGINE } from '../../server/config/strategyDefaults';
import { buildStrategyConfig, validateStrategyConfig } from '../../server/strategies';

/** QA 에이전트 보고서(2026-10-03)에서 나온 결함들의 회귀 테스트 */

let price = 1000;
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('/v1/market/all')) return json([{ market: 'KRW-XRP', korean_name: '리플', english_name: 'XRP' }, { market: 'KRW-DOGE', korean_name: '도지코인', english_name: 'Dogecoin' }]);
  if (url.includes('/v1/ticker')) return json([{ market: url.includes('DOGE') ? 'KRW-DOGE' : 'KRW-XRP', trade_price: url.includes('DOGE') ? 127 : price, timestamp: Date.now() }]);
  if (url.includes('/v1/orderbook/instruments')) return json([{ market: 'KRW-XRP', quote_currency: 'KRW', tick_size: '1', supported_levels: ['0'] }]);
  if (url.includes('/v1/candles')) {
    const now = Date.now();
    return json(Array.from({ length: 200 }, (_, i) => ({ market: 'KRW-XRP', candle_date_time_utc: new Date(now - (i + 1) * 3_600_000).toISOString().slice(0, 19), opening_price: 1000, high_price: 1005, low_price: 995, trade_price: 1000, candle_acc_trade_volume: 10 })));
  }
  throw new Error(`unexpected ${url}`);
};
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
let app: App;

function tick(p: number, market = 'KRW-XRP') {
  if (market === 'KRW-XRP') price = p;
  const m = app.market as unknown as { handleMessage: (x: Record<string, unknown>) => void };
  m.handleMessage({ type: 'ticker', code: market, trade_price: p, timestamp: Date.now(), stream_type: 'REALTIME' });
  m.handleMessage({ type: 'trade', code: market, trade_price: p, trade_volume: 1, trade_timestamp: Date.now(), timestamp: Date.now(), stream_type: 'REALTIME' });
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
  tick(127, 'KRW-DOGE');
});
afterEach(() => app.stop());

const grid = (extra = {}) =>
  app.engine.createBot({ marketCode: 'KRW-XRP', strategy: 'grid', budgetKRW: 90_000, takeProfitPercent: 1, stopLossPercent: 30, strategyConfig: { spacingPercent: 1, levels: 3, reentryCooldownSec: 0, ...extra } });

describe('QA 회귀', () => {
  it('M3: 이미 켜진 봇을 다시 켜도 실행기가 하나뿐이고 같은 칸 중복 주문 없음', async () => {
    const b = grid();
    await app.engine.startBot(b.id);
    await app.engine.startBot(b.id);
    await app.engine.startBot(b.id);
    tick(989);
    await wait(80);
    expect(app.repo.listOrders().filter((o) => o.purpose === 'GRID_BUY' && o.gridLevelId === 'L1')).toHaveLength(1);
  });

  it('M3: 같은 봇 동시 주문 요청은 하나만 처리', async () => {
    const b = grid();
    await app.engine.startBot(b.id);
    const bot = app.repo.getBot(b.id)!;
    const req = { bot, side: 'bid' as const, purpose: 'ENTRY' as const, kind: 'market' as const, krwAmount: 10_000, reason: 't' };
    const [r1, r2] = await Promise.all([app.orders.submit(req), app.orders.submit(req)]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
  });

  it('M6: 꺼져 있던 동안 가격이 내려가도, 다시 켜면 그 가격을 새 기준가로 삼아 한꺼번에 사지 않음', async () => {
    const b = grid();
    await app.engine.startBot(b.id);
    await app.engine.stopBot(b.id);
    tick(950); // 꺼진 동안 -5%
    await app.engine.startBot(b.id);
    tick(950);
    await wait(80);
    expect(app.repo.listOrders().filter((o) => o.side === 'bid')).toHaveLength(0);
  });

  it('M6: 호가 단위보다 작은 그리드 간격 거부(127원 코인 0.1%)', () => {
    expect(() =>
      app.engine.createBot({ marketCode: 'KRW-DOGE', strategy: 'grid', budgetKRW: 100_000, takeProfitPercent: 2, stopLossPercent: 3, strategyConfig: { spacingPercent: 0.1, levels: 3 } }),
    ).toThrow(/간격/);
  });

  it('M7: 분할 비율 × 횟수가 100%를 넘으면 거부, 기본값은 통과', () => {
    expect(validateStrategyConfig(buildStrategyConfig('rsi', { splitRatio: 0.5, maxEntries: 5 }), 1_000_000, 5000).length).toBeGreaterThan(0);
    expect(validateStrategyConfig(buildStrategyConfig('rsi'), 300_000, 5000)).toHaveLength(0);
    expect(validateStrategyConfig(buildStrategyConfig('grid', { orderKRW: 60_000, levels: 5 }), 100_000, 5000).length).toBeGreaterThan(0);
  });

  it('M9: 예산만 줄여도 전략 설정을 다시 검증', () => {
    const b = app.engine.createBot({ marketCode: 'KRW-XRP', strategy: 'grid', budgetKRW: 100_000, takeProfitPercent: 1, stopLossPercent: 3, strategyConfig: { spacingPercent: 1, levels: 5 } });
    expect(() => app.engine.updateBot(b.id, { budgetKRW: 20_000 })).toThrow();
  });

  it('M8: 모의 코인이 있는 봇은 삭제 대신 "모의 코인 팔기"로 정리 → 가상 원화 복구', async () => {
    const b = grid();
    await app.engine.startBot(b.id);
    tick(989);
    await wait(60);
    await app.engine.stopBot(b.id);
    await expect(app.engine.deleteBot(b.id)).rejects.toThrow(/모의 코인 팔기/);
    await app.engine.liquidatePaper(b.id);
    expect(Number(app.positions.get(b.id, 'KRW-XRP').quantity)).toBe(0);
    const realized = Number(app.positions.get(b.id, 'KRW-XRP').realizedPnl);
    expect(app.account.paperKrw()).toBeCloseTo(10_000_000 + realized, 4);
    await app.engine.deleteBot(b.id);
  });

  it('M8: 실전 봇은 모의 코인 팔기 대상이 아님', async () => {
    const b = grid();
    app.repo.updateBot(b.id, { mode: 'LIVE' });
    await expect(app.engine.liquidatePaper(b.id)).rejects.toThrow(/실전/);
  });

  it('잘못된 캔들 단위는 조용히 바꾸지 않고 거부', () => {
    expect(() =>
      app.engine.createBot({ marketCode: 'KRW-XRP', strategy: 'rsi', budgetKRW: 300_000, takeProfitPercent: 2, stopLossPercent: 3, strategyConfig: { candleUnit: '7m' as never } }),
    ).toThrow(/캔들/);
  });

  it('QA2-M3: 최소 주문 금액(수수료 포함)에 못 미치는 예산/칸 금액 거부', () => {
    expect(() => app.engine.createBot({ marketCode: 'KRW-XRP', strategy: 'goldenCross', budgetKRW: 5_000, takeProfitPercent: 2, stopLossPercent: 3 })).toThrow(/예산/);
    expect(validateStrategyConfig(buildStrategyConfig('grid', { orderKRW: 5_000, levels: 2 }), 100_000, 5000).length).toBeGreaterThan(0);
  });

  it('QA2-M3: 최소 주문 금액보다 작아진 모의 잔량도 "모의 코인 팔기"로 정리 가능', async () => {
    const b = app.engine.createBot({ marketCode: 'KRW-XRP', strategy: 'grid', budgetKRW: 20_000, takeProfitPercent: 1, stopLossPercent: 50, strategyConfig: { spacingPercent: 1, levels: 3, reentryCooldownSec: 0 } });
    await app.engine.startBot(b.id);
    tick(989);
    await wait(60);
    await app.engine.stopBot(b.id);
    tick(500); // 반토막 → 보유 평가금이 최소 주문 금액 아래
    await app.engine.liquidatePaper(b.id);
    expect(Number(app.positions.get(b.id, 'KRW-XRP').quantity)).toBe(0);
  });
});
