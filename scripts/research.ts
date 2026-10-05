// 전략 연구용 빠른 백테스트 (여러 전략 × 파라미터 × 코인을 한꺼번에 비교)
//   npm run research                → 기본: BTC/ETH/XRP, 60분봉 4년·240분봉 6년
//   npm run research -- --units 60m --days 730
//
// 공정하게 비교하려고:
//  - 신호는 캔들이 닫힌 뒤 판단 → 다음 캔들 시가에 시장가 진입(미끄러짐 0.05%) — 미래 데이터 사용 금지
//  - 손절/익절이 같은 캔들 안에서 둘 다 닿으면 손절이 먼저라고 가정(보수적)
//  - 수수료 0.05% × 2, 시장가 미끄러짐 0.05% × 2
//  - 파라미터는 앞 70%(학습 구간)에서만 고르고, 뒤 30%(검증 구간)는 고른 뒤에 한 번만 본다
//  - 세 코인에 같은 파라미터를 써서(코인별로 따로 맞추지 않음) 과최적화를 줄인다
import fs from 'node:fs';
import path from 'node:path';
import type { CandleUnit } from '../shared/types';
import { UNIT_MS, loadHistory } from '../server/backtest/history';
import type { Bar } from '../server/indicators';
import { UpbitRestClient } from '../server/upbit/rest';

const args = process.argv.slice(2);
const opt = (n: string) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : undefined);
const MARKETS = (opt('market') ?? 'KRW-BTC,KRW-ETH,KRW-XRP').split(',');
const UNITS = (opt('units') ?? '60m,240m,1d').split(',') as CandleUnit[];
const DAYS: Record<string, number> = { '15m': 365, '60m': 1460, '240m': 2190, '1d': 2190 };
const ONLY = opt('only')?.split(',');
if (opt('days')) for (const u of UNITS) DAYS[u] = Number(opt('days'));
const IS_FRACTION = 0.7;
const FEE = 0.0005;
const SLIP = 0.0005;

// ───────────── 지표(배열) ─────────────
type Arr = Float64Array;
const nanArr = (n: number) => new Float64Array(n).fill(NaN);
function sma(v: ArrayLike<number>, n: number): Arr {
  const o = nanArr(v.length);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) o[i] = s / n;
  }
  return o;
}
function ema(v: ArrayLike<number>, n: number): Arr {
  const o = nanArr(v.length);
  const k = 2 / (n + 1);
  let p = NaN;
  for (let i = 0; i < v.length; i++) {
    if (i === n - 1) {
      let s = 0;
      for (let j = 0; j < n; j++) s += v[j];
      p = s / n;
    } else if (i >= n) p = v[i] * k + p * (1 - k);
    o[i] = i >= n - 1 ? p : NaN;
  }
  return o;
}
function vwma(c: ArrayLike<number>, vol: ArrayLike<number>, n: number): Arr {
  const o = nanArr(c.length);
  let pv = 0;
  let vv = 0;
  for (let i = 0; i < c.length; i++) {
    pv += c[i] * vol[i];
    vv += vol[i];
    if (i >= n) {
      pv -= c[i - n] * vol[i - n];
      vv -= vol[i - n];
    }
    if (i >= n - 1) o[i] = vv > 0 ? pv / vv : c[i];
  }
  return o;
}
function rsi(c: ArrayLike<number>, n: number): Arr {
  const o = nanArr(c.length);
  let g = 0;
  let l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    const up = Math.max(d, 0);
    const dn = Math.max(-d, 0);
    if (i <= n) {
      g += up;
      l += dn;
      if (i === n) {
        g /= n;
        l /= n;
        o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      }
    } else {
      g = (g * (n - 1) + up) / n;
      l = (l * (n - 1) + dn) / n;
      o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
  }
  return o;
}
function atr(b: Bar[], n: number): Arr {
  const tr = b.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close))));
  const o = nanArr(b.length);
  let p = NaN;
  for (let i = 0; i < b.length; i++) {
    if (i === n - 1) p = tr.slice(0, n).reduce((a, x) => a + x, 0) / n;
    else if (i >= n) p = (p * (n - 1) + tr[i]) / n;
    if (i >= n - 1) o[i] = p;
  }
  return o;
}
function stdev(v: ArrayLike<number>, n: number): Arr {
  const o = nanArr(v.length);
  const m = sma(v, n);
  for (let i = n - 1; i < v.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - m[i]) ** 2;
    o[i] = Math.sqrt(s / n);
  }
  return o;
}

