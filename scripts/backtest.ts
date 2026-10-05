// 백테스트 명령줄 실행기 (API Key 필요 없음 — 공개 캔들만 사용)
//   npm run backtest                                  → 기본 전략 3개 × BTC/ETH/XRP, 최근 90일 비교
//   npm run backtest -- --market KRW-SOL --strategy rsi --days 180
//   npm run backtest -- --strategy goldenCross --tp 6 --sl 2 --set candleUnit=240m --set trailingStopPercent=0
import path from 'node:path';
import fs from 'node:fs';
import type { StrategyKind } from '../shared/types';
import { backtest, normalizeBacktestRequest, type BacktestResponse } from '../server/backtest';
import { UpbitRestClient } from '../server/upbit/rest';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const sets: Record<string, string | number | boolean> = {};
args.forEach((a, i) => {
  if (a !== '--set') return;
  const [k, v] = String(args[i + 1] ?? '').split('=');
  if (!k) return;
  sets[k] = v === 'true' ? true : v === 'false' ? false : v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : (v ?? '');
});

const markets = (opt('market') ?? 'KRW-BTC,KRW-ETH,KRW-XRP').split(',').map((s) => s.trim().toUpperCase());
const strategies = (opt('strategy') ?? 'all') === 'all' ? (['grid', 'rsi', 'goldenCross', 'bollinger'] as StrategyKind[]) : ((opt('strategy') ?? '').split(',') as StrategyKind[]);
const days = Number(opt('days') ?? 90);
const budget = Number(opt('budget') ?? 1_000_000);

const rest = new UpbitRestClient({ baseUrl: 'https://api.upbit.com', getCredentials: () => null });
const cacheDir = path.resolve(process.cwd(), 'data', 'backtest-cache');

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const r2 = (n: number | null) => (n == null ? '-' : n.toFixed(2));
const NAMES: Record<StrategyKind, string> = { grid: '그리드', rsi: 'RSI 반등', goldenCross: '골든크로스', bollinger: '볼린저 반등', copyTrade: '고수 따라하기' };

const rows: Array<Record<string, string>> = [];
const results: BacktestResponse[] = [];
for (const market of markets) {
  for (const strategy of strategies) {
    const body: Record<string, unknown> = { marketCode: market, strategy, budgetKRW: budget, days, strategyConfig: sets };
    if (opt('tp')) body.takeProfitPercent = Number(opt('tp'));
    if (opt('sl')) body.stopLossPercent = Number(opt('sl'));
    try {
      const req = normalizeBacktestRequest(body);
      process.stdout.write(`\r${market} ${NAMES[strategy]} 캔들 받는 중...            `);
      const res = await backtest(rest, req, {
        cacheDir,
        onProgress: (l, t) => process.stdout.write(`\r${market} ${NAMES[strategy]} 캔들 ${l}/${t}            `),
      });
      results.push(res);
      const m = res.metrics;
      rows.push({
        코인: market.replace('KRW-', ''),
        전략: NAMES[strategy],
        봉: res.simUnit,
        수익률: pct(m.totalReturnPercent),
        그냥보유: pct(m.buyHoldPercent),
        매도횟수: String(m.trades),
        승률: `${m.winRate.toFixed(0)}%`,
        손익비: r2(m.payoffRatio),
        PF: r2(m.profitFactor),
        최대낙폭: `-${m.maxDrawdownPercent.toFixed(1)}%`,
        손절: String(m.stopLosses),
        보유시간: `${m.exposurePercent.toFixed(0)}%`,
      });
    } catch (e) {
      rows.push({ 코인: market.replace('KRW-', ''), 전략: NAMES[strategy], 봉: '-', 수익률: `오류: ${(e as Error).message}` });
    }
  }
}
process.stdout.write('\r' + ' '.repeat(60) + '\r');
console.log(`\n백테스트 — 최근 ${days}일, 예산 ${budget.toLocaleString('ko-KR')}원, 수수료 0.05% + 시장가 미끄러짐 0.05% 포함`);
console.table(rows);
console.log('손익비 = 평균 수익 ÷ 평균 손실, PF = 총수익 ÷ 총손실(1보다 커야 이익), 최대낙폭 = 고점 대비 가장 많이 줄었던 비율');
console.log('※ 과거 결과가 미래 수익을 보장하지 않아요. 캔들 안의 가격 순서는 추정이라 실제와 다를 수 있어요.');
for (const r of results) for (const n of r.notes) console.log(`  · ${r.request.marketCode} ${NAMES[r.request.strategy]}: ${n}`);

const outDir = path.resolve(process.cwd(), 'data', 'backtest');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(results.map((r) => ({ request: r.request, config: r.config, metrics: r.metrics, notes: r.notes })), null, 2));
console.log(`\n자세한 결과: data/backtest/latest.json`);
