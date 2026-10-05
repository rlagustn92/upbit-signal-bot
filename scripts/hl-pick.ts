// 하이퍼리퀴드 상위 트레이더 중 BTC·ETH·XRP를 잘 거래한 사람 고르기 + '업비트에서 따라 했으면' 간이 백테스트
//   npm run hl-pick                      → 최근 60일, 후보 500명, 지연 30초
//   npm run hl-pick -- --days 45 --candidates 200 --lag 60
//
// 방법(공정하게):
//  - 리더보드에서 계좌 5만 달러↑, 누적·30일 손익 플러스, 30일 거래량이 계좌의 1~60배(쉬는 계좌·초단타·시장조성 제외)인 사람만 후보
//  - 각 후보의 체결 기록(최근 60일, 거래소가 최근 1만 건까지만 줌)에서 BTC·ETH·XRP '롱 보유 구간'을 복원
//  - 그 구간을 업비트 원화 1분봉에 대입: 신호 + 지연 뒤 첫 캔들 시가에 시장가 매수/매도, 수수료 0.05%·미끄러짐 0.05%씩
//  - 60일 전체에서 롱 8번 이상·PF 1.5 이상·앞/뒤 기간 모두 손실 아닌 사람 중 합계 수익 상위 5명(앞 2/3·뒤 1/3 성적도 따로 표시)
// ※ 과거 기록이 앞으로의 성과를 보장하지 않아요. 기간이 짧아 참고용이에요.
import fs from 'node:fs';
import path from 'node:path';
import { loadHistory } from '../server/backtest/history';
import { HyperliquidClient, type HlFill, type HlLeaderboardRow } from '../server/hyperliquid/client';
import { longIntervals, replayOnBars, type ReplayTrade } from '../server/hyperliquid/replay';
import type { Bar } from '../server/indicators';
import { UpbitRestClient } from '../server/upbit/rest';

const args = process.argv.slice(2);
const opt = (n: string) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : undefined);
const DAYS = Number(opt('days') ?? 60);
const CANDIDATES = Number(opt('candidates') ?? 500);
const MAX_TURNOVER = Number(opt('maxTurnover') ?? 60);
const PAGES = Number(opt('pages') ?? 2);
const LAG_MS = Number(opt('lag') ?? 30) * 1000;
const PICK = Number(opt('pick') ?? 5);
const FEE = 0.0005;
const SLIP = 0.0005;
const COINS = ['BTC', 'ETH', 'XRP'] as const;

const dir = path.resolve('data', 'hyperliquid');
const fillDir = path.join(dir, 'fills');
fs.mkdirSync(fillDir, { recursive: true });
const hl = new HyperliquidClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = Date.now();
const from = now - DAYS * 86_400_000;
const splitAt = from + ((now - from) * 2) / 3;

// 1) 리더보드 (6시간 캐시)
const lbFile = path.join(dir, 'leaderboard.json');
let rows: HlLeaderboardRow[];
if (fs.existsSync(lbFile) && now - fs.statSync(lbFile).mtimeMs < 6 * 3600_000) rows = JSON.parse(fs.readFileSync(lbFile, 'utf8'));
else {
  console.log('리더보드 받는 중...');
  rows = await hl.leaderboard();
  fs.writeFileSync(lbFile, JSON.stringify(rows));
}
const perf = (r: HlLeaderboardRow, w: string) => {
  const p = r.windowPerformances.find((x) => x[0] === w)?.[1];
  return { pnl: Number(p?.pnl ?? 0), roi: Number(p?.roi ?? 0), vlm: Number(p?.vlm ?? 0) };
};
const cands = rows
  .filter((r) => {
    const av = Number(r.accountValue);
    const all = perf(r, 'allTime');
    const month = perf(r, 'month');
    return av >= 50_000 && all.pnl > 0 && month.pnl > 0 && month.vlm / av >= 1 && month.vlm / av <= MAX_TURNOVER;
  })
  .sort((a, b) => perf(b, 'allTime').pnl - perf(a, 'allTime').pnl)
  .slice(0, CANDIDATES);
console.log(`리더보드 ${rows.length}명 중 조건 통과 상위 ${cands.length}명 분석`);

