import { describe, expect, it } from 'vitest';
import { runBacktest } from '../../server/backtest/simulator';
import { buildStrategyConfig } from '../../server/strategies';
import type { Bar } from '../../server/indicators';

const MIN5 = 300_000;
const T0 = Date.UTC(2026, 0, 1);

/** 종가 배열 → 5분봉(고가/저가는 종가 ±폭) */
function barsFrom(closes: number[], wick = 0.002): Bar[] {
  return closes.map((c, i) => {
    const open = i === 0 ? c : closes[i - 1];
    return { start: T0 + i * MIN5, open, high: Math.max(open, c) * (1 + wick), low: Math.min(open, c) * (1 - wick), close: c, volume: 100 };
  });
}

describe('백테스트 시뮬레이터', () => {
  it('그리드: 오르내리는 가격에서 칸마다 사고팔고, 수수료를 빼고도 이익', () => {
    // 1000원 근처에서 ±3% 사인파로 30일
    const closes = Array.from({ length: 30 * 288 }, (_, i) => 1000 * (1 + 0.03 * Math.sin(i / 40)));
    const cfg = buildStrategyConfig('grid', { downtrendGuard: false, spacingPercent: 1, levels: 3 });
    const r = runBacktest({ marketCode: 'KRW-TEST', strategy: 'grid', config: cfg, budgetKRW: 300_000, takeProfitPercent: 1, stopLossPercent: 10, bars: barsFrom(closes), unitMs: MIN5, warmup: 1 });
    expect(r.metrics.trades).toBeGreaterThan(20);
    // 손익은 실제 봇처럼 '전체 평균 매입가' 기준이라 일부 매도는 소폭 손실로 잡힐 수 있음 → 합계로 확인
    expect(r.metrics.profitFactor!).toBeGreaterThan(2);
    expect(r.metrics.totalReturnPercent).toBeGreaterThan(0);
    expect(r.metrics.feesPaid).toBeGreaterThan(0);
    // 매도 체결은 지정가(목표가)에서: 수익 = 약 1% - 수수료 0.1%
    const sells = r.fills.filter((f) => f.side === 'ask');
    expect(sells.every((f) => f.purpose === 'GRID_SELL')).toBe(true);
  });

  it('그리드: 폭락하면 손절하고, 손절 뒤에도 정상적으로 다시 사고판다(수량 찌꺼기로 멈추지 않음)', () => {
    const wave = (n: number, base: number) => Array.from({ length: n }, (_, i) => base * (1 + 0.03 * Math.sin(i / 40)));
    const closes = [...Array.from({ length: 50 }, () => 1678), ...Array.from({ length: 300 }, (_, i) => 1678 * (1 - 0.0005 * i)), ...wave(3000, 1420)];
    const cfg = buildStrategyConfig('grid', { downtrendGuard: false, spacingPercent: 1, levels: 5, cooldownAfterLossMin: 0, dailyLossLimitPercent: 0 });
    const r = runBacktest({ marketCode: 'KRW-TEST', strategy: 'grid', config: cfg, budgetKRW: 1_000_000, takeProfitPercent: 2, stopLossPercent: 3, bars: barsFrom(closes, 0), unitMs: MIN5, warmup: 1 });
    expect(r.metrics.stopLosses).toBeGreaterThanOrEqual(1);
    const stop = r.trades.find((t) => t.purpose === 'STOP_LOSS')!;
    expect(stop.pnlPercent).toBeLessThan(-2.5);
    expect(stop.pnlPercent).toBeGreaterThan(-4.5);
    // 예전 버그: 손절 뒤 0.00000001 같은 찌꺼기가 남아 '보유 중'으로 굳어서 더 이상 사고팔지 못함
    const lastStopAt = Math.max(...r.trades.filter((t) => t.purpose === 'STOP_LOSS').map((t) => t.at));
    expect(r.trades.filter((t) => t.purpose === 'GRID_SELL' && t.at > lastStopAt).length).toBeGreaterThan(5);
  });

  it('골든크로스: 교차에서 사고 데드크로스에서 판다. 같은 가격 왕복이면 수수료+미끄러짐만큼 손해', () => {
    // 평평 → 상승 → 평평 → 하락 (교차 1번씩)
    const flat = (n: number, p: number) => Array.from({ length: n }, () => p);
    const ramp = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 1)) / n);
    const closes = [...flat(100, 1000), ...ramp(30, 1000, 1100), ...flat(30, 1100), ...ramp(30, 1100, 1000), ...flat(30, 1000)];
    const cfg = buildStrategyConfig('goldenCross', { volumeMultiplier: 0, atrStopMultiplier: 0, trailingStopPercent: 0, maType: 'SMA', shortPeriod: 5, longPeriod: 20 });
    const bars = barsFrom(closes, 0).map((b, i) => ({ ...b, start: T0 + i * 3_600_000 }));
    const r = runBacktest({ marketCode: 'KRW-TEST', strategy: 'goldenCross', config: cfg, budgetKRW: 100_000, takeProfitPercent: 50, stopLossPercent: 50, bars, unitMs: 3_600_000, warmup: 60 });
    expect(r.metrics.buys).toBe(1);
    expect(r.trades.length).toBe(1);
    expect(r.trades[0].purpose).toBe('EXIT');
    const buy = r.fills.find((f) => f.side === 'bid')!;
    expect(buy.price).toBeGreaterThan(1000); // 상승 중 교차에서 매수
  });
});

