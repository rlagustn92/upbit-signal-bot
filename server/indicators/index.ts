/**
 * 기술적 지표. 순수 함수로만 구성(테스트 용이).
 * 입력은 시간 오름차순(과거 → 최신) 종가 배열.
 */

/** 단순 이동평균. 길이가 부족하면 null */
export function sma(values: number[], period: number, endIndex = values.length - 1): number | null {
  if (period <= 0 || endIndex + 1 < period) return null;
  let sum = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i++) sum += values[i];
  return sum / period;
}

/**
 * RSI (Wilder 평활). 업비트 가이드(docs: RSI 지표 산출)와 동일한 Wilder 방식.
 * 반환: 각 인덱스의 RSI (앞쪽 period개는 null)
 */
export function rsiSeries(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = closes.map(() => null);
  if (period <= 0 || closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = toRsi(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function lastRsi(closes: number[], period = 14): number | null {
  const s = rsiSeries(closes, period);
  return s[s.length - 1] ?? null;
}

/** 지수이동평균 시리즈. 앞쪽 period-1개는 null, 첫 값은 SMA로 시작 */
export function emaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = values.map(() => null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function lastEma(values: number[], period: number): number | null {
  const s = emaSeries(values, period);
  return s[s.length - 1] ?? null;
}

export interface Bar {
  start: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** ATR(Wilder). 변동성(한 봉의 평균 움직임 폭) */
export function atr(bars: Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)));
  }
  let a = 0;
  for (let i = 0; i < period; i++) a += tr[i];
  a /= period;
  for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
  return a;
}

/** 최근 period개 봉(마지막 봉 제외 가능)의 평균 거래량 */
export function averageVolume(bars: Bar[], period: number, excludeLast = true): number | null {
  const end = excludeLast ? bars.length - 1 : bars.length;
  if (end < period) return null;
  let s = 0;
  for (let i = end - period; i < end; i++) s += bars[i].volume;
  return s / period;
}

export type CrossEvent = 'GOLDEN' | 'DEAD' | null;

/**
 * 직전 봉과 현재 봉의 단기/장기 이평 관계로 교차 "이벤트"를 판단.
 *  GOLDEN: 이전 short <= long  &&  현재 short > long
 *  DEAD:   이전 short >= long  &&  현재 short < long
 * 단순히 short > long 상태인 것만으로는 이벤트가 아니다(중복 진입 방지).
 */
export function detectCross(
  closes: number[],
  shortPeriod: number,
  longPeriod: number,
  maType: 'SMA' | 'EMA' = 'SMA',
): { event: CrossEvent; short: number | null; long: number | null } {
  const n = closes.length - 1;
  let sNow: number | null, lNow: number | null, sPrev: number | null, lPrev: number | null;
  if (maType === 'EMA') {
    const s = emaSeries(closes, shortPeriod);
    const l = emaSeries(closes, longPeriod);
    [sNow, lNow, sPrev, lPrev] = [s[n] ?? null, l[n] ?? null, s[n - 1] ?? null, l[n - 1] ?? null];
  } else {
    sNow = sma(closes, shortPeriod, n);
    lNow = sma(closes, longPeriod, n);
    sPrev = sma(closes, shortPeriod, n - 1);
    lPrev = sma(closes, longPeriod, n - 1);
  }
  if (sNow == null || lNow == null || sPrev == null || lPrev == null) return { event: null, short: sNow, long: lNow };
  if (sPrev <= lPrev && sNow > lNow) return { event: 'GOLDEN', short: sNow, long: lNow };
  if (sPrev >= lPrev && sNow < lNow) return { event: 'DEAD', short: sNow, long: lNow };
  return { event: null, short: sNow, long: lNow };
}