// 2) 체결 기록 (사람별 캐시, 하루 지나면 다시 받음)
async function fillsOf(addr: string): Promise<HlFill[]> {
  const f = path.join(fillDir, `${addr}.json`);
  if (fs.existsSync(f) && now - fs.statSync(f).mtimeMs < 24 * 3600_000) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const all: HlFill[] = [];
  let start = from;
  for (let page = 0; page < PAGES; page++) {
    let batch: HlFill[] = [];
    for (let tryNo = 0; ; tryNo++) {
      try {
        batch = await hl.userFillsByTime(addr, start);
        break;
      } catch (e) {
        if (tryNo >= 3 || !String((e as Error).message).includes('429')) throw e;
        await sleep(15_000 * (tryNo + 1)); // 요청 한도 초과 → 기다렸다 다시
      }
    }
    await sleep(1100); // 분당 가중치 1200 안쪽
    all.push(...batch);
    if (batch.length < 2000) break;
    start = batch[batch.length - 1].time + 1;
  }
  const mine = all.filter((x) => (COINS as readonly string[]).includes(x.coin));
  fs.writeFileSync(f, JSON.stringify(mine));
  return mine;
}

// 3) 업비트 1분봉
const rest = new UpbitRestClient({ baseUrl: 'https://api.upbit.com', getCredentials: () => null });
const bars: Record<string, Bar[]> = {};
for (const c of COINS) {
  bars[c] = await loadHistory(rest, `KRW-${c}`, '1m', from - 86_400_000, {
    cacheDir: path.resolve('data', 'backtest-cache'),
    onProgress: (a, b) => process.stdout.write(`\rKRW-${c} 1분봉 ${a}/${b}        `),
  });
}
process.stdout.write('\r' + ' '.repeat(50) + '\r');

interface Row {
  addr: string;
  name: string | null;
  accountValue: number;
  monthPnl: number;
  trades: ReplayTrade[];
  hlPnl: number;
  perCoin: Record<string, number>;
}
const sum = (t: ReplayTrade[]) => t.reduce((a, x) => a + x.ret, 0);
const stat = (t: ReplayTrade[]) => {
  const w = t.filter((x) => x.ret > 0);
  const gain = w.reduce((a, x) => a + x.ret, 0);
  const loss = -t.filter((x) => x.ret <= 0).reduce((a, x) => a + x.ret, 0);
  return { n: t.length, win: t.length ? (w.length / t.length) * 100 : 0, pf: loss > 0 ? gain / loss : gain > 0 ? Infinity : 0, total: sum(t) * 100, avg: t.length ? (sum(t) / t.length) * 100 : 0 };
};
const result: Row[] = [];
let k = 0;
for (const r of cands) {
  k++;
  process.stdout.write(`\r체결 기록 ${k}/${cands.length}        `);
  let fills: HlFill[];
  try {
    fills = await fillsOf(r.ethAddress);
  } catch (e) {
    console.log(`\n${r.ethAddress} 실패: ${(e as Error).message}`);
    await sleep(3000);
    continue;
  }
  const trades: ReplayTrade[] = [];
  const perCoin: Record<string, number> = {};
  for (const c of COINS) {
    const t = replayOnBars(longIntervals(fills.filter((x) => x.coin === c)), bars[c], { lagMs: LAG_MS, fee: FEE, slip: SLIP });
    perCoin[c] = t.length;
    trades.push(...t);
  }
  result.push({ addr: r.ethAddress, name: r.displayName, accountValue: Number(r.accountValue), monthPnl: perf(r, 'month').pnl, trades, hlPnl: fills.reduce((a, x) => a + Number(x.closedPnl), 0), perCoin });
}
process.stdout.write('\r' + ' '.repeat(50) + '\r');

// 4) 고르기: 앞 2/3 기간에 끝난 거래로 평가 (따라 하기 쉬운 사람: 보유가 너무 짧지 않음)
const closedIn = (t: ReplayTrade[], a: number, b: number) => t.filter((x) => !x.open && x.entryTime >= a && x.entryTime < b);
const scored = result
  .map((r) => {
    const early = closedIn(r.trades, from, splitAt);
    const late = closedIn(r.trades, splitAt, now + 1);
    const holdMin = r.trades.length ? r.trades.reduce((a, x) => a + (x.exitTime - x.entryTime), 0) / r.trades.length / 60_000 : 0;
    return { ...r, early: stat(early), late: stat(late), all: stat(r.trades.filter((x) => !x.open)), holdMin };
  })
  .filter((r) => r.all.n >= 4 && r.early.n >= 2 && r.holdMin >= 10);
const ranked = [...scored].sort((a, b) => b.early.total - a.early.total);
// 최종 선택: 60일 전체에서 롱 8번 이상(실험 중 실제로 거래가 생기도록) + PF 1.5 이상 + 앞·뒤 기간 모두 손실 아님 → 합계 수익 순
// (전체 기간으로 고르므로 '확인 구간'은 참고용. 진짜 검증은 앞으로의 모의투자)
const MIN_TRADES = Number(opt('minTrades') ?? 8);
const strict = [...scored]
  .filter((r) => r.all.n >= MIN_TRADES && r.all.pf >= 1.5 && r.early.total >= 0 && r.late.total >= 0)
  .sort((a, b) => b.all.total - a.all.total)
  .slice(0, PICK);