describe('볼린저 반등 전략', () => {
  const H = 3_600_000;
  const toBars = (closes: number[]) => closes.map((c, i) => ({ start: T0 + i * H, open: i ? closes[i - 1] : c, high: Math.max(c, i ? closes[i - 1] : c), low: Math.min(c, i ? closes[i - 1] : c), close: c, volume: 100 }));
  // 완만한 상승 + 작은 출렁임(볼린저 폭이 생기도록)
  const base = (n: number) => Array.from({ length: n }, (_, i) => 1000 * (1 + 0.0005 * i) * (1 + 0.002 * Math.sin(i / 3)));

  it('상승 추세에서 하단 아래로 급락하면 사고, 중심선으로 돌아오면 판다', () => {
    const up = base(400);
    const last = up[up.length - 1];
    const closes = [...up, last * 0.982, last * 0.985, last * 0.995, last * 1.004, ...base(20).map((x) => (x / 1000) * last)];
    const cfg = buildStrategyConfig('bollinger', { cooldownAfterLossMin: 0 });
    const r = runBacktest({ marketCode: 'KRW-TEST', strategy: 'bollinger', config: cfg, budgetKRW: 100_000, takeProfitPercent: 2, stopLossPercent: 8, bars: toBars(closes), unitMs: H, warmup: 350 });
    const buy = r.fills.find((f) => f.side === 'bid');
    expect(buy).toBeDefined();
    expect(buy!.price).toBeLessThan(last * 0.99); // 급락 캔들에서 매수
    expect(r.trades[0].purpose).toBe('EXIT'); // 중심선 복귀 매도(목표 익절% 안 씀)
  });

  it('큰 추세선(EMA100) 아래(하락 흐름)에서는 하단을 뚫어도 사지 않는다', () => {
    const down = Array.from({ length: 400 }, (_, i) => 1000 * (1 - 0.001 * i) * (1 + 0.002 * Math.sin(i / 3)));
    const last = down[down.length - 1];
    const closes = [...down, last * 0.96, last * 0.97, last];
    const cfg = buildStrategyConfig('bollinger', {});
    const r = runBacktest({ marketCode: 'KRW-TEST', strategy: 'bollinger', config: cfg, budgetKRW: 100_000, takeProfitPercent: 2, stopLossPercent: 8, bars: toBars(closes), unitMs: H, warmup: 350 });
    expect(r.metrics.buys).toBe(0);
  });

  it('중심선으로 안 돌아오면 최대 보유 캔들 수 뒤에 정리한다(시간 손절)', () => {
    const up = base(400);
    const last = up[up.length - 1];
    // 급락 후 하단 근처에서 횡보(중심선 아래 유지)
    const closes = [...up, last * 0.982, ...Array.from({ length: 30 }, () => last * 0.981)];
    const cfg = buildStrategyConfig('bollinger', { maxHoldBars: 10, cooldownAfterLossMin: 0 });
    const r = runBacktest({ marketCode: 'KRW-TEST', strategy: 'bollinger', config: cfg, budgetKRW: 100_000, takeProfitPercent: 2, stopLossPercent: 8, bars: toBars(closes), unitMs: H, warmup: 350 });
    expect(r.metrics.buys).toBeGreaterThanOrEqual(1);
    const firstExit = r.trades[0];
    const buyAt = r.fills.find((f) => f.side === 'bid')!.at;
    expect(firstExit.purpose).toBe('EXIT');
    expect(Math.round((firstExit.at - buyAt) / H)).toBeGreaterThanOrEqual(9);
    expect(Math.round((firstExit.at - buyAt) / H)).toBeLessThanOrEqual(11);
  });
});