interface Series {
  bars: Bar[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  cache: Map<string, Arr>;
  /** 하루에 캔들 몇 개(60분봉=24) — 일봉 기준 추세 필터 계산용 */
  bpd: number;
}
const get = (s: Series, key: string, fn: () => Arr) => {
  let a = s.cache.get(key);
  if (!a) s.cache.set(key, (a = fn()));
  return a;
};
const VWMA = (s: Series, n: number) => get(s, `vwma${n}`, () => vwma(s.c, s.v, n));
const EMA = (s: Series, n: number) => get(s, `ema${n}`, () => ema(s.c, n));
const SMA = (s: Series, n: number) => get(s, `sma${n}`, () => sma(s.c, n));
const RSI = (s: Series, n: number) => get(s, `rsi${n}`, () => rsi(s.c, n));
const ATR = (s: Series, n: number) => get(s, `atr${n}`, () => atr(s.bars, n));
const VOLMA = (s: Series, n: number) => get(s, `volma${n}`, () => sma(s.v, n));
const SD = (s: Series, n: number) => get(s, `sd${n}`, () => stdev(s.c, n));
/** 큰 흐름 필터: 종가가 '일봉 기준 days일 이동평균' 위이고 그 평균이 10일 전보다 높음 (하락장에서는 쉬기) */
const regimeOk = (s: Series, i: number, days: number) => {
  if (!days) return true;
  const n = Math.round(days * s.bpd);
  const m = get(s, `regime${n}`, () => sma(s.c, n));
  const back = Math.round(10 * s.bpd);
  return m[i] > 0 && s.c[i] > m[i] && i >= back && m[i] > m[i - back];
};

// ───────────── 전략 정의 ─────────────
interface Entry {
  /** 손절가(없으면 null) */
  stop: number | null;
  /** 익절가(없으면 null) */
  target: number | null;
  /** 지정가 매수(없으면 다음 시가 시장가). 지정가 기준으로 손절/익절을 정한다 */
  limit?: number;
  /** 지정가 유효 캔들 수 */
  valid?: number;
  /** 역지정가 매수: 다음 캔들 고가가 이 가격 이상이면 그 가격(시가가 더 높으면 시가)에 시장가 체결 */
  stopBuy?: number;
}
interface StrategyDef {
  name: string;
  params: Record<string, number>[];
  /** i번째 캔들이 닫힌 뒤 진입 신호. 진입은 i+1 시가. entryRef = 다음 시가(손절/익절 계산용) */
  entry: (s: Series, i: number, p: Record<string, number>, entryRef: number) => Entry | null;
  /** 보유 중 i번째 캔들 종가 기준 청산 신호(종가에 시장가 매도) */
  exit?: (s: Series, i: number, p: Record<string, number>, entryIdx: number) => boolean;
  /** 최대 보유 캔들 수(0 = 무제한) */
  maxHold?: (p: Record<string, number>) => number;
}

const grid = (o: Record<string, number[]>): Record<string, number>[] =>
  Object.entries(o).reduce<Record<string, number>[]>((acc, [k, vals]) => acc.flatMap((a) => vals.map((v) => ({ ...a, [k]: v }))), [{}]);

const withRegime = (st: StrategyDef): StrategyDef => ({
  ...st,
  name: `${st.name}+추세필터`,
  params: st.params.flatMap((p) => [50, 100].map((r) => ({ ...p, regime: r }))),
  entry: (s, i, p, ref) => (regimeOk(s, i, p.regime) ? st.entry(s, i, p, ref) : null),
});

const BASE_STRATS: StrategyDef[] = [
  {
    // 사용자 아이디어: VWMA100 지지 눌림목 — 상승 추세에서 VWMA100까지 내려왔다가 다시 위에서 마감
    name: 'VWMA눌림목',
    params: grid({ len: [50, 100, 200], touch: [0.002, 0.005], slAtr: [0.5, 1, 1.5], tpR: [0.5, 1, 1.5, 2, 3] }),
    entry: (s, i, p, ref) => {
      const w = VWMA(s, p.len);
      const a = ATR(s, 14)[i];
      if (!(w[i] > 0) || !(a > 0) || i < 10) return null;
      const up = w[i] > w[i - 10];
      const touched = s.l[i] <= w[i] * (1 + p.touch);
      const closedAbove = s.c[i] > w[i] && s.c[i] > s.o[i];
      if (!(up && touched && closedAbove)) return null;
      const stop = Math.min(s.l[i], w[i]) - p.slAtr * a;
      if (!(stop < ref)) return null;
      return { stop, target: ref + p.tpR * (ref - stop) };
    },
  },
  {
    // VWMA 돌파: 아래에 있다가 거래량 실린 양봉으로 VWMA 위 마감
    name: 'VWMA돌파',
    params: grid({ len: [50, 100, 200], volK: [1, 1.5, 2], slAtr: [1, 1.5, 2], tpR: [0.5, 1, 2, 3] }),
    entry: (s, i, p, ref) => {
      const w = VWMA(s, p.len);
      const a = ATR(s, 14)[i];
      const vm = VOLMA(s, 20)[i - 1];
      if (!(w[i] > 0) || !(a > 0) || !(vm > 0)) return null;
      if (!(s.c[i - 1] < w[i - 1] && s.c[i] > w[i] && s.v[i] >= vm * p.volK)) return null;
      const stop = ref - p.slAtr * a;
      return { stop, target: ref + p.tpR * (ref - stop) };
    },
  },
  {
    // RSI(2) 단기 과매도 (래리 코너스식): 장기 추세 위 + RSI2 극단 → 반등하면 바로 청산
    name: 'RSI2평균회귀',
    params: grid({ trend: [100, 200], th: [5, 10, 15], exitMa: [3, 5, 10], slAtr: [0, 2, 3], hold: [10, 30] }),
    entry: (s, i, p, ref) => {
      const t = SMA(s, p.trend)[i];
      const r = RSI(s, 2)[i];
      if (!(t > 0) || !(r >= 0)) return null;
      if (!(s.c[i] > t && r < p.th)) return null;
      const a = ATR(s, 14)[i];
      return { stop: p.slAtr > 0 ? ref - p.slAtr * a : null, target: null };
    },
    exit: (s, i, p) => s.c[i] > SMA(s, p.exitMa)[i],
    maxHold: (p) => p.hold,
  },
  {
    // 볼린저 하단 이탈 후 중심선 복귀 (상승 추세에서만)
    name: '볼린저회귀',
    params: grid({ trend: [100, 200], k: [2, 2.5], slAtr: [0, 2, 3], hold: [10, 30] }),
    entry: (s, i, p, ref) => {
      const m = SMA(s, 20)[i];
      const sd = SD(s, 20)[i];
      const t = EMA(s, p.trend)[i];
      if (!(m > 0) || !(t > 0)) return null;
      if (!(s.c[i] < m - p.k * sd && s.c[i] > t)) return null;
      const a = ATR(s, 14)[i];
      return { stop: p.slAtr > 0 ? ref - p.slAtr * a : null, target: null };
    },
    exit: (s, i) => s.c[i] >= SMA(s, 20)[i],
    maxHold: (p) => p.hold,
  },
  {
    // VWMA100 위 상승 추세 + RSI14 눌림 → RSI 회복 시 청산 (사용자 아이디어 + 평균회귀 결합)
    name: 'VWMA+RSI눌림',
    params: grid({ len: [100, 200], rsiIn: [30, 35, 40], rsiOut: [50, 55, 60], slAtr: [0, 2, 3], hold: [20, 50] }),
    entry: (s, i, p, ref) => {
      const w = VWMA(s, p.len);
      const r = RSI(s, 14)[i];
      if (!(w[i] > 0) || i < 10) return null;
      if (!(s.c[i] > w[i] && w[i] > w[i - 10] && r < p.rsiIn)) return null;
      const a = ATR(s, 14)[i];
      return { stop: p.slAtr > 0 ? ref - p.slAtr * a : null, target: null };
    },
    exit: (s, i, p) => RSI(s, 14)[i] > p.rsiOut,
    maxHold: (p) => p.hold,
  },
  {
    // 연속 하락 마감 N번 (상승 추세에서) → 첫 양봉/고점 돌파 마감에 청산
    name: '연속하락반등',
    params: grid({ n: [3, 4, 5], trend: [100, 200], slAtr: [0, 2, 3], hold: [5, 15] }),
    entry: (s, i, p, ref) => {
      const t = SMA(s, p.trend)[i];
      if (!(t > 0) || i < p.n) return null;
      for (let k = 0; k < p.n; k++) if (!(s.c[i - k] < s.c[i - k - 1])) return null;
      if (!(s.c[i] > t)) return null;
      const a = ATR(s, 14)[i];
      return { stop: p.slAtr > 0 ? ref - p.slAtr * a : null, target: null };
    },
    exit: (s, i) => s.c[i] > s.h[i - 1],
    maxHold: (p) => p.hold,
  },
  {
    // 비교용(추세추종, 승률 낮음 예상): 20봉 신고가 돌파 + 추세 필터, ATR 손절, R 배수 익절
    name: '신고가돌파',
    params: grid({ look: [20, 55], trend: [100, 200], slAtr: [1.5, 2.5], tpR: [1, 2, 3] }),
    entry: (s, i, p, ref) => {
      if (i < p.look + 1) return null;
      let hh = -Infinity;
      for (let k = i - p.look; k < i; k++) hh = Math.max(hh, s.h[k]);
      const t = EMA(s, p.trend)[i];
      if (!(s.c[i] > hh && s.c[i] > t)) return null;
      const a = ATR(s, 14)[i];
      const stop = ref - p.slAtr * a;
      return { stop, target: ref + p.tpR * (ref - stop) };
    },
  },
  {
    // 사용자 아이디어 개선: 상승 추세에서 VWMA까지 내려오면 '지정가'로 미리 받아 두고, 작은 반등(ATR 배수)에 익절
    name: 'VWMA지정가',
    params: grid({ len: [50, 100, 200], off: [0, 0.003], tpAtr: [0.5, 1, 1.5, 2], slAtr: [1.5, 2.5, 4], hold: [24, 72] }),
    entry: (s, i, p) => {
      const w = VWMA(s, p.len);
      const a = ATR(s, 14)[i];
      if (!(w[i] > 0) || !(a > 0) || i < 20) return null;
      // 상승 추세: VWMA가 20봉 전보다 높고, 종가가 VWMA 위(아직 닿기 전)
      if (!(w[i] > w[i - 20] && s.c[i] > w[i] * (1 + p.off) && s.l[i] > w[i] * (1 + p.off))) return null;
      const limit = w[i] * (1 + p.off);
      return { limit, valid: 3, stop: limit - p.slAtr * a, target: limit + p.tpAtr * a };
    },
    maxHold: (p) => p.hold,
  },
  {
    // VWMA 상승 추세 + RSI 눌림 → ATR 익절 또는 RSI 회복 중 먼저 오는 것
    name: 'RSI눌림+ATR익절',
    params: grid({ len: [100, 200], rsiIn: [30, 35, 40], rsiOut: [55, 65], tpAtr: [1, 1.5, 2], slAtr: [0, 3], hold: [30, 60] }),
    entry: (s, i, p, ref) => {
      const w = VWMA(s, p.len);
      const r = RSI(s, 14)[i];
      const a = ATR(s, 14)[i];
      if (!(w[i] > 0) || !(a > 0) || i < 20) return null;
      if (!(s.c[i] > w[i] && w[i] > w[i - 20] && r < p.rsiIn)) return null;
      return { stop: p.slAtr > 0 ? ref - p.slAtr * a : null, target: ref + p.tpAtr * a };
    },
    exit: (s, i, p) => RSI(s, 14)[i] > p.rsiOut,
    maxHold: (p) => p.hold,
  },
  {
    // 변동성 돌파(래리 윌리엄스, 업비트에서 많이 쓰는 방식): 오늘 시가 + k×어제 변동폭을 넘으면 사고, 그날 종가(다음날 시작)에 판다
    name: '변동성돌파',
    params: grid({ k: [0.3, 0.4, 0.5, 0.6], ma: [0, 5, 10, 20], slPct: [0, 0.02, 0.04] }),
    entry: (s, i, p, ref) => {
      if (s.bpd !== 1) return null; // 일봉 전용
      const range = s.h[i] - s.l[i];
      if (!(range > 0)) return null;
      if (p.ma > 0 && !(ref > SMA(s, p.ma)[i])) return null;
      const stopBuy = ref + p.k * range;
      return { stopBuy, stop: p.slPct > 0 ? stopBuy * (1 - p.slPct) : null, target: null };
    },
    maxHold: () => 1,
  },
  {
    // 큰 추세(긴 EMA) 위에서 볼린저 하단 → 중심선 복귀
    name: '볼린저회귀(큰추세)',
    params: grid({ trend: [200, 400, 800], k: [1.5, 2, 2.5], slAtr: [0, 3, 5], hold: [20, 40] }),
    entry: (s, i, p, ref) => {
      const m = SMA(s, 20)[i];
      const sd = SD(s, 20)[i];
      const t = EMA(s, p.trend)[i];
      if (!(m > 0) || !(t > 0) || i < 50) return null;
      if (!(s.c[i] < m - p.k * sd && s.c[i] > t && t > EMA(s, p.trend)[i - 50])) return null;
      const a = ATR(s, 14)[i];
      return { stop: p.slAtr > 0 ? ref - p.slAtr * a : null, target: null };
    },
    exit: (s, i) => s.c[i] >= SMA(s, 20)[i],
    maxHold: (p) => p.hold,
  },
  {
    // TradingView 'Momentum Sequence Strategy+ [Herman]': 음봉(기준) 뒤 n개 연속 양봉,
    // 각 양봉 저가 > 기준 음봉 저가, 종가가 계속 높아짐 → 다음 시가 매수. 손절 = 기준 음봉 저가, 익절 = 마지막 종가 + R배수
    name: '모멘텀시퀀스',
    params: grid({ n: [2, 3, 4, 5], tpR: [0.5, 1, 1.5, 2] }),
    entry: (s, i, p, ref) => {
      const m = i - p.n;
      if (m < 1 || !(s.c[m] < s.o[m])) return null;
      for (let k = m + 1; k <= i; k++) {
        if (!(s.c[k] > s.o[k] && s.l[k] > s.l[m] && s.c[k] > s.c[k - 1])) return null;
      }
      const stop = s.l[m];
      const risk = s.c[i] - stop;
      if (!(risk > 0) || !(stop < ref)) return null;
      return { stop, target: s.c[i] + p.tpR * risk };
    },
  },
];

const REGIME_TARGETS = ['모멘텀시퀀스', 'VWMA눌림목', 'VWMA돌파', 'RSI2평균회귀', '볼린저회귀', 'VWMA+RSI눌림', 'VWMA지정가', 'RSI눌림+ATR익절'];
const STRATS: StrategyDef[] = [...BASE_STRATS, ...BASE_STRATS.filter((x) => REGIME_TARGETS.includes(x.name)).map(withRegime)];

// ───────────── 거래 시뮬레이션 ─────────────
interface Trade {
  ret: number; // 수수료·미끄러짐 포함 수익률(소수)
  bars: number;
}
function simulate(s: Series, st: StrategyDef, p: Record<string, number>, from: number, to: number): Trade[] {
  const trades: Trade[] = [];
  const maxHold = st.maxHold?.(p) ?? 0;
  let i = Math.max(from, 210, Math.round(s.bpd * 110));
  while (i < to - 1) {
    const ref = s.o[i + 1];
    const e = st.entry(s, i, p, ref);
    if (!e) {
      i++;
      continue;
    }
    let entryIdx = i + 1;
    let entry = ref * (1 + SLIP);
    if (e.stopBuy != null) {
      const k = i + 1;
      if (!(s.h[k] >= e.stopBuy)) {
        i++;
        continue;
      }
      entryIdx = k;
      entry = Math.max(s.o[k], e.stopBuy) * (1 + SLIP);
    } else if (e.limit != null) {
      // 지정가: 유효 기간 안에 저가가 닿으면 체결(시가가 이미 아래면 시가), 미끄러짐 없음
      let filled = false;
      for (let k = i + 1; k < Math.min(to, i + 1 + (e.valid ?? 1)); k++) {
        if (s.l[k] <= e.limit) {
          entryIdx = k;
          entry = Math.min(s.o[k], e.limit);
          filled = true;
          break;
        }
      }
      if (!filled) {
        i++;
        continue;
      }
    }
    let exitPrice = NaN;
    let j = entryIdx;
    for (; j < to; j++) {
      // 캔들 안: 손절 먼저 확인(보수적), 시가가 이미 넘어섰으면 시가로
      if (e.stop != null && s.l[j] <= e.stop) {
        exitPrice = Math.min(s.o[j], e.stop) * (1 - SLIP);
        break;
      }
      // 지정가로 체결된 그 캔들의 고가는 체결 '전'에 찍혔을 수 있으므로(순서를 모름) 그 캔들에서는 익절로 치지 않는다
      const sameBarLimitFill = e.limit != null && j === entryIdx;
      if (e.target != null && !sameBarLimitFill && s.h[j] >= e.target) {
        exitPrice = Math.max(s.o[j], e.target); // 익절은 지정가(미끄러짐 없음)
        break;
      }
      if (st.exit && j > entryIdx - 1 && st.exit(s, j, p, entryIdx)) {
        exitPrice = s.c[j] * (1 - SLIP);
        break;
      }
      if (maxHold > 0 && j - entryIdx + 1 >= maxHold) {
        exitPrice = s.c[j] * (1 - SLIP);
        break;
      }
    }
    if (!Number.isFinite(exitPrice)) break; // 구간 끝까지 보유 → 집계에서 제외
    const ret = (exitPrice * (1 - FEE)) / (entry * (1 + FEE)) - 1;
    trades.push({ ret, bars: j - entryIdx + 1 });
    i = j + 1;
  }
  return trades;
}

interface Stats {
  n: number;
  winRate: number;
  pf: number;
  avgWin: number;
  avgLoss: number;
  totalRet: number; // 복리(%)
  mdd: number; // %
  expectancy: number; // 1회 평균(%)
  exposure: number; // 보유 캔들 비율(%)
  worst: number; // 가장 큰 1회 손실(%)
}
function stats(t: Trade[], span: number): Stats {
  const w = t.filter((x) => x.ret > 0);
  const l = t.filter((x) => x.ret <= 0);
  const sw = w.reduce((a, x) => a + x.ret, 0);
  const sl = l.reduce((a, x) => a + x.ret, 0);
  let eq = 1;
  let peak = 1;
  let mdd = 0;
  for (const x of t) {
    eq *= 1 + x.ret;
    peak = Math.max(peak, eq);
    mdd = Math.max(mdd, (peak - eq) / peak);
  }
  return {
    n: t.length,
    winRate: t.length ? (w.length / t.length) * 100 : 0,
    pf: sl < 0 ? sw / -sl : sw > 0 ? 99 : 0,
    avgWin: w.length ? (sw / w.length) * 100 : 0,
    avgLoss: l.length ? (sl / l.length) * 100 : 0,
    totalRet: (eq - 1) * 100,
    mdd: mdd * 100,
    expectancy: t.length ? ((sw + sl) / t.length) * 100 : 0,
    exposure: span > 0 ? (t.reduce((a, x) => a + x.bars, 0) / span) * 100 : 0,
    worst: t.length ? Math.min(...t.map((x) => x.ret)) * 100 : 0,
  };
}

// ───────────── 실행 ─────────────
const rest = new UpbitRestClient({ baseUrl: 'https://api.upbit.com', getCredentials: () => null });
const cacheDir = path.resolve('data', 'backtest-cache');
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

const report: unknown[] = [];
for (const unit of opt('robust') ? [] : UNITS) {
  const series: Record<string, Series> = {};
  for (const m of MARKETS) {
    process.stdout.write(`\r${m} ${unit} ${DAYS[unit]}일 캔들 준비 중...          `);
    const bars = await loadHistory(rest, m, unit, Date.now() - DAYS[unit] * 86_400_000, {
      cacheDir,
      onProgress: (a, b) => process.stdout.write(`\r${m} ${unit} 캔들 ${a}/${b}          `),
    });
    series[m] = { bars, o: bars.map((b) => b.open), h: bars.map((b) => b.high), l: bars.map((b) => b.low), c: bars.map((b) => b.close), v: bars.map((b) => b.volume), cache: new Map(), bpd: Math.round(86_400_000 / UNIT_MS[unit]) };
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  const anyBars = series[MARKETS[0]].bars;
  const split = (s: Series) => Math.floor(s.bars.length * IS_FRACTION);
  const d0 = new Date(anyBars[0].start).toISOString().slice(0, 10);
  const dS = new Date(anyBars[split(series[MARKETS[0]])].start).toISOString().slice(0, 10);
  const d1 = new Date(anyBars[anyBars.length - 1].start).toISOString().slice(0, 10);
  console.log(`\n■ ${unit}봉 — 학습 ${d0}~${dS} / 검증 ${dS}~${d1}`);

  const rows: Array<Record<string, string>> = [];
  for (const st of STRATS.filter((x) => !ONLY || ONLY.includes(x.name))) {
    // 학습 구간에서 세 코인 모두 거래가 충분하고, 승률 70%↑ 중 기대값(1회 평균 수익)이 가장 큰 파라미터
    let best: { p: Record<string, number>; score: number; is: Stats[]; pooled: Stats } | null = null;
    let bestAny: { p: Record<string, number>; score: number; is: Stats[]; pooled: Stats } | null = null;
    for (const p of st.params) {
      const isTrades = MARKETS.map((m) => simulate(series[m], st, p, 0, split(series[m])));
      const isStats = isTrades.map((t, k) => stats(t, split(series[MARKETS[k]])));
      if (isStats.some((x) => x.n < 10)) continue;
      const pooled = stats(isTrades.flat(), 0);
      const minPf = Math.min(...isStats.map((x) => x.pf));
      // 점수 = 세 코인 합친 총 기대 수익(1회 평균 × 횟수). 거래가 너무 드물면 신뢰도가 낮으므로 횟수도 반영
      const score = pooled.expectancy * pooled.n;
      if (!bestAny || score > bestAny.score) bestAny = { p, score, is: isStats, pooled };
      if (pooled.winRate >= 70 && pooled.pf >= 1.2 && minPf >= 1 && (!best || score > best.score)) best = { p, score, is: isStats, pooled };
    }
    const pick = best ?? bestAny;
    if (!pick) {
      rows.push({ 전략: st.name, 결과: '거래가 너무 적음' });
      continue;
    }
    const oosTrades = MARKETS.map((m) => simulate(series[m], st, pick.p, split(series[m]), series[m].bars.length));
    const oos = oosTrades.map((t, k) => stats(t, series[MARKETS[k]].bars.length - split(series[MARKETS[k]])));
    const oosPooled = stats(oosTrades.flat(), 0);
    report.push({ unit, strategy: st.name, params: pick.p, meetsWinRate70: !!best, insample: pick.is, insamplePooled: pick.pooled, outOfSample: oos, outOfSamplePooled: oosPooled });
    rows.push({
      전략: st.name,
      '70%기준': best ? '충족' : '미달',
      파라미터: Object.entries(pick.p).map(([k, v]) => `${k}=${v}`).join(' '),
      '학습 합산': `${f1(pick.pooled.winRate)}% PF${f2(pick.pooled.pf)} n${pick.pooled.n}`,
      '검증 합산': `${f1(oosPooled.winRate)}% PF${f2(oosPooled.pf)} n${oosPooled.n} 평균${f2(oosPooled.expectancy)}%`,
      '학습 승률': pick.is.map((x) => f1(x.winRate)).join('/'),
      '학습 PF': pick.is.map((x) => f2(x.pf)).join('/'),
      '검증 승률': oos.map((x) => f1(x.winRate)).join('/'),
      '검증 PF': oos.map((x) => f2(x.pf)).join('/'),
      '검증 수익%': oos.map((x) => f1(x.totalRet)).join('/'),
      '검증 MDD%': oos.map((x) => f1(x.mdd)).join('/'),
      '검증 횟수': oos.map((x) => String(x.n)).join('/'),
      '평균익/손%': oos.map((x) => `${f2(x.avgWin)}/${f2(x.avgLoss)}`).join(' '),
    });
  }
  console.table(rows);
}
console.log('값은 BTC/ETH/XRP 순서. PF = 총이익÷총손실(1 넘어야 이익). 수수료·미끄러짐 포함.');
console.log('※ 과거 결과가 미래 수익을 보장하지 않아요.');
if (!opt('robust')) {
  fs.mkdirSync(path.resolve('data', 'research'), { recursive: true });
  fs.writeFileSync(path.resolve('data', 'research', 'latest.json'), JSON.stringify(report, null, 2));
}

// ───────────── 견고성 점검: npm run research -- --units 60m --robust 볼린저회귀 ─────────────
// 이웃 파라미터들도 비슷하게 좋은지(우연히 한 점만 좋은 게 아닌지) + 연도별로 꾸준한지
const ROBUST = opt('robust');
if (ROBUST) {
  const st = STRATS.find((x) => x.name === ROBUST);
  if (!st) throw new Error(`전략 없음: ${ROBUST}`);
  const extra = opt('grid') ? (JSON.parse(opt('grid')!) as Record<string, number[]>) : null;
  const params = extra ? grid(extra) : st.params;
  for (const unit of UNITS) {
    const ser: Series[] = [];
    for (const m of MARKETS) {
      const bars = await loadHistory(rest, m, unit, Date.now() - DAYS[unit] * 86_400_000, { cacheDir });
      ser.push({ bars, o: bars.map((b) => b.open), h: bars.map((b) => b.high), l: bars.map((b) => b.low), c: bars.map((b) => b.close), v: bars.map((b) => b.volume), cache: new Map(), bpd: Math.round(86_400_000 / UNIT_MS[unit]) });
    }
    console.log(`\n◆ 견고성 ${ROBUST} ${unit} — 전체 기간, 세 코인 합산`);
    const rows: Array<Record<string, string>> = [];
    for (const p of params) {
      const per = ser.map((s) => simulate(s, st, p, 0, s.bars.length));
      const pooled = stats(per.flat(), 0);
      const years = new Map<number, Trade[]>();
      // 연도별: 거래 종료 시점이 아니라 단순화를 위해 구간을 연 단위로 나눠 다시 시뮬레이션
      const y0 = new Date(ser[0].bars[0].start).getUTCFullYear();
      const y1 = new Date(ser[0].bars[ser[0].bars.length - 1].start).getUTCFullYear();
      for (let y = y0; y <= y1; y++) {
        const from = Date.UTC(y, 0, 1);
        const to = Date.UTC(y + 1, 0, 1);
        const t = ser.flatMap((s) => {
          const a = s.bars.findIndex((b) => b.start >= from);
          let b = s.bars.findIndex((x) => x.start >= to);
          if (b < 0) b = s.bars.length;
          return a < 0 ? [] : simulate(s, st, p, a, b);
        });
        years.set(y, t);
      }
      rows.push({
        파라미터: Object.entries(p).map(([k, v]) => `${k}=${v}`).join(' '),
        합산: `${f1(pooled.winRate)}% PF${f2(pooled.pf)} n${pooled.n} 평균${f2(pooled.expectancy)}%`,
        코인별PF: per.map((t) => f2(stats(t, 0).pf)).join('/'),
        '평균익/손·최악': `${f2(pooled.avgWin)}/${f2(pooled.avgLoss)} 최악${f1(pooled.worst)}% MDD${f1(Math.max(...per.map((t) => stats(t, 0).mdd)))}%`,
        ...Object.fromEntries([...years].map(([y, t]) => {
          const x = stats(t, 0);
          return [String(y), x.n ? `${f1(x.winRate)}%/${f2(x.pf)}/n${x.n}` : '-'];
        })),
      });
    }
    for (const r of rows) console.log('  ' + Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' | '));
  }
  process.exit(0);
}