// 모자라면 거래 횟수 조건만 빼고 채운다(표에 '보충')
const fill = [...scored].filter((r) => !strict.includes(r) && r.all.pf >= 1.5 && r.all.total > 0).sort((a, b) => b.all.total - a.all.total).slice(0, Math.max(0, PICK - strict.length));
const picks = [...strict, ...fill];

const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '∞');
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '∞');
const d = (t: number) => new Date(t).toISOString().slice(0, 10);
console.log(`\n■ 기간 ${d(from)}~${d(now)} (고르기 ${d(from)}~${d(splitAt)} / 확인 ${d(splitAt)}~${d(now)}), 지연 ${LAG_MS / 1000}초`);
console.log(`BTC·ETH·XRP를 거래한 사람 ${result.filter((r) => r.trades.length > 0).length}명 중 롱 4번 이상(고르기 구간 2번 이상) + 평균 보유 10분 이상: ${scored.length}명`);
const show = (r: (typeof scored)[number]) => ({
  구분: strict.includes(r) ? '기준 통과' : fill.includes(r) ? '보충' : '',
  주소: `${r.addr.slice(0, 6)}…${r.addr.slice(-4)}`,
  계좌$: Math.round(r.accountValue).toLocaleString('en-US'),
  'BTC/ETH/XRP 횟수': COINS.map((c) => r.perCoin[c]).join('/'),
  평균보유: `${Math.round(r.holdMin)}분`,
  '고르기 구간': `${f1(r.early.win)}% PF${f2(r.early.pf)} 합${f1(r.early.total)}% n${r.early.n}`,
  '확인 구간': r.late.n ? `${f1(r.late.win)}% PF${f2(r.late.pf)} 합${f1(r.late.total)}% n${r.late.n}` : '-',
  전체: `${f1(r.all.win)}% PF${f2(r.all.pf)} 합${f1(r.all.total)}% n${r.all.n}`,
});
console.log('\n◆ 선택된 사람');
console.table(picks.map(show));
console.log('\n◆ 참고: 고르기 구간 상위 15명');
console.table(ranked.slice(0, 15).map(show));
const hold = (c: string, t0: number, t1: number) => {
  const xs = bars[c].filter((x) => x.start >= t0 && x.start < t1);
  return xs.length ? (xs[xs.length - 1].close / xs[0].open - 1) * 100 : 0;
};
console.log(`
비교: 그냥 보유 수익 — 전체 ${COINS.map((c) => `${c} ${f1(hold(c, from, now))}%`).join(' / ')} · 확인 구간 ${COINS.map((c) => `${c} ${f1(hold(c, splitAt, now))}%`).join(' / ')}`);
const pooledAll = stat(picks.flatMap((r) => r.trades.filter((x) => !x.open)));
console.log(`선택 ${picks.length}명 전체 기간 합산: 승률 ${f1(pooledAll.win)}% PF${f2(pooledAll.pf)} 1회 평균 ${f2(pooledAll.avg)}% n${pooledAll.n}`);
const pooledLate = stat(picks.flatMap((r) => closedIn(r.trades, splitAt, now + 1)));
const pooledAllCands = stat(scored.flatMap((r) => closedIn(r.trades, splitAt, now + 1)));
console.log(`\n확인 구간 합산 — 선택 ${picks.length}명: 승률 ${f1(pooledLate.win)}% PF${f2(pooledLate.pf)} 1회 평균 ${f2(pooledLate.avg)}% n${pooledLate.n}`);
console.log(`확인 구간 합산 — 후보 전체: 승률 ${f1(pooledAllCands.win)}% PF${f2(pooledAllCands.pf)} 1회 평균 ${f2(pooledAllCands.avg)}% n${pooledAllCands.n}`);
console.log('수익률은 업비트 원화 가격, 레버리지 없음, 수수료·미끄러짐 포함. ※ 과거 기록이 앞으로의 성과를 보장하지 않아요.');

fs.writeFileSync(
  path.join(dir, 'picks.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), days: DAYS, lagSec: LAG_MS / 1000, addresses: picks.map((r) => r.addr), picks: picks.map((r) => ({ address: r.addr, ...show(r) })) }, null, 2),
);
console.log(`저장: data/hyperliquid/picks.json`);
